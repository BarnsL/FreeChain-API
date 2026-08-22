# 3. Agent responsibility map

**Enforcement: Requires agent runtime.** Needs something that owns the execution loop. FreeChain does not.

Twenty agent concepts, grouped by who owns each one.

## The concept

Most confusion about agents is really confusion about ownership. This map answers one question per concept: when this goes wrong, whose code do I open?

```text
FREECHAIN OWNS
  Model routing      Failover         Harness compilation
  Access control     Request journal  Response streaming

YOUR CLIENT OWNS
  Goals         State       Memory       Knowledge
  Planning      Tools       Actions      Approvals
  Orchestration Handoffs    Environment

THE PROVIDER OWNS
  Weights       Tokenization    Context window
  Sampling      Reasoning budget
```

## What it means in FreeChain

Six things are FreeChain’s. Eleven belong to whatever calls it. Five belong to the provider. Nothing written in the Harness moves an item between columns.

## What FreeChain enforces

- Everything in the FreeChain column, on every request.

## What your client must provide

- Everything in the client column. A Harness can describe these, and describing is all it does.

## Example

```text
A handoff between two agents is orchestration. It happens entirely in your runtime, and FreeChain sees two unrelated requests.
```

## Common failure

Filing a bug against FreeChain because the model did not call a tool. FreeChain does not expose tools or execute them. Check the client loop.

## Related FreeChain settings

Harness › Tool policy, Guide › Enforcement boundaries

---

_Part of the [FreeChain Guide](../README.md). This file is generated from
`src/webui/guide-content.js`; edit that and re-run `npm run build-guide-docs`._
