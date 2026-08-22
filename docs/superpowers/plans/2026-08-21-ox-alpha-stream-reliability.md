# Ox Alpha Stream Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put healthy OpenCode and OpenRouter Ox Alpha routes first, retain the failing OpenCode credential as the final pinned route, and make FreeChain fail over when an HTTP 200 stream begins with an SSE error.

**Architecture:** Reuse FreeChain's existing numbered provider slots, candidate cooldowns, dynamic dashboard, and request journal. Add one bounded first-event stream gate inside `dispatch()` so failover still owns the response before server headers are committed. Update Nous Man compression routing through supported Ox Alpha models.

**Tech Stack:** Node.js 20+, built-in Fetch and Web Streams APIs, `node:test`, GitNexus, plain HTML/CSS/JavaScript dashboard, Hermes CLI.

## Global Constraints

- Preserve all pre-existing dirty worktree changes and stage only task-owned files or hunks.
- Never output or persist credentials, raw authorization data, provider response bodies, prompts, tool bodies, or email addresses.
- Keep `opencode-zen0` configured and pin it to the final chain position.
- Do not add a dependency or a new CSS rule.
- Leave the shared card-containment CSS byte-identical across FreeChain, SubChain, and VisionChain.
- Write tests before production changes and observe the expected failure.
- Run GitNexus impact before symbol edits and `detect_changes` before any commit.

---

### Task 1: Early SSE error failover

**Files:**
- Modify: `test/chain.test.js`
- Modify: `src/chain.js`

**Interfaces:**
- Consumes: `dispatch(chain, cooldowns, body, options)` and the existing `Cooldowns` candidate state.
- Produces: a byte-preserving successful `Response`, or a sanitized `stream-error` attempt that advances to the next candidate.

- [ ] **Step 1: Write the failing regression test**

Add a real local HTTP upstream that returns status 200 and this SSE event before closing:

```js
data: {"error":{"type":"server_error","message":"Service temporarily overloaded"}}

```

Add a second upstream that streams:

```js
data: {"choices":[{"delta":{"content":"OX_OK"}}]}

data: [DONE]

```

Call `dispatch()` with `{ ...askBody, stream: true }` and assert the second link wins, the first attempt outcome is `stream-error`, the second is `ok`, the first candidate is cooling, and the returned response text is byte-identical to the second fixture.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test --test-name-pattern "200 SSE error" test/chain.test.js
```

Expected: FAIL because the current dispatcher accepts the first HTTP 200 response and returns its error event.

- [ ] **Step 3: Implement the bounded first-event gate**

Add a private helper in `src/chain.js` that reads raw `Uint8Array` chunks until the first `\r?\n\r?\n` event boundary, with a 65,536-byte ceiling. Parse only `data:` lines. Return a rebuilt `Response` whose `ReadableStream` enqueues the exact buffered bytes and then pumps the same reader when the event is valid. Return a sanitized failure marker for an error event, malformed data, empty early close, read failure, or exceeded ceiling.

In `dispatch()`, run the helper only for streaming `text/event-stream` responses. On an early failure:

```js
cooldowns.penalise(cand.id, 'stream error');
record('stream-error', `200 SSE ${probe.reason}`);
continue;
```

If the caller signal is aborted, rethrow instead of advancing. Record `ok` only after the gate accepts the response.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same focused command. Expected: PASS with the second link serving exact bytes.

- [ ] **Step 5: Run all chain tests**

Run:

```powershell
node --test test/chain.test.js
```

Expected: all chain tests pass with no warnings from the application.

### Task 2: Pin the Ox Alpha routes and preserve the failing slot last

**Files:**
- Modify: `test/chain.test.js`
- Modify: `chain.config.json`

**Interfaces:**
- Consumes: `loadChain(file)` and existing explicit numbered provider IDs.
- Produces: position 1 `opencode-zen1/x-preview-f-free`, position 2 `openrouter/stealth/ox-alpha`, and final `opencode-zen0/x-preview-f-free`.

- [ ] **Step 1: Write the failing route-order test**

Load the repository `chain.config.json` through `loadChain()` and assert these literal tuples:

```js
assert.deepEqual(
  chain.links.slice(0, 2).map(({ provider, model }) => [provider, model]),
  [
    ['opencode-zen1', 'x-preview-f-free'],
    ['openrouter', 'stealth/ox-alpha'],
  ],
);
assert.deepEqual(
  [chain.links.at(-1).provider, chain.links.at(-1).model],
  ['opencode-zen0', 'x-preview-f-free'],
);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test --test-name-pattern "Ox Alpha routes" test/chain.test.js
```

Expected: FAIL because the current first route is OpenRouter Nemotron and the failing slot is not pinned last.

- [ ] **Step 3: Update the chain**

Insert the two healthy Ox Alpha links first. Convert every other OpenCode Zen link to the healthy `opencode-zen1` slot so `opencode-zen0` cannot fan into them. Append the pinned failing `opencode-zen0/x-preview-f-free` link last. Preserve every non-OpenCode fallback unless a live deep-health check proves the model invalid.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same focused command. Expected: PASS.

### Task 3: Document and ticket the incident

**Files:**
- Modify: `ISSUES.md`
- Create: `docs/RCA-NOUS-MAN-FREECHAIN-SSE-2026-08-21.md`
- Modify: `DEPLOYMENT.md`

**Interfaces:**
- Consumes: sanitized Hermes logs, FreeChain request-journal records, live provider probes, and regression output.
- Produces: closed FC-003 with incident and acceptance evidence, plus durable operational documentation.

- [ ] **Step 1: Update FC-003**

Move FC-003 to Closed Issues with the exact supplied chat notice, sanitized request times, HTTP 200 versus SSE outcome distinction, retained bad-slot decision, resolution, and verification commands.

- [ ] **Step 2: Write the dedicated RCA**

Record timeline, affected path, evidence, contributing compression failures, ruled-out prior 401, root cause, remediation, residual post-first-event limitation, and rollback instructions. Do not include provider response bodies, credentials, user IDs, channel IDs, or email addresses.

- [ ] **Step 3: Update deployment documentation**

Document first-event gating, the `stream-error` attempt outcome, the 64 KiB bound, exact-byte replay, and why failover cannot restart after valid content reaches a client.

### Task 4: Verify source and build the Windows release

**Files:**
- Verify: all repository changes
- Build: `dist/freechain.exe`

**Interfaces:**
- Consumes: tested source, chain configuration, and existing release builder.
- Produces: a verified packaged executable and web UI payload.

- [ ] **Step 1: Run the complete test suite**

Run:

```powershell
npm test
```

Expected: zero failed tests, with only the existing documented Windows skip if present.

- [ ] **Step 2: Run source checks**

Run:

```powershell
git diff --check
node .gitnexus/run.cjs detect-changes --scope unstaged --repo FreeChain-API
```

Confirm only expected symbols and execution flows are added beyond the pre-existing dirty changes.

- [ ] **Step 3: Build**

Run:

```powershell
npm run build
```

Expected: release executable and portable archives are produced with exit code 0.

### Task 5: Deploy FreeChain and migrate credential slots safely

**Files:**
- Backup and update: installed FreeChain `.env`, `chain.config.json`, executable, and `webui/`

**Interfaces:**
- Consumes: the current working OpenCode credential, retained failing `opencode-zen0` credential, built release, and source chain.
- Produces: a running installed FreeChain on the existing fixed port with healthy Ox routes first and the failing slot last.

- [ ] **Step 1: Create timestamped backups**

Resolve every installed target under the installed FreeChain directory, verify each path, then copy the current `.env`, chain, executable, and web UI to timestamped backups before replacement.

- [ ] **Step 2: Move the healthy key without displaying it**

Use the existing `.env` helpers in a local Node process to read the working bare OpenCode value in memory, write it to `FREECHAIN_OPENCODE_ZEN1_API_KEY`, clear only `FREECHAIN_OPENCODE_ZEN_API_KEY`, and leave `FREECHAIN_OPENCODE_ZEN0_API_KEYS` untouched. Print only variable names and presence booleans.

- [ ] **Step 3: Replace and restart**

Stop the installed FreeChain process through its supported lifecycle, replace the executable, chain, and web UI, then launch it minimized without stealing focus.

- [ ] **Step 4: Verify runtime state and provider behavior**

Confirm the listener, process ownership, candidate count, positions 1, 2, and final, and Start Menu shortcut. Send bounded streamed text and required-tool probes through the running FreeChain endpoint. Confirm healthy Ox routes return content/tool calls and that direct deep health reports the retained final slot as unhealthy without moving it forward.

### Task 6: Repair Nous Man compression routing

**Files:**
- Backup and update: Hermes `config.yaml`
- Modify: `ISSUES.md` and the dedicated RCA with final evidence

**Interfaces:**
- Consumes: Hermes configuration CLI and the verified Ox Alpha routes.
- Produces: supported compression primary and fallbacks, correct provider metadata, and a restarted gateway.

- [ ] **Step 1: Back up and update config**

Set the compression primary to `opencode-zen/x-preview-f-free`. Set the fallback chain to `openrouter/stealth/ox-alpha`, then `openrouter/nvidia/nemotron-3-super-120b-a12b:free`. Remove unsupported LongCat and duplicate custom routes from compression only. Correct the OpenCode provider endpoint to `https://opencode.ai/zen/v1` and add `x-preview-f-free` to its displayed model map.

- [ ] **Step 2: Restart and verify the gateway**

Restart Hermes through `hermes gateway restart`. Verify persisted values, gateway status, Discord safety gates, and absence of raw credential output.

- [ ] **Step 3: Exercise compression and main streaming**

Use a private, bounded test session or the available gateway diagnostic surface to prove compression selects a supported Ox route without the prior 401/402 sequence. Send a FreeChain-backed streamed tool-call turn and correlate Hermes and FreeChain metadata-only logs.

### Task 7: Verify the dashboard and close documentation

**Files:**
- Verify: installed dashboard
- Finalize: `ISSUES.md`, RCA, and `DEPLOYMENT.md`

**Interfaces:**
- Consumes: live installed runtime and completed test evidence.
- Produces: desktop and mobile GUI proof plus final issue closure.

- [ ] **Step 1: Verify desktop geometry**

Open the installed dashboard at 1280 pixels. Confirm Ox Alpha occupies rows 1 and 2, the failing OpenCode slot is last, cooling and Logs show `stream-error`, and a hostile long identifier stays within its card.

- [ ] **Step 2: Verify mobile geometry**

Repeat at 380 pixels using the console geometry check from `docs/CARD-TEXT-CONTAINMENT.md`. Require no card overflow and no page-level horizontal scrollbar.

- [ ] **Step 3: Record fresh evidence**

Add final test counts, build result, runtime route headers, browser geometry results, gateway status, and remaining limitation to FC-003 and the RCA. Run `git diff --check`, the full tests, and GitNexus `detect_changes` again before any completion claim.

## Execution note

The user approved inline execution and explicitly required the failing OpenCode credential to remain configured at the final position. The current dirty checkout is used in place because its existing failover and dashboard changes are required by this fix. Implementation commits are withheld unless task-owned hunks can be separated without staging unrelated user work.
