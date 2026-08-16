// OpenAI-compatible HTTP surface. Any client that can talk to api.openai.com
// can talk to this: editor assistants, agent frameworks, curl, the OpenAI SDKs.

import http from 'node:http';
import { chainStatus, resolveKeys } from './config.js';
import { Cooldowns, dispatch, ChainError } from './chain.js';

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

export function createServer(chain, { verbose = false } = {}) {
  const cooldowns = new Cooldowns(chain.settings.cooldownMs);

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
      });
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
        if (err instanceof ChainError) {
          return fail(res, 502, err.message, { attempts: err.attempts });
        }
        console.error('[freechain] unexpected error:', err);
        return fail(res, 500, String(err.message || err));
      }
    }

    return fail(res, 404, `No route for ${req.method} ${url.pathname}`);
  });
}
