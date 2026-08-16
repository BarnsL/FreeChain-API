// Chain + credential loading.
//
// Credentials are resolved at request time from the environment (optionally
// seeded from a gitignored .env). They are never written into chain.config.json
// and never logged — only their count is ever reported.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerDef, familyMembers, MAX_KEYS_PER_ACCOUNT } from './providers.js';
import { IS_SEA, EXE_DIR } from './runtime.js';

// A packaged binary carries chain.config.json, .env, and webui/ alongside
// the executable itself rather than alongside this source file.
export const ROOT = IS_SEA
  ? EXE_DIR
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_CHAIN = path.join(ROOT, 'chain.config.json');

// Minimal KEY=VALUE reader. Deliberately not a full dotenv: no export
// keywords, no interpolation, no multi-line values — a key is one line.
export function loadDotEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return 0;
  let loaded = 0;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // A real environment variable always wins over the file.
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
      loaded++;
    }
  }
  return loaded;
}

const splitList = (raw) =>
  String(raw)
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * All credentials configured for one account slot, in priority order.
 *
 * For each base name (e.g. FREECHAIN_OPENROUTER0_API_KEY) three forms are
 * accepted, so a single account can carry several keys:
 *
 *   FREECHAIN_OPENROUTER0_API_KEY    = k1             single
 *   FREECHAIN_OPENROUTER0_API_KEYS   = k1,k2,k3       comma/space separated
 *   FREECHAIN_OPENROUTER0_API_KEY_1  = k1             numbered, 1..10
 *   FREECHAIN_OPENROUTER0_API_KEY_2  = k2
 *
 * Duplicates are collapsed so the same key is never tried twice in a row, and
 * the total is capped at MAX_KEYS_PER_ACCOUNT.
 */
export function resolveKeys(providerId) {
  const def = providerDef(providerId);
  const found = [];

  for (const base of def.keyEnv) {
    for (const name of [base, `${base}S`]) {
      const raw = process.env[name];
      if (raw && raw.trim()) found.push(...splitList(raw));
    }
    for (let n = 1; n <= MAX_KEYS_PER_ACCOUNT; n++) {
      const raw = process.env[`${base}_${n}`];
      if (raw && raw.trim()) found.push(...splitList(raw));
    }
  }

  return [...new Set(found)].slice(0, MAX_KEYS_PER_ACCOUNT);
}

/**
 * Every (account slot, key) pair a chain link can draw on, in order.
 * A bare family id fans out across its numbered slots; a numbered id is
 * pinned to itself. Slots with no key contribute nothing.
 */
export function resolveAccounts(providerId) {
  const out = [];
  for (const member of familyMembers(providerId)) {
    for (const key of resolveKeys(member)) out.push({ provider: member, key });
  }
  return out;
}

/** First configured key, or null. Kept for callers that only need presence. */
export function resolveKey(providerId) {
  return resolveKeys(providerId)[0] ?? null;
}

export function saveChainConfig(chain, file = DEFAULT_CHAIN) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.chain = chain.links.map((l) => {
    const entry = { provider: l.provider, model: l.model };
    if (!l.free) entry.free = false;
    if (l.note) entry.note = l.note;
    return entry;
  });
  fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n', 'utf8');
}

export function loadChain(file = DEFAULT_CHAIN) {
  if (!fs.existsSync(file)) throw new Error(`Chain config not found: ${file}`);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const links = (parsed.chain || []).map((entry, i) => {
    const def = providerDef(entry.provider);
    if (!entry.model) throw new Error(`chain[${i}] (${entry.provider}) is missing "model"`);
    return {
      index: i,
      provider: entry.provider,
      label: def.label,
      model: entry.model,
      baseUrl: (entry.baseUrl || def.baseUrl).replace(/\/+$/, ''),
      headers: def.headers || {},
      keyOptional: Boolean(def.keyOptional),
      free: entry.free !== false,
      note: entry.note || null,
    };
  });
  if (!links.length) throw new Error(`Chain config has no entries: ${file}`);
  return {
    links,
    settings: {
      requestTimeoutMs: parsed.requestTimeoutMs ?? 90_000,
      cooldownMs: parsed.cooldownMs ?? 60_000,
      maxAttempts: parsed.maxAttempts ?? null, // null = every configured candidate
      ...parsed.settings,
    },
  };
}

// Reports credential configuration without contacting or exposing a provider.
export function chainStatus(chain) {
  return chain.links.map((l) => {
    const accounts = resolveAccounts(l.provider);
    // Which numbered slots actually contributed, for the status table.
    const slots = [...new Set(accounts.map((a) => a.provider))];
    return {
      index: l.index,
      provider: l.provider,
      model: l.model,
      free: l.free,
      slots,
      accountCount: slots.length,
      keyCount: accounts.length,
      hasKey: l.keyOptional || accounts.length > 0,
    };
  });
}
