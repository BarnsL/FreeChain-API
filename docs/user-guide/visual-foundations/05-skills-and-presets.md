# 5. Skills and presets

**Enforcement: Prompted.** Placed in the system message. Influences the model, guarantees nothing.

Load the one fragment the task needs, not an entire prompt library.

## The concept

A skill or preset is a reusable chunk of instruction. The useful discipline is progressive loading: keep a compact index, select the relevant fragment, and load only that.

```text
Request
  |
Compact preset index
  |
Select one relevant fragment
  |
Load only that fragment
  |
Compile the Harness
  |
Send to provider
```

## What it means in FreeChain

FreeChain’s preset library imports published prompts as inert local text, classifies each by the component it was written for, and applies only what you choose. Browse presets from a component and the library opens already filtered to it.

## What FreeChain enforces

- Presets are stored in private application data, never in the repository.
- Applying a preset to a component it was not classified for raises an inline warning and a second confirmation.

## What your client must provide

- Nothing. Presets are resolved inside FreeChain at edit time, not per request.

## Example

```text
Run npm run import-presets to fill the library, then use Browse presets beside Operating instructions rather than pasting a whole published system prompt into the field.
```

## Common failure

Treating a preset as a grant. A preset contributes instructions. It does not grant permissions. An imported prompt describing shell access, filesystem rules or approval flows still gets you none of those.

## Related FreeChain settings

Harness › Browse presets, docs/PRESETS.md

---

_Part of the [FreeChain Guide](../README.md). This file is generated from
`src/webui/guide-content.js`; edit that and re-run `npm run build-guide-docs`._
