// The admin surface writes credentials to disk and gates the proxy, so the
// tests here care about two things above all: the .env file survives editing
// intact, and provider keys never leave the server in readable form.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setEnvVars, reloadEnv, envNames } from '../src/envfile.js';
import { maskKey, accessKeyMatches, bearerFrom, ACCESS_KEY_VAR } from '../src/admin.js';
import { createServer } from '../src/server.js';

function tmpEnv(contents = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freechain-'));
  const file = path.join(dir, '.env');
  if (contents) fs.writeFileSync(file, contents);
  return file;
}
const read = (f) => fs.readFileSync(f, 'utf8');

// ── .env round-tripping ───────────────────────────────────────────────

test('adds a variable to an empty file', () => {
  const f = tmpEnv();
  setEnvVars(f, { FREECHAIN_OPENROUTER_API_KEYS: 'k1' });
  assert.match(read(f), /FREECHAIN_OPENROUTER_API_KEYS=k1/);
});

test('updates in place without disturbing comments, blanks or order', () => {
  const f = tmpEnv('# header comment\nA=1\n\n# about B\nB=2\nC=3\n');
  setEnvVars(f, { B: 'changed' });
  assert.equal(read(f), '# header comment\nA=1\n\n# about B\nB=changed\nC=3\n');
});

test('removes a variable when the value is null', () => {
  const f = tmpEnv('A=1\nB=2\nC=3\n');
  setEnvVars(f, { B: null });
  assert.equal(read(f), 'A=1\nC=3\n');
  assert.deepEqual(envNames(f), ['A', 'C']);
});

test('quotes values that would otherwise be misread', () => {
  const f = tmpEnv();
  setEnvVars(f, { A: 'has space', B: 'has#hash', C: 'plain-key_123' });
  const out = read(f);
  assert.match(out, /A="has space"/);
  assert.match(out, /B="has#hash"/);
  assert.match(out, /C=plain-key_123/, 'ordinary values stay unquoted');
});

test('reloadEnv parses quoted values back to the original string', () => {
  const f = tmpEnv();
  setEnvVars(f, { FREECHAIN_TEST_ROUNDTRIP: 'has space' });
  delete process.env.FREECHAIN_TEST_ROUNDTRIP;
  reloadEnv(f);
  assert.equal(process.env.FREECHAIN_TEST_ROUNDTRIP, 'has space');
  delete process.env.FREECHAIN_TEST_ROUNDTRIP;
});

test('an unrelated variable is never touched by an edit', () => {
  const f = tmpEnv('UNRELATED=keepme\n');
  setEnvVars(f, { FREECHAIN_OPENROUTER_API_KEYS: 'k1' });
  setEnvVars(f, { FREECHAIN_OPENROUTER_API_KEYS: null });
  assert.match(read(f), /UNRELATED=keepme/);
});

test('the credential file is written owner-only where the OS supports it', { skip: process.platform === 'win32' }, () => {
  const f = tmpEnv();
  setEnvVars(f, { A: '1' });
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
});

// ── masking ───────────────────────────────────────────────────────────

test('a mask shows only the ends of a long key', () => {
  const masked = maskKey('sk-or-v1-0123456789abcdef');
  assert.match(masked, /^sk-or/);
  assert.match(masked, /cdef$/);
  assert.ok(!masked.includes('0123456789'), 'the body must not survive masking');
});

test('a short key is masked without revealing most of it', () => {
  const masked = maskKey('short123');
  assert.ok(!masked.includes('short123'));
  assert.match(masked, /^sh/);
});

test('masking an absent key yields an empty string, not "undefined"', () => {
  assert.equal(maskKey(null), '');
  assert.equal(maskKey(''), '');
});

// ── access key ────────────────────────────────────────────────────────

test('the access key gates requests once one is set', () => {
  const prior = process.env[ACCESS_KEY_VAR];
  process.env[ACCESS_KEY_VAR] = 'fc-secret';

  assert.equal(accessKeyMatches('fc-secret'), true);
  assert.equal(accessKeyMatches('fc-wrong'), false);
  assert.equal(accessKeyMatches(''), false);
  assert.equal(accessKeyMatches(null), false);
  assert.equal(accessKeyMatches('fc-secret-longer'), false, 'a prefix must not pass');

  if (prior === undefined) delete process.env[ACCESS_KEY_VAR];
  else process.env[ACCESS_KEY_VAR] = prior;
});

test('with no access key set, requests are allowed rather than locked out', () => {
  const prior = process.env[ACCESS_KEY_VAR];
  delete process.env[ACCESS_KEY_VAR];
  assert.equal(accessKeyMatches(null), true);
  if (prior !== undefined) process.env[ACCESS_KEY_VAR] = prior;
});

test('the bearer token is read with or without the scheme', () => {
  assert.equal(bearerFrom({ headers: { authorization: 'Bearer abc' } }), 'abc');
  assert.equal(bearerFrom({ headers: { authorization: 'abc' } }), 'abc');
  assert.equal(bearerFrom({ headers: {} }), null);
});

// ── server wiring ─────────────────────────────────────────────────────

function testChain() {
  return {
    links: [{ index: 0, provider: 'local', label: 'test', model: 'm', baseUrl: 'http://127.0.0.1:1/v1', headers: {}, keyOptional: true, free: true }],
    settings: { requestTimeoutMs: 500, cooldownMs: 50, maxAttempts: null },
  };
}
async function boot(opts) {
  const app = createServer(testChain(), opts);
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  return { app, base: `http://127.0.0.1:${app.address().port}` };
}

test('a wrong access key is refused before any provider is contacted', async () => {
  const prior = process.env[ACCESS_KEY_VAR];
  process.env[ACCESS_KEY_VAR] = 'fc-secret';
  const { app, base } = await boot();

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nope' },
    body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'x' }] }),
  });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'invalid_api_key');

  app.close();
  if (prior === undefined) delete process.env[ACCESS_KEY_VAR];
  else process.env[ACCESS_KEY_VAR] = prior;
});

test('/admin/state never includes a full key, only masks', async () => {
  const prior = process.env.FREECHAIN_OPENROUTER0_API_KEY;
  process.env.FREECHAIN_OPENROUTER0_API_KEY = 'sk-or-v1-supersecretvalue';
  const { app, base } = await boot();

  const body = await (await fetch(`${base}/admin/state`)).text();
  assert.ok(!body.includes('supersecretvalue'), 'the raw key must never reach the browser');
  assert.match(body, /openrouter0/);

  app.close();
  if (prior === undefined) delete process.env.FREECHAIN_OPENROUTER0_API_KEY;
  else process.env.FREECHAIN_OPENROUTER0_API_KEY = prior;
});

test('the dashboard is served at the root and can be turned off', async () => {
  const on = await boot({ ui: true });
  const page = await fetch(`${on.base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /FreeChain/);
  on.app.close();

  const off = await boot({ ui: false });
  assert.equal((await fetch(`${off.base}/`)).status, 404);
  assert.equal((await fetch(`${off.base}/admin/state`)).status, 404);
  off.app.close();
});

test('static serving cannot be walked out of the UI directory', async () => {
  const { app, base } = await boot();
  const res = await fetch(`${base}/../../package.json`, { redirect: 'manual' });
  assert.notEqual(res.status, 200);
  app.close();
});

// ── Start Menu shortcut ───────────────────────────────────────────────
// This test process is never the packaged SEA binary, so ELIGIBLE is always
// false here regardless of OS — these tests exercise the "not offered"
// shape, not the actual PowerShell shortcut creation (covered manually on a
// built .exe; see docs/DEPLOYMENT.md).

test('the shortcut prompt is not offered outside the packaged Windows exe', async () => {
  const { app, base } = await boot();
  const status = await (await fetch(`${base}/admin/shortcut`)).json();
  assert.deepEqual(status, { eligible: false, exists: false, state: null });
  app.close();
});

test('creating or dismissing the shortcut is refused when not eligible', async () => {
  const { app, base } = await boot();

  const create = await fetch(`${base}/admin/shortcut/create`, { method: 'POST' });
  assert.equal(create.status, 400);
  assert.match((await create.json()).error.message, /Windows executable/);

  const dismiss = await fetch(`${base}/admin/shortcut/dismiss`, { method: 'POST' });
  assert.equal(dismiss.status, 400);
  assert.match((await dismiss.json()).error.message, /Windows executable/);

  app.close();
});
