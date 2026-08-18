# RCA: Nous Man requests rejected by FreeChain after access-key rotation

- **Incident time:** 2026-08-17 17:47:24 UTC
- **Surface:** Discord thread `<redacted-thread-id>`
- **Hermes session:** `<redacted-session-id>`
- **Gateway:** FreeChain on loopback port 4853
- **Severity:** User-visible authentication outage for affected Nous Man threads
- **Status:** Resolved by identifying client credential drift; durable observability added in this change

## Executive summary

Nous Man sent an OpenAI-compatible chat request to FreeChain with an access key that had been saved before the FreeChain access key was rotated. FreeChain correctly rejected the request with HTTP 401 at its local authentication boundary. The request never reached JSON parsing, model selection, a provider, or cooling logic, so there were no upstream attempts and no provider token usage.

The original gateway had no persistent request journal. That made the failure visible in the client and transient console output, but it did not leave a durable, content-safe record tying the request, app, session, authentication result, and zero-attempt outcome together. This change adds that missing evidence while explicitly excluding prompts, responses, tools, credentials, arbitrary headers, and raw provider bodies.

## User-visible notice

```text
🛠 Nous Man operational notice [status/lifecycle] — 2026-08-17 17:47:24 UTC
❌ Non-retryable error (HTTP 401): HTTP 401: Invalid API key. Use the access key from the FreeChain dashboard.

(as would have posted: ⚠️ Provider authentication failed. Check the configured credentials; raw provider details are in the gateway logs.)
surface: thread:<redacted-thread-id> session: <redacted-session-id>
```

## Impact

- The affected Nous Man turn did not receive a model response.
- Six matching authentication notices were found across four Discord threads between 09:28:14 and 17:47:24 UTC on 2026-08-17.
- No provider credential was sent and no provider quota was consumed for these rejected turns.
- FreeChain itself remained reachable. Requests using its current access key could authenticate successfully.

## Timeline

| Time, UTC | Event |
|---|---|
| 09:28:14 to 17:47:24 | Matching Nous Man authentication failures appeared across four threads. |
| 17:47:21 | Hermes session `<redacted-session-id>` prepared the affected request for the target thread. |
| 17:47:24 | FreeChain rejected the request at the local access-key check with HTTP 401. |
| Immediately after | The normal provider dispatch path did not run. Attempts, cooling changes, and upstream usage were all zero. |
| Same incident path | An auxiliary title-generation fallback separately encountered an OpenRouter HTTP 402. It did not authenticate or recover the original chat turn and was not the cause of the 401. |

## Technical request path

```text
Nous Man / Hermes Discord surface
  -> POST http://127.0.0.1:4853/v1/chat/completions
  -> Authorization bearer comparison
  -> HTTP 401 invalid_api_key
  -> stop

Never reached:
  JSON body parsing -> model selection -> provider candidate dispatch -> cooling -> response metering
```

The captured request envelope identified model `auto`, two messages with system and user roles, tool declarations, and `max_tokens` 65536. Those bodies are intentionally not reproduced here and are not retained by the new journal.

## Root cause

The Nous Man client retained a stale FreeChain access key after FreeChain's local access key had been rotated. A masked-equivalence check tied the failed request to the client-saved value without exposing either credential. A controlled request with the saved client key returned 401, while the same authenticated model-list request with FreeChain's current key returned 200.

The rotation event itself could not be timestamped from FreeChain because the pre-incident server retained no persistent operational records. This limits the RCA to proving credential divergence and its effect, not the exact action or process that initiated rotation.

## Five whys

1. **Why did Nous Man fail?** FreeChain returned HTTP 401 for the bearer credential.
2. **Why was the bearer credential invalid?** The value saved by Nous Man no longer matched FreeChain's current access key.
3. **Why did those values diverge?** FreeChain's access key had been rotated after Nous Man saved its configuration.
4. **Why did the client not recover automatically?** Access-key rotation is intentionally immediate and revokes all old clients; Nous Man had no secure automatic re-enrollment channel for this local key.
5. **Why was diagnosis slower than necessary?** FreeChain exposed transient console errors and aggregate counters but had no durable, privacy-safe request lifecycle journal or app/session correlation.

## Contributing factors

- One FreeChain access key gates every client, so a rotation intentionally invalidates all saved copies at once.
- The client did not identify itself or its session through standardized optional metadata headers.
- Aggregate served/failed counters could not distinguish authentication rejection from provider failure.
- The client-facing recovery text mentioned provider authentication even though the rejection happened before any provider was contacted.
- The unrelated auxiliary HTTP 402 occurred close enough to the failed turn to be mistaken for the primary cause without request-level correlation.

## Corrective actions completed

- Added a bounded `RequestJournal` with 500 in-memory records and JSONL persistence.
- Added 5 MiB rotation with one predecessor file and malformed-line recovery.
- Added `--log <path>` and `--no-log`; the latter keeps the in-memory view while disabling disk writes.
- Added one sanitized terminal record per meaningful request, including pre-auth 401s with `inputSummary: unavailable-before-auth`.
- Added authenticated `GET /v1/logs` with status, provider, app, route, search, limit, and cursor filters.
- Added `X-FreeChain-Request-Id` response correlation.
- Added optional `X-FreeChain-App` and `X-FreeChain-Session-Id` client metadata with control-character removal and length caps.
- Added exact token usage when the upstream supplies it and clearly labelled four-character estimates otherwise.
- Added the Logs dashboard directly below Chain, including filters, summaries, attempt trails, errors, cooling, loading/empty/stale states, and visible refresh timing.
- Added metadata-only audit records for credential reveal/rotation, provider-key changes/tests, chain reorder, and shortcut actions.

## Privacy and security boundary

The request journal stores operational metadata only. It does not store:

- prompt or response text;
- tool definitions, tool arguments, or tool results;
- FreeChain or provider credentials;
- authorization or arbitrary request headers;
- raw provider diagnostic bodies;
- raw client IP addresses.

Client app and session values are opt-in, client-reported metadata. They are sanitized and length capped, but operators must still avoid putting secrets in them. The log API uses the same constant-time access-key boundary as chat and model discovery, returns `Cache-Control: no-store`, and never journals its own reads.

## Follow-up recommendations

- Rebind every Nous Man/Hermes client profile to the current FreeChain access key after an intentional rotation.
- Set the optional app and session headers from Nous Man so future records correlate directly without retaining content.
- Change client recovery wording to distinguish local gateway authentication from upstream provider authentication.
- Treat any future access-key rotation as a coordinated client-reenrollment event and record the operator action in the journal.
- Continue FC-005 separately: the dashboard admin API remains a broader loopback/browser security boundary that should be hardened before non-loopback exposure.

## Verification criteria

The incident class is considered durably covered when tests and a live isolated run prove that:

1. a stale key receives 401 before body parsing and creates a metadata-only auth-reject record;
2. a current key can read `/v1/logs` while a missing or stale key cannot;
3. the record contains the request ID, app/session metadata, zero attempts, zero cooling changes, and no usage;
4. known prompt, response, provider-error, and credential sentinels do not appear in memory or JSONL;
5. log reads do not create recursive log records.

