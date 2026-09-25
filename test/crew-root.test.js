import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

test('Crew isolates every ROOT-based setting while standalone keeps its root', () => {
  const source = new URL('../src/config.js', import.meta.url).href;
  const probe = `import { ROOT } from ${JSON.stringify(source)}; console.log(ROOT)`;
  const expected = path.resolve('private-crew-data');
  const env = { ...process.env, FREECHAIN_ROOT_DIR: expected };
  const isolated = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { env, encoding: 'utf8' });
  assert.equal(isolated.status, 0, isolated.stderr);
  assert.equal(isolated.stdout.trim(), expected);
  delete env.FREECHAIN_ROOT_DIR;
  const standalone = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { env, encoding: 'utf8' });
  assert.equal(standalone.status, 0, standalone.stderr);
  assert.equal(standalone.stdout.trim(), path.resolve('.'));
});
