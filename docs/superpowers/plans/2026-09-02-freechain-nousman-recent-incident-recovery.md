# FreeChain and Nous Man Recent Incident Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore reliable Nous Man Discord replies and tool-bearing FreeChain requests by fixing the three newest confirmed failure boundaries and proving the installed path.

**Architecture:** Hermes owns Discord admission and model-visible tool assembly. FreeChain owns candidate-specific provider failover. Reply-to-bot events will be admitted without weakening unrelated mention gates, large tool catalogs will switch to Hermes progressive disclosure before reaching provider limits, and provider-specific validation errors will advance to compatible FreeChain links while ordinary malformed requests remain fatal.

**Tech Stack:** Python 3.11, pytest, Node.js, node:test, GitNexus, Hermes gateway, packaged FreeChain executable.

## Global Constraints

- Never expose credentials, raw email addresses, prompts, response bodies, or private Discord content in documentation or receipts.
- Preserve the heavily dirty shared Hermes checkout and edit only the exact owned symbols and tests.
- Run GitNexus impact analysis before editing every function or method.
- Use red-green TDD for each behavioral fix.
- Keep public Discord execution restrictions fail-closed; admitting a reply does not authorize additional tools.
- Do not change FreeChain routing order, request bodies, streaming bytes, access-key behavior, or provider credentials.
- Restart Hermes only through its managed gateway restart path and prove a replacement live PID plus Discord connectivity.
- Rebuild and replace the installed FreeChain artifact only after source tests pass; preserve a recoverable backup.

---

### Task 1: Admit replies to the bot without opening general-channel admission

**Files:**
- Modify: `C:/Users/Burgboy/AppData/Local/hermes/hermes-agent/plugins/platforms/discord/adapter.py`
- Test: `C:/Users/Burgboy/AppData/Local/hermes/hermes-agent/tests/gateway/test_discord_message_edit_trigger.py`
- Create: `C:/Users/Burgboy/AppData/Local/hermes/docs/RCA-NOUSMAN-RECENT-CHAT-FAILURES-2026-09-02.md`

**Interfaces:**
- Consumes: Discord `Message.reference`, resolved replied-message author, reply-ping mentions, existing allowlists and channel gates.
- Produces: `_discord_message_admission(message, claim=...) -> tuple[bool, bool]` that admits a human reply to this bot but keeps unrelated unmentioned messages denied.

- [x] **Step 1: Write the failing test**

Add a real adapter admission test where a human guild message has no inline mention, references a message authored by the current bot, and is expected to dispatch exactly once. Add a negative sibling case referencing another author.

- [x] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/gateway/test_discord_message_edit_trigger.py -q`

Expected: the reply-to-self case fails because the existing inline-mention gate drops it.

- [x] **Step 3: Write minimal implementation**

Detect a reply to the current bot from structured reference data, with the reply-ping mention as a fallback, and exempt only that case from the no-inline-mention drop.

- [x] **Step 4: Run test to verify it passes**

Run the focused test again, then the adjacent Discord admission and double-dispatch suites.

- [x] **Step 5: Record the exact RCA and verification evidence**

Document the admission log evidence, preserved security gates, test commands, and live reply/read-back proof without copying private message content.

### Task 2: Keep model-visible tool arrays below provider ceilings

**Files:**
- Modify: `C:/Users/Burgboy/AppData/Local/hermes/hermes-agent/tools/tool_search.py`
- Test: `C:/Users/Burgboy/AppData/Local/hermes/hermes-agent/tests/tools/test_tool_search.py`
- Modify: `C:/Users/Burgboy/AppData/Local/hermes/docs/RCA-NOUSMAN-RECENT-CHAT-FAILURES-2026-09-02.md`

**Interfaces:**
- Consumes: `assemble_tool_defs(tool_defs, context_length, config)` and the existing progressive-disclosure bridge tools.
- Produces: auto activation when either schema-token pressure or the model-facing provider-safe tool-count ceiling is crossed.

- [x] **Step 1: Write the failing test**

Create more than 128 mixed core and deferrable real-shaped tool definitions with a large context window and assert auto mode replaces deferrable definitions with the three bridge tools while preserving core tools.

- [x] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/tools/test_tool_search.py -q`

Expected: auto mode remains inactive because current logic considers only the ten-percent context threshold.

- [x] **Step 3: Write minimal implementation**

Extend the existing activation decision with a count guard using the provider ceiling and existing bridge count; do not add another tool-discovery system.

- [x] **Step 4: Run test to verify it passes**

Run the focused tool-search suite and a real configured tool assembly, asserting the visible count is below 128 and deferred tools remain callable through the bridge.

- [x] **Step 5: Update the RCA**

Record the measured failing request count of 160, why the token-only threshold missed it, and the post-fix visible/deferred counts.

### Task 3: Advance past provider-specific validation incompatibilities

**Files:**
- Modify: `src/chain.js`
- Test: `test/chain.test.js`
- Create: `docs/RCA-FREECHAIN-NOUSMAN-PROVIDER-COMPATIBILITY-2026-09-02.md`
- Modify: `ISSUES.md`

**Interfaces:**
- Consumes: `wrapsRetryableUpstreamError(link, status, detail, settings)` from `dispatch`.
- Produces: candidate-specific 400/422 classification for provider tool-count ceilings and missing provider-only thought signatures, while generic malformed request errors remain fatal.

- [x] **Step 1: Write the failing tests**

Add table-driven dispatch tests for the two observed compatibility errors. Each first upstream returns 400, the second returns success, and the assertion requires two attempts ending on the second link. Retain the existing generic 400 hard-fail test.

- [x] **Step 2: Run tests to verify they fail**

Run: `node --test test/chain.test.js`

Expected: each new case throws `ChainError` after one fatal attempt.

- [x] **Step 3: Write minimal implementation**

Add a narrowly worded candidate-compatibility marker and use it inside `wrapsRetryableUpstreamError`; preserve the operator hard-fail override.

- [x] **Step 4: Run tests to verify they pass**

Run the focused test, then `npm test`.

- [x] **Step 5: Document the source-adjacent RCA**

Record journal timing, the two exact error categories in paraphrase, the low GitNexus blast radius, red-green evidence, and the boundary that remains after first usable streamed output.

### Task 4: Deploy and prove the complete installed route

**Files:**
- Modify: installed FreeChain artifact under the existing local installation.
- Verify: Hermes gateway state, gateway logs, FreeChain request journal, Start Menu shortcuts.

**Interfaces:**
- Consumes: tested FreeChain build, tested Hermes source, managed gateway restart, existing local credentials.
- Produces: a fresh Discord reply-to-bot turn that reaches a provider with fewer than 128 visible tools and receives a substantive response recorded by both FreeChain and Hermes delivery evidence.

- [x] **Step 1: Run pre-deploy structural checks**

Run GitNexus `detect_changes` in FreeChain and review exact diffs in both repositories. Refuse unrelated symbols.

- [x] **Step 2: Build and replace FreeChain safely**

Run the repository release build, preserve the installed executable backup, replace only the verified executable/web assets, and restart without leaving concurrent workers.

- [x] **Step 3: Restart Hermes through the managed path**

Drain the gateway, restart through `gateway-service/restart-gateway.ps1`, and verify the replacement PID, running state, Discord connected timestamp, tool-search activation, and no duplicate platform client.

- [x] **Step 4: Prove the fresh user-visible path**

Send or replay a controlled reply-to-bot event through the installed gateway, require a substantive Discord response, read it back, and correlate the FreeChain request ID to a terminal served journal record.

- [x] **Step 5: Run final verification**

Run complete FreeChain tests, focused Hermes suites, source compilation, installed health/deep-health probes, shortcut checks, and GitNexus change detection. Report any external provider outage separately from code correctness.

Final result: FreeChain passed 111 tests with one expected Windows permission skip; the reviewed
Hermes slice passed 160 tests with one unrelated dependency warning; syntax, lint, scoped diff,
installed hash, loopback health, deep health, process ownership, and Start Menu checks passed.
GitNexus reported LOW risk for the FreeChain diff. Its HIGH Hermes worktree result spans unrelated
pre-existing shared changes, while the owned files passed scoped tests, diff checks, and independent
review. The final gateway reduced live 158-tool and replayed 160-tool catalogs to 32 schemas.
A post-final-restart human Discord smoke could not be generated because all authorized input-control
paths were unavailable, so earlier official Discord read-backs are explicitly classified as
pre-final-restart evidence and were not overstated.
