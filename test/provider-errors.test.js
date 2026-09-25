import './private-data-dir.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { Cooldowns, dispatch } from '../src/chain.js';
import { createServer } from '../src/server.js';
import { ACCESS_KEY_VAR } from '../src/admin.js';

const body = { model: 'auto', messages: [{ role: 'user', content: 'test' }] };
const overflow = { error: { message: 'Please reduce the length of the messages or completion. PRIVATE_UPSTREAM_DETAIL', type: 'invalid_request_error', code: 'context_length_exceeded', param: 'messages' } };
const success = { choices: [{ message: { role: 'assistant', content: 'fallback worked' } }] };
async function fixture(t, responses) {
  const servers = [];
  t.after(() => servers.forEach(server => { server.close(); server.closeAllConnections(); }));
  const links = [];
  for (const [status, payload, stream = false] of responses) {
    const server = http.createServer(async (req, res) => {
      for await (const chunk of req) {} // consume request before replying
      res.writeHead(status, { 'content-type': stream ? 'text/event-stream' : 'application/json' });
      res.end(stream ? `data: ${JSON.stringify(payload)}\n\n` : JSON.stringify(payload));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); servers.push(server);
    links.push({ index: links.length, provider: 'local', model: `model-${links.length}`, baseUrl: `http://127.0.0.1:${server.address().port}`, keyOptional: true });
  }
  return { links, settings: { requestTimeoutMs: 2000, cooldownMs: 1000 } };
}

test('context overflow tries a larger compatible candidate without cooling the small model', async t => {
  const chain = await fixture(t, [[400, overflow], [200, success]]);
  const cooldowns = new Cooldowns(1000);
  const result = await dispatch(chain, cooldowns, body);
  assert.equal((await result.response.json()).choices[0].message.content, 'fallback worked');
  assert.equal(cooldowns.isCooling('0:local:0'), false, 'an oversized request must not penalise short requests');
});

test('HTTP 200 overload and missing choices are rejected before committing a route', async t => {
  const chain = await fixture(t, [[200, { error: { message: 'upstream provider overloaded (503)' } }], [200, { usage: {} }], [200, success]]);
  const result = await dispatch(chain, new Cooldowns(1000), body);
  assert.equal(result.link.model, 'model-2');
  assert.equal((await result.response.json()).choices[0].message.content, 'fallback worked');
});

test('context overflow inside HTTP 200 JSON and SSE preserves the compression signal', async t => {
  for (const stream of [false, true]) {
    const chain = await fixture(t, [[200, overflow, stream]]);
    await assert.rejects(dispatch(chain, new Cooldowns(1000), { ...body, stream }), error => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, 'context_length_exceeded');
      return true;
    });
  }
});

test('oversized untrusted success and error bodies cannot prevent failover', async t => {
  const chain = await fixture(t, [[503, { error: 'x'.repeat(128 * 1024) }], [200, { choices: success.choices, excess: 'x'.repeat(9 * 1024 * 1024) }], [200, success]]);
  const result = await dispatch(chain, new Cooldowns(1000), body);
  assert.equal(result.link.model, 'model-2');
  assert.equal((await result.response.json()).choices[0].message.content, 'fallback worked');
});

test('public errors preserve recovery codes and never expose upstream bodies', async t => {
  const previous = process.env[ACCESS_KEY_VAR]; process.env[ACCESS_KEY_VAR] = 'fixture-access';
  t.after(() => { if (previous === undefined) delete process.env[ACCESS_KEY_VAR]; else process.env[ACCESS_KEY_VAR] = previous; });
  for (const [responses, expectedStatus, code, retryable] of [
    [[[400, overflow]], 400, 'context_length_exceeded', false],
    [[[400, { error: { message: 'PRIVATE_UPSTREAM_DETAIL invalid field' } }], [200, success]], 400, 'invalid_request_error', false],
    [[[503, { error: { message: 'PRIVATE_UPSTREAM_DETAIL overloaded' } }]], 503, 'upstream_unavailable', true],
  ]) {
    const chain = await fixture(t, responses);
    const app = createServer(chain); app.listen(0, '127.0.0.1'); await once(app, 'listening');
    try {
      const response = await fetch(`http://127.0.0.1:${app.address().port}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer fixture-access', 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const raw = await response.text(); const payload = JSON.parse(raw);
      assert.equal(response.status, expectedStatus);
      assert.equal(payload.error.code, code);
      assert.equal(payload.error.retryable, retryable);
      assert.equal(raw.includes('PRIVATE_UPSTREAM_DETAIL'), false);
      assert.equal(payload.error.attempts.some(attempt => 'detail' in attempt), false);
    } finally { app.close(); app.closeAllConnections(); }
  }
});
