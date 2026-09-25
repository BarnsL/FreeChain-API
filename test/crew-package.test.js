import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

test('release is a Kiro Crew package with its own engine, installer and CLI', async () => {
  const root = path.resolve('dist/freechain-crew');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'app.json'), 'utf8'));
  assert.equal(manifest.minKiroCrewVersion, '0.7.0');
  assert.equal(manifest.minCodexCrewVersion, undefined);
  const ui = await fs.readFile(path.join(root, 'ui/index.mjs'), 'utf8');
  assert.match(ui, /@kirocrew\/app-sdk/);
  assert.doesNotMatch(ui, /@codexcrew\/app-sdk/);
  for (const file of ['Install-FreeChain.cmd', 'install.sh', 'bin/freechain.mjs', 'engine/src/server.js']) {
    assert.ok((await fs.stat(path.join(root, file))).isFile(), file);
  }
  for (const file of ['data', '.env', '.app_secret', 'installed.json', 'node_modules']) {
    await assert.rejects(fs.stat(path.join(root, file)), { code: 'ENOENT' });
  }
});
