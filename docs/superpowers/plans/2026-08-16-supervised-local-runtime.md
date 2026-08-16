# Supervised Local Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a manually launched FreeChain process available after an unexpected router-worker exit without adding a Windows scheduled task.

**Architecture:** `bin/freechain.mjs` becomes a lightweight parent when invoked normally. It starts the existing router path in an internal `--worker` child, restarts unexpected child exits with bounded exponential backoff, and forwards shutdown signals for a clean stop. The parent does not claim to start itself after a Windows reboot.

**Tech Stack:** Node.js ESM, `node:child_process`, `node:net`, and Node's built-in test runner.

## Global Constraints

- Keep `127.0.0.1:4853` as the default fixed local endpoint.
- Do not change provider routing, credentials, or the public OpenAI-compatible API.
- Do not start a duplicate router when another process already owns the selected port.
- Restart only unexpected worker exits; Ctrl+C and SIGTERM stop both parent and worker.
- Add no dependencies and never print credentials.

---

### Task 1: Specify and test restart policy

**Files:**
- Create: `src/supervisor.js`
- Create: `test/supervisor.test.js`

**Interfaces:**
- Produces: `restartDelayMs(failures)` and `superviseWorker(options)`.
- Consumes: an injected `spawnWorker`, scheduler, and clock so tests never need a real process.

- [ ] **Step 1: Write the failing tests**

```js
assert.equal(restartDelayMs(1), 1_000);
assert.equal(restartDelayMs(10), 30_000);
assert.equal(spawns, 2); // one initial worker, one restart after a crash
```

- [ ] **Step 2: Run the focused test and verify module-not-found failure**

Run: `node --test test/supervisor.test.js`

- [ ] **Step 3: Implement the dependency-free supervisor**

```js
export function restartDelayMs(failures) {
  return Math.min(1_000 * 2 ** Math.max(0, failures - 1), 30_000);
}
```

The worker supervisor must not reschedule after `stop()` and must reset its failure count after a stable minute.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node --test test/supervisor.test.js`

### Task 2: Make normal CLI starts supervised

**Files:**
- Modify: `bin/freechain.mjs`
- Modify: `test/cli.test.js`

**Interfaces:**
- Consumes: `superviseWorker()` and the existing worker startup code.
- Produces: normal `node bin/freechain.mjs` parent launches and internal `--worker` child launches.

- [ ] **Step 1: Extend the isolated CLI test to confirm a normal launch remains ready and shuts down without a child leak**
- [ ] **Step 2: Route normal starts through the parent supervisor, while `--status`, `--help`, and `--worker` retain their intended behavior**
- [ ] **Step 3: Run the CLI and supervisor tests**

Run: `node --test test/cli.test.js test/supervisor.test.js`

### Task 3: Document operation and validate the running app

**Files:**
- Modify: `README.md`
- Modify: `DEPLOYMENT.md`

**Interfaces:**
- Consumes: the fixed endpoint and supervisor contract.
- Produces: accurate operator guidance for crash recovery and the reboot boundary.

- [ ] **Step 1: Document the parent/worker behavior and bounded restart timing**
- [ ] **Step 2: Restart the local FreeChain instance with the new launcher**
- [ ] **Step 3: Stop only the verified worker PID and prove a replacement responds at the same endpoint**
- [ ] **Step 4: Run `npm test`, `git diff --check`, and GitNexus `detect_changes` before any commit**
