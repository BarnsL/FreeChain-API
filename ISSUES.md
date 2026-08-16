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

### FC-001: Add request logging to disk
- **Status**: OPEN
- **Priority**: P2
- **Type**: Feature
- **Description**: The server logs to stdout only. For debugging production issues, it would
  help to have an opt-in file logger that records attempt outcomes (provider, model, status,
  latency) without ever logging request/response bodies or credentials.
- **Acceptance**: `--log <file>` flag writes structured JSON lines. Bodies and keys are never
  included. The file rotates or caps at a configurable size.

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
- **Status**: OPEN
- **Priority**: P3
- **Type**: Feature
- **Description**: `/healthz` reports which links have keys but not whether the providers
  are actually reachable. A deeper health check that probes each provider (like the
  dashboard's Test button) would help monitoring.
- **Acceptance**: `/v1/health/deep` sends a 1-token probe to each provider with a key
  and reports latency and status. Rate-limited to prevent abuse.

### FC-005: Dashboard authentication
- **Status**: OPEN
- **Priority**: P2
- **Type**: Security
- **Description**: The admin API (`/admin/*`) has no authentication. It is safe on loopback
  but becomes a risk if someone binds to `0.0.0.0`. The access key could gate admin routes
  too, or a separate admin password could be introduced.
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

(None yet.)

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
