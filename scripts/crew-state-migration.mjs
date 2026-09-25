import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setEnvVars } from '../src/envfile.js';

export async function privateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') execFileSync(path.join(process.env.SystemRoot, 'System32/icacls.exe'),
    [directory, '/inheritance:r', '/grant:r', '*S-1-3-4:(OI)(CI)F', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F'],
    { stdio: 'pipe', windowsHide: true, timeout: 10000 });
}

// Never follow junctions/symlinks out of the explicitly selected state trees.
async function copyState(source, target, required = false) {
  let stat;
  try { stat = await fs.lstat(source); } catch (error) { if (!required && error.code === 'ENOENT') return 0; throw error; }
  if (stat.isSymbolicLink()) throw new Error('Linked state paths are not supported for migration.');
  if (stat.isDirectory()) {
    await fs.mkdir(target, { recursive: true, mode: 0o700 }); let count = 0;
    for (const entry of await fs.readdir(source)) count += await copyState(path.join(source, entry), path.join(target, entry), true);
    return count;
  }
  if (!stat.isFile()) throw new Error('Unsupported state file type.');
  // Opaque copy: provider credentials are never parsed or included in reports.
  await fs.copyFile(source, target); return 1;
}

export async function stageCrewState({ sourceRoot, userData, crewData, destination, port }) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid API port.');
  const target = path.resolve(destination);
  for (const source of [sourceRoot, userData, crewData]) {
    const a = path.resolve(source).toLowerCase(); const b = target.toLowerCase();
    if (a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep)) throw new Error('Migration paths overlap.');
  }
  if (await fs.lstat(target).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) throw new Error('Migration destination already exists.');
  await privateDirectory(target);
  let copied = await copyState(crewData, target, true);
  for (const file of ['.env', 'chain.config.json', '.freechain-operator.json']) copied += await copyState(path.join(sourceRoot, file), path.join(target, file), file !== '.freechain-operator.json');
  for (const entry of ['harnesses.json', 'presets']) {
    const existing = path.join(crewData, entry);
    if (await fs.access(existing).then(() => true, () => false)) throw new Error(`Existing Crew ${entry} needs reconciliation before migration.`);
    copied += await copyState(path.join(userData, entry), path.join(target, entry));
  }
  await fs.mkdir(path.join(target, 'logs'), { recursive: true });
  for (const file of ['requests.jsonl', 'requests.jsonl.1']) copied += await copyState(path.join(sourceRoot, 'logs', file), path.join(target, 'logs', file));
  await fs.rm(path.join(target, 'runtime.json'), { force: true });
  // Use FreeChain's existing writer to change only deployment settings.
  setEnvVars(path.join(target, '.env'), { FREECHAIN_PORT: String(port), FREECHAIN_HOST: '127.0.0.1', FREECHAIN_CREW_API_PORT: null });
  return { copiedFiles: copied, apiPort: port, credentialsPrinted: false };
}
