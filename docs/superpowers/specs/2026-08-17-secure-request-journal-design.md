# Secure Request Journal and Incident RCA Design

**Date:** 2026-08-17
**Status:** Approved design, pending implementation
**Scope:** FreeChain request observability, authenticated logs API, dashboard Logs page, issue tracking, and the Nous Man 401 RCA

## Goal

Give an operator enough durable evidence to reconstruct every FreeChain API request without retaining prompt text, response text, tool arguments, credentials, or arbitrary headers. The journal must distinguish FreeChain authentication failures from provider failures, preserve provider-attempt and cooldown history, report exact token usage when a provider supplies it, and remain useful after a process restart.

## Incident that drives the design

At `2026-08-17 17:47:24 UTC`, Nous Man sent `POST /v1/chat/completions` to the FreeChain loopback service from Discord thread `<redacted-thread-id>`. The Hermes session was `<redacted-session-id>`.

Captured facts:

- Requested model: `auto`
- Input shape: two messages with system and user roles, plus tool definitions
- Requested maximum output: 65,536 tokens
- Result: HTTP 401 with FreeChain error code `invalid_api_key`
- Provider attempts: zero
- Provider token usage: zero because FreeChain rejected authentication before parsing or dispatching the body
- Cooling changes: none
- Caller: Nous Man through the Hermes Discord gateway

The request dump's masked key matches the key saved by Nous Man. A live control request using that saved key returns 401, while the current FreeChain key returns 200. Six equivalent owner notices occurred across four Discord threads between `09:28:14 UTC` and `17:47:24 UTC`. The immediate root cause is stale client authentication state after FreeChain key rotation. The exact rotation request cannot be timestamped from FreeChain because the service has no persistent request journal today.

The issue tracker will retain this notice, with the private Discord thread and session identifiers redacted:

```text
🛠 Nous Man operational notice [status/lifecycle] — 2026-08-17 17:47:24 UTC
❌ Non-retryable error (HTTP 401): HTTP 401: Invalid API key. Use the access key from the FreeChain dashboard.

(as would have posted: ⚠️ Provider authentication failed. Check the configured credentials; raw provider details are in the gateway logs.)
surface: thread:<redacted-thread-id> session: <redacted-session-id>
```

## Design decisions

### 1. One metadata record per request

Add a focused `RequestJournal` module. A request record is assembled during the request lifecycle and appended only when the request reaches a terminal state. Records have a schema version so future changes can remain backward compatible.

Each record may contain:

- Schema version and generated request ID
- Start and completion timestamps, duration, method, and route
- Remote address category limited to `loopback`, `private-network`, or `public-network`, never the address value or a reverse-resolved identity
- Client-reported app name from an allowlisted header when supplied
- Sanitized user-agent family and OpenAI SDK runtime metadata
- Optional sanitized client session identifier
- Authentication result and failure ownership, such as `freechain`, `provider`, or `request`
- Requested model, streaming flag, message count, role counts, input character count, tool count, and requested token cap
- Serving provider, resolved model, key ordinal, and number of attempts
- Every provider attempt's sanitized provider, model, key ordinal, outcome, HTTP status when known, duration, and redacted error summary
- Final HTTP status, finish reasons, choice count, output character and byte counts
- Exact prompt, completion, and total tokens when the provider returns usage
- Clearly labeled estimates derived from character counts when exact usage is unavailable
- Cooling snapshot relevant to the completed request
- Terminal error code, class, ownership, and redacted summary

Records never contain raw request bodies, response bodies, prompt text, response text, tool definitions or arguments, provider diagnostics bodies, authorization headers, provider keys, the FreeChain access key, cookies, or arbitrary headers.

### 2. Bounded memory and bounded persistence

The journal keeps the newest 500 records in memory for fast dashboard reads. Production startup persists the same sanitized records as JSON Lines in `logs/requests.jsonl` under the FreeChain runtime root.

- Default maximum active file size: 5 MiB
- One rotated predecessor: `requests.jsonl.1`
- Maximum retained disk data: approximately 10 MiB
- Best-effort owner-only file mode on platforms that support it
- Existing valid records are loaded at startup, newest first, up to the memory limit
- A malformed or partial line is skipped and never prevents startup
- `--log <path>` overrides the default file
- `--no-log` disables disk persistence but keeps the bounded in-memory page

The log directory is ignored by Git. Rotation targets only the two resolved journal files and never uses a broad directory deletion.

### 3. Secure API surface

Add `GET /v1/logs`. It uses the same constant-time access-key boundary as chat completions and model discovery, even on loopback.

Supported query parameters:

- `limit`, default 100 and maximum 500
- `before`, an opaque cursor derived from the prior page's start timestamp and request ID
- `status`
- `provider`
- `app`
- `route`
- `q`, matched only against sanitized metadata fields

The response contains `items`, `nextBefore`, a stable schema version, retention metadata, and a privacy statement. It always sends `Cache-Control: no-store`. The logs endpoint excludes itself from the journal so polling cannot create recursive noise.

All API responses receive `X-FreeChain-Request-Id`. CORS exposes this header. Two optional request headers are accepted:

- `X-FreeChain-App`, a client-reported label
- `X-FreeChain-Session-Id`, a client-reported correlation value

Both values are normalized, length-capped, stripped of control characters, and explicitly presented as client-reported rather than trusted identity.

### 4. What gets journaled

Journal all `/v1/*` requests except `/v1/logs` itself. Also journal meaningful dashboard actions that explain configuration drift, including access-key reveal and rotation, provider-key changes, provider tests, and chain reorder. Exclude static assets and high-frequency passive polling such as `/admin/state`.

Administrative events record the route, action class, result, and request ID only. They never record submitted values or returned credentials. Recording key rotation without the key value closes the evidence gap exposed by this incident.

### 5. Input, output, usage, and streaming

Input and output summaries are deterministic metadata, not model-generated summaries.

For input, count messages, roles, characters, structured content parts, tool definitions, streaming preference, and the requested token cap. Do not retain content. Requests rejected by access-key authentication are not body-parsed and explicitly record `inputSummary: unavailable-before-auth`.

For a non-streaming response, parse a copy of the already-buffered payload only to extract allowlisted usage, finish reasons, choice count, and output character count. Return the original provider payload byte-for-byte.

For streaming, pass every byte through unchanged. Observe complete SSE events opportunistically to collect output size, finish reasons, and a provider-supplied usage object when present. Do not enable provider stream-usage options on the caller's behalf and do not buffer the stream before delivery. When exact usage is absent, store only a clearly labeled `ceil(characterCount / 4)` heuristic estimate.

### 6. Attempts, errors, and cooling

The existing `dispatch()` attempt callback remains the attempt source. Journal integration normalizes its current fields without changing failover policy. Provider detail is passed through the central secret redactor, control-character filter, and length cap before persistence or API return.

The terminal record distinguishes:

- FreeChain access-key rejection before dispatch
- Caller request validation rejection
- Fatal provider rejection
- Retryable provider HTTP error
- Provider quota or rate limit
- Timeout or network failure
- Client disconnect
- Unexpected internal error

The terminal cooling field contains the sanitized post-request snapshot. An authentication failure before dispatch records an empty attempt list and no cooling change.

### 7. Dashboard Logs page

Add Logs immediately below Chain in the left sidebar. The page contains:

- Summary counts for requests, successes, failures, exact tokens, estimated tokens, and cooling events
- Filters for status, route, app, provider, and sanitized search
- Manual refresh and a ten-second refresh only while Logs is visible
- A compact table for time, app, route/model, result, duration, attempts, and token usage
- Expandable details for request ID, lifecycle, input/output metadata, attempts, errors, and cooling
- A persistent privacy notice explaining that conversation content and credentials are not retained
- Clear labels for exact versus estimated token values

Every server-controlled value is escaped before entering HTML. Empty, loading, API-error, and retention-truncation states are explicit.

## Files and ownership

- `src/request-journal.js`: schema, redaction, summaries, retention, persistence, and filtering
- `src/server.js`: lifecycle integration, request IDs, authenticated API, and terminal recording
- `bin/freechain.mjs`: production journal path and CLI flags
- `src/webui/index.html`: sidebar entry and Logs page structure
- `src/webui/app.js`: authenticated log loading, filters, and rendering
- `src/webui/app.css`: compact log table, summaries, details, and responsive layout
- `test/request-journal.test.js`: redaction, summaries, persistence, rotation, recovery, and filters
- `test/admin.test.js` and `test/chain.test.js`: auth boundary and lifecycle integration
- `test/source-integrity.test.js`: static browser contract and privacy language
- `ISSUES.md`: expand and close FC-001 when verified; add FC-017 for the Nous Man incident
- `docs/RCA-NOUS-MAN-FREECHAIN-401-2026-08-17.md`: complete evidence-backed RCA
- `README.md` and `DEPLOYMENT.md`: API, retention, security, runtime ownership, and operator instructions

## Testing and verification

Implementation uses red-green TDD.

1. Unit tests prove record schema, secret redaction, no raw content retention, exact and estimated usage, filters, malformed-line recovery, and bounded rotation.
2. Server tests prove unauthorized `/v1/logs` returns 401, authorized access returns only sanitized data, request IDs are stable, failed auth is recorded, successful and failed attempts are recorded, and `/v1/logs` does not record itself.
3. Existing chain tests prove failover semantics remain unchanged.
4. Source-integrity tests prove Logs sits below Chain, expected hooks exist, dynamic values use escaping, and privacy language is present.
5. Full `node --test "test/*.test.js"`, syntax checks, `git diff --check`, and GitNexus `detect_changes` must pass.
6. An isolated live server must prove one unauthorized request, one authorized model request, one successful completion, one provider error with cooling, authenticated log retrieval, and restart persistence.
7. Browser verification must inspect the real Logs page, filters, expanded details, responsive layout, and console output.

## Non-goals

- Storing or searching conversation content
- Replaying requests
- Sending logs off-machine
- Treating a client-reported app label as authenticated identity
- Changing provider selection or retry policy
- Automatically updating external clients after access-key rotation

The Nous Man credential must still be rebound through its supported configuration path and its gateway restarted separately. The journal makes future drift immediate to diagnose, but it does not broaden FreeChain's authority over client configuration.
