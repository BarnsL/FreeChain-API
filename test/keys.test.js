// Multiple credentials per provider: how they are read from the environment,
// and that rotating through them actually happens before the chain advances.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { resolveKeys } from '../src/config.js';
import { Cooldowns, dispatch, candidatesFor } from '../src/chain.js';

const KEY_VARS = Object.keys(process.env).filter((k) => k.startsWith('FREECHAIN_'));
function clearKeys() {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('FREECHAIN_') || k.endsWith('_API_KEY') || k.endsWith('_API_KEYS')) {
      delete process.env[k];
    }
  }
}
test.beforeEach(clearKeys);
test.after(() => {
  for (const k of KEY_VARS) delete process.env[k];
});

test('reads the singular form', () => {
  process.env.FREECHAIN_OPENROUTER_API_KEY = 'k1';
  assert.deepEqual(resolveKeys('openrouter'), ['k1']);
});

test('reads a comma-separated plural list', () => {
  process.env.FREECHAIN_OPENROUTER_API_KEYS = 'k1,k2,k3';
  assert.deepEqual(resolveKeys('openrouter'), ['k1', 'k2', 'k3']);
});

test('accepts whitespace as a separator too', () => {
  process.env.FREECHAIN_OPENROUTER_API_KEYS = 'k1 k2\nk3';
  assert.deepEqual(resolveKeys('openrouter'), ['k1', 'k2', 'k3']);
});

test('reads numbered slots in order', () => {
  process.env.FREECHAIN_OPENROUTER_API_KEY_1 = 'k1';
  process.env.FREECHAIN_OPENROUTER_API_KEY_2 = 'k2';
  process.env.FREECHAIN_OPENROUTER_API_KEY_3 = 'k3';
  assert.deepEqual(resolveKeys('openrouter'), ['k1', 'k2', 'k3']);
});

test('numbered slots may be sparse without truncating the rest', () => {
  process.env.FREECHAIN_OPENROUTER_API_KEY_1 = 'k1';
  process.env.FREECHAIN_OPENROUTER_API_KEY_5 = 'k5';
  assert.deepEqual(resolveKeys('openrouter'), ['k1', 'k5']);
});

test('all three forms combine, singular first, duplicates collapsed', () => {
  process.env.FREECHAIN_OPENROUTER_API_KEY = 'k1';
  process.env.FREECHAIN_OPENROUTER_API_KEYS = 'k2,k1';
  process.env.FREECHAIN_OPENROUTER_API_KEY_1 = 'k3';
  assert.deepEqual(resolveKeys('openrouter'), ['k1', 'k2', 'k3']);
});

test('the unprefixed vendor variable is honoured as a fallback', () => {
  process.env.OPENROUTER_API_KEY = 'vendor';
  assert.deepEqual(resolveKeys('openrouter'), ['vendor']);
});

test('a provider with no key resolves empty rather than throwing', () => {
  assert.deepEqual(resolveKeys('openrouter'), []);
});

test('each key becomes its own candidate for the same link', () => {
  process.env.FREECHAIN_OPENROUTER_API_KEYS = 'k1,k2,k3';
  const chain = {
    links: [{ index: 0, provider: 'openrouter', model: 'm', baseUrl: 'http://x/v1', headers: {}, keyOptional: false, free: true }],
    settings: {},
  };
  const cands = candidatesFor(chain);
  assert.equal(cands.length, 3);
  assert.deepEqual(cands.map((c) => c.keyIndex), [0, 1, 2]);
  assert.deepEqual(cands.map((c) => c.id), ['0:0', '0:1', '0:2']);
});

test('a key-optional provider yields one candidate with no key', () => {
  const chain = {
    links: [{ index: 0, provider: 'omniroute', model: 'auto', baseUrl: 'http://x/v1', headers: {}, keyOptional: true, free: true }],
    settings: {},
  };
  const cands = candidatesFor(chain);
  assert.equal(cands.length, 1);
  assert.equal(cands[0].key, null);
});

test('a rate-limited key rotates to the next key on the same link', async () => {
  // Upstream accepts only the third key; the first two are told to back off.
  const seen = [];
  const server = http.createServer((req, res) => {
    const key = (req.headers.authorization || '').replace('Bearer ', '');
    seen.push(key);
    if (key !== 'k3') {
      res.writeHead(429, { 'Content-Type': 'text/plain' });
      return res.end('quota exhausted for this account');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'served' } }] }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  process.env.FREECHAIN_OPENROUTER_API_KEYS = 'k1,k2,k3';
  const chain = {
    links: [{
      index: 0, provider: 'openrouter', model: 'm',
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      headers: {}, keyOptional: false, free: true,
    }],
    settings: { requestTimeoutMs: 5000, cooldownMs: 50, maxAttempts: null },
  };

  const { keyIndex, attempts } = await dispatch(chain, new Cooldowns(50), {
    messages: [{ role: 'user', content: 'ping' }],
  });

  assert.deepEqual(seen, ['k1', 'k2', 'k3'], 'must try each key in order');
  assert.equal(keyIndex, 2);
  assert.equal(attempts.length, 3);
  server.close();
});

test('cooldowns are per key, not per link', async () => {
  process.env.FREECHAIN_OPENROUTER_API_KEYS = 'k1,k2';
  const cooldowns = new Cooldowns(60_000);
  cooldowns.penalise('0:0', 'http 429');

  assert.equal(cooldowns.isCooling('0:0'), true);
  assert.equal(cooldowns.isCooling('0:1'), false, 'the second key must stay usable');
});
