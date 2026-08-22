import './private-data-dir.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../src/server.js';
import { ACCESS_KEY_VAR } from '../src/admin.js';
import { RequestJournal } from '../src/request-journal.js';

const ACCESS_KEY = 'freechain-journal-test-access-key';

const chainFor = (...ports) => ({
  links: ports.map((port, index) => ({
    index,
    provider: `local${index || ''}`,
    label: `Local ${index}`,
    model: `model-${index}`,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    headers: {},
    keyOptional: true,
    free: true,
  })),
  settings: { requestTimeoutMs: 2_000, cooldownMs: 60_000, maxAttempts: null },
});

const upstream = (handler) => new Promise((resolve) => {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port,
    close: () => new Promise((done) => server.close(done)),
  }));
});

const listen = (server) => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
});

const authorized = (extra = {}) => ({ Authorization: `Bearer ${ACCESS_KEY}`, ...extra });

test('auth rejects are journaled before body parsing and logs require the access key', async () => {
  const journal = new RequestJournal({ enabled: false });
  const app = createServer(chainFor(), { journal });
  const prior = process.env[ACCESS_KEY_VAR];
  process.env[ACCESS_KEY_VAR] = ACCESS_KEY;
  const base = await listen(app);

  try {
    const denied = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer stale-key',
        'Content-Type': 'application/json',
        'X-FreeChain-App': 'Nous Man',
        'X-FreeChain-Session-Id': '20260817_104721_fixture',
      },
      body: '{"private prompt":',
    });
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get('x-freechain-request-id') || '', /^[0-9a-f-]{36}$/);

    assert.equal((await fetch(`${base}/v1/logs`)).status, 401);
    const response = await fetch(`${base}/v1/logs?status=401&app=nous`, { headers: authorized() });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const page = await response.json();
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].outcome, 'auth-rejected');
    assert.equal(page.items[0].request.inputSummary, 'unavailable-before-auth');
    assert.equal(page.items[0].client.reportedApp, 'Nous Man');
    assert.equal(page.items[0].client.sessionId, '20260817_104721_fixture');
    assert.equal(page.items[0].error.code, 'invalid_api_key');
    assert.doesNotMatch(JSON.stringify(page), /private prompt|stale-key/);

    const secondRead = await (await fetch(`${base}/v1/logs`, { headers: authorized() })).json();
    assert.equal(secondRead.summary.total, 1, 'log reads must not journal themselves');
  } finally {
    await new Promise((done) => app.close(done));
    if (prior === undefined) delete process.env[ACCESS_KEY_VAR];
    else process.env[ACCESS_KEY_VAR] = prior;
  }
});

test('successful JSON responses record exact usage and never retain content', async () => {
  const provider = await upstream((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: 'PRIVATE_OUTPUT_SENTINEL' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      }));
    });
  });
  const journal = new RequestJournal({ enabled: false });
  const app = createServer(chainFor(provider.port), { journal });
  const prior = process.env[ACCESS_KEY_VAR];
  process.env[ACCESS_KEY_VAR] = ACCESS_KEY;
  const base = await listen(app);

  try {
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: authorized({
        'Content-Type': 'application/json',
        'X-FreeChain-App': 'Codex',
        'X-FreeChain-Session-Id': 'session-1234567890123456789',
      }),
      body: JSON.stringify({
        model: 'auto',
        messages: [{ role: 'user', content: 'PRIVATE_INPUT_SENTINEL' }],
        max_tokens: 100,
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-expose-headers')?.includes('X-FreeChain-Request-Id'), true);
    await response.text();

    const page = await (await fetch(`${base}/v1/logs?provider=local&route=chat&q=Codex`, { headers: authorized() })).json();
    assert.equal(page.items.length, 1);
    const record = page.items[0];
    assert.equal(record.request.inputSummary.inputChars, 22);
    assert.equal(record.result.outputChars, 23);
    assert.deepEqual(record.result.usage, { inputTokens: 11, outputTokens: 7, totalTokens: 18, source: 'exact' });
    assert.equal(record.attempts.length, 1);
    assert.equal(record.served.provider, 'local');
    // The control plane can retain bounded, redacted prompt summaries, but
    // that is opt-in. With default settings nothing derived from the prompt
    // or the response body may reach the journal.
    assert.deepEqual(record.request.inputSummary.promptSummary, []);
    assert.doesNotMatch(JSON.stringify(page), /PRIVATE_INPUT_SENTINEL|PRIVATE_OUTPUT_SENTINEL/);
  } finally {
    await new Promise((done) => app.close(done));
    await provider.close();
    if (prior === undefined) delete process.env[ACCESS_KEY_VAR];
    else process.env[ACCESS_KEY_VAR] = prior;
  }
});

test('streaming failover records sanitized attempts, estimated usage, and cooling', async () => {
  const failed = await upstream((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('PRIVATE_PROVIDER_ERROR_SENTINEL');
    });
  });
  const served = await upstream((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"index":0,"delta":{"content":"PRIVATE_"}}]}\n\n');
      res.write('data: {"choices":[{"index":0,"delta":{"content":"STREAM"},"finish_reason":"stop"}]}\n\n');
      res.end('data: [DONE]\n\n');
    });
  });
  const journal = new RequestJournal({ enabled: false });
  const app = createServer(chainFor(failed.port, served.port), { journal });
  const prior = process.env[ACCESS_KEY_VAR];
  process.env[ACCESS_KEY_VAR] = ACCESS_KEY;
  const base = await listen(app);

  try {
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: authorized({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ model: 'auto', stream: true, messages: [{ role: 'user', content: 'stream input' }] }),
    });
    assert.equal(response.status, 200);
    await response.text();

    const page = await (await fetch(`${base}/v1/logs`, { headers: authorized() })).json();
    const record = page.items[0];
    assert.equal(record.attempts.length, 2);
    assert.deepEqual(record.attempts.map((attempt) => attempt.outcome), ['http-error', 'ok']);
    assert.equal(record.result.outputChars, 14);
    assert.equal(record.result.usage.source, 'estimated');
    assert.equal(record.cooling.count, 1);
    assert.equal(record.cooling.candidates[0].id, '0:local:0');
    assert.doesNotMatch(JSON.stringify(page), /PRIVATE_PROVIDER_ERROR_SENTINEL|PRIVATE_STREAM/);
  } finally {
    await new Promise((done) => app.close(done));
    await failed.close();
    await served.close();
    if (prior === undefined) delete process.env[ACCESS_KEY_VAR];
    else process.env[ACCESS_KEY_VAR] = prior;
  }
});

test('CORS opts into app metadata and access-key reveals create a metadata-only audit record', async () => {
  const journal = new RequestJournal({ enabled: false });
  const app = createServer(chainFor(), { journal, ui: true });
  const prior = process.env[ACCESS_KEY_VAR];
  process.env[ACCESS_KEY_VAR] = ACCESS_KEY;
  const base = await listen(app);

  try {
    const options = await fetch(`${base}/v1/chat/completions`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type, x-freechain-app, x-freechain-session-id',
      },
    });
    const allowed = options.headers.get('access-control-allow-headers')?.toLowerCase() || '';
    assert.match(allowed, /x-freechain-app/);
    assert.match(allowed, /x-freechain-session-id/);

    const reveal = await fetch(`${base}/admin/access-key`);
    assert.equal(reveal.status, 200);
    await reveal.text();
    const page = await (await fetch(`${base}/v1/logs?route=admin`, { headers: authorized() })).json();
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].audit.action, 'access-key-revealed');
    assert.doesNotMatch(JSON.stringify(page), new RegExp(ACCESS_KEY));
  } finally {
    await new Promise((done) => app.close(done));
    if (prior === undefined) delete process.env[ACCESS_KEY_VAR];
    else process.env[ACCESS_KEY_VAR] = prior;
  }
});
