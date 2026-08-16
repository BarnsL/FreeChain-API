// OpenAI-compatible HTTP surface. Any client that can talk to api.openai.com
// can talk to this: editor assistants, agent frameworks, curl, the OpenAI SDKs.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chainStatus, resolveAccounts, resolveKeys } from './config.js';
import { Cooldowns, dispatch, ChainError } from './chain.js';
import { IS_SEA, EXE_DIR } from './runtime.js';
import {
  inventory,
  saveSlotKeys,
  testSlot,
  reorderChain,
  getAccessKey,
  rotateAccessKey,
  accessKeyMatches,
  bearerFrom,
} from './admin.js';

// A packaged binary ships its webui/ folder next to the executable, not
// next to this source file.
const WEBUI_DIR = IS_SEA
  ? path.join(EXE_DIR, 'webui')
  : path.join(path.dirname(fileURLToPath(import.meta.url)), 'webui');
const DEEP_HEALTH_MIN_INTERVAL_MS = 60_000;
const DEEP_HEALTH_MAX_TIMEOUT_MS = 15_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
};

// OpenAI clients expect this error envelope, not a bare string.
const fail = (res, code, message, extra = {}) =>
  json(res, code, { error: { message, type: 'freechain_error', ...extra } });

function readJson(req, limitBytes = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error('request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(Object.assign(new Error(`invalid JSON body: ${err.message}`), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(WEBUI_DIR, rel);
  // Never serve outside the UI directory, whatever the request path claims.
  if (!file.startsWith(WEBUI_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return false;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(fs.readFileSync(file));
  return true;
}

// This is deliberately separate from normal dispatch: a deep health check
// probes each configured link exactly once and must never return provider text.
async function probeLink(link, timeoutMs, signal) {
  const account = resolveAccounts(link.provider)[0];
  const startedAt = Date.now();
  const result = {
    index: link.index,
    provider: link.provider,
    model: link.model,
    latencyMs: 0,
    status: 'network-error',
    reason: 'network error',
  };

  try {
    const response = await fetch(`${link.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      headers: {
        'Content-Type': 'application/json',
        ...(account?.key ? { Authorization: `Bearer ${account.key}` } : {}),
        ...link.headers,
      },
      body: JSON.stringify({
        model: link.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
    });
    // Do not inspect the body: it may contain provider output or diagnostics.
    response.body?.cancel().catch(() => {});
    result.status = response.ok ? 'ok' : 'http-error';
    result.reason = `HTTP ${response.status}`;
  } catch (err) {
    if (signal?.aborted) return null;
    if (err?.name === 'TimeoutError') {
      result.status = 'timeout';
      result.reason = 'request timeout';
    }
  }

  result.latencyMs = Date.now() - startedAt;
  return result;
}

export function createServer(chain, { verbose = false, ui = true } = {}) {
  const cooldowns = new Cooldowns(chain.settings.cooldownMs);
  const stats = { served: 0, failed: 0, startedAt: Date.now() };
  let nextDeepHealthAt = 0;

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers':
          'Content-Type, Authorization, X-Stainless-Lang, X-Stainless-Package-Version, X-Stainless-OS, X-Stainless-Arch, X-Stainless-Runtime, X-Stainless-Runtime-Version, X-Stainless-Retry-Count, X-Stainless-Timeout, X-Stainless-Helper-Method',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      });
      return res.end();
    }

    if (url.pathname === '/healthz' || url.pathname === '/v1/status') {
      const status = chainStatus(chain);
      return json(res, 200, {
        ok: status.some((l) => l.hasKey),
        links: status,
        cooling: cooldowns.snapshot(),
        settings: chain.settings,
        stats: { ...stats, uptimeSeconds: Math.round((Date.now() - stats.startedAt) / 1000) },
      });
    }

    if (url.pathname === '/v1/health/deep' && req.method === 'POST') {
      if (!accessKeyMatches(bearerFrom(req))) {
        return fail(res, 401, 'Invalid API key. Use the access key from the FreeChain dashboard.', {
          code: 'invalid_api_key',
        });
      }
      try {
        await readJson(req, 16 * 1024); // request content is intentionally ignored
      } catch (err) {
        return fail(res, err.statusCode || 400, err.message);
      }

      const abort = new AbortController();
      res.once('close', () => {
        if (!res.writableEnded) abort.abort();
      });

      const now = Date.now();
      if (now < nextDeepHealthAt) {
        return fail(res, 429, 'Deep health checks are rate-limited.', {
          retryAfterMs: nextDeepHealthAt - now,
        });
      }
      nextDeepHealthAt = now + DEEP_HEALTH_MIN_INTERVAL_MS;

      const timeoutMs = Math.min(chain.settings.requestTimeoutMs, DEEP_HEALTH_MAX_TIMEOUT_MS);
      const links = [];
      for (const link of chain.links) {
        if (abort.signal.aborted) return;
        const configured = link.keyOptional || resolveAccounts(link.provider).length > 0;
        if (!configured) continue;
        const result = await probeLink(link, timeoutMs, abort.signal);
        if (abort.signal.aborted) return;
        links.push(result);
      }

      return json(res, 200, {
        ok: links.length > 0 && links.every((link) => link.status === 'ok'),
        links,
      });
    }

    // ── Admin API, consumed by the web UI on the same origin ──────────
    if (ui && url.pathname.startsWith('/admin/')) {
      try {
        if (url.pathname === '/admin/state' && req.method === 'GET') {
          return json(res, 200, {
            ...inventory(chain),
            accessKeyMasked: getAccessKey() ? '••••••••' : null,
            cooling: cooldowns.snapshot(),
            stats: { ...stats, uptimeSeconds: Math.round((Date.now() - stats.startedAt) / 1000) },
          });
        }
        // Revealed only on explicit request: this key is meant to be copied
        // into other apps, unlike the provider keys which never leave here.
        if (url.pathname === '/admin/access-key' && req.method === 'GET') {
          return json(res, 200, { key: getAccessKey() });
        }
        if (url.pathname === '/admin/access-key/rotate' && req.method === 'POST') {
          return json(res, 200, { key: rotateAccessKey() });
        }
        if (url.pathname === '/admin/keys' && req.method === 'POST') {
          const { slot, keys } = await readJson(req);
          if (!slot || !Array.isArray(keys)) return fail(res, 400, 'slot and keys[] are required');
          const count = saveSlotKeys(slot, keys);
          return json(res, 200, { slot, count });
        }
        if (url.pathname === '/admin/test' && req.method === 'POST') {
          const { slot } = await readJson(req);
          if (!slot) return fail(res, 400, 'slot is required');
          return json(res, 200, await testSlot(chain, slot));
        }
        if (url.pathname === '/admin/chain/reorder' && req.method === 'POST') {
          const { order } = await readJson(req);
          if (!Array.isArray(order)) return fail(res, 400, 'order[] is required');
          reorderChain(chain, order);
          return json(res, 200, { ok: true, count: chain.links.length });
        }
      } catch (err) {
        return fail(res, err.statusCode || 500, String(err.message || err));
      }
      return fail(res, 404, `No admin route for ${req.method} ${url.pathname}`);
    }

    // "auto" is the point of the whole service: let the chain decide.
    if (url.pathname === '/v1/models') {
      if (!accessKeyMatches(bearerFrom(req))) {
        return fail(res, 401, 'Invalid API key. Use the access key from the FreeChain dashboard.', {
          code: 'invalid_api_key',
        });
      }
      const seen = new Set();
      const data = [{ id: 'auto', object: 'model', owned_by: 'freechain' }];
      for (const l of chain.links) {
        if (seen.has(l.model)) continue;
        seen.add(l.model);
        const keyCount = resolveKeys(l.provider).length;
        data.push({
          id: l.model,
          object: 'model',
          owned_by: l.provider,
          freechain: { free: l.free, keyCount, hasKey: l.keyOptional || keyCount > 0 },
        });
      }
      return json(res, 200, { object: 'list', data });
    }

    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      // The access key is what stops any other process on the machine from
      // spending the provider credentials this server holds.
      if (!accessKeyMatches(bearerFrom(req))) {
        return fail(res, 401, 'Invalid API key. Use the access key from the FreeChain dashboard.', {
          code: 'invalid_api_key',
        });
      }
      let body;
      try {
        body = await readJson(req);
      } catch (err) {
        return fail(res, err.statusCode || 400, err.message);
      }
      if (!Array.isArray(body.messages) || !body.messages.length) {
        return fail(res, 400, '"messages" must be a non-empty array');
      }

      const abort = new AbortController();
      req.on('close', () => {
        if (!res.writableEnded) abort.abort();
      });

      try {
        const { response, link, provider, keyIndex, attempts } = await dispatch(chain, cooldowns, body, {
          signal: abort.signal,
          onAttempt: (a) => {
            if (verbose || a.outcome !== 'ok') {
              console.log(
                `[freechain] ${a.provider}/${a.model} key#${a.keyIndex} ${a.outcome} (${a.ms}ms) ${a.detail ?? ''}`.trim()
              );
            }
          },
        });

        // Tell the caller which link actually served it — without this the
        // failover is invisible and impossible to debug from the client side.
        // Provider is the account slot that answered (e.g. "openrouter2") and
        // key index is its ordinal within that slot. Never the key itself.
        const served = {
          'X-Freechain-Provider': provider,
          'X-Freechain-Model': link.model,
          'X-Freechain-Key-Index': String(keyIndex),
          'X-Freechain-Attempts': String(attempts.length),
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers':
            'X-Freechain-Provider, X-Freechain-Model, X-Freechain-Key-Index, X-Freechain-Attempts',
        };

        stats.served++;
        if (body.stream) {
          res.writeHead(200, {
            ...served,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          // Pass SSE through untouched; re-chunking risks splitting events.
          for await (const chunk of response.body) {
            if (!res.write(chunk)) await new Promise((r) => res.once('drain', r));
          }
          return res.end();
        }

        const payload = await response.text();
        res.writeHead(200, {
          ...served,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        });
        return res.end(payload);
      } catch (err) {
        if (abort.signal.aborted) return; // client gone, nothing to answer
        stats.failed++;
        if (err instanceof ChainError) {
          return fail(res, 502, err.message, { attempts: err.attempts });
        }
        console.error('[freechain] unexpected error:', err);
        return fail(res, 500, String(err.message || err));
      }
    }

    if (ui && req.method === 'GET' && serveStatic(res, url.pathname)) return;

    return fail(res, 404, `No route for ${req.method} ${url.pathname}`);
  });
}
