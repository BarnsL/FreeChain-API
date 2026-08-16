import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync(new URL('../chain.config.json', import.meta.url), 'utf8'));

test('the shipped default chain contains no paid fallback', () => {
  assert.equal(
    config.chain.some((link) => link.free === false),
    false,
    'the default chain must never silently reach a paid model'
  );
});
