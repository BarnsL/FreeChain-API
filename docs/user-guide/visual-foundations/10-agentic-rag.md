# 10. RAG versus agentic RAG

**Enforcement: Requires client cooperation.** Only holds if the calling application cooperates.

Ordinary RAG retrieves once. Agentic RAG loops, and the loop belongs to your client.

## The concept

Ordinary RAG is a straight pipeline. Agentic RAG plans, retrieves, evaluates what came back, and retrieves again when the evidence is thin or contradictory.

```text
Agent runtime
  |-- Plans
  |-- Chooses retrieval source
  |-- Retrieves
  |-- Evaluates result
  |-- Retrieves again when needed
  '-- Maintains task state
        |
     FreeChain
        |
   Model provider
```

## What it means in FreeChain

Every arrow in that loop is your runtime’s. FreeChain sees each pass as an independent request with no memory of the last.

## What FreeChain enforces

- Per-request composition and routing, identically on every pass through the loop.

## What your client must provide

- The loop, its iteration budget, and its stopping condition.
- Task state between passes, since FreeChain holds none.

## Example

```text
Cap iterations in your client. FreeChain has no maximum-steps control to protect you, because it does not own the loop.
```

## Common failure

Expecting FreeChain to stop a runaway retrieval loop. It cannot see that a loop exists.

## Related FreeChain settings

Logs, for spotting repeated near-identical requests

---

_Part of the [FreeChain Guide](../README.md). This file is generated from
`src/webui/guide-content.js`; edit that and re-run `npm run build-guide-docs`._
