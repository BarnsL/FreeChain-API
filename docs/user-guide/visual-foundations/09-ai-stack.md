# 9. Where FreeChain sits in the stack

**Enforcement: Gateway-enforced.** FreeChain applies or rejects this before the request leaves the process.

Technology categories rather than a product list that ages badly.

## The concept

Naming layers by category rather than by vendor keeps the picture true for longer, and makes it obvious which layer a given problem belongs to.

```text
User Interface
     |
Application or Agent Runtime
     |
Retrieval, Memory, Tools, Browser
     |
FreeChain Gateway
     |
Provider Adapters
     |
Hosted or Local Models
     |
CPU, GPU, TPU, or other accelerator
```

## What it means in FreeChain

FreeChain is one layer, deliberately thin. It does not reach up into the runtime above it, and it does not reach down into the model below it.

## What FreeChain enforces

- Everything at the gateway layer: authentication, Harness composition, routing, failover, journaling.

## What your client must provide

- Every layer above the gateway.

## Example

```text
A latency problem at the accelerator layer is not fixed by editing a Harness. Find the layer first, then the setting.
```

## Common failure

Treating a stack diagram from any publication as a shopping list. Named products age quickly. The categories do not.

## Related FreeChain settings

Overview, Chain

---

_Part of the [FreeChain Guide](../README.md). This file is generated from
`src/webui/guide-content.js`; edit that and re-run `npm run build-guide-docs`._
