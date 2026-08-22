# Provider Setup Behavior

The operator distinguishes provider access modes before doing anything:

## Managed subscription/OAuth

Use the provider-owned managed login flow. The operator can propose starting the already-supported OpenAI Codex managed sign-in in SubChain, then return the verification URL/code to the human. It never reads the resulting token into model context.

## Direct API key

The Providers tab shows an official setup URL and a password input. Pasting there posts directly to the loopback server; it does not go through chat. Alternatively, if a supported credential source is already detected, the chat can propose a confirmation-gated import that rereads it server-side.

## Local service

Local providers are treated as services, not credential stores. The operator should verify the process/model endpoint and only use an API key when the local service actually requires one.

## Current setup destinations included in this kit

- OpenAI API: `platform.openai.com/api-keys`
- OpenAI Codex managed auth: official Codex authentication documentation
- OpenRouter: `openrouter.ai/settings/keys`
- Groq: `console.groq.com/keys`
- Google Gemini: AI Studio key/auth-key page
- Cerebras: Cerebras Cloud
- NVIDIA NIM: NVIDIA Build
- Dario: its GitHub project/local service

Provider URLs are server-allowlisted. The model cannot invent an arbitrary credential-harvesting link and have the UI render it as a setup action.
