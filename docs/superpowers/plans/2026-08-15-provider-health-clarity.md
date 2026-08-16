# Provider Health Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove confirmed retired free-model links and prevent credential presence from being represented as live provider availability.

**Architecture:** Keep the existing non-networking `chainStatus()` contract and change only its user-facing language. Add deep probing as an explicit authenticated endpoint because it sends upstream requests and must be rate-limited.

**Tech Stack:** Node.js ESM, JSON configuration, static HTML, zero dependencies.

## Global Constraints

- Never print or store provider credentials in source, tests, logs, or documentation.
- Keep OmniRoute as an optional local first hop; an absent local service is not a bad credential.
- Keep the default chain free-only and do not add automatic upstream probes.

---

### Task 1: Prune live-confirmed retired model IDs

**Files:**
- Modify: `chain.config.json`

**Interfaces:**
- Consumes: provider `/models` catalogs checked on 2026-08-15.
- Produces: a default chain containing only currently listed free model IDs, except for a transiently rate-limited Gemma link.

- [x] **Step 1: Write the failing acceptance assertion**

```js
assert.equal(config.chain.some((link) => removed.has(link.model)), false);
```

- [x] **Step 2: Run it and verify the expected failure**

The assertion found the three retired IDs in the current configuration.

- [x] **Step 3: Remove only the two retired Zen IDs and one retired OpenRouter ID**

```json
// Remove north-mini-code-free, ling-3.0-flash-free,
// and inclusionai/ling-3.0-tiny:free.
```

- [x] **Step 4: Re-run the assertion and the full test suite**

Verified: the configuration assertion passed and `npm test` reported 46 passing, 0 failing, and 1 Windows-only permission test skipped.

### Task 2: Label credential configuration honestly

**Files:**
- Modify: `bin/freechain.mjs`
- Modify: `src/config.js`
- Modify: `src/webui/index.html`
- Modify: `src/webui/app.js`
- Modify: `README.md`
- Modify: `DEPLOYMENT.md`
- Modify: `ISSUES.md`

**Interfaces:**
- Consumes: `chainStatus()` fields `hasKey`, `keyCount`, and `accountCount`.
- Produces: CLI, dashboard, API documentation, and issue tracking that distinguish configured credentials from live availability.

- [x] **Step 1: Add a failing CLI assertion**

```js
assert.match(result.stdout, /links configured/);
```

- [x] **Step 2: Run it and verify the expected failure**

The existing CLI output says `links ready` even though it does not contact providers.

- [x] **Step 3: Change only user-facing wording and docs**

Use `configured` for credential presence. Keep `ready` as the existing internal JSON property so the dashboard contract does not break.

- [x] **Step 4: Re-run the CLI assertion, full tests, and live end-to-end request**

Verified: `--status` reported 15/15 links configured; the dashboard served the updated wording; and one local `auto` request reached Zen after the two absent OmniRoute hops.

### Task 3: Preserve a bounded future health-check scope

**Files:**
- Modify: `ISSUES.md`

**Interfaces:**
- Consumes: the existing FC-004 deep-health proposal.
- Produces: an acceptance criterion for per-link, rate-limited, redacted live probes.

- [x] **Step 1: Implement FC-004 with per-link, redacted, rate-limited probes**
- [x] **Step 2: Confirm the tracker records the completed capability accurately**

Verified: FC-004 is DONE. The endpoint is POST-only, authenticated, rate-limited, and covered by isolated no-UI, access-boundary, and client-disconnect tests.

### Task 4: Let OmniRoute diagnostic failures use the outer failover chain

**Files:**
- Modify: `src/chain.js`
- Modify: `test/chain.test.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: OmniRoute's documented diagnostic response shape for its exhausted internal candidate pool.
- Produces: a retryable outer-chain failure only for an OmniRoute HTTP 400 containing a diagnostics object; ordinary HTTP 400 and 422 responses remain fatal.

- [x] **Step 1: Capture live root-cause evidence**

FreeChain received OmniRoute HTTP 400 with an internal pool diagnostics object while the same request succeeded through OmniRoute's `auto/best-free` model and directly through Zen.

- [x] **Step 2: Run GitNexus impact analysis**

`dispatch` has LOW upstream risk: three direct callers and one server flow.

- [x] **Step 3: Write a failing local-chain test for a diagnostic 400**

The first local upstream returns HTTP 400 with an OmniRoute diagnostics object; the next candidate must serve the request.

- [x] **Step 4: Add the provider-scoped retry classification**

Match only an OmniRoute 400 containing a diagnostics object. Do not relax fatal handling for ordinary 400 or any 422 response.

- [x] **Step 5: Verify unit tests and a live `auto` request**

Verified: the focused chain test and full suite passed. The live server on port 4853 returned HTTP 200 for its dashboard, passive health endpoint, and `auto` request through OmniRoute.
