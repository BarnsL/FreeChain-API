# Secure Request Journal Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a privacy-safe, persistent request journal, an authenticated query API, a complete Logs dashboard, and the Nous Man 401 RCA to FreeChain.

**Architecture:** A focused `RequestJournal` owns sanitization, bounded memory, JSONL recovery, rotation, query filtering, and token summaries. `createServer` creates one lifecycle record per meaningful API or admin request and never passes raw credentials or content into the journal. The existing dependency-free dashboard reads the authenticated `/v1/logs` API and presents operational summaries plus expandable metadata.

**Tech Stack:** Node.js 20 standard library, existing HTTP server and plain HTML/CSS/JavaScript dashboard, Node test runner.

---

### Task 1: Build the journal core test-first

**Files:**
- Create: `test/request-journal.test.js`
- Create: `src/request-journal.js`

**Step 1: Write failing tests**

Cover bounded newest-first memory, malformed JSONL recovery, one-file rotation, owner-only mode where supported, query filters, cursor pagination, metadata header sanitization, prompt/output omission, exact usage, estimated usage, and incremental SSE metering.

**Step 2: Run the focused test and confirm RED**

Run: `node --test test/request-journal.test.js`

Expected: failure because `src/request-journal.js` does not exist.

**Step 3: Implement the minimum core**

Export:

```js
export class RequestJournal {
  constructor({ filePath, enabled = true, maxEntries = 500, maxBytes = 5 * 1024 * 1024 } = {})
  append(record)
  query({ limit, before, status, provider, app, route, q } = {})
}

export function requestMetadata(req) {}
export function summarizeInput(body) {}
export function summarizeJsonOutput(payload) {}
export function createSseMeter() {}
export function estimatedUsage(inputChars, outputChars) {}
```

Records use schema version 1 and contain only sanitized summaries. No request message text, response text, tool definitions or arguments, credentials, arbitrary headers, or provider error bodies are accepted into the persisted shape.

**Step 4: Run the focused test and confirm GREEN**

Run: `node --test test/request-journal.test.js`

Expected: all journal tests pass.

### Task 2: Journal the FreeChain HTTP lifecycle

**Files:**
- Modify: `test/chain.test.js`
- Modify: `test/admin.test.js`
- Modify: `src/server.js`

**Step 1: Write failing server tests**

Add tests proving:

- invalid access keys create an auth-reject record without parsing the request body;
- successful JSON and streaming requests record route, request ID, input/output counts, attempts, serving link, and usage source;
- provider failures record sanitized attempts and cooldown state without upstream bodies;
- `/v1/logs` requires the access key, supports filters and pagination, returns `Cache-Control: no-store`, and does not journal its own reads;
- meaningful admin mutations are journaled while `/admin/state`, static files, and passive polling are excluded;
- every journaled response exposes `X-FreeChain-Request-Id` and CORS allows/exposes the opt-in app/session headers.

**Step 2: Run focused tests and confirm RED**

Run: `node --test test/chain.test.js test/admin.test.js`

**Step 3: Integrate one terminal record per request**

Extend the server options:

```js
export function createServer(chain, {
  verbose = false,
  ui = true,
  journal = new RequestJournal({ enabled: false }),
} = {})
```

Generate a request ID before authentication, summarize only after successful authentication, meter streamed output without retaining it, and finalize once on every terminal path. Map `ChainError` attempts to `{ provider, model, keyIndex, outcome, ms }` only.

**Step 4: Add the authenticated log route**

Implement `GET /v1/logs` before other `/v1` routing. Authenticate with the existing access-key matcher, parse only documented query parameters, exclude the route from journaling, and return `{ items, nextBefore, summary }` with `no-store`.

**Step 5: Run focused tests and confirm GREEN**

Run: `node --test test/chain.test.js test/admin.test.js test/request-journal.test.js`

### Task 3: Wire persistence and CLI controls

**Files:**
- Modify: `test/cli.test.js`
- Modify: `bin/freechain.mjs`
- Modify: `src/config.js` only if an existing root helper cannot supply the default path

**Step 1: Write failing CLI/source tests**

Assert help contains `--log <path>` and `--no-log`, default startup passes `logs/requests.jsonl`, a custom path is resolved, and `--no-log` disables disk persistence while retaining the in-memory journal.

**Step 2: Run the focused test and confirm RED**

Run: `node --test test/cli.test.js`

**Step 3: Create and inject the journal**

Construct one journal per worker, use `path.join(ROOT, 'logs', 'requests.jsonl')` by default, and pass it to `createServer`. Keep supervisor arguments unchanged so worker restarts preserve the configured path.

**Step 4: Run the focused test and confirm GREEN**

Run: `node --test test/cli.test.js test/request-journal.test.js`

### Task 4: Add the Logs dashboard as an incumbent-system extension

**Files:**
- Modify: `test/source-integrity.test.js`
- Modify: `src/webui/index.html`
- Modify: `src/webui/app.js`
- Modify: `src/webui/app.css`

**Step 1: Write failing source-contract tests**

Assert the Logs navigation button immediately follows Chain, the page exposes summary/filter/table/detail/privacy/status anchors, and app/session metadata headers appear in CORS and UI copy.

**Step 2: Run the source test and confirm RED**

Run: `node --test test/source-integrity.test.js`

**Step 3: Implement the view**

Add:

- outcome, volume, token, latency, and cooling summaries;
- status/provider/app/route/search filters;
- manual refresh and a visible ten-second refresh cadence only while Logs is active;
- compact rows with native `<details>` expansion for attempts, usage provenance, client metadata, errors, and cooling;
- loading skeleton, empty, error, stale, and populated states;
- a privacy notice that says content and secrets are never stored.

Use the existing palette, spacing, type, button, badge, and table vocabulary. On narrow screens, keep filters usable and turn record rows into readable stacked detail without horizontal data loss.

**Step 4: Run the source test and confirm GREEN**

Run: `node --test test/source-integrity.test.js`

### Task 5: Record the incident and operating contract

**Files:**
- Create: `docs/RCA-NOUS-MAN-FREECHAIN-401-2026-08-17.md`
- Modify: `ISSUES.md`
- Modify: `README.md`
- Modify: `DEPLOYMENT.md`

**Step 1: Write the RCA**

Document the stale Nous Man access key, the authenticated boundary where the 401 occurred, the absence of provider attempts/cooling/token usage, the separate non-recovering title fallback, the exact incident notice and recovered session ID, contributing factors, corrective actions, and evidence limits.

**Step 2: Update issues**

Close or supersede FC-001 with the implemented journal contract and add FC-017 for the 401 incident. Preserve the supplied operational notice with the private thread and session identifiers redacted.

**Step 3: Document operation and security**

Explain persistence, rotation, flags, API authentication/filtering, client-reported app/session headers, privacy exclusions, token estimation, log ownership, and shared-device considerations.

### Task 6: Verify FreeChain end to end

**Files:** all changed FreeChain files

**Step 1: Run focused and full tests**

Run: `npm test`

Expected: all tests pass with only the existing Windows permission skip where applicable.

**Step 2: Run GitNexus change detection**

Run: `node .gitnexus/run.cjs detect-changes --scope unstaged --repo FreeChain-API`

Confirm only the server lifecycle, worker startup, journal, and dashboard flows are affected.

**Step 3: Run an isolated live server**

Start on a temporary loopback port with a temporary chain and journal. Exercise an invalid key, a successful non-streaming request, a streaming request, filtered `/v1/logs`, and persistence/reload. Verify no known prompt, response, or key sentinel appears in the JSONL file.

**Step 4: Inspect the dashboard**

Capture desktop and mobile screenshots of populated, empty, and error-safe Logs states. Run the Impeccable detector once across the changed UI targets, address mechanical findings in one batch, and complete the finish review.

