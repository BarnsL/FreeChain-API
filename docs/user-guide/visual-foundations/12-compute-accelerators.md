# 12. Compute accelerators

**Enforcement: Not available here.** Not implemented in this deployment.

An optional appendix for self-hosting decisions, not a Harness setting.

## The concept

Inference runs on a CPU, a GPU, a TPU or another accelerator. The differences matter when you self-host, and are nearly invisible when you use a hosted provider.

```text
CPU          orchestration, small models, high per-token cost
GPU          parallel tensor work, the common case
TPU / other  specialised accelerators, provider-managed

What actually decides throughput:
  model size, precision, batch size,
  memory bandwidth, context length, software stack
```

## What it means in FreeChain

Nothing in FreeChain configures this. It matters only when choosing between hosted providers and running a model yourself.

## What FreeChain enforces

- Nothing. This chapter is background for provider choice.

## What your client must provide

- Any self-hosting decision, sizing and benchmarking.

## Example

```text
If a local model is too slow, look at quantization, batch size and context length before concluding the hardware is wrong.
```

## Common failure

Repeating universal claims such as "CPU takes seconds, GPU milliseconds, TPU microseconds". Real performance depends on model, precision, batch size, memory bandwidth and software, so benchmark your own workload.

## Related FreeChain settings

Model sources

---

_Part of the [FreeChain Guide](../README.md). This file is generated from
`src/webui/guide-content.js`; edit that and re-run `npm run build-guide-docs`._
