// OpenAI-compatible HTTP surface. Any client that can talk to api.openai.com
// can talk to this: editor assistants, agent frameworks, curl, the OpenAI SDKs.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chainStatus, resolveKeys } from './config.js';
import { Cooldowns, dispatch, ChainError } from './chain.js';
import {
  inventory,
  saveSlotKeys,
  testSlot,
  getAccessKey,
  rotateAccessKey,
  accessKeyMatches,
  bearerFrom,
} from './admin.js';

const WEBUI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'webui');

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

export function createServer(chain, { verbose = false, ui = true } = {}) {
  const cooldowns = new Cooldowns(chain.settings.cooldownMs);
  const stats = { served: 0, failed: 0, startedAt: Date.now() };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
      } catch (err) {
        return fail(res, err.statusCode || 500, String(err.message || err));
      }
      return fail(res, 404, `No admin route for ${req.method} ${url.pathname}`);
    }

    // "auto" is the point of the whole service: let the chain decide.
    if (url.pathname === '/v1/models') {
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
