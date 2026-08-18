// OpenAI-compatible HTTP surface. Any client that can talk to api.openai.com
// can talk to this: editor assistants, agent frameworks, curl, the OpenAI SDKs.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
import { shortcutStatus, createShortcut, dismissShortcut } from './shortcut.js';
import {
  RequestJournal,
  createSseMeter,
  estimatedUsage,
  requestMetadata,
  summarizeInput,
  summarizeJsonOutput,
} from './request-journal.js';

// A packaged binary ships its webui/ folder next to the executable, not
// next to this source file.
const WEBUI_DIR = IS_SEA
  ? path.join(EXE_DIR, 'webui')
  : path.join(path.dirname(fileURLToPath(import.meta.url)), 'webui');
const DEEP_HEALTH_MIN_INTERVAL_MS = 60_000;
const DEEP_HEALTH_MAX_TIMEOUT_MS = 15_000;
const PASSIVE_JOURNAL_ROUTES = new Set(['/v1/logs', '/v1/status']);
const ADMIN_AUDIT_ROUTES = new Map([
  ['GET /admin/access-key', ['access-key-revealed', 'access-key']],
  ['POST /admin/access-key/rotate', ['access-key-rotated', 'access-key']],
  ['POST /admin/keys', ['provider-keys-updated', 'provider-slot']],
  ['POST /admin/test', ['provider-tested', 'provider-slot']],
  ['POST /admin/chain/reorder', ['chain-reordered', 'chain']],
  ['POST /admin/shortcut/create', ['shortcut-created', 'shortcut']],
  ['POST /admin/shortcut/dismiss', ['shortcut-dismissed', 'shortcut']],
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/**
 * Write one JSON response and end it. `cors: true` adds the wildcard CORS
 * header used by the OpenAI-compatible routes; admin routes never pass it, so
 * their responses stay unreadable from another origin.
 */
const json = (res, code, obj, { cors = false } = {}) => {
  const body = JSON.stringify(obj);
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  };
  if (cors) headers['Access-Control-Allow-Origin'] = '*';
  res.writeHead(code, headers);
  res.end(body);
};

// OpenAI clients expect this error envelope, not a bare string.
const fail = (res, code, message, extra = {}, { cors = false } = {}) =>
  json(res, code, { error: { message, type: 'freechain_error', ...extra } }, { cors });

/**
 * Buffer a request body and parse it as JSON. Rejects with `statusCode` set
 * (413 over the size cap, 400 on invalid JSON) so callers can pass the error
 * straight to `fail()` without translating it themselves.
 */
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

const WEBUI_DIR_PREFIX = WEBUI_DIR + path.sep;

/**
 * Serve one file from `webui/` if `pathname` resolves inside it, `/` mapping
 * to `index.html`. Returns false (never writes a response) for anything
 * outside the directory or that doesn't exist, so the caller can fall through
 * to its own 404 — the `file.startsWith(WEBUI_DIR_PREFIX)` check is what stops
 * a `..`-laden path from walking out to arbitrary files on disk.
 */
function serveStatic(res, pathname) {
  const rel = pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(WEBUI_DIR, rel);
  if (
    (file !== WEBUI_DIR && !file.startsWith(WEBUI_DIR_PREFIX)) ||
    !fs.existsSync(file) ||
    !fs.statSync(file).isFile()
  ) {
    return false;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
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

/**
 * Build the HTTP server: the OpenAI-compatible proxy routes (`/v1/*`,
 * access-key gated), the admin API the dashboard talks to (`/admin/*`, no
 * auth of its own — see README's Security section), plain health checks
 * (`/healthz`, `/v1/health/deep`), and static file serving for `webui/`.
 * `chain` is mutated in place by admin actions (key edits, reordering) so it
 * always reflects what's on disk without a restart. `ui: false` (`--no-ui`)
 * removes the dashboard and the entire `/admin/*` surface, leaving only the
 * proxy routes.
 */
export function createServer(chain, {
  verbose = false,
  ui = true,
  journal = new RequestJournal({ enabled: false }),
} = {}) {
  const cooldowns = new Cooldowns(chain.settings.cooldownMs);
  const stats = { served: 0, failed: 0, startedAt: Date.now() };
  let nextDeepHealthAt = 0;

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const auditDefinition = ADMIN_AUDIT_ROUTES.get(`${req.method} ${url.pathname}`);
    const shouldJournal = req.method !== 'OPTIONS' && (
      (url.pathname.startsWith('/v1/') && !PASSIVE_JOURNAL_ROUTES.has(url.pathname)) ||
      Boolean(auditDefinition)
    );
    const startedMs = Date.now();
    const journalRecord = shouldJournal ? {
      id: randomUUID(),
      startedAt: new Date(startedMs).toISOString(),
      route: url.pathname,
      method: req.method,
      client: requestMetadata(req),
      ...(auditDefinition ? { audit: { action: auditDefinition[0], entityType: auditDefinition[1] } } : {}),
    } : null;
    let journalFinalized = false;
    const finalizeJournal = (overrides = {}) => {
      if (!journalRecord || journalFinalized) return;
      journalFinalized = true;
      const status = overrides.status ?? res.statusCode ?? 500;
      journal.append({
        ...journalRecord,
        ...overrides,
        status,
        outcome: overrides.outcome ?? journalRecord.outcome ?? (status >= 500 ? 'failed' : status >= 400 ? 'rejected' : 'served'),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedMs,
      });
    };
    if (journalRecord) {
      res.setHeader('X-FreeChain-Request-Id', journalRecord.id);
      res.once('finish', () => finalizeJournal());
      res.once('close', () => {
        if (!res.writableEnded) finalizeJournal({ status: 499, outcome: 'client-disconnected' });
      });
    }

    if (req.method === 'OPTIONS' && !url.pathname.startsWith('/admin/')) {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers':
          'Content-Type, Authorization, X-FreeChain-App, X-FreeChain-Session-Id, X-Stainless-Lang, X-Stainless-Package-Version, X-Stainless-OS, X-Stainless-Arch, X-Stainless-Runtime, X-Stainless-Runtime-Version, X-Stainless-Retry-Count, X-Stainless-Timeout, X-Stainless-Helper-Method',
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
      }, { cors: true });
    }

    if (url.pathname === '/v1/health/deep' && req.method === 'POST') {
      if (!accessKeyMatches(bearerFrom(req))) {
        journalRecord.auth = { result: 'rejected', ownership: 'freechain-access-key' };
        journalRecord.request = { inputSummary: 'unavailable-before-auth' };
        journalRecord.error = { code: 'invalid_api_key', category: 'authentication', httpStatus: 401, retryable: false };
        journalRecord.outcome = 'auth-rejected';
        return fail(res, 401, 'Invalid API key. Use the access key from the FreeChain dashboard.', {
          code: 'invalid_api_key',
        }, { cors: true });
      }
      journalRecord.auth = { result: 'accepted', ownership: 'freechain-access-key' };
      try {
        await readJson(req, 16 * 1024);
      } catch (err) {
        return fail(res, err.statusCode || 400, err.message, {}, { cors: true });
      }

      const abort = new AbortController();
      res.once('close', () => {
        if (!res.writableEnded) abort.abort();
      });

      const now = Date.now();
      if (now < nextDeepHealthAt) {
        return fail(res, 429, 'Deep health checks are rate-limited.', {
          retryAfterMs: nextDeepHealthAt - now,
        }, { cors: true });
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
      }, { cors: true });
    }

    // ── Admin API, consumed by the web UI on the same origin ──────────
    if (ui && url.pathname.startsWith('/admin/')) {
      try {
        if (url.pathname === '/admin/state' && req.method === 'GET') {
          return json(res, 200, {
            ...inventory(chain),
            accessKeyMasked: getAccessKey() ? '••••••••' : null,
            cooling: cooldowns.snapshot(),
            journal: journal.status(),
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
          journalRecord.audit.entityId = String(slot);
          journalRecord.audit.count = keys.length;
          const count = saveSlotKeys(slot, keys);
          return json(res, 200, { slot, count });
        }
        if (url.pathname === '/admin/test' && req.method === 'POST') {
          const { slot } = await readJson(req);
          if (!slot) return fail(res, 400, 'slot is required');
          journalRecord.audit.entityId = String(slot);
          return json(res, 200, await testSlot(chain, slot));
        }
        if (url.pathname === '/admin/chain/reorder' && req.method === 'POST') {
          const { order } = await readJson(req);
          if (!Array.isArray(order)) return fail(res, 400, 'order[] is required');
          journalRecord.audit.count = order.length;
          reorderChain(chain, order);
          return json(res, 200, { ok: true, count: chain.links.length });
        }
        // Windows exe/zip releases only: offers a Start Menu shortcut once,
        // and only after the browser asks — nothing is created unprompted.
        if (url.pathname === '/admin/shortcut' && req.method === 'GET') {
          return json(res, 200, shortcutStatus());
        }
        if (url.pathname === '/admin/shortcut/create' && req.method === 'POST') {
          return json(res, 200, createShortcut());
        }
        if (url.pathname === '/admin/shortcut/dismiss' && req.method === 'POST') {
          return json(res, 200, dismissShortcut());
        }
      } catch (err) {
        const code = err.statusCode || 500;
        if (journalRecord) journalRecord.error = {
          code: code >= 500 ? 'internal_error' : 'invalid_admin_request',
          category: code >= 500 ? 'internal' : 'request',
          httpStatus: code,
          retryable: code >= 500,
        };
        return fail(res, code, code >= 500 ? 'Internal server error' : String(err.message || err));
      }
      return fail(res, 404, `No admin route for ${req.method} ${url.pathname}`);
    }

    if (url.pathname === '/v1/logs' && req.method === 'GET') {
      if (!accessKeyMatches(bearerFrom(req))) {
        return fail(res, 401, 'Invalid API key. Use the access key from the FreeChain dashboard.', {
          code: 'invalid_api_key',
        }, { cors: true });
      }
      res.setHeader('Cache-Control', 'no-store');
      return json(res, 200, journal.query({
        limit: url.searchParams.get('limit') || undefined,
        before: url.searchParams.get('before') || undefined,
        status: url.searchParams.get('status') || undefined,
        provider: url.searchParams.get('provider') || undefined,
        app: url.searchParams.get('app') || undefined,
        route: url.searchParams.get('route') || undefined,
        q: url.searchParams.get('q') || undefined,
      }), { cors: true });
    }

    if (url.pathname === '/v1/models') {
      if (!accessKeyMatches(bearerFrom(req))) {
        journalRecord.auth = { result: 'rejected', ownership: 'freechain-access-key' };
        journalRecord.request = { inputSummary: 'unavailable-before-auth' };
        journalRecord.error = { code: 'invalid_api_key', category: 'authentication', httpStatus: 401, retryable: false };
        journalRecord.outcome = 'auth-rejected';
        return fail(res, 401, 'Invalid API key. Use the access key from the FreeChain dashboard.', {
          code: 'invalid_api_key',
        }, { cors: true });
      }
      journalRecord.auth = { result: 'accepted', ownership: 'freechain-access-key' };
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
      return json(res, 200, { object: 'list', data }, { cors: true });
    }

    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      if (!accessKeyMatches(bearerFrom(req))) {
        journalRecord.auth = { result: 'rejected', ownership: 'freechain-access-key' };
        journalRecord.request = { inputSummary: 'unavailable-before-auth' };
        journalRecord.error = { code: 'invalid_api_key', category: 'authentication', httpStatus: 401, retryable: false };
        journalRecord.outcome = 'auth-rejected';
        return fail(res, 401, 'Invalid API key. Use the access key from the FreeChain dashboard.', {
          code: 'invalid_api_key',
        }, { cors: true });
      }
      journalRecord.auth = { result: 'accepted', ownership: 'freechain-access-key' };
      let body;
      try {
        body = await readJson(req);
      } catch (err) {
        journalRecord.error = { code: 'invalid_request', category: 'request', httpStatus: err.statusCode || 400, retryable: false };
        return fail(res, err.statusCode || 400, err.message, {}, { cors: true });
      }
      const inputSummary = summarizeInput(body);
      journalRecord.request = {
        model: inputSummary.model,
        stream: inputSummary.stream,
        inputSummary,
      };
      if (!Array.isArray(body.messages) || !body.messages.length) {
        journalRecord.error = { code: 'invalid_messages', category: 'request', httpStatus: 400, retryable: false };
        return fail(res, 400, '"messages" must be a non-empty array', {}, { cors: true });
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
        journalRecord.attempts = attempts;
        journalRecord.served = { provider, model: link.model, keyIndex };
        journalRecord.cooling = {
          count: cooldowns.snapshot().length,
          candidates: cooldowns.snapshot().map(({ id, secondsRemaining }) => ({ id, secondsRemaining })),
        };

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
            'X-Freechain-Provider, X-Freechain-Model, X-Freechain-Key-Index, X-Freechain-Attempts, X-FreeChain-Request-Id',
        };

        stats.served++;
        if (body.stream) {
          const meter = createSseMeter();
          res.writeHead(200, {
            ...served,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          // Pass SSE through untouched; re-chunking risks splitting events.
          for await (const chunk of response.body) {
            meter.push(chunk);
            if (!res.write(chunk)) await new Promise((r) => res.once('drain', r));
          }
          journalRecord.result = meter.finish(inputSummary.inputChars);
          return res.end();
        }

        const payload = await response.text();
        const outputSummary = summarizeJsonOutput(payload);
        journalRecord.result = {
          ...outputSummary,
          usage: outputSummary.usage ?? estimatedUsage(inputSummary.inputChars, outputSummary.outputChars),
        };
        res.writeHead(200, {
          ...served,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        });
        return res.end(payload);
      } catch (err) {
        if (abort.signal.aborted) return;
        stats.failed++;
        if (err instanceof ChainError) {
          journalRecord.attempts = err.attempts;
          const lastProviderStatus = Number.parseInt(String(err.attempts.at(-1)?.detail || ''), 10);
          journalRecord.cooling = {
            count: cooldowns.snapshot().length,
            candidates: cooldowns.snapshot().map(({ id, secondsRemaining }) => ({ id, secondsRemaining })),
          };
          journalRecord.error = {
            code: 'chain_failed',
            category: 'provider',
            httpStatus: 502,
            providerStatus: Number.isFinite(lastProviderStatus) ? lastProviderStatus : undefined,
            retryable: true,
          };
          return fail(res, 502, err.message, { attempts: err.attempts }, { cors: true });
        }
        console.error('[freechain] unexpected error:', err);
        journalRecord.error = { code: 'internal_error', category: 'internal', httpStatus: 500, retryable: true };
        return fail(res, 500, 'Internal server error', {}, { cors: true });
      }
    }

    if (ui && req.method === 'GET' && serveStatic(res, url.pathname)) return;

    return fail(res, 404, `No route for ${req.method} ${url.pathname}`);
  });
}
