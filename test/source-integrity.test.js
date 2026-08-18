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

test('the overview keeps source statuses aligned and documents cooling errors in place', () => {
  // The dashboard is intentionally framework-free and app.js touches `document`
  // at module scope, so this is a source-contract test. Browser verification
  // complements it by proving the static contract paints correctly at runtime.
  const appJs = fs.readFileSync(path.join(ROOT, 'src', 'webui', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'src', 'webui', 'app.css'), 'utf8');
  const overviewHtml = fs.readFileSync(path.join(ROOT, 'src', 'webui', 'index.html'), 'utf8');
  const deploymentMap = fs.readFileSync(path.join(ROOT, 'DEPLOYMENT.md'), 'utf8');

  assert.match(appJs, /class="stat source-card"/, 'overview source cards need their dedicated layout hook');
  assert.match(appJs, /class="source-card-header"/, 'every source label and status needs the same grid header');
  assert.match(
    css,
    /\.source-card-header\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;[^}]*\}/s,
    'the source-status column must stay pinned to the shared right edge',
  );
  assert.match(overviewHtml, /id="coolingErrorLegend"/, 'the error legend belongs beneath the cooling table');
  for (const errorGroup of ['400', '401 / 403', '404', '408 / network', '429', '5xx']) {
    assert.match(overviewHtml, new RegExp(errorGroup.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing ${errorGroup} cooling explanation`);
  }
  assert.match(deploymentMap, /## Dashboard data and layout contract/, 'the deployment map must describe this dashboard contract');
});

test('the Logs workspace sits below Harness and exposes the complete privacy-safe workflow', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src', 'webui', 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(ROOT, 'src', 'webui', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'src', 'webui', 'app.css'), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
  const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');

  // Harness was inserted between Chain and Logs to match SubChain's rail, so
  // the contract Logs owns is its own position, not Chain's adjacency.
  assert.match(
    html,
    /data-page="harness"[\s\S]*?>[\s\S]*?Harness[\s\S]*?<\/button>\s*<button class="nav-item" data-page="logs"/,
    'Logs must be the next primary navigation item after Harness',
  );
  for (const id of [
    'page-logs',
    'logSummary',
    'logFilters',
    'logStatus',
    'logRows',
    'logEmpty',
    'logError',
    'btnLogsRefresh',
    'btnLogsPause',
    'btnLogsClear',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing Logs UI anchor #${id}`);
  }
  // The page states nothing about retention in the shipped metadata-only
  // posture: the callout ships hidden and empty. app.js owns every word of it,
  // and only fills it when caller content is actually being written — a static
  // "never stored" sentence would become a lie the moment a switch is flipped.
  assert.match(html, /class="callout warn log-privacy hidden" id="logRetentionCallout"/, 'the retention warning ships hidden');
  assert.match(html, /<span id="logRetentionNotice"><\/span>/, 'the notice ships empty');
  assert.match(appJs, /function renderRetentionNotice/);
  assert.match(appJs, /Retention is on\./);
  assert.doesNotMatch(html, /never stored/i, 'the page must not promise a policy it cannot guarantee');
  assert.match(appJs, /async function refreshLogs/);
  assert.doesNotMatch(appJs, /log-record-summary" aria-label=/);
  assert.match(appJs, /setInterval[\s\S]*10_000/);
  assert.match(appJs, /X-FreeChain-App/);
  assert.match(appJs, /X-FreeChain-Session-Id/);
  assert.match(appJs, /logsPaused/);
  assert.match(appJs, /data-request-id/);
  assert.match(css, /\.log-filters/);
  assert.match(css, /\.log-record/);
  assert.match(css, /\.log-detail/);
  assert.match(css, /nav-provider-link/);
  assert.match(css, /max-width:\s*880px[\s\S]*nav-provider-link[\s\S]*display:\s*none/);
  assert.match(css, /max-width:\s*880px[\s\S]*\.nav-item\s*\{[^}]*width:\s*auto/);
  assert.match(server, /X-FreeChain-App/);
  assert.match(server, /X-FreeChain-Session-Id/);
  assert.match(server, /X-FreeChain-Request-Id/);
  assert.match(gitignore, /^logs\/requests\.jsonl\*$/m, 'private journal files must not enter git');
});

test('Harness sits between Chain and Logs and carries the shared component vocabulary', () => {
  // FreeChain and SubChain deliberately ship the same Harness page: same nav
  // position, same eight instruction components, same preset library hooks.
  // A drift here is what makes the two dashboards stop reading as one product.
  const html = fs.readFileSync(path.join(ROOT, 'src', 'webui', 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(ROOT, 'src', 'webui', 'app.js'), 'utf8');

  assert.match(
    html,
    /data-page="chain"[\s\S]*?<\/button>\s*<button class="nav-item" data-page="harness"/,
    'Harness must be the navigation item directly after Chain',
  );
  assert.match(
    html,
    /data-page="harness"[\s\S]*?<\/button>\s*<button class="nav-item" data-page="logs"/,
    'Logs must be the navigation item directly after Harness',
  );
  assert.match(html, /<section class="page" id="page-harness">/);
  assert.match(html, /id="harnessConfig"/);
  assert.match(html, /id="presetLibrary"/);

  for (const component of [
    'identity', 'operatingInstructions', 'safetyPolicy', 'toolPolicy',
    'reasoningPolicy', 'outputStyle', 'behavioralMode', 'persona',
  ]) {
    assert.ok(
      appJs.includes(`key: '${component}'`),
      `${component} must stay a first-class Harness component in the dashboard`,
    );
    assert.ok(appJs.includes(`${component}: {`), `${component} needs its field guidance entry`);
  }

  // The editor is repainted from server state on a timer, so the poll has to
  // know to leave it alone while it is being typed into.
  assert.match(appJs, /preserveHarnessEditor/);
});

test('Chat is a dashboard page directly below Logs, not a separate document', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src', 'webui', 'index.html'), 'utf8');
  const operatorJs = fs.readFileSync(path.join(ROOT, 'src', 'webui', 'operator.js'), 'utf8');

  // The operator used to ship as its own /operator.html document with its own
  // stylesheet. It now lives inside the dashboard shell, so those must be gone
  // or the two surfaces drift apart visually again.
  assert.equal(fs.existsSync(path.join(ROOT, 'src', 'webui', 'operator.html')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'src', 'webui', 'operator.css')), false);
  assert.doesNotMatch(html, /operator\.html/);

  // Page key, nav label and tab set are deliberately identical to SubChain's
  // dashboard so the two surfaces stay recognisably the same product.
  assert.match(
    html,
    /data-page="logs"[\s\S]*?<\/button>\s*<button class="nav-item" data-page="chat"/,
    'Chat must be the navigation item directly after Logs',
  );
  assert.match(html, /<section class="page" id="page-chat">/);
  assert.match(html, /<script src="\/operator\.js"><\/script>/);
  assert.deepEqual(
    [...html.matchAll(/data-op-tab="([a-z]+)"/g)].map((m) => m[1]),
    ['chat', 'doctor', 'security', 'providers', 'settings'],
  );

  for (const id of ['opStatus', 'opTabs', 'opMessages', 'opPending', 'opInput', 'opSend', 'opDoctor', 'opSecurity', 'opProviders', 'opPromptSummary']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing Chat anchor #${id}`);
  }

  // The appearance preferences are applied through the [data-operator-*] hooks
  // in app.css; using any other attribute name makes saving them a no-op.
  assert.match(operatorJs, /dataset\.operatorTheme/);
  assert.match(operatorJs, /--operator-scale/);
  assert.match(fs.readFileSync(path.join(ROOT, 'src', 'webui', 'app.css'), 'utf8'), /\.op-panel\.active/);
});
