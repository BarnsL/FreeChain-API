# 6. Agentic browsers

**Enforcement: Requires agent runtime.** Needs something that owns the execution loop. FreeChain does not.

Perception, security, confirmation and execution all live in the browser runtime, not here.

## The concept

A browsing agent perceives a page, reasons about it, decides an action, and executes it. Each of those is a separate layer with its own failure mode.

```text
Perception   accessibility tree, DOM, screenshot
Reasoning    page interpretation, goal tracking, recovery
Security     domain allowlist, download policy,
             credential boundary, confirmation
Execution    navigate, click, type, upload, refresh state

     ^ all four live in the browser runtime
     |
FreeChain sees only the request, and the reply.
```

## What it means in FreeChain

FreeChain supplies the model request and the provider fallback behind it. It has no browser, no page state, and no notion of a domain allowlist.

## What FreeChain enforces

- Nothing in this chapter. FreeChain is not in the browsing path.

## What your client must provide

- All four layers, including confirmation before any action that writes, purchases, publishes, communicates or deletes.
- Refreshed page state to the model after a material action.

## Example

```text
A browser agent reads a page, sends the extracted text to FreeChain as a message, gets a decision back, and performs the click itself.
```

## Common failure

Trusting page content. Text on a webpage is untrusted input and cannot grant tools or permissions no matter what it claims. Credentials belong to the browser boundary and should never be written into a Harness component.

## Related FreeChain settings

Harness › Tool policy (guidance only)

---

_Part of the [FreeChain Guide](../README.md). This file is generated from
`src/webui/guide-content.js`; edit that and re-run `npm run build-guide-docs`._
