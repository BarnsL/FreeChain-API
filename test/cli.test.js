import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('help documents persistent journal controls', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/freechain.mjs', import.meta.url)), '--help'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--log <path>/);
  assert.match(result.stdout, /--no-log/);
});

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForServer(base, child, stderr) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`launcher exited with ${child.exitCode}: ${stderr()}`);
    try {
      if ((await fetch(`${base}/healthz`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('launcher did not become ready');
}

async function waitForServerToStop(base) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await fetch(`${base}/healthz`);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('worker remained live after its supervisor stopped');
}

test('no-ui startup creates an access key that gates deep health', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freechain-cli-'));
  fs.cpSync(new URL('../src/', import.meta.url), path.join(root, 'src'), { recursive: true });
  fs.cpSync(new URL('../bin/', import.meta.url), path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  const chainFile = path.join(root, 'chain.json');
  fs.writeFileSync(chainFile, JSON.stringify({
    chain: [{ provider: 'local', model: 'test-model', baseUrl: 'http://127.0.0.1:1/v1' }],
    requestTimeoutMs: 100,
  }));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(root, 'bin', 'freechain.mjs'), '--no-ui', '--chain', chainFile, '--port', String(port)], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await once(child, 'exit');
    }
    await waitForServerToStop(base);
    fs.rmSync(root, { recursive: true, force: true });
  });
  await waitForServer(base, child, () => stderr.trim());

  const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
  const key = /^FREECHAIN_ACCESS_KEY=(.+)$/m.exec(env)?.[1];
  assert.ok(key, 'no-ui startup must generate an access key');

  assert.equal((await fetch(`${base}/v1/health/deep`, { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await fetch(`${base}/v1/health/deep`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: '{}',
  })).status, 200);

  const journalFile = path.join(root, 'logs', 'requests.jsonl');
  assert.equal(fs.existsSync(journalFile), true, 'default startup must persist the journal below the runtime root');
  const journalText = fs.readFileSync(journalFile, 'utf8');
  assert.match(journalText, /"outcome":"auth-rejected"/);
  assert.doesNotMatch(journalText, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
