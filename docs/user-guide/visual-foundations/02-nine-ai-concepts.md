# 2. Nine AI concepts

**Enforcement: Prompted.** Placed in the system message. Influences the model, guarantees nothing.

A compact glossary, marking which concepts FreeChain implements and which it only carries.

## The concept

The vocabulary around models blurs together fast. These nine come up constantly, and separating them makes the rest of the guide readable.

```text
Concept              Who implements it
-------------------  -----------------------------
Tokenization         Provider
Context window       Provider
Few-shot examples    You, in the Harness
System prompt        FreeChain, from the Harness
RAG                  Your client, before FreeChain
Fine-tuning          Provider, out of band
Planning             Your client, or the model
Tool calling         Your client's loop
Streaming            FreeChain and the provider
```

## What it means in FreeChain

Only two rows in that table are FreeChain’s: the system prompt it composes, and the streaming it relays. Everything else is either upstream of it or downstream of it.

## What FreeChain enforces

- System prompt composition from the Harness components.
- Streaming relay, including a default stream setting when the client sends none.

## What your client must provide

- Retrieval, if the model needs external knowledge.
- The tool-calling loop, if the model is to use tools.
- Any few-shot examples, which live in the Harness as ordinary text.

## Example

```text
Few-shot examples belong in Operating instructions. Two short examples usually beat six long ones, especially on smaller models.
```

## Common failure

Confusing a large context window with good recall. A model that accepts 200k tokens does not attend to all of it equally. Send what the task needs.

## Related FreeChain settings

Harness › Operating instructions, Harness › Generation defaults

---

_Part of the [FreeChain Guide](../README.md). This file is generated from
`src/webui/guide-content.js`; edit that and re-run `npm run build-guide-docs`._
