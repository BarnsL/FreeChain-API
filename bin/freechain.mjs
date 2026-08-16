#!/usr/bin/env node
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadChain, loadDotEnv, chainStatus, ROOT } from '../src/config.js';
import { createServer } from '../src/server.js';
import { ensureAccessKey } from '../src/admin.js';
import { isPortListening, superviseWorker } from '../src/supervisor.js';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(name);
const isWorker = has('--worker');

if (has('--help') || has('-h')) {
  console.log(`freechain — OpenAI-compatible failover router

  freechain [--port 4853] [--host 127.0.0.1] [--chain <file>] [--verbose]
  freechain --status        show which links have credentials, then exit

Point any OpenAI-compatible client at http://<host>:<port>/v1 and use the
model id "auto" to let the chain pick.`);
  process.exit(0);
}

loadDotEnv();

const chainFile = path.resolve(flag('--chain', path.join(ROOT, 'chain.config.json')));
let chain;
try {
  chain = loadChain(chainFile);
} catch (err) {
  console.error(`freechain: ${err.message}`);
  process.exit(1);
}

const status = chainStatus(chain);
const configured = status.filter((l) => l.hasKey);

if (has('--status')) {
  for (const l of status) {
    const creds = l.keyCount
      ? `${l.keyCount} key${l.keyCount > 1 ? 's' : ''} / ${l.accountCount} slot${l.accountCount > 1 ? 's' : ''}`
      : l.hasKey
        ? 'no key needed'
        : '—';
    const slots = l.slots.length > 1 ? `  [${l.slots.join(' ')}]` : '';
    console.log(`${l.hasKey ? 'ok  ' : '--  '} ${l.provider.padEnd(14)} ${creds.padEnd(18)} ${l.model}${slots}`);
  }
  const candidates = status.reduce((n, l) => n + (l.keyCount || (l.hasKey ? 1 : 0)), 0);
  console.log(`\n${configured.length}/${status.length} links configured, ${candidates} candidate(s) to try.`);
  process.exit(configured.length ? 0 : 1);
}

const port = Number(flag('--port', process.env.FREECHAIN_PORT || 4853));
// Loopback by default: this process holds every provider credential, so it
// must be opted in to listening on anything wider.
const host = flag('--host', process.env.FREECHAIN_HOST || '127.0.0.1');
const ui = !has('--no-ui');

if (!isWorker) {
  if (await isPortListening({ host, port })) {
    console.log(`freechain already running at http://${host}:${port}/v1`);
  } else {
    // The parent owns recovery; the child intentionally executes this same
    // familiar startup path so its API and credential behavior stay unchanged.
    const supervisor = superviseWorker({
      spawnWorker: () => fork(fileURLToPath(import.meta.url), [...argv, '--worker'], {
        cwd: process.cwd(),
        env: process.env,
      }),
    });
    const stop = (signal) => {
      console.log(`[supervisor] received ${signal}; stopping worker`);
      supervisor.stop();
    };
    process.once('SIGINT', () => stop('SIGINT'));
    process.once('SIGTERM', () => stop('SIGTERM'));
    supervisor.start();
  }
} else {
  // Generated on first run even without the dashboard: every proxy route is gated.
  const accessKey = ensureAccessKey();

  createServer(chain, { verbose: has('--verbose'), ui }).listen(port, host, () => {
    const withKeys = status.filter((l) => l.keyCount > 0);
    console.log(`freechain    http://${host}:${port}/v1`);
    if (ui) console.log(`dashboard    http://${host}:${port}/`);
    console.log(`chain        ${configured.length}/${status.length} links configured (${chainFile})`);

    if (!withKeys.length) {
      // Not fatal: the dashboard is how a user is meant to add their first key,
      // so refusing to start here would leave them nowhere to do it.
      console.log('');
      console.log('No model source keys configured yet — requests will fail until you add one.');
      if (ui) console.log(`Add one at   http://${host}:${port}/  →  Model sources`);
    } else if (accessKey) {
      console.log(ui ? 'access key   set (reveal it in the dashboard)' : 'access key   set');
    }

    if (host !== '127.0.0.1' && host !== 'localhost') {
      console.warn(`\nWARNING: bound to ${host}, not loopback — this port proxies your API keys.`);
    }
  });
}
