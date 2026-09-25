import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { verifyRequest } from './auth.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = path.resolve(process.env.FREECHAIN_CREW_DATA_DIR || path.join(appRoot, 'data'));
fs.mkdirSync(data, { recursive: true, mode: 0o700 });
// POSIX modes do not restrict Windows ACLs. Keep app state accessible only
// to its owner and Windows administrators, including existing child files.
if (process.platform === 'win32') {
  const icacls = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'icacls.exe');
  const restrict = (target, directory) => {
    const inherit = directory ? '(OI)(CI)' : '';
    execFileSync(icacls, [target, '/inheritance:r', '/grant:r',
      `*S-1-3-4:${inherit}F`, `*S-1-5-18:${inherit}F`, `*S-1-5-32-544:${inherit}F`],
    { windowsHide: true, stdio: 'pipe', timeout: 10000 });
  };
  restrict(data, true);
  const hostSecret = path.join(appRoot, '.app_secret');
  if (fs.existsSync(hostSecret)) restrict(hostSecret, false);
}
process.env.FREECHAIN_ROOT_DIR = data;
process.env.FREECHAIN_DATA_DIR = data;
process.env.FREECHAIN_ENV_FILE = path.join(data, '.env');
const configFile = path.join(data, 'chain.config.json');
if (!fs.existsSync(configFile)) fs.copyFileSync(path.join(appRoot, 'engine/chain.config.json'), configFile, fs.constants.COPYFILE_EXCL);
const cliKeyFile = path.join(data, '.cli-key');
if (!fs.existsSync(cliKeyFile)) fs.writeFileSync(cliKeyFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
const cliKey = fs.readFileSync(cliKeyFile, 'utf8').trim();
const { loadDotEnv, loadChain } = await import('../engine/src/config.js');
loadDotEnv();
const { createServer } = await import('../engine/src/server.js');
const { ensureAccessKey, getAccessKey, accessKeyMatches } = await import('../engine/src/admin.js');
const { RequestJournal } = await import('../engine/src/request-journal.js');
ensureAccessKey();
const journal = new RequestJournal({ filePath: path.join(data, 'logs/requests.jsonl'), enabled: true });
const engine = createServer(loadChain(configFile), { configFile, journal, trustedAdminProxy: true });
const engineRequest = engine.listeners('request')[0];
const proxySecret = process.env.CODEXCREW_PROXY_SECRET || process.env.KIROCREW_PROXY_SECRET;
if (!proxySecret) throw new Error('Crew must supply its per-app proxy secret. Enable this app through Crew Library.');

function json(res, code, value) {
  const body = JSON.stringify(value);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}

async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw Object.assign(new Error('Request body exceeds 8 MiB.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function dispatch(req, res) {
  Promise.resolve(engineRequest(req, res)).catch(() => {
    if (!res.headersSent) json(res, 500, { error: { message: 'FreeChain could not complete the request. Check the app logs.' } });
    else res.destroy();
  });
}

const api = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (!url.pathname.startsWith('/v1/')) return json(res, 404, { error: { message: 'Use Crew for administration.' } });
  if (req.method === 'OPTIONS') return dispatch(req, res);
  const key = /^Bearer (.+)$/i.exec(req.headers.authorization || '')?.[1];
  if (!accessKeyMatches(key)) return json(res, 401, { error: { message: 'Invalid API key.', code: 'invalid_api_key' } });
  dispatch(req, res);
});

let ready;
const control = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true, app: 'freechain', engine: 'bundled', endpoint: ready?.endpoint });
    const body = await readBody(req);
    const signatureInput = { method: req.method, target: req.url, body };
    const authorized = verifyRequest({ ...signatureInput, secret: proxySecret, header: req.headers['x-codexcrew-proxy'] || req.headers['x-kirocrew-proxy'] })
      || verifyRequest({ ...signatureInput, secret: cliKey, header: req.headers['x-freechain-cli'] });
    if (!authorized) return json(res, 401, { error: { message: 'A valid Crew or FreeChain CLI signature is required.' } });
    const target = req.url.replace(/^\/api(?=\/)/, '');
    if (req.method === 'GET' && target === '/runtime') return json(res, 200, ready);
    if (!/^\/(?:admin|v1)\//.test(target)) return json(res, 404, { error: { message: 'Unknown app route.' } });
    // The existing handler receives the authenticated request in process. No
    // unprotected administration socket or dependency on another app exists.
    // End of the buffered body is not a client disconnect. The engine uses
    // request.close to cancel upstream work, so defer close to the response.
    const replay = Readable.from(body.length ? [body] : [], { autoDestroy: false, objectMode: false });
    Object.assign(replay, { method: req.method, url: target, socket: req.socket, headers: { ...req.headers, authorization: `Bearer ${getAccessKey()}` } });
    res.once('close', () => replay.destroy());
    dispatch(replay, res);
  } catch (error) {
    if (!res.headersSent) json(res, error.statusCode || 400, { error: { message: error.statusCode === 413 ? error.message : 'Invalid app request.' } });
  }
});

function port(value, fallback) {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error('Invalid TCP port.');
  return n;
}
async function listen(server, value) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(value, '127.0.0.1', () => { server.removeListener('error', reject); resolve(server.address().port); });
  });
}
try {
  const apiPort = await listen(api, port(process.env.FREECHAIN_CREW_API_PORT ?? process.env.FREECHAIN_PORT, 4863));
  const controlPort = await listen(control, port(process.env.PORT, 0));
  const { version } = JSON.parse(fs.readFileSync(path.join(appRoot, 'app.json'), 'utf8'));
  ready = { app: 'freechain', version, engine: 'bundled', pid: process.pid, port: controlPort, endpoint: `http://127.0.0.1:${apiPort}/v1`, startedAt: new Date().toISOString() };
  const runtimeFile = path.join(data, 'runtime.json');
  fs.writeFileSync(`${runtimeFile}.tmp`, JSON.stringify(ready), { mode: 0o600 });
  fs.renameSync(`${runtimeFile}.tmp`, runtimeFile);
  process.stdout.write(`FREECHAIN_CREW_READY:${JSON.stringify(ready)}\n`);
  const stop = () => {
    control.close(); api.close();
    control.closeAllConnections(); api.closeAllConnections();
    try { if (JSON.parse(fs.readFileSync(runtimeFile, 'utf8')).pid === process.pid) fs.unlinkSync(runtimeFile); } catch {}
    process.exit(0);
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
} catch (error) {
  control.close(); api.close();
  console.error(error.code === 'EADDRINUSE' ? 'FreeChain Crew port is already in use. No existing process was adopted or stopped.' : error.message);
  process.exitCode = 1;
}
