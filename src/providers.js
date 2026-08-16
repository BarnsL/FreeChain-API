// Provider catalog. Every provider here speaks the OpenAI chat-completions
// wire format, which is what lets one chain span all of them.
//
// `keyEnv` lists the environment variable *base names* checked for that
// provider's credentials, in order. Each base name supports three forms —
// single, plural list, and numbered — see src/config.js. Nothing in this file
// is a secret: keys are resolved at runtime and never written back to disk.

export const PROVIDERS = {
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: ['FREECHAIN_OPENROUTER_API_KEY', 'OPENROUTER_API_KEY'],
    // OpenRouter attributes requests to an app via these; harmless if unset.
    headers: {
      'HTTP-Referer': 'https://github.com/freechain-api',
      'X-Title': 'freechain',
    },
  },

  'opencode-zen': {
    label: 'OpenCode Zen',
    baseUrl: 'https://opencode.ai/zen/v1',
    keyEnv: ['FREECHAIN_OPENCODE_ZEN_API_KEY', 'OPENCODE_ZEN_API_KEY'],
  },

  // Self-hosted OpenAI-compatible router. Runs on loopback and usually needs
  // no credential, so it is treated as optional-key.
  omniroute: {
    label: 'OmniRoute (self-hosted router)',
    baseUrl: 'http://127.0.0.1:20128/v1',
    keyEnv: ['FREECHAIN_OMNIROUTE_API_KEY', 'OMNIROUTE_API_KEY'],
    keyOptional: true,
  },

  longcat: {
    label: 'LongCat',
    baseUrl: 'https://api.longcat.chat/openai/v1',
    keyEnv: ['FREECHAIN_LONGCAT_API_KEY', 'LONGCAT_API_KEY'],
  },

  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyEnv: ['FREECHAIN_GROQ_API_KEY', 'GROQ_API_KEY'],
  },
  cerebras: {
    label: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    keyEnv: ['FREECHAIN_CEREBRAS_API_KEY', 'CEREBRAS_API_KEY'],
  },
  nvidia: {
    label: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    keyEnv: ['FREECHAIN_NVIDIA_API_KEY', 'NVIDIA_API_KEY'],
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    keyEnv: ['FREECHAIN_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY'],
  },
  google: {
    label: 'Google Gemini (OpenAI-compatible)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    keyEnv: ['FREECHAIN_GOOGLE_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyEnv: ['FREECHAIN_OPENAI_API_KEY', 'OPENAI_API_KEY'],
  },

  // Any OpenAI-compatible server on the machine: Ollama, LM Studio,
  // llama.cpp, vLLM. Base URL comes from the chain entry itself.
  local: {
    label: 'Local OpenAI-compatible server',
    baseUrl: 'http://127.0.0.1:11434/v1',
    keyEnv: ['FREECHAIN_LOCAL_API_KEY'],
    keyOptional: true,
  },
};

export function providerDef(id) {
  const def = PROVIDERS[id];
  if (!def) throw new Error(`Unknown provider "${id}". Known: ${Object.keys(PROVIDERS).join(', ')}`);
  return def;
}
