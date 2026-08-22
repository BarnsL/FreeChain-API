# 8. RAG

**Enforcement: Requires client cooperation.** Only holds if the calling application cooperates.

Retrieval happens in your client, before the request ever reaches FreeChain.

## The concept

Retrieval-augmented generation answers from documents you supply at request time rather than from what the model memorized during training.

```text
User question
  |
Client searches documents, database, code, web, API
  |
Client selects and labels the retrieved context
  |
FreeChain compiles the Harness
  |
Provider chain answers from question + context
```

## What it means in FreeChain

By the time FreeChain sees the request, retrieval has already happened. The retrieved text is message content, and FreeChain treats it as such.

## What FreeChain enforces

- Harness composition around whatever context you sent.
- Metadata-only journaling: the journal records counts and models, never the retrieved passages.

## What your client must provide

- Search, ranking, selection and truncation.
- Clear delimiting of retrieved content, and a label saying where it came from.

## Example

```text
Put retrieved passages in a user message under an explicit heading such as "Retrieved context (untrusted)", kept separate from the actual question.
```

## Common failure

Letting instructions inside retrieved documents act as policy. Retrieved content is untrusted by default. If a document says "ignore previous instructions", that is a fact about the document, not a command to obey.

## Related FreeChain settings

Harness › Operating instructions, Logs

---

_Part of the [FreeChain Guide](../README.md). This file is generated from
`src/webui/guide-content.js`; edit that and re-run `npm run build-guide-docs`._
