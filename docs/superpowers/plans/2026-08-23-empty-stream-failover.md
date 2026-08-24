# Empty Stream Failover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep FreeChain in control of failover until a streaming provider emits actual assistant output or a substantive tool call, instead of accepting protocol-only scaffolding as success.

**Architecture:** Extend the existing bounded SSE gate in `src/chain.js`. Metadata-only events remain buffered; content, reasoning, refusal, audio, function calls, or tool calls prove the stream is usable. If the stream closes or sends `[DONE]` first, the current `stream-error` path cools that candidate and advances through the existing chain.

**Tech Stack:** Node.js 20+, built-in Fetch and Web Streams APIs, `node:test`, GitNexus.

## Global Constraints

- Preserve the untracked `.ua/` graph and every unrelated worktree change.
- Do not read, retain, or print prompts, completions, credentials, or raw provider bodies.
- Keep tool-call-only model responses valid even when text output is zero characters.
- Do not change the Hermes runtime in this task.
- Write the regression before production code and observe the expected failure.
- Run GitNexus impact before editing `gateSseResponse()` and `detect_changes` before completion.

---

### Task 1: Reject metadata-only stream starts

**Files:**
- Modify: `test/chain.test.js`
- Modify: `src/chain.js`

**Interfaces:**
- Consumes: `dispatch(chain, cooldowns, body, options)` and `gateSseResponse(response, signal)`.
- Produces: the existing `{ response, link, provider, keyIndex, attempts }` success shape after usable output, or a sanitized `stream-error` attempt that advances the chain.

- [x] **Step 1: Write the failing regression test**

Add one local upstream that sends a role-only empty delta, an index-only tool-call scaffold, and then `[DONE]`:

```js
const emptyStream = 'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}\n\ndata: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0}]}}]}\n\ndata: [DONE]\n\n';
```

Add a second upstream whose first output is a real tool call:

```js
const toolStream = 'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"ping","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n';
```

Assert that the second link wins, attempts are `stream-error` then `ok`, the first candidate cools, and the accepted bytes equal `toolStream` exactly.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test --test-name-pattern "metadata-only SSE" test/chain.test.js
```

Expected: FAIL because the current gate accepts the structurally non-empty tool-call scaffold and returns the first link.

- [x] **Step 3: Implement the minimal gate correction**

Inside `gateSseResponse()`, after rejecting malformed and explicit error payloads, inspect `choice.delta` or `choice.message`. Treat these non-empty fields as usable output:

```js
content, refusal, reasoning, reasoning_content, reasoning_details,
tool_calls, function_call, audio
```

If no choice contains a substantive nested value, continue buffering. IDs, indexes, roles, type tags, signatures, annotations, metadata, and status fields are structural rather than usable output. Existing close, `[DONE]`, scanned-prefix limit, abort, exact replay, cooldown, and attempt behavior remains unchanged.

- [x] **Step 4: Run the focused test and verify GREEN**

Run the focused command again. Expected: PASS.

- [x] **Step 5: Run all chain tests**

Run:

```powershell
node --test test/chain.test.js
```

Expected: zero failures.

### Task 2: Record the incident

**Files:**
- Create: `docs/RCA-NOUS-MAN-FREECHAIN-EMPTY-STREAM-2026-08-23.md`
- Modify: `ISSUES.md`
- Modify: `DEPLOYMENT.md`

**Interfaces:**
- Consumes: allowlisted request-journal metadata and test/runtime evidence.
- Produces: FC-019, a dedicated RCA, and an updated streaming-gate operations contract.

- [x] **Step 1: Add FC-019 and the dedicated RCA**

Record the 15:00 UTC correlation, 87 client-disconnected requests, false `ok` classification, one attempted route despite 34 configured links, root cause, resolution, ruled-out authentication drift, residual post-output limitation, and rollback. Exclude raw content and credentials.

- [x] **Step 2: Tighten the deployment contract**

Change the streaming first-event language from any valid JSON event to actual content, reasoning, refusal, audio, function call, or tool call. State that role-only, empty-delta, and usage-only events do not commit the route.

### Task 3: Verify source and the live route

**Files:**
- Verify: all task-owned changes
- Build: packaged Windows release when source verification passes

**Interfaces:**
- Consumes: the repaired source, installed FreeChain configuration, and its existing access key without printing it.
- Produces: focused/full test evidence, structural impact evidence, a new packaged runtime, and a fresh authenticated stream proving usable output or a tool call.

- [x] **Step 1: Run source verification**

Run:

```powershell
npm test
git diff --check
node .gitnexus/run.cjs detect-changes --repo FreeChain-API
```

Require zero failed tests and only the expected routing/documentation scope.

- [x] **Step 2: Build and deploy through the existing package boundary**

Run `npm run build`, back up the installed executable, replace it with the verified build, restart through the existing supervisor path, and confirm the Start Menu shortcut still targets the installed executable.

- [x] **Step 3: Prove a fresh authenticated live route**

Send a bounded streaming request to the installed loopback endpoint using the stored access key only in process memory. Require HTTP 200, accepted route headers, and at least one usable content, reasoning, refusal, audio, function-call, or tool-call event before `[DONE]`. Correlate the returned request ID to a terminal journal record.

## Execution note

The user explicitly requested immediate RCA and repair, and the sibling Hermes task delegated this FreeChain-only lane for inline execution. No separate execution-choice prompt is needed.
