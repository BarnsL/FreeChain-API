# Security Model

## Trust boundaries

**Trusted local server code** is the authority. The chat model is advisory and may be wrong or malicious. The browser UI is a human interaction surface. Provider APIs and external control models are untrusted external systems.

The server therefore enforces:
- operator routes on loopback only;
- same-origin checks for browser mutations;
- JSON-only mutation bodies;
- strict tool allowlists;
- one-time pending action ids with expiration;
- validation again at confirmation time;
- secret-free model context;
- official provider-link allowlisting;
- repair file/size/content allowlists;
- rollback after failed validation.

## Credential discovery

Discovery may inspect only approved locations: environment variables, the app's ignored `.env`, an explicitly configured private credential directory, supported provider-owned application state, and platform-native stores already supported by the host app. UI/model output contains generic source categories, never credential values or absolute paths.

SubChain retains its existing provider-specific discovery layer and managed-client ownership model. FreeChain only looks for direct provider credentials. VisionChain detects Codex auth presence without copying Codex tokens.

## Logs

Logs are operational records, not conversation archives. They may retain:
- bounded redacted prompt summaries;
- request/model/route metadata;
- provider attempt trail;
- HTTP/error classification;
- timing, usage and quota metadata;
- image count/type metadata for VisionChain.

They do not retain raw request/response bodies, image bytes/data URLs, provider keys, OAuth tokens, authorization headers or cookies.

## External control models

An external OpenAI-compatible control model receives the same sanitized context the built-in/self route receives. Remote non-loopback control-model URLs must use HTTPS. Its API key is stored locally and is never included in prompts or logs.
