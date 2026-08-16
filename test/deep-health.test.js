import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../src/server.js';
import { ACCESS_KEY_VAR } from '../src/admin.js';

function upstream(handler) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => handler(req, res, body ? JSON.parse(body) : {}));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: server.address().port, close: () => server.close() })
    );
  });
}

function chainOf(...links) {
  return {
    links: links.map((link, index) => ({
      index,
      provider: 'local',
      label: 'local test provider',
      model: link.model,
      baseUrl: `http://127.0.0.1:${link.port}/v1`,
      headers: {},
      keyOptional: true,
      free: true,
    })),
    settings: { requestTimeoutMs: 5_000, cooldownMs: 50, maxAttempts: null },
  };
}

async function boot(chain) {
  const app = createServer(chain);
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  return { app, base: `http://127.0.0.1:${app.address().port}` };
}

test('deep health sends one redacted one-token probe per configured link only on POST', async (t) => {
  const received = [];
  const first = await upstream((req, res, body) => {
    received.push(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'must not appear in health output' } }] }));
  });
  const second = await upstream((req, res, body) => {
    received.push(body);
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('upstream failure body must not appear in health output');
  });
  const { app, base } = await boot(
    chainOf({ model: 'first', port: first.port }, { model: 'second', port: second.port })
  );
  t.after(() => { app.close(); first.close(); second.close(); });

  await fetch(`${base}/healthz`);
  const get = await fetch(`${base}/v1/health/deep`);
  assert.equal(get.status, 404);
  assert.equal(received.length, 0, 'ordinary status and GET must not send probes');

  const response = await fetch(`${base}/v1/health/deep`, { method: 'POST', body: '{}' });
  assert.equal(response.status, 200);
  const payload = await response.json();

  assert.equal(received.length, 2, 'one probe per configured chain link');
  assert.deepEqual(received.map((body) => body.model), ['first', 'second']);
  assert.deepEqual(received.map((body) => body.max_tokens), [1, 1]);
  assert.deepEqual(payload.links.map((link) => link.provider), ['local', 'local']);
  assert.deepEqual(payload.links.map((link) => link.model), ['first', 'second']);
  assert.deepEqual(payload.links.map((link) => link.status), ['ok', 'http-error']);
  assert.deepEqual(payload.links.map((link) => link.reason), ['HTTP 200', 'HTTP 503']);
  assert.ok(payload.links.every((link) => Number.isFinite(link.latencyMs)));
  assert.doesNotMatch(JSON.stringify(payload), /must not appear/);

});

test('deep health is globally rate-limited without additional upstream probes', async (t) => {
  let calls = 0;
  const source = await upstream((req, res) => {
    calls++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  const { app, base } = await boot(chainOf({ model: 'first', port: source.port }));
  t.after(() => { app.close(); source.close(); });

  assert.equal((await fetch(`${base}/v1/health/deep`, { method: 'POST', body: '{}' })).status, 200);
  const throttled = await fetch(`${base}/v1/health/deep`, { method: 'POST', body: '{}' });

  assert.equal(throttled.status, 429);
  assert.match((await throttled.json()).error.message, /rate-limited/i);
  assert.equal(calls, 1, 'the rejected request must not probe upstream');

});

test('deep health rejects missing or invalid access keys before probing and accepts a valid key', async (t) => {
  const previous = process.env[ACCESS_KEY_VAR];
  process.env[ACCESS_KEY_VAR] = 'fc-deep-health-test-key';
  let calls = 0;
  const source = await upstream((req, res) => {
    calls++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  const { app, base } = await boot(chainOf({ model: 'first', port: source.port }));
  t.after(() => {
    app.close(); source.close();
    if (previous === undefined) delete process.env[ACCESS_KEY_VAR];
    else process.env[ACCESS_KEY_VAR] = previous;
  });

  const missing = await fetch(`${base}/v1/health/deep`, { method: 'POST', body: '{}' });
  const invalid = await fetch(`${base}/v1/health/deep`, {
    method: 'POST', headers: { Authorization: 'Bearer wrong' }, body: '{}',
  });
  assert.equal(missing.status, 401);
  assert.equal(invalid.status, 401);
  assert.equal(calls, 0, 'rejected requests must not contact the provider');

  const valid = await fetch(`${base}/v1/health/deep`, {
    method: 'POST', headers: { Authorization: 'Bearer fc-deep-health-test-key' }, body: '{}',
  });
  assert.equal(valid.status, 200);
  assert.equal(calls, 1);
});

test('deep health stops before later links when the client disconnects', async (t) => {
  let firstStarted;
  const firstSeen = new Promise((resolve) => { firstStarted = resolve; });
  let secondCalls = 0;
  const first = await upstream((req, res) => {
    firstStarted();
    req.on('close', () => res.destroy());
  });
  const second = await upstream((req, res) => {
    secondCalls++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  const chain = chainOf({ model: 'first', port: first.port }, { model: 'second', port: second.port });
  chain.settings.requestTimeoutMs = 50;
  const { app, base } = await boot(chain);
  t.after(() => { app.close(); first.close(); second.close(); });

  const client = http.request(`${base}/v1/health/deep`, { method: 'POST' });
  client.on('error', () => {});
  client.end('{}');
  await firstSeen;
  client.destroy();
  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.equal(secondCalls, 0, 'a disconnected client must stop the remaining sweep');
});
