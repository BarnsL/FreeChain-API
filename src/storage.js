// Private local storage for FreeChain's Harness library and imported presets.
//
// Deliberately separate from ROOT (which is the checkout, or the folder next
// to a packaged exe): Harness bodies and imported preset text are user data,
// not part of the shipped app, so they live in the platform's conventional
// private application directory and never inside the repository.

import os from 'node:os';
import path from 'node:path';

const nonEmpty = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** Resolve a conventional private data directory without baking a host path into the app. */
export function resolveDataDir({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const explicit = nonEmpty(env.FREECHAIN_DATA_DIR);
  if (explicit) return explicit;
  if (platform === 'win32') return path.join(nonEmpty(env.APPDATA) || path.join(home, 'AppData', 'Roaming'), 'FreeChain');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'FreeChain');
  return path.join(nonEmpty(env.XDG_CONFIG_HOME) || path.join(home, '.config'), 'freechain');
}
