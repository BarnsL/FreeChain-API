import './private-data-dir.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { createServer } from '../src/server.js';

test('standalone administration rejects foreign browser origins and DNS rebinding', async t => {
  const server = createServer({ links: [], settings: { cooldownMs: 1000 } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/admin/state', '/admin/access-key', '/admin/operator/state']) {
    for (const headers of [{ origin: 'https://untrusted.example' }, { origin: 'null' }, { host: 'rebind.example' }, { 'sec-fetch-site': 'cross-site' }]) {
      // Node fetch can replace Host; use the actual HTTP header for rebinding.
      const status = await new Promise((resolve, reject) => {
        http.get(`${base}${route}`, { headers }, response => {
          response.resume(); resolve(response.statusCode);
        }).once('error', reject);
      });
      assert.equal(status, 403, `${route} must reject ${JSON.stringify(headers)}`);
    }
  }
  const mutation = await fetch(`${base}/admin/chain/settings`, { method: 'POST', headers: { origin: 'https://untrusted.example', 'content-type': 'text/plain' }, body: JSON.stringify({ cooldownMs: 2000 }) });
  assert.equal(mutation.status, 403);
  for (const headers of [{}, { origin: base }]) {
    const response = await fetch(`${base}/admin/state`, { headers });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).settings.cooldownMs, 1000);
  }
});
