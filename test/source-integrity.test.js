// Guards against byte-level corruption in shipped source, not logic bugs.
//
// A NUL byte was found silently sitting where a leading space belonged in
// two `keep:${index}` sentinel template literals in webui/app.js (see
// admin.js's KEEP regex). It broke silently: KEEP failed to match, so every
// "keep this existing key" marker sent by the dashboard was instead stored
// as a literal new key, overwriting the real provider credential on the next
// add or delete in a slot that already held one. No test caught it because
// app.js is browser-only DOM code that node --test cannot import directly.
// This scans the shipped source as bytes instead, which any test can do.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_EXTS = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.json']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'temp', 'skill-observations']);

function collectSourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (SOURCE_EXTS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

test('no shipped source file (src/, bin/, scripts/) contains a stray control byte', () => {
  const offenders = [];
  for (const dir of ['src', 'bin', 'scripts']) {
    for (const file of collectSourceFiles(path.join(ROOT, dir))) {
      const buf = fs.readFileSync(file);
      for (let i = 0; i < buf.length; i++) {
        const byte = buf[i];
        // Tab, LF, CR are legitimate whitespace; everything else below 0x20
        // (NUL, other C0 controls) has no business in source text.
        if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
          offenders.push(`${path.relative(ROOT, file)}:${i} (0x${byte.toString(16).padStart(2, '0')})`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], 'control bytes found — see file:offset (hex) above');
});

test('the "keep" sentinel in the dashboard matches the KEEP regex admin.js parses it with', () => {
  const appJs = fs.readFileSync(path.join(ROOT, 'src', 'webui', 'app.js'), 'utf8');
  const KEEP = /^keep:(\d+)$/;

  // Both call sites build the sentinel the same way: a template literal whose
  // static prefix must be exactly " keep:" so that, once trimmed server-side,
  // it matches KEEP. Assert on the literal source text rather than executing
  // app.js (it touches `document` at module scope and cannot be imported
  // outside a browser).
  const sentinelLiterals = [...appJs.matchAll(/`([^`]*keep:\$\{[^}]+\}[^`]*)`/g)].map((m) => m[1]);
  assert.ok(sentinelLiterals.length >= 2, 'expected to find the keep-sentinel template literals in app.js');
  for (const literal of sentinelLiterals) {
    const rendered = literal.replace(/\$\{[^}]+\}/, '0').trim();
    assert.match(rendered, KEEP, `"${literal}" does not round-trip through KEEP after trim()`);
  }
});
