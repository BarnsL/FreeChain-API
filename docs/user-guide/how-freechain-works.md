# How FreeChain works

FreeChain is a model gateway. It does one job well and refuses to pretend it
does more.

## The request path

```text
Client sends an OpenAI-compatible request
  |
Access key authenticated
  |
Active Harness composed into the request
  |
Request summarized into the privacy-safe journal
  |
Chain tried in order, skipping unconfigured links,
  cooling off failed ones, failing over to the next
  |
Answer streamed back to the client
```

The Harness is applied immediately after the body is parsed, so the journal, the
dispatcher, and the provider all see the same composed request rather than the
raw one the client sent.

## What FreeChain enforces

- **Authentication.** Every request presents the one access key.
- **Harness composition.** The active Harness's components are joined in a fixed
  order and prepended as a single system message.
- **Routing and failover.** Provider selection, cooldowns, and failover across
  the chain.
- **Privacy-safe journaling.** Metadata only by default: models, attempts,
  latency, error classes, and the Harness id. Never prompts or replies.

## What FreeChain does not do

It has no agent loop, so it never executes a tool, browses a page, reads a
database, keeps memory between requests, or approves anything. Those belong to
the application calling it. The [agent chapter](visual-foundations/01-ai-agent.md)
and [enforcement boundaries](../harness/enforcement-boundaries.md) draw the line
field by field.

## Where the active Harness comes from

FreeChain has one access key, so there is nothing to assign a Harness to.
Instead one Harness in the library is **active**, and every request is composed
with it. This is the one deliberate difference from SubChain, which assigns a
Harness per local key. The file format is shared, so a `harnesses.json` written
by one is readable by the other.

See [docs/HARNESS.md](../HARNESS.md) for the component reference and
[docs/harness/README.md](../harness/README.md) for using the page.

---

_Part of the [FreeChain Guide](README.md)._
