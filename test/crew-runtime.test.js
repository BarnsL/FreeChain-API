import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { signRequest } from '../crew-app/backend/auth.mjs';

const exec = promisify(execFile);
const app = path.resolve('dist/freechain-crew');
const timedFetch = (url, options = {}) => fetch(url, { signal: AbortSignal.timeout(5000), ...options });

test('packaged engine, full signed administration, streaming, CLI and restart work independently', { timeout: 30000 }, async (t) => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'freechain-crew-test-'));
  const upstream = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    if (req.url.startsWith('/fail/')) { res.writeHead(503); res.end('unavailable'); return; }
    const input = JSON.parse(body);
    if (input.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('data: {"choices":[{"delta":{"content":"CREW_STREAM_OK"}}]}\n\ndata: [DONE]\n\n');
    } else { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'CREW_ENGINE_OK' } }] })); }
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  t.after(() => upstream.close());
  const base = `http://127.0.0.1:${upstream.address().port}`;
  await fs.writeFile(path.join(data, 'chain.config.json'), JSON.stringify({ cooldownMs: 10, chain: [{ provider: 'local', model: 'test', baseUrl: `${base}/fail` }, { provider: 'local', model: 'test', baseUrl: `${base}/ok` }] }));
  let child;
  t.after(async () => { if (child?.exitCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; } await fs.rm(data, { recursive: true, force: true }); });
  async function boot() {
    child = spawn(process.execPath, [path.join(app, 'backend/server.mjs')], { env: { ...process.env, PORT: '0', FREECHAIN_CREW_API_PORT: '0', FREECHAIN_CREW_DATA_DIR: data, KIROCREW_PROXY_SECRET: 'test-proxy-secret', CODEXCREW_PROXY_SECRET: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let errors = '';
    child.stderr.on('data', c => { errors += c; });
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`backend startup timed out: ${errors}; ${output}`)), 5000);
      child.once('exit', code => reject(new Error(`backend exited ${code}: ${errors}`)));
      child.stdout.on('data', c => { output += c; const match = output.match(/FREECHAIN_CREW_READY:(.+)\n/); if (match) { clearTimeout(timer); resolve(JSON.parse(match[1])); } });
    });
    assert.equal(output.includes('test-proxy-secret'), false);
    return ready;
  }
  let ready = await boot();
  t.diagnostic('Packaged backend started.');
  if (process.platform === 'win32') {
    const acl = await exec('icacls.exe', [data], { timeout: 5000 });
    assert.doesNotMatch(acl.stdout, /\(I\)/, 'private app data must not inherit broader parent read grants');
  }
  async function admin(target, method = 'GET', input) {
    const body = input === undefined ? '' : JSON.stringify(input);
    return timedFetch(`http://127.0.0.1:${ready.port}${target}`, { method, headers: { 'x-kirocrew-proxy': signRequest({ secret: 'test-proxy-secret', method, target, body }), 'content-type': 'application/json' }, ...(body ? { body } : {}) });
  }
  assert.equal((await fetch(`http://127.0.0.1:${ready.port}/health`)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${ready.port}/api/admin/state`)).status, 401);
  assert.equal((await fetch(`${ready.endpoint}/models`)).status, 401);
  assert.equal((await fetch(ready.endpoint.replace('/v1', '/admin/state'))).status, 404);
  t.diagnostic('Unsigned control/API requests rejected.');
  const state = await (await admin('/api/admin/state')).json();
  assert.equal(state.chain.length, 2);
  const key = (await (await admin('/api/admin/access-key')).json()).key;
  t.diagnostic('Signed state and access-key routes answered.');
  const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  const completion = await timedFetch(`${ready.endpoint}/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'test' }] }) });
  assert.equal(completion.status, 200);
  assert.equal((await completion.json()).choices[0].message.content, 'CREW_ENGINE_OK');
  t.diagnostic('API failover completion passed.');
  const stream = await timedFetch(`${ready.endpoint}/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ model: 'auto', stream: true, messages: [{ role: 'user', content: 'test' }] }) });
  assert.match(await stream.text(), /CREW_STREAM_OK/);
  t.diagnostic('API streaming passed.');
  assert.equal((await admin('/api/admin/chain/settings', 'POST', { cooldownMs: 1234 })).status, 200);
  const harness = await admin('/api/admin/harnesses', 'POST', { name: 'Crew persistence check' });
  assert.equal(harness.status, 201);
  t.diagnostic('Signed mutations passed.');
  const cli = await exec(process.execPath, [path.join(app, 'bin/freechain.mjs'), 'status'], { timeout: 5000, env: { ...process.env, FREECHAIN_CREW_DATA_DIR: data } });
  assert.equal(JSON.parse(cli.stdout).app, 'freechain');
  assert.equal(cli.stdout.includes(key), false);
  t.diagnostic('CLI status passed.');
  const chat = await exec(process.execPath, [path.join(app, 'bin/freechain.mjs'), 'chat', 'hello'], { timeout: 5000, env: { ...process.env, FREECHAIN_CREW_DATA_DIR: data } });
  assert.match(chat.stdout, /CREW_ENGINE_OK/);
  const exit = once(child, 'exit'); child.kill(); await exit;
  ready = await boot();
  const restored = await (await admin('/api/admin/state')).json();
  assert.equal(restored.settings.cooldownMs, 1234);
  assert.ok(restored.harnesses.some(h => h.name === 'Crew persistence check'));
  assert.equal((await (await admin('/api/admin/access-key')).json()).key, key);
});
