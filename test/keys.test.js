// Credentials per provider: numbered account slots, several keys within each
// slot, how both are read from the environment, and that rotating through them
// actually happens before the chain advances.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { resolveKeys, resolveAccounts } from '../src/config.js';
import { Cooldowns, dispatch, candidatesFor } from '../src/chain.js';
import { familyMembers, providerDef, envBaseFor, ACCOUNT_SLOTS, MAX_KEYS_PER_ACCOUNT } from '../src/providers.js';

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

test('caps at 10 keys per account slot', () => {
  process.env.FREECHAIN_OPENROUTER_API_KEYS = Array.from({ length: 15 }, (_, i) => `k${i}`).join(',');
  assert.equal(resolveKeys('openrouter').length, MAX_KEYS_PER_ACCOUNT);
});

// ── Numbered account slots ────────────────────────────────────────────

test('every family exposes slots 0..9 and no more', () => {
  const members = familyMembers('openrouter');
  assert.equal(members.length, ACCOUNT_SLOTS + 1, 'bare id plus ten slots');
  assert.deepEqual(members.slice(0, 4), ['openrouter', 'openrouter0', 'openrouter1', 'openrouter2']);
  assert.equal(members.at(-1), `openrouter${ACCOUNT_SLOTS - 1}`);
  assert.throws(() => providerDef(`openrouter${ACCOUNT_SLOTS}`), /Unknown provider/);
});

test('slot env names follow the provider id, hyphens included', () => {
  assert.equal(envBaseFor('openrouter0'), 'FREECHAIN_OPENROUTER0_API_KEY');
  assert.equal(envBaseFor('opencode-zen'), 'FREECHAIN_OPENCODE_ZEN_API_KEY');
  assert.equal(envBaseFor('opencode-zen3'), 'FREECHAIN_OPENCODE_ZEN3_API_KEY');
});

test('a slot keeps its own credentials, separate from the bare id', () => {
  process.env.FREECHAIN_OPENROUTER_API_KEY = 'bare';
  process.env.FREECHAIN_OPENROUTER0_API_KEY = 'zero';
  process.env.FREECHAIN_OPENROUTER1_API_KEYS = 'one-a,one-b';

  assert.deepEqual(resolveKeys('openrouter'), ['bare']);
  assert.deepEqual(resolveKeys('openrouter0'), ['zero']);
  assert.deepEqual(resolveKeys('openrouter1'), ['one-a', 'one-b']);
});

test('the vendor variable applies to the bare id only, never to a slot', () => {
  process.env.OPENROUTER_API_KEY = 'vendor';
  assert.deepEqual(resolveKeys('openrouter'), ['vendor']);
  assert.deepEqual(resolveKeys('openrouter0'), []);
});

test('a bare family id fans out across every configured slot, in order', () => {
  process.env.FREECHAIN_OPENROUTER_API_KEY = 'bare';
  process.env.FREECHAIN_OPENROUTER0_API_KEY = 'zero';
  process.env.FREECHAIN_OPENROUTER2_API_KEYS = 'two-a,two-b';

  assert.deepEqual(resolveAccounts('openrouter'), [
    { provider: 'openrouter', key: 'bare' },
    { provider: 'openrouter0', key: 'zero' },
    { provider: 'openrouter2', key: 'two-a' },
    { provider: 'openrouter2', key: 'two-b' },
  ]);
});

test('naming a slot explicitly pins the link to that account alone', () => {
  process.env.FREECHAIN_OPENROUTER_API_KEY = 'bare';
  process.env.FREECHAIN_OPENROUTER2_API_KEY = 'two';

  assert.deepEqual(resolveAccounts('openrouter2'), [{ provider: 'openrouter2', key: 'two' }]);
});

test('each slot-and-key pair becomes its own candidate', () => {
  process.env.FREECHAIN_OPENROUTER_API_KEYS = 'k1,k2';
  process.env.FREECHAIN_OPENROUTER3_API_KEY = 'k3';
  const chain = {
    links: [{ index: 0, provider: 'openrouter', model: 'm', baseUrl: 'http://x/v1', headers: {}, keyOptional: false, free: true }],
    settings: {},
  };
  const cands = candidatesFor(chain);

  assert.deepEqual(cands.map((c) => c.id), [
    '0:openrouter:0',
    '0:openrouter:1',
    '0:openrouter3:0',
  ]);
  // keyIndex restarts per slot, so it stays a meaningful ordinal.
  assert.deepEqual(cands.map((c) => c.keyIndex), [0, 1, 0]);
});

test('a key-optional provider yields one candidate with no key', () => {
  const chain = {
    links: [{ index: 0, provider: 'omniroute', model: 'auto', baseUrl: 'http://x/v1', headers: {}, keyOptional: true, free: true }],
    settings: {},
  };
  const cands = candidatesFor(chain);
  assert.equal(cands.length, 1);
  assert.equal(cands[0].key, null);
  assert.equal(cands[0].id, '0:omniroute:0');
});

test('exhausting one slot moves to the next slot, same model', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    const key = (req.headers.authorization || '').replace('Bearer ', '');
    seen.push(key);
    if (key !== 'slot2') {
      res.writeHead(429, { 'Content-Type': 'text/plain' });
      return res.end('account quota exhausted');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'served' } }] }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  process.env.FREECHAIN_OPENROUTER0_API_KEY = 'slot0';
  process.env.FREECHAIN_OPENROUTER1_API_KEY = 'slot1';
  process.env.FREECHAIN_OPENROUTER2_API_KEY = 'slot2';

  const chain = {
    links: [{
      index: 0, provider: 'openrouter', model: 'm',
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      headers: {}, keyOptional: false, free: true,
    }],
    settings: { requestTimeoutMs: 5000, cooldownMs: 50, maxAttempts: null },
  };

  const { provider, attempts } = await dispatch(chain, new Cooldowns(50), {
    messages: [{ role: 'user', content: 'ping' }],
  });

  assert.deepEqual(seen, ['slot0', 'slot1', 'slot2']);
  assert.equal(provider, 'openrouter2', 'the answering slot is reported');
  assert.deepEqual(attempts.map((a) => a.provider), ['openrouter0', 'openrouter1', 'openrouter2']);
  server.close();
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
