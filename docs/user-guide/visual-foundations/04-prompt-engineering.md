# 4. Prompting weaker models reliably

**Enforcement: Prompted.** Placed in the system message. Influences the model, guarantees nothing.

The central FreeChain chapter: one role, one objective, a short ordered rule list, an explicit output shape.

## The concept

FreeChain routes to free, open and often smaller models. Instructions a frontier model absorbs effortlessly will be partially followed, reordered, or silently dropped by a weaker one. Compactness is not stylistic here. It is what makes the output reproducible.

```text
ROLE
  One sentence describing the assistant.

OBJECTIVE
  One primary outcome.

REQUIRED RULES
  Five to eight short ordered rules.

OUTPUT
  Exact format, length, required sections.

INPUT
  The current task, and only the context it needs.
```

## What it means in FreeChain

That contract maps onto Harness components directly. ROLE is Identity. OBJECTIVE and REQUIRED RULES are Operating instructions. OUTPUT is Output style. INPUT is what your client sends per request.

## What FreeChain enforces

- The components are joined in a fixed order and prepended as one system message.
- Empty components, and any component whose whole value is the word "auto", are skipped.

## What your client must provide

- The per-request task and its context.
- Any verification of the result, since FreeChain does not validate output shape.

## Example

```text
ROLE
You are a careful technical assistant.

OBJECTIVE
Produce a correct, usable answer to the requested task.

REQUIRED RULES
1. Follow the requested format.
2. Do not invent facts or completed actions.
3. State important assumptions.
4. Verify calculations and constraints.

OUTPUT
Give the result first, then only the explanation needed to use it.
```

## Common failure

Several overlapping personas, a huge imported system prompt, the same rule stated three ways, and conflicting "always" instructions. On a small model this does not degrade gracefully, it produces something that follows none of them. Also avoid asking for hidden reasoning to be revealed. Ask instead for a brief statement of approach, a verification step, and any material uncertainty, all of which are observable.

## Related FreeChain settings

Harness › Identity, Operating instructions, Output style

---

_Part of the [FreeChain Guide](../README.md). This file is generated from
`src/webui/guide-content.js`; edit that and re-run `npm run build-guide-docs`._
