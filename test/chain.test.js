// Failover behaviour is the whole product, so it is tested against a real
// local upstream rather than a mocked fetch.

import './private-data-dir.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { Cooldowns, dispatch, ChainError } from '../src/chain.js';
import { createServer } from '../src/server.js';
import { ACCESS_KEY_VAR } from '../src/admin.js';
import { loadChain } from '../src/config.js';

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
      provider: l.provider || 'local',
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

test('the default Ox Alpha routes pin the bad OpenCode slot at the very back', () => {
  // Break caught: a bare OpenCode family link expands the known bad slot beside
  // the good key, so it is not enough to move one row in the visible chain.
  const chain = loadChain(fileURLToPath(new URL('../chain.config.json', import.meta.url)));

  assert.deepEqual(
    chain.links.slice(0, 2).map(({ provider, model }) => [provider, model]),
    [
      ['opencode-zen1', 'x-preview-f-free'],
      ['openrouter', 'stealth/ox-alpha'],
    ],
  );
  assert.deepEqual(
    [chain.links.at(-1).provider, chain.links.at(-1).model],
    ['opencode-zen0', 'x-preview-f-free'],
  );
  assert.equal(
    chain.links.slice(0, -1).some(({ provider }) => provider === 'opencode-zen' || provider === 'opencode-zen0'),
    false,
    'the retained bad slot must not fan into an earlier OpenCode family link',
  );
});

test('OpenCode request identity is stable and truthful across one dispatch', async () => {
  // Break caught: OpenCode rejects a valid coding-agent request when the
  // proxy forwards only authorization/content-type and drops session identity.
  let captured;
  const source = await upstream((req, res) => {
    captured = req.headers;
    ok('opencode')(req, res);
  });
  const chain = chainOf({ provider: 'opencode-zen1', model: 'open-model', port: source.port });

  try {
    const { response } = await dispatch(chain, new Cooldowns(50), askBody, {
      requestId: 'request-fixture-1',
      sessionId: 'session-fixture-1',
    });
    await response.json();

    assert.equal(captured['x-opencode-session'], 'session-fixture-1');
    assert.equal(captured['x-opencode-request'], 'request-fixture-1');
    assert.equal(captured['x-opencode-client'], 'freechain');
    assert.equal(captured['user-agent'], 'FreeChain/0.7.1');
  } finally {
    source.close();
  }
});

test('non-OpenCode request identity does not gain OpenCode headers', async () => {
  // Break caught: provider-specific identity accidentally leaks to every
  // upstream instead of staying at the OpenCode boundary.
  let captured;
  const source = await upstream((req, res) => {
    captured = req.headers;
    ok('local')(req, res);
  });
  const chain = chainOf({ provider: 'local', model: 'local-model', port: source.port });

  try {
    const { response } = await dispatch(chain, new Cooldowns(50), askBody, {
      requestId: 'request-fixture-2',
      sessionId: 'session-fixture-2',
    });
    await response.json();

    assert.equal(captured['x-opencode-session'], undefined);
    assert.equal(captured['x-opencode-request'], undefined);
    assert.equal(captured['x-opencode-client'], undefined);
  } finally {
    source.close();
  }
});

test('server preserves caller session identity at the OpenCode boundary', async () => {
  // Break caught: request metadata reaches FreeChain for correlation but is not
  // handed to dispatch, so OpenCode sees no stable conversation identity.
  let captured;
  const source = await upstream((req, res) => {
    captured = req.headers;
    ok('opencode')(req, res);
  });
  const app = createServer(chainOf({ provider: 'opencode-zen1', model: 'open-model', port: source.port }));
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  const previous = process.env[ACCESS_KEY_VAR];
  process.env[ACCESS_KEY_VAR] = 'server-session-test-key';

  try {
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer server-session-test-key',
        'Content-Type': 'application/json',
        'X-FreeChain-Session-Id': 'nous-conversation-1',
      },
      body: JSON.stringify({ model: 'auto', ...askBody }),
    });
    assert.equal(response.status, 200);
    await response.json();

    assert.equal(captured['x-opencode-session'], 'nous-conversation-1');
    assert.equal(captured['x-opencode-request'], response.headers.get('x-freechain-request-id'));
  } finally {
    app.close();
    source.close();
    if (previous === undefined) delete process.env[ACCESS_KEY_VAR];
    else process.env[ACCESS_KEY_VAR] = previous;
  }
});

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

test('a 200 SSE error before the first valid event advances the chain', async () => {
  // Break caught: treating HTTP 200 as success before inspecting the first SSE
  // event returns an upstream error to the caller and retries the same candidate.
  const providerError = 'data: {"error":{"type":"server_error","message":"Service temporarily overloaded"}}\n\n';
  const validStream = 'data: {"choices":[{"delta":{"content":"OX_OK"}}]}\n\ndata: [DONE]\n\n';
  const a = await upstream((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(providerError);
  });
  const b = await upstream((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(validStream);
  });
  const chain = chainOf({ model: 'first', port: a.port }, { model: 'second', port: b.port });
  const cooldowns = new Cooldowns(5_000);

  try {
    const { response, link, attempts } = await dispatch(
      chain,
      cooldowns,
      { ...askBody, stream: true },
    );

    assert.equal(link.model, 'second');
    assert.deepEqual(attempts.map(({ outcome }) => outcome), ['stream-error', 'ok']);
    assert.equal(cooldowns.isCooling('0:local:0'), true);
    assert.equal(await response.text(), validStream, 'the accepted stream must preserve every byte');
  } finally {
    a.close(); b.close();
  }
});

test('metadata-only SSE scaffolds followed by DONE advance to a substantive tool-call stream', async () => {
  // Break caught: role-only and index-only tool-call deltas are protocol
  // scaffolding. Accepting either commits the route before usable output exists.
  const roleEvent = 'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}\n\n';
  const emptyStream = `${roleEvent}data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0}]}}]}\n\ndata: [DONE]\n\n`;
  const toolStream = `${roleEvent}data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"ping","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n`;
  const a = await upstream((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(emptyStream);
  });
  const b = await upstream((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(toolStream);
  });
  const chain = chainOf({ model: 'first', port: a.port }, { model: 'second', port: b.port });
  const cooldowns = new Cooldowns(5_000);

  try {
    const { response, link, attempts } = await dispatch(
      chain,
      cooldowns,
      { ...askBody, stream: true },
    );

    assert.equal(link.model, 'second');
    assert.deepEqual(attempts.map(({ outcome }) => outcome), ['stream-error', 'ok']);
    assert.equal(cooldowns.isCooling('0:local:0'), true);
    assert.equal(await response.text(), toolStream, 'the accepted tool-call stream must preserve every byte');
  } finally {
    a.close(); b.close();
  }
});

test('each documented non-text SSE output field can commit a route', async () => {
  const variants = [
    ['refusal', { refusal: 'cannot comply' }],
    ['reasoning', { reasoning: 'brief rationale' }],
    ['reasoning_content', { reasoning_content: 'brief rationale' }],
    ['reasoning_details', { reasoning_details: [{ type: 'summary_text', text: 'brief rationale' }] }],
    ['function_call', { function_call: { name: 'ping', arguments: '{}' } }],
    ['audio', { audio: { data: 'dGVzdA==', transcript: 'ping' } }],
  ];

  for (const [field, delta] of variants) {
    const validStream = `data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\ndata: [DONE]\n\n`;
    const server = await upstream((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(validStream);
    });

    try {
      const { response, link, attempts } = await dispatch(
        chainOf({ model: 'first', port: server.port }),
        new Cooldowns(5_000),
        { ...askBody, stream: true },
      );

      assert.equal(link.model, 'first', `${field} should establish usable output`);
      assert.deepEqual(attempts.map(({ outcome }) => outcome), ['ok']);
      assert.equal(await response.text(), validStream, `${field} stream bytes must replay exactly`);
    } finally {
      server.close();
    }
  }
});

test('the SSE prefix cap ignores bytes after a valid first event in the same transport chunk', async () => {
  // Break caught: Web Stream chunk boundaries are transport details. A large
  // chunk must not trip the prefix cap when its first valid event ends early.
  const validEvent = 'data: {"choices":[{"delta":{"content":"OX_OK"}}]}\n\n';
  const oversizedChunk = validEvent + `: ${'x'.repeat(70 * 1024)}\n\n`;
  const originalFetch = globalThis.fetch;
  const encoded = new TextEncoder().encode(oversizedChunk);
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });

  try {
    const { response, link, attempts } = await dispatch(
      chainOf({ model: 'first', port: 1 }),
      new Cooldowns(5_000),
      { ...askBody, stream: true },
    );

    assert.equal(link.model, 'first');
    assert.deepEqual(attempts.map(({ outcome }) => outcome), ['ok']);
    assert.equal(await response.text(), oversizedChunk, 'the full transport chunk must replay unchanged');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an abort during SSE gate cancellation does not cool or advance the chain', async () => {
  // Break caught: an abort can arrive while cancel() is settling. That is the
  // caller leaving, not a provider failure, so it must not mutate routing state.
  const originalFetch = globalThis.fetch;
  const abort = new AbortController();
  const cooldowns = new Cooldowns(5_000);
  const encoder = new TextEncoder();
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches++;
    if (fetches > 1) {
      return new Response('data: {"choices":[{"delta":{"content":"wrong"}}]}\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"error":{"message":"overloaded"}}\n\n'));
      },
      cancel() {
        abort.abort(new Error('caller gone'));
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };

  try {
    await assert.rejects(
      () => dispatch(
        chainOf({ model: 'first', port: 1 }, { model: 'second', port: 2 }),
        cooldowns,
        { ...askBody, stream: true },
        { signal: abort.signal },
      ),
      /caller gone|aborted/i,
    );
    assert.equal(fetches, 1, 'an aborted caller must not advance to another provider');
    assert.equal(cooldowns.isCooling('0:local:0'), false, 'an aborted caller must not cool the provider');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an OmniRoute diagnostic 400 falls through to the next candidate', async () => {
  const a = await upstream(status(400, JSON.stringify({
    error: { message: 'internal pool exhausted' },
    diagnostics: { attempted: 2 },
  })));
  const b = await upstream(ok('second'));
  const chain = chainOf(
    { provider: 'omniroute', model: 'coding', port: a.port },
    { model: 'second', port: b.port }
  );

  try {
    const { link, attempts } = await dispatch(chain, new Cooldowns(50), askBody);

    assert.equal(link.model, 'second');
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].outcome, 'http-error');
  } finally {
    a.close(); b.close();
  }
});

test('a 400 that wraps an upstream server error advances the chain', async () => {
  // Aggregators (OpenRouter, and the "Console" router) return a provider-side
  // failure inside a 400 envelope. The request itself is valid, so the chain
  // must try the next link instead of failing terminally. This is the exact
  // shape from the 2026-08-18 incident (RCA / FC-018).
  const a = await upstream(status(400, JSON.stringify({
    error: {
      type: 'server_error',
      message: 'Error from provider (Console): Upstream request failed: [404] Provider returned error',
    },
  })));
  const b = await upstream(ok('second'));
  const chain = chainOf({ model: 'first', port: a.port }, { model: 'second', port: b.port });

  const { link, attempts } = await dispatch(chain, new Cooldowns(50), askBody);

  assert.equal(link.model, 'second', 'a wrapped upstream error must not end the chain');
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].outcome, 'http-error');
  a.close(); b.close();
});

test('provider-specific tool validation errors advance to a compatible link', async () => {
  const cases = [
    {
      name: 'tool array item ceiling',
      detail: JSON.stringify({
        error: {
          type: 'invalid_request_error',
          message: "'tools' : maximum number of items is 128",
        },
      }),
    },
    {
      name: 'provider-only thought signature',
      detail: JSON.stringify({
        error: {
          code: 400,
          message: 'Function call is missing a thought_signature in functionCall parts.',
        },
      }),
    },
  ];

  for (const { name, detail } of cases) {
    const incompatible = await upstream(status(400, detail));
    const compatible = await upstream(ok('compatible'));
    const chain = chainOf(
      { model: `incompatible-${name}`, port: incompatible.port },
      { model: 'compatible', port: compatible.port },
    );

    try {
      const { link, attempts } = await dispatch(chain, new Cooldowns(50), askBody);

      assert.equal(link.model, 'compatible', `${name} must not end provider failover`);
      assert.deepEqual(attempts.map(({ outcome }) => outcome), ['http-error', 'ok']);
    } finally {
      incompatible.close();
      compatible.close();
    }
  }
});

test('the wrapped-error exception can be turned off for hard-fail behaviour', async () => {
  // Operators can restore the strict "any 400 is fatal" behaviour by clearing
  // advanceOnWrappedServerErrors, e.g. to debug an over-matching provider.
  const a = await upstream(status(400, JSON.stringify({
    error: { type: 'server_error', message: 'upstream request failed [502]' },
  })));
  const b = await upstream(ok('second'));
  const chain = chainOf({ model: 'first', port: a.port }, { model: 'second', port: b.port });
  chain.settings.advanceOnWrappedServerErrors = false;

  await assert.rejects(
    () => dispatch(chain, new Cooldowns(50), askBody),
    (err) => {
      assert.ok(err instanceof ChainError);
      assert.equal(err.attempts.length, 1, 'the toggle-off path must stop at the first link');
      return true;
    }
  );
  a.close(); b.close();
});

test('a cooling link is demoted but still used as a last resort', async () => {
  const a = await upstream(ok('first'));
  const chain = chainOf({ model: 'first', port: a.port });
  const cooldowns = new Cooldowns(60_000);
  cooldowns.penalise('0:local:0', 'http 429');

  const { link } = await dispatch(chain, cooldowns, askBody);
  assert.equal(link.model, 'first', 'sole link must still answer while cooling');
  a.close();
});

test('a success clears an earlier cooldown', async () => {
  const a = await upstream(ok('first'));
  const chain = chainOf({ model: 'first', port: a.port });
  const cooldowns = new Cooldowns(60_000);
  cooldowns.penalise('0:local:0', 'http 500');

  await dispatch(chain, cooldowns, askBody);
  assert.equal(cooldowns.isCooling('0:local:0'), false);
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

test('server requires an access key to list models', async () => {
  const a = await upstream(status(429));
  const b = await upstream(ok('second'));
  const chain = chainOf({ model: 'first', port: a.port }, { model: 'second', port: b.port });

  const app = createServer(chain);
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const priorAccessKey = process.env[ACCESS_KEY_VAR];
  process.env[ACCESS_KEY_VAR] = 'test-model-discovery-access-key';

  try {
    const deniedModels = await fetch(`${base}/v1/models`);
    assert.equal(deniedModels.status, 401);

    const models = await (await fetch(`${base}/v1/models`, {
      headers: { Authorization: 'Bearer test-model-discovery-access-key' },
    })).json();
    assert.deepEqual(models.data.map((m) => m.id), ['auto', 'first', 'second']);

    const health = await (await fetch(`${base}/healthz`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.links.length, 2);

    const chat = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-model-discovery-access-key',
      },
      body: JSON.stringify({ model: 'auto', ...askBody }),
    });
    assert.equal(chat.status, 200);
    assert.equal(chat.headers.get('x-freechain-model'), 'second');
    assert.equal(chat.headers.get('x-freechain-attempts'), '2');
  } finally {
    app.close(); a.close(); b.close();
    if (priorAccessKey === undefined) delete process.env[ACCESS_KEY_VAR];
    else process.env[ACCESS_KEY_VAR] = priorAccessKey;
  }
});

test('server permits OpenAI browser SDK metadata headers in CORS preflights', async () => {
  const a = await upstream(ok('first'));
  const app = createServer(chainOf({ model: 'first', port: a.port }));
  await new Promise((r) => app.listen(0, '127.0.0.1', r));

  const res = await fetch(`http://127.0.0.1:${app.address().port}/v1/chat/completions`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers':
        'authorization, content-type, x-stainless-lang, x-stainless-package-version, x-stainless-os, x-stainless-arch, x-stainless-runtime, x-stainless-runtime-version',
    },
  });

  assert.equal(res.status, 204);
  const allowedHeaders = res.headers.get('access-control-allow-headers')?.toLowerCase() ?? '';
  for (const header of [
    'authorization',
    'content-type',
    'x-stainless-lang',
    'x-stainless-package-version',
    'x-stainless-os',
    'x-stainless-arch',
    'x-stainless-runtime',
    'x-stainless-runtime-version',
  ]) {
    assert.match(allowedHeaders, new RegExp(`\\b${header}\\b`));
  }

  app.close(); a.close();
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
