# Ox Alpha and Stream Reliability Design

**Date:** 2026-08-21
**Status:** Approved

## Goal

Make Ox Alpha the first FreeChain route through OpenCode Zen and the second route through OpenRouter, preserve the failing OpenCode credential at the final chain position, and prevent an HTTP 200 SSE error from defeating provider failover.

## Incident evidence

Nous Man sent `model=auto` streaming requests through FreeChain at 12:47 and 13:03 local time. FreeChain accepted the current top OpenRouter Nemotron route because its HTTP status was 200. The provider then emitted an SSE error reporting temporary Nvidia overload before any usable output. FreeChain had already returned the live response, so it recorded a successful route, applied no cooldown, and Hermes retried the same route three times.

The same session also exposed a separate compression routing problem. Its primary OpenCode Zen model was unsupported, a duplicate custom OpenCode route lacked usable authentication, and paid OpenRouter LongCat fallbacks returned credit errors. A later free OpenRouter fallback completed compression, but only after avoidable failures.

## Routing design

The installed credentials will use explicit account slots so the known failing credential can remain configured without being expanded beside the healthy credential:

1. Move the working OpenCode Zen credential from the bare family slot to `opencode-zen1`.
2. Put `opencode-zen1` with `x-preview-f-free` at chain position 1.
3. Put OpenRouter with `stealth/ox-alpha` at chain position 2. Its family link retains both verified OpenRouter credentials.
4. Keep the known failing `opencode-zen0` credential and add its pinned Ox Alpha link at the final chain position.

Pinning uses the provider-slot behavior FreeChain already supports. No new credential-selection abstraction is required.

## Early SSE error gate

For a successful streaming response whose content type is `text/event-stream`, `dispatch()` will read a bounded prefix before returning the response:

- Buffer no more than 64 KiB while waiting for the first complete SSE event.
- Preserve the original bytes exactly when rebuilding the live response body.
- Accept the candidate after the first valid non-error data event.
- Treat an explicit error event, a top-level JSON `error`, an empty early close, a malformed first data event, a read failure, or a prefix that exceeds the bound as `stream-error`.
- Penalize an early stream-error candidate, record a sanitized attempt without raw provider text, and continue down the normal candidate order.
- If the caller aborts, stop immediately instead of advancing.

Once valid stream content has been forwarded, FreeChain cannot safely retry because doing so could duplicate text or tool calls. That limitation remains documented.

## Nous Man compression design

Use OpenCode Zen Ox Alpha as the compression primary, OpenRouter Ox Alpha as the first fallback, and retain one known free OpenRouter model as the final fallback. Remove unsupported LongCat and duplicate custom routes from the compression chain. Correct the OpenCode provider metadata so its displayed endpoint and model list match the live route.

The failing FreeChain OpenCode credential remains configured at the final FreeChain chain position. This does not require keeping broken duplicate compression routes in Hermes.

## GUI and observability

The existing Chain table, Logs page, and cooling table already render live server state. Updating the chain and attempt outcome is sufficient:

- Chain positions 1 and 2 show the two Ox Alpha routes.
- The failing OpenCode slot remains visible as the final chain row.
- Early SSE errors appear as `stream-error` attempts and cooling entries.
- No new CSS is needed, so the shared card-containment stylesheet remains unchanged across sister projects.

## Documentation and ticketing

Update FC-003 in `ISSUES.md` with the incident notice, root cause, resolution, test evidence, and live verification. Add a dedicated RCA under `docs/` and update deployment documentation for the first-event gate and the remaining post-commit streaming limitation.

## Verification

Verification requires:

1. A regression test that fails before the SSE gate and passes after it.
2. Exact-byte preservation for a valid first SSE event.
3. Full FreeChain tests and clean diff checks.
4. GitNexus change detection for the expected symbols and flows.
5. Live provider text-stream and tool-call probes through all healthy Ox Alpha routes.
6. A packaged FreeChain restart with positions 1, 2, and final confirmed from live state.
7. Browser verification at 1280 and 380 pixels with a hostile long string and no horizontal overflow.
8. A Nous Man gateway restart, persisted compression configuration proof, and a live FreeChain-backed streamed tool-call turn.
