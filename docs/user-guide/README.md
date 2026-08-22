# FreeChain Guide

FreeChain ships this guide **inside the app**, on the **Guide** page between
Harness and Logs. It works offline; only the external reference links need the
network. These markdown files mirror that content for reading in the repository.

## Start here

- [Quick start](quick-start.md)
- [How FreeChain works](how-freechain-works.md)
- [Visual foundations](visual-foundations/README.md) — the twelve chapters
- [Troubleshooting](troubleshooting.md)
- [Sources and attribution](sources.md)

## What the Guide is for

FreeChain routes one OpenAI-compatible request through an ordered chain of free,
open, and often smaller providers. The Guide is written for exactly that: how to
write instructions weaker models follow reliably, and a clear line between what
this gateway enforces and what still belongs to the application calling it.

Every chapter carries an **enforcement badge** using the same vocabulary as the
Harness page and SubChain: *prompted*, *gateway-enforced*, *requires agent
runtime*, *requires client cooperation*, or *not available here*.

## The twelve chapters

1. [What is an AI agent?](visual-foundations/01-ai-agent.md) — Gateway-enforced
2. [Nine AI concepts](visual-foundations/02-nine-ai-concepts.md) — Prompted
3. [Agent responsibility map](visual-foundations/03-agent-glossary.md) — Requires agent runtime
4. [Prompting weaker models reliably](visual-foundations/04-prompt-engineering.md) — Prompted
5. [Skills and presets](visual-foundations/05-skills-and-presets.md) — Prompted
6. [Agentic browsers](visual-foundations/06-agentic-browser.md) — Requires agent runtime
7. [MCP](visual-foundations/07-mcp.md) — Requires agent runtime
8. [RAG](visual-foundations/08-rag.md) — Requires client cooperation
9. [Where FreeChain sits in the stack](visual-foundations/09-ai-stack.md) — Gateway-enforced
10. [RAG versus agentic RAG](visual-foundations/10-agentic-rag.md) — Requires client cooperation
11. [RAG versus fine-tuning](visual-foundations/11-rag-vs-fine-tuning.md) — Not available here
12. [Compute accelerators](visual-foundations/12-compute-accelerators.md) — Not available here

---

_The chapter files, troubleshooting, and sources pages are generated from
`src/webui/guide-content.js` by `scripts/build-guide-docs.mjs`. Edit the
content module, then run `npm run build-guide-docs`. This index and the
quick-start / how-it-works pages are written by hand._
