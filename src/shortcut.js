// Optional Start Menu shortcut for the packaged Windows executable.
//
// Only offered when this process is the Windows .exe (or the zip built
// around it) — a source checkout or the Node-only portable has no single
// binary worth pinning to the Start Menu. The decision is asked once and the
// answer persisted to .env, so the prompt never resurfaces after the user
// has picked either way, and does not come back merely because the shortcut
// was later deleted by hand.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { IS_SEA, EXE_DIR } from './runtime.js';
import { ENV_FILE } from './admin.js';
import { setEnvVars, reloadEnv } from './envfile.js';

export const SHORTCUT_STATE_VAR = 'FREECHAIN_SHORTCUT_STATE';

export const ELIGIBLE = IS_SEA && process.platform === 'win32';

function shortcutLnkPath() {
  return path.join(
    process.env.APPDATA || '',
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'FreeChain.lnk'
  );
}

function getState() {
  const value = process.env[SHORTCUT_STATE_VAR];
  return value === 'created' || value === 'declined' ? value : null;
}

function setState(value) {
  setEnvVars(ENV_FILE, { [SHORTCUT_STATE_VAR]: value });
  reloadEnv(ENV_FILE);
}

// Single-quoted PowerShell string literal: only ' needs escaping, by doubling.
const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

/** What the web UI needs to decide whether to show the permission prompt. */
export function shortcutStatus() {
  if (!ELIGIBLE) return { eligible: false, exists: false, state: null };
  return { eligible: true, exists: fs.existsSync(shortcutLnkPath()), state: getState() };
}

/**
 * Creates the .lnk via PowerShell's WScript.Shell COM object — the standard
 * way to write a shortcut on Windows without a native module. windowsHide
 * keeps the console from flashing up while it runs.
 */
export function createShortcut() {
  if (!ELIGIBLE) {
    throw Object.assign(
      new Error('Start Menu shortcuts are only offered for the Windows executable release'),
      { statusCode: 400 }
    );
  }
  const link = shortcutLnkPath();
  fs.mkdirSync(path.dirname(link), { recursive: true });

  const script = [
    '$ws = New-Object -ComObject WScript.Shell',
    `$sc = $ws.CreateShortcut(${psQuote(link)})`,
    // process.execPath, not a guessed "freechain.exe": it is correct even if
    // the user renamed the executable after unzipping.
    `$sc.TargetPath = ${psQuote(process.execPath)}`,
    `$sc.WorkingDirectory = ${psQuote(EXE_DIR)}`,
    `$sc.Description = ${psQuote('FreeChain — OpenAI-compatible failover router')}`,
    '$sc.Save()',
  ].join('; ');

  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
  });
  setState('created');
  return shortcutStatus();
}

/** The user was asked and said no. Remember it so the banner stays gone. */
export function dismissShortcut() {
  if (!ELIGIBLE) {
    throw Object.assign(
      new Error('Nothing to dismiss: not running as the Windows executable'),
      { statusCode: 400 }
    );
  }
  setState('declined');
  return shortcutStatus();
}
