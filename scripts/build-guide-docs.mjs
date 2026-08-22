#!/usr/bin/env node
// Generate docs/user-guide/ from the in-app Guide content.
//
// The Guide ships in the web UI (src/webui/guide-content.js is the single
// source of truth). These markdown files are a mirror for people reading the
// repo rather than running the app. Generating them means the two can never
// drift: edit guide-content.js, re-run `npm run build-guide-docs`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHAPTERS, TROUBLESHOOTING, SOURCE, ENFORCEMENT_LABEL, ENFORCEMENT_BLURB,
} from '../src/webui/guide-content.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'user-guide');
const VF = path.join(OUT, 'visual-foundations');

fs.mkdirSync(VF, { recursive: true });

const bullets = (items) => items.map((i) => `- ${i}`).join('\n');
const fence = (text) => `\`\`\`text\n${text}\n\`\`\``;

function chapterMarkdown(c) {
  const version = c.protocolVersion
    ? `> Guide version ${c.protocolVersion} · last verified ${c.lastVerified || 'unrecorded'}\n\n`
    : '';
  const legacy = c.legacy ? `\n### Legacy compatibility note\n\n${c.legacy}\n` : '';
  const sources = c.sources?.length
    ? `\n### Source and version\n\n${c.sources.map((s) => `- [${s.label}](${s.url})`).join('\n')}\n`
    : '';
  return `# ${c.number}. ${c.title}

${version}**Enforcement: ${ENFORCEMENT_LABEL[c.enforcement]}.** ${ENFORCEMENT_BLURB[c.enforcement]}

${c.summary}

## The concept

${c.concept}

${fence(c.diagram)}

## What it means in FreeChain

${c.inProduct}
${legacy}
## What FreeChain enforces

${bullets(c.enforced)}

## What your client must provide

${bullets(c.clientMustProvide)}

## Example

${fence(c.example)}

## Common failure

${c.commonFailure}

## Related FreeChain settings

${c.relatedSettings}
${sources}
---

_Part of the [FreeChain Guide](../README.md). This file is generated from
\`src/webui/guide-content.js\`; edit that and re-run \`npm run build-guide-docs\`._
`;
}

// One file per chapter.
for (const c of CHAPTERS) {
  fs.writeFileSync(path.join(VF, `${c.id}.md`), chapterMarkdown(c), 'utf8');
}

// Chapter index.
const vfIndex = `# Visual foundations

Twelve chapters adapting the concept sequence from ByteByteGo's *12 AI Visuals*
into FreeChain's own diagrams and explanations. Every chapter states what
FreeChain enforces and what your client must provide.

${CHAPTERS.map((c) => `${c.number}. [${c.title}](${c.id}.md) — ${ENFORCEMENT_LABEL[c.enforcement]}`).join('\n')}

${SOURCE.title}: ${SOURCE.body} [${SOURCE.linkText}](${SOURCE.url})
`;
fs.writeFileSync(path.join(VF, 'README.md'), vfIndex, 'utf8');

// Troubleshooting.
const trouble = `# Troubleshooting

Symptom-first fixes. The Guide inside the app carries the same list.

${TROUBLESHOOTING.map((t) => `## ${t.symptom}\n\n${bullets(t.steps)}`).join('\n\n')}

---

_Generated from \`src/webui/guide-content.js\`._
`;
fs.writeFileSync(path.join(OUT, 'troubleshooting.md'), trouble, 'utf8');

// Sources / attribution — the credited-external-source requirement.
const sources = `# Sources and adaptation

## Visual learning reference

${SOURCE.body}

[${SOURCE.linkText}](${SOURCE.url})

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

_Generated from \`src/webui/guide-content.js\`._
`;
fs.writeFileSync(path.join(OUT, 'sources.md'), sources, 'utf8');

// Top-level index.
const readme = `# FreeChain Guide

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

${CHAPTERS.map((c) => `${c.number}. [${c.title}](visual-foundations/${c.id}.md) — ${ENFORCEMENT_LABEL[c.enforcement]}`).join('\n')}

---

_The chapter files, troubleshooting, and sources pages are generated from
\`src/webui/guide-content.js\` by \`scripts/build-guide-docs.mjs\`. Edit the
content module, then run \`npm run build-guide-docs\`. This index and the
quick-start / how-it-works pages are written by hand._
`;
fs.writeFileSync(path.join(OUT, 'README.md'), readme, 'utf8');

console.log(`Wrote ${CHAPTERS.length} chapters + index, troubleshooting, sources, README to docs/user-guide/`);
