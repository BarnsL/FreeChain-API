# 11. RAG versus fine-tuning

**Enforcement: Not available here.** Not implemented in this deployment.

RAG supplies information at request time. Fine-tuning changes the model through training.

## The concept

These solve different problems, and are often posed as a choice when they are not mutually exclusive.

```text
RAG                          Fine-tuning
-------------------------    -------------------------
Information at request time  Behaviour learned in training
Changes per request          Changes the endpoint
Citable, inspectable         Opaque once trained
Private data stays outside   Data absorbed into weights
Cheap to update              Retraining to update
```

## What it means in FreeChain

FreeChain routes to whatever endpoint your chain names, base or fine-tuned, and applies the Harness to either. It does not train anything.

## What FreeChain enforces

- Routing to the configured endpoint, and applying the Harness identically regardless of how that endpoint was produced.

## What your client must provide

- Retrieval, for the RAG side.
- Any training, dataset building and evaluation, entirely out of band.

## Example

```text
Use RAG when information changes often, citations matter, or private knowledge should stay out of weights. Consider a fine-tuned endpoint when stable behaviour must be learned from many examples and you have evaluation data.
```

## Common failure

Believing a large imported system prompt is a form of fine-tuning. It is not. It is text, sent on every request, competing for the same context.

## Related FreeChain settings

Chain, Model sources

---

_Part of the [FreeChain Guide](../README.md). This file is generated from
`src/webui/guide-content.js`; edit that and re-run `npm run build-guide-docs`._
