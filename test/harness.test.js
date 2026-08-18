// Harness library behaviour, and the one thing that actually matters at
// runtime: that a request is composed with the *active* Harness before it
// reaches the journal or a provider.

import './private-data-dir.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {
  activeHarness,
  applyHarnessConfig,
  createHarness,
  loadHarnessLibrary,
  removeHarness,
  sanitizeHarnessHeaders,
  saveHarnessLibrary,
  setActiveHarness,
  updateHarness,
} from '../src/harness.js';
import { createServer } from '../src/server.js';
import { ACCESS_KEY_VAR } from '../src/admin.js';
import { RequestJournal } from '../src/request-journal.js';

const tempFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'freechain-harness-')), 'harnesses.json');

const listen = (server) => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

test('a missing library loads as one Default Harness that is already active', () => {
  const library = loadHarnessLibrary(path.join(os.tmpdir(), 'freechain-absent', 'harnesses.json'));
  assert.equal(library.schemaVersion, 2);
  assert.equal(library.harnesses.length, 1);
  assert.equal(library.harnesses[0].id, 'default');
  assert.equal(library.activeId, 'default');
  assert.equal(activeHarness(library).id, 'default');
});

test('the library round-trips through disk with its active pointer intact', () => {
  const file = tempFile();
  const library = loadHarnessLibrary(file);
  createHarness(library, { name: 'Research mode' });
  setActiveHarness(library, 'research-mode');
  saveHarnessLibrary(library, file);

  const reloaded = loadHarnessLibrary(file);
  assert.deepEqual(reloaded.harnesses.map((harness) => harness.id), ['default', 'research-mode']);
  assert.equal(reloaded.activeId, 'research-mode');
});

test('an active pointer to a deleted Harness falls back to Default rather than failing', () => {
  const file = tempFile();
  const library = loadHarnessLibrary(file);
  createHarness(library, { name: 'Temporary' });
  setActiveHarness(library, 'temporary');
  removeHarness(library, 'temporary');
  assert.equal(library.activeId, 'default');

  // Same guarantee for a file hand-edited to name a Harness that never existed.
  saveHarnessLibrary({ schemaVersion: 2, activeId: 'ghost', harnesses: library.harnesses }, file);
  assert.equal(loadHarnessLibrary(file).activeId, 'default');
});

test('activating an unknown Harness is refused instead of silently ignored', () => {
  const library = loadHarnessLibrary(tempFile());
  assert.throws(() => setActiveHarness(library, 'nope'), /Unknown Harness/);
  assert.equal(library.activeId, 'default');
});

test('the Default Harness cannot be deleted', () => {
  const library = loadHarnessLibrary(tempFile());
  assert.throws(() => removeHarness(library, 'default'), /cannot be deleted/);
});

test('components compose into one system message in declared order', () => {
  const library = loadHarnessLibrary(tempFile());
  updateHarness(library, 'default', {
    components: { identity: 'You are a reviewer.', outputStyle: 'Answer in one paragraph.' },
  });
  const composed = applyHarnessConfig({ model: 'auto', messages: [{ role: 'user', content: 'hi' }] }, library.harnesses[0].components);
  assert.equal(composed.messages.length, 2);
  assert.equal(composed.messages[0].role, 'system');
  assert.equal(composed.messages[0].content, 'You are a reviewer.\n\nAnswer in one paragraph.');
  assert.equal(composed.messages[1].content, 'hi');
});

test('generation defaults fill gaps but never override what the client asked for', () => {
  const library = loadHarnessLibrary(tempFile());
  updateHarness(library, 'default', {
    components: { generation: { temperature: 0.2, max_tokens: 500 }, aliases: { 'gpt-4o': 'auto' } },
  });
  const composed = applyHarnessConfig(
    { model: 'gpt-4o', temperature: 1.5, messages: [{ role: 'user', content: 'hi' }] },
    library.harnesses[0].components,
  );
  assert.equal(composed.model, 'auto', 'aliases rewrite the requested model');
  assert.equal(composed.temperature, 1.5, 'an explicit client value wins');
  assert.equal(composed.max_tokens, 500, 'an unset value takes the default');
});

test('custom request metadata cannot smuggle credential or framing headers', () => {
  const headers = sanitizeHarnessHeaders({
    'X-Trace': 'abc',
    Authorization: 'Bearer secret',
    Cookie: 'session=1',
    Host: 'evil.example',
    'X-Bad': 'line\r\ninjection',
  });
  assert.deepEqual(headers, { 'X-Trace': 'abc' });
});

test('the active Harness composes live requests and is named in the journal', async () => {
  // Upstream that echoes back what it was actually sent, so the assertion is
  // about the request the provider received, not about internal state.
  let receivedBody = null;
  const upstream = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      receivedBody = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }));
    });
  });
  const upstreamPort = await listen(upstream);

  const harnessFile = tempFile();
  const library = loadHarnessLibrary(harnessFile);
  createHarness(library, { name: 'Strict' });
  updateHarness(library, 'strict', { components: { identity: 'You are strict.', generation: { temperature: 0.1 } } });
  setActiveHarness(library, 'strict');
  saveHarnessLibrary(library, harnessFile);

  process.env[ACCESS_KEY_VAR] = 'fc-test-harness-key';
  const journal = new RequestJournal({ enabled: true });
  const chain = {
    links: [{
      index: 0,
      provider: 'local',
      label: 'Local',
      model: 'test-model',
      baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      headers: {},
      keyOptional: true,
      free: true,
    }],
    settings: { requestTimeoutMs: 2_000, cooldownMs: 60_000, maxAttempts: null },
  };
  const app = createServer(chain, { journal, harnessFile });
  const port = await listen(app);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fc-test-harness-key' },
      body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(response.status, 200);
    await response.json();

    assert.equal(receivedBody.messages[0].role, 'system');
    assert.equal(receivedBody.messages[0].content, 'You are strict.');
    assert.equal(receivedBody.temperature, 0.1);

    // The record is appended when the response finishes, which can land a
    // tick after fetch() resolves.
    const completions = journal.query({ limit: 20 }).items
      .filter((entry) => entry.route === '/v1/chat/completions');
    assert.equal(completions.length, 1);
    assert.equal(completions[0].harnessId, 'strict', 'the journal records which Harness composed the request');
  } finally {
    app.close();
    upstream.close();
    delete process.env[ACCESS_KEY_VAR];
  }
});
