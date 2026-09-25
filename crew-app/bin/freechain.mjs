#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signRequest } from '../backend/auth.mjs';

const args = process.argv.slice(2);
const command = args.shift() || 'help';
const help = `FreeChain Crew CLI

  freechain status                  Managed runtime and API endpoint
  freechain models                  Available model IDs
  freechain providers                Masked provider inventory
  freechain chain                    Chain, cooldowns and settings
  freechain harnesses                Harness library
  freechain logs                     Recent request journal (metadata by default)
  freechain chat "your prompt"        Complete through the managed chain
  freechain request GET /admin/state Generic authenticated administration
  freechain request POST /admin/keys Read the JSON body from stdin
  freechain help                     Show this help

Run with node <installed-app>/bin/freechain.mjs, or use the included launcher.
Crew starts and stops the engine. Enable FreeChain in Library before using it.
Provider secrets belong in stdin or the Providers UI, never shell arguments.
`;
if (['help', '--help', '-h'].includes(command)) { process.stdout.write(help); process.exit(0); }
try {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const data = path.resolve(process.env.FREECHAIN_CREW_DATA_DIR || path.join(appRoot, 'data'));
  const runtime = JSON.parse(fs.readFileSync(path.join(data, 'runtime.json'), 'utf8'));
  if (runtime.app !== 'freechain' || !Number.isInteger(runtime.port) || runtime.port < 1 || runtime.port > 65535) throw new Error('Invalid app runtime discovery record.');
  const secret = fs.readFileSync(path.join(data, '.cli-key'), 'utf8').trim();
  let method = 'GET'; let route; let body = '';
  const routes = { status: '/runtime', models: '/v1/models', providers: '/admin/state', chain: '/admin/state', harnesses: '/admin/harnesses', logs: '/v1/logs' };
  if (command === 'chat') {
    if (!args.join(' ').trim()) throw new Error('chat requires a prompt.');
    method = 'POST'; route = '/v1/chat/completions';
    body = JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: args.join(' ') }] });
  } else if (command === 'request') {
    [method, route] = args;
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || !/^\/(admin|v1)\/[a-zA-Z0-9/?=&%_.-]+$/.test(route || '') || route.includes('..')) throw new Error('Use request METHOD /admin/... or /v1/...');
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      if (process.stdin.isTTY) throw new Error('Pipe a JSON body into this command.');
      const chunks = []; let bytes = 0;
      for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) throw new Error('JSON input exceeds 8 MiB.'); chunks.push(chunk); }
      body = Buffer.concat(chunks).toString('utf8'); if (body) JSON.parse(body);
    }
  } else { route = routes[command]; if (!route) throw new Error(`Unknown command: ${command}. Run help.`); }
  const target = `/api${route}`;
  const response = await fetch(`http://127.0.0.1:${runtime.port}${target}`, { method, signal: AbortSignal.timeout(180000), headers: { 'content-type': 'application/json', 'x-freechain-cli': signRequest({ secret, method, target, body }) }, ...(body ? { body } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || `HTTP ${response.status}`);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (error) {
  const message = error.code === 'ENOENT' || error.cause?.code === 'ECONNREFUSED' ? 'FreeChain is not running in Crew. Enable it in Library, then retry.' : error.message;
  process.stderr.write(`freechain: ${message}\n`); process.exitCode = 1;
}
