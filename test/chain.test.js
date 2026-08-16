// Failover behaviour is the whole product, so it is tested against a real
// local upstream rather than a mocked fetch.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Cooldowns, dispatch, ChainError } from '../src/chain.js';
import { createServer } from '../src/server.js';

function upstream(handler) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => handler(req, res, body ? JSON.parse(body) : {}));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: server.address().port, close: () => server.close() })
    );
  });
}

const ok = (model) => (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: `hi from ${model}` } }] }));
};
const status = (code, msg = 'nope') => (req, res) => {
  res.writeHead(code, { 'Content-Type': 'text/plain' });
  res.end(msg);
};

function chainOf(...links) {
  return {
    links: links.map((l, i) => ({
      index: i,
      provider: 'local',
      label: 'test',
      model: l.model,
      baseUrl: `http://127.0.0.1:${l.port}/v1`,
      headers: {},
      keyOptional: true,
      free: true,
    })),
    settings: { requestTimeoutMs: 5000, cooldownMs: 50, maxAttempts: null },
  };
}

const askBody = { messages: [{ role: 'user', content: 'ping' }] };

test('falls through a rate-limited link to the next one', async () => {
  const a = await upstream(status(429));
  const b = await upstream(ok('second'));
  const chain = chainOf({ model: 'first', port: a.port }, { model: 'second', port: b.port });

  const { response, link, attempts } = await dispatch(chain, new Cooldowns(50), askBody);
  const payload = await response.json();

  assert.equal(link.model, 'second');
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].outcome, 'http-error');
  assert.match(payload.choices[0].message.content, /second/);
  a.close(); b.close();
});

test('a 5xx and a dead port both advance the chain', async () => {
  const a = await upstream(status(503));
  const dead = await upstream(status(200));
  const deadPort = dead.port;
  dead.close(); // nothing is listening here now
  const c = await upstream(ok('third'));

  const chain = chainOf(
    { model: 'first', port: a.port },
    { model: 'second', port: deadPort },
    { model: 'third', port: c.port }
  );
  const { link, attempts } = await dispatch(chain, new Cooldowns(50), askBody);

  assert.equal(link.model, 'third');
  assert.equal(attempts[1].outcome, 'network-error');
  a.close(); c.close();
});

test('a 400 stops the chain instead of burning every link', async () => {
  const a = await upstream(status(400, 'bad model param'));
  const b = await upstream(ok('second'));
  const chain = chainOf({ model: 'first', port: a.port }, { model: 'second', port: b.port });

  await assert.rejects(
    () => dispatch(chain, new Cooldowns(50), askBody),
    (err) => {
      assert.ok(err instanceof ChainError);
      assert.equal(err.attempts.length, 1, 'must not try the second link');
      assert.match(err.message, /400/);
      return true;
    }
  );
  a.close(); b.close();
});

test('a cooling link is demoted but still used as a last resort', async () => {
  const a = await upstream(ok('first'));
  const chain = chainOf({ model: 'first', port: a.port });
  const cooldowns = new Cooldowns(60_000);
  cooldowns.penalise('0:0', 'http 429');

  const { link } = await dispatch(chain, cooldowns, askBody);
  assert.equal(link.model, 'first', 'sole link must still answer while cooling');
  a.close();
});

test('a success clears an earlier cooldown', async () => {
  const a = await upstream(ok('first'));
  const chain = chainOf({ model: 'first', port: a.port });
  const cooldowns = new Cooldowns(60_000);
  cooldowns.penalise('0:0', 'http 500');

  await dispatch(chain, cooldowns, askBody);
  assert.equal(cooldowns.isCooling('0:0'), false);
  a.close();
});

test('an explicit model name pins the chain to matching links', async () => {
  const a = await upstream(ok('first'));
  const b = await upstream(ok('second'));
  const chain = chainOf({ model: 'first', port: a.port }, { model: 'second', port: b.port });

  const { link } = await dispatch(chain, new Cooldowns(50), { ...askBody, model: 'second' });
  assert.equal(link.model, 'second');
  a.close(); b.close();
});

test('an unknown model is refused rather than silently rerouted', async () => {
  const a = await upstream(ok('first'));
  const chain = chainOf({ model: 'first', port: a.port });

  await assert.rejects(
    () => dispatch(chain, new Cooldowns(50), { ...askBody, model: 'no-such-model' }),
    /No chain link serves model/
  );
  a.close();
});

test('server exposes /v1/models, /healthz and the serving provider header', async () => {
  const a = await upstream(status(429));
  const b = await upstream(ok('second'));
  const chain = chainOf({ model: 'first', port: a.port }, { model: 'second', port: b.port });

  const app = createServer(chain);
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.address().port}`;

  const models = await (await fetch(`${base}/v1/models`)).json();
  assert.deepEqual(models.data.map((m) => m.id), ['auto', 'first', 'second']);

  const health = await (await fetch(`${base}/healthz`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.links.length, 2);

  const chat = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'auto', ...askBody }),
  });
  assert.equal(chat.status, 200);
  assert.equal(chat.headers.get('x-freechain-model'), 'second');
  assert.equal(chat.headers.get('x-freechain-attempts'), '2');

  app.close(); a.close(); b.close();
});

test('server rejects a body with no messages', async () => {
  const a = await upstream(ok('first'));
  const app = createServer(chainOf({ model: 'first', port: a.port }));
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.address().port}`;

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'auto' }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error.message, /messages/);

  app.close(); a.close();
});

test('streaming responses pass through and report the serving link', async () => {
  const a = await upstream(status(500));
  const b = await upstream((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"he"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":"llo"}}]}\n\n');
    res.end('data: [DONE]\n\n');
  });
  const chain = chainOf({ model: 'first', port: a.port }, { model: 'second', port: b.port });

  const app = createServer(chain);
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const res = await fetch(`http://127.0.0.1:${app.address().port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'auto', stream: true, ...askBody }),
  });

  assert.equal(res.headers.get('x-freechain-model'), 'second');
  const text = await res.text();
  assert.match(text, /"he"/);
  assert.match(text, /\[DONE\]/);

  app.close(); a.close(); b.close();
});
