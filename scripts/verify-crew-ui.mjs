import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { signRequest } from '../crew-app/backend/auth.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hostTools = process.env.FREECHAIN_UI_TOOL_ROOT;
if (!hostTools) throw new Error('Set FREECHAIN_UI_TOOL_ROOT to a directory containing installed React, ReactDOM and Playwright development dependencies.');
const require = createRequire(path.join(hostTools, 'package.json'));
const { chromium } = require('playwright');
const { build } = createRequire(path.join(process.env.FREECHAIN_BUILD_TOOL_ROOT || root, 'package.json'))('esbuild');
const evidence = path.join(root, 'dist/crew-evidence');
await fs.mkdir(evidence, { recursive: true });
const data = await fs.mkdtemp(path.join(evidence, 'ui-data-'));
const app = path.join(root, 'dist/freechain-crew');
const backend = spawn(process.execPath, [path.join(app, 'backend/server.mjs')], { env: { ...process.env, PORT: '0', FREECHAIN_CREW_API_PORT: '0', FREECHAIN_CREW_DATA_DIR: data, KIROCREW_PROXY_SECRET: 'isolated-ui-test', CODEXCREW_PROXY_SECRET: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
let browser; let web;
try {
  let backendOutput = ''; let backendError = '';
  backend.stderr.on('data', chunk => { backendError += chunk; });
  const runtime = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`UI backend startup timed out: ${backendError}`)), 7000);
    backend.once('exit', code => { clearTimeout(timer); reject(new Error(`UI backend exited ${code}: ${backendError}`)); });
    backend.stdout.on('data', chunk => { backendOutput += chunk; const m = backendOutput.match(/FREECHAIN_CREW_READY:(.+)\n/); if (m) { clearTimeout(timer); resolve(JSON.parse(m[1])); } });
  });
  await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import App from ${JSON.stringify(path.join(app, 'ui/index.mjs').replaceAll('\\', '/'))}; const root=createRoot(document.getElementById('app')); window.mountFreechain=()=>root.render(React.createElement(App)); window.unmountFreechain=()=>root.render(null); window.mountFreechain();`, resolveDir: hostTools },
    outfile: path.join(evidence, 'host.mjs'), bundle: true, format: 'esm', platform: 'browser', nodePaths: [path.join(hostTools, 'node_modules')],
    plugins: [{ name: 'test-only-crew-sdk', setup(b) {
      b.onResolve({ filter: /^@kirocrew\/app-sdk$/ }, () => ({ path: 'sdk', namespace: 'test-sdk' }));
      b.onLoad({ filter: /.*/, namespace: 'test-sdk' }, () => ({ contents: `const request=async(p,o)=>{const r=await fetch(p,o);const data=await r.json();if(!r.ok)throw Error(data.error?.message||'HTTP '+r.status);return data};const api={get:(p,o)=>request(p,o),post:(p,b)=>request(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}),del:p=>request(p,{method:'DELETE'})};export const useAppApi=()=>api;`, loader: 'js' }));
    } }],
  });
  const styles = `:root{--font-body:'Segoe UI',sans-serif;--mono:Consolas,monospace;--border:#323641;--accent:#a78bfa;--accent-fg:#171320;--ok:#22c55e;--warn:#f59e0b;--danger:#ef4444;--bg:#12141a;--text:#e4e4e7;--card:#1a1d25;--bg-hover:#262a35;--muted:#a1a1aa;color-scheme:dark} :root[data-theme=light]{--bg:#fafafa;--text:#3f3f46;--card:#fff;--bg-hover:#f0f0f0;--border:#d4d4d8;--accent:#6550c0;--muted:#62626b;color-scheme:light} :root[data-theme=ocean]{--bg:#081f2c;--text:#e0f2fe;--card:#103448;--bg-hover:#18465c;--border:#2a6174;--accent:#22d3ee;--muted:#a1c6d6;color-scheme:dark} *{box-sizing:border-box} body{margin:0;color:var(--text);background:var(--bg);font-family:var(--font-body)} header{height:46px;padding:8px 16px;display:flex;gap:20px;border-bottom:1px solid var(--border)} #app{height:calc(100vh - 46px);display:flex;min-width:0} select,button{color:inherit;background:var(--card)} #host-proof{font-size:14px}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>FreeChain Crew verification</title><style>${styles}</style></head><body><header><strong id="host-proof">Crew app verification</strong><label>Theme <select id="theme"><option>dark</option><option>light</option><option>ocean</option></select></label></header><div id="app"></div><script>document.getElementById('theme').onchange=e=>document.documentElement.dataset.theme=e.target.value;window.freechainTimers=new Set;const interval=window.setInterval;const clear=window.clearInterval;window.setInterval=(...a)=>{const id=interval(...a);freechainTimers.add(id);return id};window.clearInterval=id=>{freechainTimers.delete(id);clear(id)};</script><script type="module" src="/host.mjs"></script></body></html>`;
  web = http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/apps/freechain/api/')) {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks); const target = req.url.replace('/apps/freechain', '');
        const upstream = await fetch(`http://127.0.0.1:${runtime.port}${target}`, { method: req.method, headers: { 'content-type': 'application/json', 'x-kirocrew-proxy': signRequest({ secret: 'isolated-ui-test', method: req.method, target, body }) }, ...(body.length ? { body } : {}) });
        res.writeHead(upstream.status, { 'content-type': 'application/json' }); res.end(await upstream.text()); return;
      }
      if (req.url === '/host.mjs') { res.setHeader('content-type', 'text/javascript'); res.end(await fs.readFile(path.join(evidence, 'host.mjs'))); return; }
      res.setHeader('content-type', 'text/html'); res.end(html);
    } catch { res.writeHead(500); res.end('Verification server error'); }
  });
  web.listen(0, '127.0.0.1'); await once(web, 'listening');
  browser = await chromium.launch({ headless: true, ...(process.env.FREECHAIN_TEST_BROWSER ? { executablePath: process.env.FREECHAIN_TEST_BROWSER } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${web.address().port}`, { waitUntil: 'networkidle' });
  await page.locator('.freechain-crew #serverStatus').filter({ hasText: 'running' }).waitFor();
  const results = [];
  for (const tab of ['overview', 'access', 'providers', 'chain', 'harness', 'guide', 'logs', 'chat']) {
    await page.locator(`.freechain-crew [data-page="${tab}"]`).click();
    await page.locator(`.freechain-crew #page-${tab}.active`).waitFor();
    results.push({ page: tab, visible: true });
  }
  await page.locator('.freechain-crew [data-page="harness"]').click();
  await page.locator('[data-create-harness] input[name="name"]').fill('UI creation check');
  await page.locator('[data-create-harness] button[type="submit"]').click();
  await page.locator('option[value="ui-creation-check"]').waitFor({ state: 'attached' });
  assert.equal(await page.locator('option[value="ui-creation-check"]').evaluate(option => option.selected), true);
  await page.locator('.freechain-crew [data-page="overview"]').click();
  const colors = [];
  for (const theme of ['dark', 'light', 'ocean']) {
    await page.locator('#theme').selectOption(theme);
    const palette = await page.evaluate(() => ({ app: getComputedStyle(document.querySelector('.freechain-crew')).backgroundColor, host: getComputedStyle(document.body).backgroundColor, font: getComputedStyle(document.querySelector('.freechain-crew')).fontFamily, hostFont: getComputedStyle(document.body).fontFamily }));
    assert.equal(palette.app, palette.host, `${theme}: app background must follow Crew`);
    assert.equal(palette.font, palette.hostFont, `${theme}: app font must follow Crew`);
    colors.push({ theme, ...palette });
    await page.screenshot({ path: path.join(evidence, `freechain-${theme}-1280.png`), fullPage: true });
  }
  assert.equal(new Set(colors.map(c => c.app)).size, 3);
  const geometry = [];
  for (const width of [1280, 380]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => {
      for (const card of document.querySelectorAll('.freechain-crew .stat,.freechain-crew .source-card')) {
        const text = document.createElement('p'); text.textContent = 'hostile-model-'.repeat(30); card.append(text);
      }
    });
    const measure = await page.evaluate(() => {
      const root = document.querySelector('.freechain-crew'); const problems = [];
      for (const card of root.querySelectorAll('.card,.stat,.callout,.slot,.provider,.source-card,.log-record,.bubble')) {
        const cb = card.getBoundingClientRect();
        for (const el of card.querySelectorAll('*')) {
          if (el.tagName === 'PRE' || el.tagName === 'TABLE' || el.closest('.table-wrap')) continue;
          const r = el.getBoundingClientRect(); if (r.width && r.right > cb.right + 1.5) problems.push(el.tagName + '.' + el.className);
        }
      }
      return { width: innerWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth + 1, appOverflow: root.scrollWidth > root.clientWidth + 1, problems };
    });
    geometry.push(measure); assert.equal(measure.pageOverflow, false); assert.equal(measure.appOverflow, false); assert.deepEqual(measure.problems, []);
    await page.screenshot({ path: path.join(evidence, `freechain-hostile-${width}.png`), fullPage: true });
  }
  await page.evaluate(() => window.unmountFreechain());
  await page.waitForFunction(() => document.querySelector('.freechain-crew') === null);
  assert.equal(await page.evaluate(() => window.freechainTimers.size), 0, 'app polling must stop on unmount');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.operatorTheme), undefined, 'app must not mutate host appearance');
  await page.evaluate(() => window.mountFreechain());
  await page.locator('.freechain-crew #serverStatus').filter({ hasText: 'running' }).waitFor({ state: 'attached' });
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(evidence, 'verification.json'), JSON.stringify({ pages: results, themes: colors, geometry, unmountTimers: 0, remount: true, browserErrors: errors, mode: 'isolated Crew SDK test host; production host still requires installed verification' }, null, 2));
  console.log(JSON.stringify({ pages: results.length, themes: colors.length, widths: geometry.map(g => g.width), browserErrors: errors.length, lifecycle: 'unmount/remount passed', evidence }));
} finally {
  await browser?.close(); web?.close(); web?.closeAllConnections();
  if (backend.exitCode === null && backend.signalCode === null) { const exited = once(backend, 'exit'); backend.kill(); await exited; }
  await fs.rm(data, { recursive: true, force: true });
}
