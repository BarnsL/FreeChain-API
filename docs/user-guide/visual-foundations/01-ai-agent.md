# 1. What is an AI agent?

**Enforcement: Gateway-enforced.** FreeChain applies or rejects this before the request leaves the process.

An agent is a model plus state, goals, context, tools and an environment. FreeChain supplies one part of that.

## The concept

An agent is not a model. A model maps input to output. An agent wraps a model in a loop that holds a goal, remembers what happened, perceives an environment, chooses actions, executes them, and observes what changed.

```text
User
  |
Application or Agent Runtime
  |-- Memory
  |-- Retrieval
  |-- Tools
  |-- Browser
  '-- Approval UI
  |
FreeChain
  |-- Access authentication
  |-- Harness compilation
  |-- Provider chain and failover
  '-- Response streaming
  |
Model Provider
```

## What it means in FreeChain

FreeChain occupies one band of that stack. It authenticates the caller, composes the active Harness into the request, routes through the ordered chain, retries past failures, and streams the answer back.

## What FreeChain enforces

- Access key authentication on every request.
- Harness composition, applied before anything else reads the body.
- Provider selection, cooldowns and failover across the chain.
- Privacy-safe request metadata in the journal.

## What your client must provide

- The agent loop itself: goals, iteration and stopping conditions.
- Memory that survives between requests.
- Tool execution, and any approval before a tool runs.
- Retrieval, browsing and filesystem access.

## Example

```text
A coding agent decides to read a file. It reads the file itself, puts the contents in a message, and sends that message to FreeChain. FreeChain never saw the file and never could have.
```

## Common failure

Writing "you may read files in ./src" into the Harness and expecting file access to exist. It does not. The sentence reaches the model, the capability does not.

## Related FreeChain settings

Harness › Identity, Harness › Operating instructions

---

_Part of the [FreeChain Guide](../README.md). This file is generated from
`src/webui/guide-content.js`; edit that and re-run `npm run build-guide-docs`._
