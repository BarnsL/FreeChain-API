# Unified Log Schema

All three apps use the same conceptual record:

- identity: request id and timestamps;
- request: route, method, model, streaming flag, message/role counts, bounded prompt summaries;
- client: coarse network category and optional reported app/session metadata;
- attempts: provider, model, outcome, provider HTTP classification, latency, transport where relevant;
- served result: provider/model/key ordinal/transport, never the key;
- usage: exact provider usage where available, otherwise explicit estimates;
- terminal status/outcome/error category;
- app-specific fields.

Specializations:
- **FreeChain:** key slot ordinal, cooldown state.
- **SubChain:** local-key id, target chain/provider, Harness id, transport, quota data.
- **VisionChain:** image count/type/detail and vision route.

Prompt summaries are deliberately bounded (default 280 characters per recent item, 3 items) and redacted before persistence. The operator can reduce or disable summaries. Raw prompt retention is not an operator option.

The deterministic security analyzer works from this sanitized schema so it does not need secrets or full conversation content.
