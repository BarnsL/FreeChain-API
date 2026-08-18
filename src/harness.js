// Versioned, private Harness library and deterministic request composition.
//
// FreeChain authenticates every caller with one access key, so unlike SubChain
// there is nothing to assign a Harness to: the Default Harness applies to every
// request. The file format is shared with SubChain on purpose — same schema,
// same component vocabulary — so a Harness exported from one is legible in the
// other.

import fs from 'node:fs';
import path from 'node:path';
import { resolveDataDir } from './storage.js';

export function resolveHarnessFile({ dataDir = resolveDataDir() } = {}) {
  return path.join(dataDir, 'harnesses.json');
}

export const TEXT_COMPONENTS = [
  'identity',
  'operatingInstructions',
  'safetyPolicy',
  'toolPolicy',
  'reasoningPolicy',
  'outputStyle',
  'behavioralMode',
  'persona',
];

const BLOCKED_HEADERS = new Set([
  'authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'host',
  'content-length', 'connection', 'transfer-encoding', 'upgrade', 'x-api-key',
  'api-key', 'proxy-authenticate', 'www-authenticate',
]);

/** Keep user-selected HTTP metadata away from credentials and framing controls. */
export function sanitizeHarnessHeaders(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const headers = {};
  for (const [name, value] of Object.entries(input).slice(0, 20)) {
    const lower = name.toLowerCase();
    if (!/^[a-z0-9-]{1,64}$/i.test(name) || BLOCKED_HEADERS.has(lower)) continue;
    if (typeof value !== 'string' || value.length > 1024 || /[\r\n]/.test(value)) continue;
    headers[name] = value;
  }
  return headers;
}

function blankComponents() {
  return {
    identity: '',
    operatingInstructions: '',
    persona: '',
    behavioralMode: '',
    safetyPolicy: '',
    toolPolicy: '',
    reasoningPolicy: '',
    outputStyle: '',
    generation: {
      temperature: null,
      top_p: null,
      top_k: null,
      max_tokens: null,
      stop_sequences: [],
      effort: null,
    },
    infrastructure: { stream: null, service_tier: null, user_id: null },
    aliases: {},
    headers: {},
  };
}

function defaultHarness() {
  return { id: 'default', name: 'Default Harness', components: blankComponents() };
}

function cleanId(value, fallback = 'harness') {
  const id = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  if (!id || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error('Harness name must contain letters or numbers');
  return id;
}

function normalizeComponents(input = {}) {
  const defaults = blankComponents();
  const legacyPrompts = input.systemPrompts || {};
  const source = input.components || input;
  const normalized = { ...defaults };
  for (const key of TEXT_COMPONENTS) {
    const legacy = key === 'identity' || key === 'operatingInstructions' || key === 'persona' || key === 'behavioralMode'
      ? legacyPrompts[key]
      : undefined;
    const value = source[key] ?? legacy;
    normalized[key] = typeof value === 'string' ? value : '';
  }
  normalized.generation = { ...defaults.generation, ...(source.generation || input.generation || {}) };
  normalized.infrastructure = { ...defaults.infrastructure, ...(source.infrastructure || input.infrastructure || {}) };
  normalized.aliases = source.aliases && typeof source.aliases === 'object' && !Array.isArray(source.aliases) ? { ...source.aliases } : {};
  normalized.headers = sanitizeHarnessHeaders(source.headers);
  return normalized;
}

function normalizeHarness(input, fallbackId = 'harness') {
  const id = cleanId(input?.id, fallbackId);
  const name = typeof input?.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 120) : id;
  return { id, name, components: normalizeComponents(input || {}) };
}

/**
 * Which Harness requests are composed with.
 *
 * SubChain answers this per local key. FreeChain has exactly one access key,
 * so the choice is a property of the library instead: one Harness is active
 * and every request gets it. An `activeId` naming a Harness that no longer
 * exists falls back to the Default rather than failing a request.
 */
function normalizeActiveId(activeId, harnesses) {
  const wanted = typeof activeId === 'string' ? activeId : '';
  return harnesses.some((harness) => harness.id === wanted) ? wanted : 'default';
}

function normalizeLibrary(raw) {
  if (raw?.schemaVersion === 2 && Array.isArray(raw.harnesses)) {
    const harnesses = raw.harnesses.map((harness, index) => normalizeHarness(harness, `harness-${index + 1}`));
    if (!harnesses.some((harness) => harness.id === 'default')) harnesses.unshift(defaultHarness());
    return { schemaVersion: 2, activeId: normalizeActiveId(raw.activeId, harnesses), harnesses };
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return {
      schemaVersion: 2,
      activeId: 'default',
      harnesses: [{ id: 'default', name: 'Default Harness', components: normalizeComponents(raw) }],
    };
  }
  return { schemaVersion: 2, activeId: 'default', harnesses: [defaultHarness()] };
}

/** Load the named Harness library, tolerating a missing or corrupt file. */
export function loadHarnessLibrary(file = resolveHarnessFile()) {
  if (!fs.existsSync(file)) return normalizeLibrary(null);
  try {
    return normalizeLibrary(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return normalizeLibrary(null);
  }
}

/** Save private Harness configuration atomically. */
export function saveHarnessLibrary(library, file = resolveHarnessFile()) {
  const normalized = normalizeLibrary(library);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, file);
  if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
  return normalized;
}

export function createHarness(library, { id, name, components = {} } = {}) {
  if (!library || !Array.isArray(library.harnesses)) throw new Error('Harness library is invalid');
  const base = cleanId(id || name, 'harness');
  let harnessId = base;
  for (let suffix = 2; library.harnesses.some((harness) => harness.id === harnessId); suffix++) {
    harnessId = `${base.slice(0, 64 - String(suffix).length - 1)}-${suffix}`;
  }
  const harness = normalizeHarness({ id: harnessId, name: name || harnessId, components }, harnessId);
  library.harnesses.push(harness);
  return harness;
}

export function updateHarness(library, harnessId, { name, components } = {}) {
  const harness = library?.harnesses?.find((candidate) => candidate.id === harnessId);
  if (!harness) throw new Error(`Unknown Harness: ${harnessId}`);
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('Harness name is required');
    harness.name = name.trim().slice(0, 120);
  }
  if (components !== undefined) harness.components = normalizeComponents({ ...harness.components, ...components });
  return harness;
}

export function removeHarness(library, harnessId) {
  if (harnessId === 'default') throw new Error('Default Harness cannot be deleted');
  const index = library?.harnesses?.findIndex((candidate) => candidate.id === harnessId) ?? -1;
  if (index < 0) throw new Error(`Unknown Harness: ${harnessId}`);
  const removed = library.harnesses.splice(index, 1)[0];
  // Deleting what was active must not leave requests pointing at nothing.
  if (library.activeId === harnessId) library.activeId = 'default';
  return removed;
}

/** Point every future request at `harnessId`. Unknown ids are refused here. */
export function setActiveHarness(library, harnessId) {
  if (!library?.harnesses?.some((candidate) => candidate.id === harnessId)) {
    throw new Error(`Unknown Harness: ${harnessId}`);
  }
  library.activeId = harnessId;
  return library;
}

/** The Harness every request is composed with right now. */
export function activeHarness(library) {
  return harnessById(library, library?.activeId || 'default');
}

export function harnessById(library, harnessId = 'default') {
  return library?.harnesses?.find((candidate) => candidate.id === harnessId)
    || library?.harnesses?.find((candidate) => candidate.id === 'default')
    || defaultHarness();
}

export function applyHarnessConfig(body, harness) {
  const components = normalizeComponents(harness || {});
  const next = { ...body, messages: Array.isArray(body.messages) ? [...body.messages] : body.messages };

  if (components.aliases[next.model]) next.model = components.aliases[next.model];

  const generation = components.generation;
  if (generation.temperature !== null && generation.temperature !== undefined && next.temperature === undefined) next.temperature = generation.temperature;
  if (generation.top_p !== null && generation.top_p !== undefined && next.top_p === undefined) next.top_p = generation.top_p;
  if (generation.top_k !== null && generation.top_k !== undefined && next.top_k === undefined) next.top_k = generation.top_k;
  if (generation.max_tokens !== null && generation.max_tokens !== undefined && next.max_tokens === undefined) next.max_tokens = generation.max_tokens;
  if (generation.stop_sequences?.length && next.stop === undefined) next.stop = generation.stop_sequences;
  if (generation.effort && next.reasoning_effort === undefined) next.reasoning_effort = generation.effort;

  if (components.infrastructure.stream !== null && components.infrastructure.stream !== undefined && next.stream === undefined) {
    next.stream = components.infrastructure.stream;
  }
  if (components.infrastructure.service_tier && next.service_tier === undefined) next.service_tier = components.infrastructure.service_tier;
  if (components.infrastructure.user_id && next.user === undefined) next.user = components.infrastructure.user_id;

  const prompts = TEXT_COMPONENTS
    .map((key) => components[key])
    .filter((value) => typeof value === 'string' && value.trim() && value.trim().toLowerCase() !== 'auto')
    .map((value) => value.trim());
  if (prompts.length && Array.isArray(next.messages)) {
    next.messages.unshift({ role: 'system', content: prompts.join('\n\n') });
  }
  return next;
}

// Compatibility helpers for callers that still address the Default Harness directly.
export function loadHarness(file = resolveHarnessFile()) {
  return harnessById(loadHarnessLibrary(file)).components;
}

export function saveHarness(config, file = resolveHarnessFile()) {
  const library = loadHarnessLibrary(file);
  const source = config?.components || config || {};
  const legacy = config?.systemPrompts || {};
  updateHarness(library, 'default', {
    components: {
      ...source,
      ...Object.fromEntries(
        ['identity', 'operatingInstructions', 'behavioralMode', 'persona']
          .filter((key) => legacy[key] !== undefined)
          .map((key) => [key, legacy[key]]),
      ),
    },
  });
  saveHarnessLibrary(library, file);
}

export function applyHarness(body, file = resolveHarnessFile()) {
  return applyHarnessConfig(body, loadHarness(file));
}
