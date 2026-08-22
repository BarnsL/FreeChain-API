# Sources and adaptation

## Visual learning reference

This guide was informed by ByteByteGo’s 12 AI Visuals. FreeChain uses original diagrams and product-specific explanations rather than reproducing the source graphics.

[Open the original ByteByteGo PDF](https://assets.bytebytego.com/12-AI-Visuals.pdf)

The FreeChain Guide uses the twelve-topic *sequence* of that resource as a
learning framework. Every diagram and explanation in the Guide is original and
written for FreeChain. No graphic from the source PDF is reproduced, bundled in
the executable or release archive, committed to this repository, or copied into
application data. Linking to the original is deliberate: the searchable content
of that PDF carries no licence, copyright, or redistribution statement, so
linking rather than bundling is the safer default.

## Protocol currency

Chapters covering fast-moving protocols carry their own version and
verification date. In particular the [MCP chapter](visual-foundations/07-mcp.md)
reflects the **2026-07-28** Model Context Protocol specification, which moved to
a stateless, self-describing core and deprecates Roots, Sampling and Logging for
new implementations. The Guide labels those three as legacy compatibility only.

- [MCP 2026-07-28 specification release](https://blog.modelcontextprotocol.io/posts/2026-07-28/)

## Adaptation rules

1. Credit and link the original PDF.
2. Do not copy its diagrams; create original ones in FreeChain's visual language.
3. Preserve the source's high-level concept sequence.
4. Rewrite every explanation around actual FreeChain behaviour.
5. Mark features owned by the client runtime rather than the gateway.
6. Version protocol-sensitive material and qualify over-general claims.
7. Keep the Guide usable offline; only external reference links need the network.

---

_Generated from `src/webui/guide-content.js`._
