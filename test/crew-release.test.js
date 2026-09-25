import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

test('release packager refuses runtime secrets and the wrong host', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'freechain-release-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = path.join(root, 'dist/freechain-crew');
  await fs.mkdir(app, { recursive: true });
  await fs.mkdir(path.join(root, 'scripts'));
  const script = path.join(root, 'scripts/package-crew-app.py');
  await fs.copyFile('scripts/package-crew-app.py', script);
  const manifest = { name: 'freechain', version: '0.1.2', minKiroCrewVersion: '0.7.0' };
  await fs.writeFile(path.join(app, 'app.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(app, '.env'), 'FIXTURE_SECRET=never-publish\n');
  const run = () => spawnSync(process.env.PYTHON || 'python', [script], { encoding: 'utf8' });
  const privateState = run();
  assert.equal(privateState.status, 1, privateState.error?.message);
  assert.match(privateState.stderr, /private or generated runtime state/);
  assert.doesNotMatch(privateState.stderr, /never-publish/);
  await assert.rejects(fs.stat(path.join(root, 'dist/freechain-kiro-crew-0.1.2.zip')), { code: 'ENOENT' });
  await fs.unlink(path.join(app, '.env'));
  manifest.minCodexCrewVersion = '0.7.0';
  await fs.writeFile(path.join(app, 'app.json'), JSON.stringify(manifest));
  assert.match(run().stderr, /Only the Kiro Crew build/);
});
