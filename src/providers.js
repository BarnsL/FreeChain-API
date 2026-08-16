// Provider catalog.
//
// Every provider here speaks the OpenAI chat-completions wire format, which is
// what lets one chain span all of them.
//
// Each provider is expanded into numbered *account slots* — `openrouter0`
// through `openrouter9` alongside the bare `openrouter`. Slots exist so several
// accounts on the same service can be rotated through without any of them being
// named after a person or an organisation. Each slot holds up to 10 keys of its
// own, so one provider can carry 110 credentials before you run out of room.
//
// Nothing in this file is a secret: keys are resolved at runtime from the
// environment and never written back to disk.

/** Numbered account slots generated per provider: <id>0 … <id>9. */
export const ACCOUNT_SLOTS = 10;

/** Keys accepted per account slot, via numbered env vars _1 … _10. */
export const MAX_KEYS_PER_ACCOUNT = 10;

// The env variable base name for a provider id.
//   openrouter    -> FREECHAIN_OPENROUTER_API_KEY
//   openrouter0   -> FREECHAIN_OPENROUTER0_API_KEY
//   opencode-zen3 -> FREECHAIN_OPENCODE_ZEN3_API_KEY
export const envBaseFor = (id) =>
  `FREECHAIN_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;

// Base definitions. `vendorEnv` is the provider's conventional variable, picked
// up so an environment that already has one works without renaming. It applies
// to the bare id only — numbered slots are explicit by nature.
const BASE_PROVIDERS = {
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    vendorEnv: ['OPENROUTER_API_KEY'],
    // OpenRouter attributes requests to an app via these; harmless if unset.
    headers: {
      'HTTP-Referer': 'https://github.com/freechain-api',
      'X-Title': 'freechain',
    },
  },

  'opencode-zen': {
    label: 'OpenCode Zen',
    baseUrl: 'https://opencode.ai/zen/v1',
    vendorEnv: ['OPENCODE_ZEN_API_KEY'],
  },

  // Self-hosted OpenAI-compatible router. Runs on loopback and usually needs
  // no credential, so it is treated as optional-key.
  omniroute: {
    label: 'OmniRoute (self-hosted router)',
    baseUrl: 'http://127.0.0.1:20128/v1',
    vendorEnv: ['OMNIROUTE_API_KEY'],
    keyOptional: true,
  },

  longcat: {
    label: 'LongCat',
    baseUrl: 'https://api.longcat.chat/openai/v1',
    vendorEnv: ['LONGCAT_API_KEY'],
  },
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    vendorEnv: ['GROQ_API_KEY'],
  },
  cerebras: {
    label: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    vendorEnv: ['CEREBRAS_API_KEY'],
  },
  nvidia: {
    label: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    vendorEnv: ['NVIDIA_API_KEY'],
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    vendorEnv: ['DEEPSEEK_API_KEY'],
  },
  google: {
    label: 'Google Gemini (OpenAI-compatible)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    vendorEnv: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    vendorEnv: ['OPENAI_API_KEY'],
  },

  // Any OpenAI-compatible server on the machine: Ollama, LM Studio,
  // llama.cpp, vLLM. Base URL comes from the chain entry itself.
  local: {
    label: 'Local OpenAI-compatible server',
    baseUrl: 'http://127.0.0.1:11434/v1',
    vendorEnv: [],
    keyOptional: true,
  },
};

/** Every provider id, bare and numbered, keyed by id. */
export const PROVIDERS = {};

for (const [family, def] of Object.entries(BASE_PROVIDERS)) {
  PROVIDERS[family] = {
    ...def,
    id: family,
    family,
    account: null,
    keyEnv: [envBaseFor(family), ...def.vendorEnv],
  };

  for (let n = 0; n < ACCOUNT_SLOTS; n++) {
    const id = `${family}${n}`;
    PROVIDERS[id] = {
      ...def,
      id,
      family,
      account: n,
      label: `${def.label} #${n}`,
      keyEnv: [envBaseFor(id)],
    };
  }
}

export function providerDef(id) {
  const def = PROVIDERS[id];
  if (!def) {
    throw new Error(
      `Unknown provider "${id}". Known families: ${Object.keys(BASE_PROVIDERS).join(', ')} ` +
        `(each also accepts numbered slots 0-${ACCOUNT_SLOTS - 1}, e.g. "openrouter0")`
    );
  }
  return def;
}

/**
 * The provider ids a chain link should draw candidates from.
 *
 * A bare family id fans out across the family — the bare slot first, then
 * every numbered slot — so adding a second account is a .env edit, not a chain
 * edit. Naming a numbered slot explicitly pins the link to that one account.
 */
export function familyMembers(id) {
  const def = providerDef(id);
  if (def.account !== null) return [id];
  return [def.family, ...Array.from({ length: ACCOUNT_SLOTS }, (_, n) => `${def.family}${n}`)];
}

export const FAMILIES = Object.keys(BASE_PROVIDERS);
