#!/usr/bin/env node
import path from 'node:path';
import { loadChain, loadDotEnv, chainStatus, ROOT } from '../src/config.js';
import { createServer } from '../src/server.js';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(name);

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
const ready = status.filter((l) => l.hasKey);

if (has('--status')) {
  for (const l of status) {
    const keys = l.keyCount ? `${l.keyCount} key${l.keyCount > 1 ? 's' : ''}` : l.hasKey ? 'no key needed' : '—';
    console.log(`${l.hasKey ? 'ok  ' : '--  '} ${l.provider.padEnd(16)} ${keys.padEnd(14)} ${l.model}`);
  }
  const candidates = status.reduce((n, l) => n + (l.keyCount || (l.hasKey ? 1 : 0)), 0);
  console.log(`\n${ready.length}/${status.length} links ready, ${candidates} candidate(s) to try.`);
  process.exit(ready.length ? 0 : 1);
}

if (!ready.length) {
  console.error(
    'freechain: no chain link has a credential.\n' +
      `Copy .env.example to .env and fill in at least one key, then retry.\n` +
      `Run "freechain --status" to see the chain.`
  );
  process.exit(1);
}

const port = Number(flag('--port', process.env.FREECHAIN_PORT || 4853));
// Loopback by default: this process holds every provider credential, so it
// must be opted in to listening on anything wider.
const host = flag('--host', process.env.FREECHAIN_HOST || '127.0.0.1');

createServer(chain, { verbose: has('--verbose') }).listen(port, host, () => {
  console.log(`freechain   http://${host}:${port}/v1`);
  console.log(`chain       ${ready.length}/${status.length} links ready (${chainFile})`);
  console.log(`first up    ${ready[0].provider} / ${ready[0].model}`);
  if (host !== '127.0.0.1' && host !== 'localhost') {
    console.warn(`WARNING: bound to ${host}, not loopback — this port proxies your API keys.`);
  }
});
