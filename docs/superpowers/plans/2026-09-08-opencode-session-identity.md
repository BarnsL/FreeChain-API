# OpenCode Session Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every FreeChain OpenCode request, including Analyze, carry the dynamic session identity required by OpenCode while preserving truthful client attribution.

**Architecture:** Compose OpenCode-only headers at the shared outbound request boundary. Resolve identity once per FreeChain request, accept only sanitized allowlisted caller metadata, and use the request ID as a non-empty fallback; reuse the composer for deep-health probes.

**Tech Stack:** Node.js 20+, native `fetch`, `node:http`, `node:test`, GitNexus, Node SEA, Inno Setup

## Global Constraints

- Do not spoof OpenCode Desktop or reuse an unrelated OpenCode session.
- Do not expose credentials, raw provider bodies, prompts, responses, or raw private chat text.
- Preserve all unrelated working-tree edits.
- Do not add a runtime dependency.
- Run GitNexus impact analysis before symbol edits and `detect_changes` before commit.
- Prove the installed runtime, not only source tests.

---

### Task 1: Normal OpenCode dispatch identity

**Files:**
- Modify: `test/chain.test.js`
- Modify: `src/chain.js`

**Interfaces:**
- Consumes: a chain link with `provider`, `headers`, and the existing `dispatch(chain, cooldowns, body, options)` request options
- Produces: `upstreamHeaders(link, { requestId, sessionId }) -> Record<string, string>` and support for `requestId`/`sessionId` in `dispatch` options

- [x] **Step 1: Write the failing dispatch tests**

Add loopback-upstream assertions that an `opencode-zen1` link receives `x-opencode-session`, `x-opencode-request`, `x-opencode-client: freechain`, and a `FreeChain/0.7.1` user agent. Add a second assertion that a normal `local` link receives none of the `x-opencode-*` headers.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test --test-name-pattern="OpenCode request identity|non-OpenCode request identity" test/chain.test.js
```

Expected: the OpenCode case fails because the captured headers do not contain `x-opencode-session`.

- [x] **Step 3: Implement minimal request identity composition**

In `src/chain.js`, import `randomUUID`, add a bounded control-character-stripping identifier normalizer, and export:

```js
export function upstreamHeaders(link, { requestId, sessionId } = {})
```

Return the unchanged configured headers for other providers. For OpenCode providers, resolve a request ID, resolve the session ID to the sanitized caller value or request ID, and return configured headers plus the four OpenCode contract headers and the FreeChain user agent. Resolve this identity once near the top of `dispatch()` and use the helper in the outbound `fetch` call.

- [x] **Step 4: Run the focused test and verify GREEN**

Run the focused command from Step 2. Expected: both cases pass.

### Task 2: Caller session preservation and Analyze coverage

**Files:**
- Modify: `test/request-journal.test.js`
- Modify: `src/request-journal.js`
- Modify: `test/chain.test.js`
- Modify: `test/deep-health.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `requestMetadata(req)` and `upstreamHeaders(link, identity)` from Task 1
- Produces: a sanitized `client.sessionId` selected from the allowlisted correlation headers and identity propagation through normal server dispatch and `probeLink()`

- [x] **Step 1: Write the failing metadata and server-path tests**

Add table-driven request-metadata cases for `x-opencode-session`, `x-hermes-session-id`, and `x-session-id`, retaining the existing FreeChain/SubChain precedence. Add a server dispatch test that supplies `X-FreeChain-Session-Id` and proves the OpenCode loopback receives it. Extend the deep-health fixture to use an OpenCode provider and assert a non-empty session/request pair in the captured headers.

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="session metadata aliases|server preserves OpenCode session identity|deep health sends OpenCode identity" test/request-journal.test.js test/chain.test.js test/deep-health.test.js
```

Expected: aliases are absent, normal server dispatch omits the session, and the Analyze probe omits OpenCode identity.

- [x] **Step 3: Implement the two server paths**

Update `requestMetadata()` with a fixed allowlist in this precedence order: FreeChain, SubChain, OpenCode, Hermes, standard session. In `createServer()`, pass `journalRecord.id` and the sanitized metadata session into `dispatch()`. In `probeLink()`, generate one probe request ID and call `upstreamHeaders()` for its request headers.

- [x] **Step 4: Run the focused tests and verify GREEN**

Run the focused command from Step 2. Expected: all selected tests pass without warnings.

### Task 3: Patch release, installed proof, and publication

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `ISSUES.md`
- Create: `docs/PATCH-NOTES-0.7.1.md`
- Verify: `README.md`, `DEPLOYMENT.md`, installed executable, Start Menu entry, and configured remote

**Interfaces:**
- Consumes: Tasks 1 and 2 plus the pre-existing uncommitted compatibility-classifier regression
- Produces: version 0.7.1 release metadata, dedicated patch notes, rebuilt installed runtime, and a pushed commit

- [x] **Step 1: Update release metadata and patch notes**

Set both package metadata files to version `0.7.1`. Add an FC issue entry documenting the OpenCode session-identity RCA and resolution. Create patch notes describing the shortcut finding, dynamic header contract, truthful attribution, fallback behavior, security boundaries, verification commands, live evidence, and rollback.

- [x] **Step 2: Run source verification**

Run:

```powershell
npm test
npm run build
```

Expected: the suite reports zero failures and the Windows executable, portable archives, and installer are produced.

- [x] **Step 3: Inspect GitNexus and the outgoing diff**

Run GitNexus `detect_changes` against `main`, review all affected flows, inspect `git diff --check`, and verify that staged files contain no credentials or raw private request data.

- [x] **Step 4: Install and restart safely**

Resolve the current installed FreeChain executable and owning processes, retain a timestamped backup, replace it with the tested release executable, and use the existing supervisor lifecycle to restart without touching unrelated processes.

- [x] **Step 5: Prove the user-visible runtime**

Verify `/healthz`, run authenticated `POST /v1/health/deep` and confirm the OpenCode link no longer fails for missing session identity, then send a fresh authenticated `model=auto` request through the installed executable. Record only sanitized status, provider/model, attempt outcomes, and timestamps.

- [x] **Step 6: Commit and push**

Re-run `npm test` on the exact tree being committed, create a scoped commit, push `main` without force, and confirm the remote commit and repository visibility.
