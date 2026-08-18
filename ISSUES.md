# FreeChain Issue Tracker

Issues are tracked in this file. Each issue has a unique ID, status, priority, and description.

## Status Legend

| Status | Meaning |
|---|---|
| `OPEN` | Not started |
| `IN_PROGRESS` | Actively being worked on |
| `DONE` | Completed and verified |
| `WONTFIX` | Decided against fixing |

## Priority Legend

| Priority | Meaning |
|---|---|
| `P0` | Critical. Blocks usage or leaks credentials. Fix immediately. |
| `P1` | High. Significant functionality gap or reliability issue. |
| `P2` | Medium. Improvement that would meaningfully help users. |
| `P3` | Low. Nice to have, cosmetic, or minor convenience. |

---

## Open Issues

### FC-002: Per-provider timeout overrides
- **Status**: OPEN
- **Priority**: P3
- **Type**: Feature
- **Description**: The global `requestTimeoutMs` (90s) applies to every provider equally.
  Some providers (e.g. local Ollama with a large model) may need longer, while fast inference
  providers (Groq, Cerebras) could use a shorter timeout to fail faster.
- **Acceptance**: `chain.config.json` entries accept an optional `timeoutMs` field that
  overrides the global default for that link.

### FC-003: Streaming error handling
- **Status**: OPEN
- **Priority**: P1
- **Type**: Bug
- **Description**: If a provider returns HTTP 200 and begins streaming but then errors
  mid-stream (malformed SSE, connection drop), the client receives a truncated response
  with no error indication. The chain cannot retry because headers are already sent.
- **Acceptance**: Document the limitation. Consider a buffered-start mode where the first
  N bytes are buffered before committing to the response, allowing a retry if the stream
  fails early.

### FC-004: Health check endpoint with per-provider latency
- **Status**: DONE
- **Priority**: P2
- **Type**: Feature
- **Description**: `/healthz`, `--status`, and the dashboard's configured indicators report
  credentials but not whether each configured model is currently reachable. A deeper health
  check must probe each chain link, not only the first model for a provider family.
- **Resolution**: `POST /v1/health/deep` sends a 1-token probe per configured chain link and
  reports provider, model, latency, status, and a redacted reason without response bodies or
  credentials. It is globally rate-limited to one run per minute, and the existing configuration
  indicators remain explicitly non-live.

### FC-005: Dashboard authentication
- **Status**: OPEN
- **Priority**: P2
- **Type**: Security
- **Description**: The admin API (`/admin/*`) has no authentication. It is safe on loopback
  but becomes a risk if someone binds to `0.0.0.0`. The access key could gate admin routes
  too, or a separate admin password could be introduced.
  Sharper than "becomes a risk on `0.0.0.0`": it is already reachable on the loopback default
  through a browser the user has open to any other site. `readJson()` in `src/server.js` parses
  the body as JSON regardless of `Content-Type`, so a cross-origin page can hit any `/admin/*`
  POST (`keys`, `chain/reorder`, `access-key/rotate`, `shortcut/create`) blind, via an
  auto-submitted `enctype="text/plain"` form crafted to serialize as valid JSON — no preflight,
  no cookies needed, since there is no auth to bypass. Worst case is `/admin/keys`: an attacker
  can plant their own provider key into a slot, after which real chat traffic dispatched through
  that slot is sent to the attacker's provider account. A cheap, scoped mitigation without a full
  auth system: reject `/admin/*` state-changing requests whose `Sec-Fetch-Site` header (sent by
  all modern browsers, not spoofable from page content) is present and not `same-origin`,
  falling back to allow when the header is absent (so curl/scripts keep working).
- **Acceptance**: When bound to a non-loopback address, admin routes require the access key
  or a separate admin credential. Loopback remains open for local convenience.

### FC-006: Support for non-chat endpoints
- **Status**: OPEN
- **Priority**: P3
- **Type**: Feature
- **Description**: Some providers support `/v1/embeddings`, `/v1/completions` (legacy), or
  `/v1/images/generations`. FreeChain only proxies chat completions today.
- **Acceptance**: At minimum, `/v1/embeddings` is proxied with the same failover logic.
  Other endpoints are added as needed.

### FC-007: Chain editing from the dashboard
- **Status**: OPEN
- **Priority**: P2
- **Type**: Feature
- **Description**: The chain order and model list can only be changed by editing
  `chain.config.json` by hand. The dashboard should let users reorder links,
  add/remove entries, and toggle paid/free status.
- **Acceptance**: A Chain page with drag-to-reorder, add/remove buttons, and a save
  action that writes `chain.config.json` and reloads the chain without restarting.

### FC-008: Rate limit intelligence
- **Status**: OPEN
- **Priority**: P2
- **Type**: Feature
- **Description**: The cooldown system uses a fixed duration. Providers that return
  `Retry-After` headers are respected, but many free tiers have daily/hourly quotas
  that are not surfaced. Tracking cumulative request counts per slot and warning when
  approaching known limits would help users.
- **Acceptance**: The dashboard shows request counts per provider/slot since startup.
  Known free-tier limits (e.g. OpenRouter 100 req/day on free models) are documented
  and optionally enforced.

### FC-009: Docker image
- **Status**: OPEN
- **Priority**: P3
- **Type**: Feature
- **Description**: Provide a Dockerfile for users who want to run FreeChain in a container.
  Should be minimal (node:20-slim), mount `.env` from the host, and expose the configured port.
- **Acceptance**: `docker build` produces a working image. `docker run -v .env:/app/.env -p 4853:4853`
  starts the server.

### FC-010: Graceful shutdown
- **Status**: OPEN
- **Priority**: P2
- **Type**: Bug
- **Description**: The server does not handle SIGTERM or SIGINT. In-flight requests are
  dropped when the process is killed. A graceful shutdown should stop accepting new
  connections, wait for in-flight requests to complete (with a timeout), then exit.
- **Acceptance**: SIGTERM/SIGINT triggers a graceful shutdown. In-flight requests complete
  within a 30-second window. New connections are refused with 503.

---

## Closed Issues

### FC-001: Add request logging to disk
- **Status**: DONE
- **Priority**: P2
- **Type**: Feature
- **Description**: The server logged attempts to stdout only, leaving no durable evidence for
  authentication, routing, token usage, failover, cooling, or app/session correlation.
- **Resolution**: Added a privacy-safe request journal with 500 in-memory records, JSONL
  persistence, 5 MiB rotation plus one predecessor, malformed-line recovery, `--log <path>`,
  `--no-log`, authenticated filtered `/v1/logs`, request IDs, optional sanitized app/session
  metadata, exact/estimated usage labels, metadata-only admin audits, and a complete Logs dashboard.
  Prompt/response content, tool bodies, credentials, arbitrary headers, raw IP addresses, and raw
  provider diagnostics are excluded by the journal schema.
- **Verification**: Core, server, CLI, source-contract, persistence, auth-before-parse, streaming,
  filter, no-recursion, and sentinel-absence tests cover the implemented boundary.

### FC-017: Nous Man used a stale FreeChain access key after rotation
- **Status**: DONE
- **Priority**: P1
- **Type**: Integration
- **Description**: Nous Man requests were rejected at FreeChain's local access-key boundary before
  JSON parsing or provider dispatch. The saved client credential no longer matched FreeChain's
  current credential. No provider attempt, cooling change, or upstream token usage occurred.
- **Incident notice**:

  ```text
  🛠 Nous Man operational notice [status/lifecycle] — 2026-08-17 17:47:24 UTC
  ❌ Non-retryable error (HTTP 401): HTTP 401: Invalid API key. Use the access key from the FreeChain dashboard.

  (as would have posted: ⚠️ Provider authentication failed. Check the configured credentials; raw provider details are in the gateway logs.)
  surface: thread:<redacted-thread-id> session: <redacted-session-id>
  ```
- **Root cause**: Stale Nous Man client credential after a FreeChain access-key rotation. Masked
  equivalence and paired control requests proved the mismatch without revealing either value.
- **Resolution**: Documented the full RCA in
  `docs/RCA-NOUS-MAN-FREECHAIN-401-2026-08-17.md` and added durable request/app/session correlation.
  The exact rotation action could not be timestamped because pre-incident FreeChain had no
  persistent request or admin journal.

### FC-011: Corrupted "keep" sentinel silently destroyed provider keys
- **Status**: DONE
- **Priority**: P0
- **Type**: Bug
- **Description**: `src/webui/app.js` built the "keep this existing key" marker sent to
  `POST /admin/keys` as `` `keep:${k.index}` ``, but a stray NUL byte sat where the
  leading space belonged (two call sites: `addKey`, `deleteKey`), rendering
  `"\0keep:0"` instead of `" keep:0"`. `admin.js`'s `KEEP` regex (`/^keep:(\d+)$/`)
  never matches after `.trim()` (NUL is not whitespace), so `saveSlotKeys` fell
  through to `return value` and stored the literal corrupted string as a brand-new
  key. Net effect: adding or removing one key in a slot that already held another
  silently destroyed that other key's real credential in `.env`. Found during a
  pre-release audit; no existing test caught it because `app.js` is browser-only DOM
  code that `node --test` cannot import to exercise directly.
- **Resolution**: Replaced both corrupted literals with the intended `` ` keep:${k.index}` ``.
  Added `test/source-integrity.test.js`: a byte-level scan for stray control
  characters across `src/`, `bin/`, `scripts/`, plus a source-text check that the
  keep-sentinel literals in `app.js` round-trip through `admin.js`'s `KEEP` regex.

### FC-012: Expose FreeChain provider identity to Nexus AI
- **Status**: DONE
- **Priority**: P1
- **Type**: Integration
- **Description**: GitNexus could send requests through FreeChain, but Nexus AI did not receive or
  display a sanitized provider identity. Users could not tell which provider, model, repository, or
  request phase was active.
- **Resolution**: GitNexus now derives a credential-free FreeChain identity, adds it to the current
  codebase context and system prompt, and shows provider, model, repository, and request-state badges.
  Provider settings remain scoped to the active browser profile.
- **Verification**: Provider sanitization, prompt, agent lifecycle, and panel status tests pass. A
  post-build browser run showed the FreeChain provider, model, repository, and request lifecycle.
  Successful guide and edit flows moved the served-request counter from 45 to 53.

### FC-013: Distinguish external FreeChain service from a traced managed run
- **Status**: DONE
- **Priority**: P1
- **Type**: Integration
- **Description**: FreeChain intentionally exits zero when another process already owns port 4853.
  GitNexus showed the optimistic start response as `running`, even though the existing external
  process had no runtime probes and the event dock correctly stayed at zero.
- **Resolution**: GitNexus classifies a clean `already running` exit as
  `existing-external-app`, polls active cards to their terminal state, removes the managed Stop
  control, and explains that the external process can serve requests but is not traced.
- **Verification**: Manager and card tests cover the successful external case, unrelated clean exits,
  nonzero false positives, final polling, and polling shutdown. GitNexus never stops the external
  process. The live card reported the external untraced owner, while its short instrumented startup
  attempt still emitted 35 Node events before exit.

### FC-014: Add FreeChain-specific indexed-app trigger guidance
- **Status**: DONE
- **Priority**: P1
- **Type**: Integration
- **Description**: Generic runtime instructions told users to run terminal commands but did not explain
  which FreeChain dashboard or API action would trigger a path, what should change in the UI, or how
  to confirm it.
- **Resolution**: GitNexus now combines current index processes, application surfaces, runtime
  discovery, managed actions, and observations into a strict seven-section guide. It includes
  prerequisites, exact app actions, expected code/UI path, confirmation, troubleshooting, citations,
  and confidence.
- **Verification**: Guidance context, prompt protocol, schema, app card, safe loopback opening, and
  graph-focus tests pass. The live card named the dashboard action, expected
  `createServer -> dispatch -> candidatesFor` path, visible answer, observability locations,
  confidence, source citation, and remaining runtime evidence gap.

### FC-015: Record live GitNexus-to-FreeChain proof and ownership recovery
- **Status**: DONE
- **Priority**: P1
- **Type**: Docs
- **Description**: Provider traffic, app process ownership, and runtime events were previously treated
  as one signal. That made a healthy external FreeChain instance look like failed tracing.
- **Resolution**: `DEPLOYMENT.md` now separates provider, index-guidance, and managed-trace paths. It
  records ports 4747, 5173, and 4853; browser-profile provider scope; the exact external-process
  interpretation; controlled restart steps; and rollback references.
- **Verification**: The original RCA confirmed a pre-existing port-4853 process, a successful
  FreeChain-backed Nexus request, and zero events from the uninstrumented process. Final branch proof
  adds visible badges, app guidance, truthful external-process classification, 35 managed startup
  events, and byte-identical repository edit undo.

### FC-016: Prevent incomplete provider tool calls from looking permanently active
- **Status**: DONE
- **Priority**: P1
- **Type**: Integration
- **Description**: A weaker FreeChain model route emitted a GitNexus tool call but ended its response
  without the matching tool result. GitNexus marked the request completed and left the tool card on
  `running`, recreating the appearance that nothing was happening.
- **Resolution**: GitNexus now turns unresolved tool calls into visible error cards at end-of-stream,
  marks the request Failed, and recommends retrying with a tool-capable model. The final message is
  persisted synchronously so the terminal state cannot be cancelled with a pending animation frame.
- **Verification**: The regression test covers an orphan tool call. Live FreeChain model
  `auto/coding:free` reproduced the condition and displayed the new Failed/error recovery state.

---

## How to File an Issue

Add a new entry under "Open Issues" with the next sequential ID (FC-NNN). Include:

1. A clear, short title as the heading.
2. **Status**: Start with `OPEN`.
3. **Priority**: P0 through P3.
4. **Type**: `Bug`, `Feature`, `Security`, `Docs`, or `Refactor`.
5. **Description**: What is the problem or desired outcome? Be specific.
6. **Acceptance**: What does "done" look like? Testable criteria.

When an issue is resolved, move it to "Closed Issues" with a note on what was done and when.
