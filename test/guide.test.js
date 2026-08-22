// The Guide page is a first-class product surface, so its structure, its
// external attribution, its protocol currency, and its deep-links from the
// Harness page are all contract, not decoration. These tests read the shipped
// source (the content module can be imported; the HTML/CSS are scanned as
// text, same approach as source-integrity.test.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHAPTERS, TROUBLESHOOTING, SOURCE, ENTRY_CARDS,
  HARNESS_COMPONENT_CHAPTER, ENFORCEMENT_LABEL,
} from '../src/webui/guide-content.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('Guide sits between Harness and Logs in nav and page order', () => {
  const html = read('src', 'webui', 'index.html');
  assert.match(
    html,
    /data-page="harness"[\s\S]*?<\/button>\s*<button class="nav-item" data-page="guide"/,
    'Guide nav item must directly follow Harness',
  );
  assert.match(
    html,
    /data-page="guide"[\s\S]*?<\/button>\s*<button class="nav-item" data-page="logs"/,
    'Logs nav item must directly follow Guide',
  );
  assert.match(html, /<section class="page" id="page-guide">/);
  assert.match(html, /id="guideView"/);
  // The renderer is an ES module (it imports the content module), so it must be
  // loaded as type="module" or the whole page silently loses the Guide.
  assert.match(html, /<script type="module" src="\/guide-boot\.js"><\/script>/);
});

test('the Guide carries all twelve numbered visual chapters', () => {
  assert.equal(CHAPTERS.length, 12);
  CHAPTERS.forEach((chapter, index) => {
    assert.equal(chapter.number, index + 1, `chapter ${index + 1} is misnumbered`);
    for (const key of ['id', 'title', 'summary', 'concept', 'diagram', 'inProduct', 'example', 'commonFailure', 'relatedSettings']) {
      assert.ok(chapter[key], `chapter ${chapter.id} is missing ${key}`);
    }
    assert.ok(Array.isArray(chapter.enforced) && chapter.enforced.length, `chapter ${chapter.id} needs an "enforced" list`);
    assert.ok(Array.isArray(chapter.clientMustProvide) && chapter.clientMustProvide.length, `chapter ${chapter.id} needs a "clientMustProvide" list`);
    assert.ok(ENFORCEMENT_LABEL[chapter.enforcement], `chapter ${chapter.id} has an unknown enforcement level`);
  });
});

test('the external source is credited and linked, never bundled', () => {
  // Requirement: link the original, do not redistribute its graphics. The URL
  // must be present in the content, and no copy of the PDF may sit in the repo.
  assert.match(SOURCE.url, /bytebytego\.com\/12-AI-Visuals\.pdf$/);
  assert.ok(SOURCE.body.length > 40, 'source card needs a real attribution sentence');
  const bootJs = read('src', 'webui', 'guide-boot.js');
  assert.ok(bootJs.includes('SOURCE'), 'the renderer must surface the source card');

  // No bundled PDF, anywhere a release could carry it.
  for (const dir of ['src', 'docs', 'scripts']) {
    const hits = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (/12-AI-Visuals\.pdf$/i.test(e.name) || e.name.toLowerCase().endsWith('.pdf')) hits.push(full);
      }
    })(path.join(ROOT, dir));
    assert.deepEqual(hits, [], `no PDF may be bundled under ${dir}/ (found ${hits.join(', ')})`);
  }
});

test('the MCP chapter shows the current protocol and labels the legacy features', () => {
  const mcp = CHAPTERS.find((c) => c.id === '07-mcp');
  assert.ok(mcp, 'the MCP chapter must exist');
  assert.equal(mcp.protocolVersion, '2026-07-28', 'MCP chapter must state its protocol version');
  assert.ok(mcp.lastVerified, 'MCP chapter must carry a verification date');
  assert.ok(/legacy/i.test(mcp.legacy || ''), 'MCP chapter must carry a legacy-compatibility note');
  // The three deprecated features must be named as legacy, not shown as core.
  for (const feature of ['Roots', 'Sampling', 'Logging']) {
    assert.ok(mcp.legacy.includes(feature), `legacy note must name ${feature}`);
  }
  assert.ok(
    (mcp.sources || []).some((s) => /modelcontextprotocol\.io\/posts\/2026-07-28/.test(s.url)),
    'MCP chapter must link the 2026-07-28 specification',
  );
});

test('every Harness instruction component deep-links to a real chapter', () => {
  const ids = new Set(CHAPTERS.map((c) => c.id));
  const components = [
    'identity', 'operatingInstructions', 'safetyPolicy', 'toolPolicy',
    'reasoningPolicy', 'outputStyle', 'behavioralMode', 'persona',
  ];
  for (const component of components) {
    const chapter = HARNESS_COMPONENT_CHAPTER[component];
    assert.ok(chapter, `${component} has no guide mapping`);
    assert.ok(ids.has(chapter), `${component} maps to missing chapter ${chapter}`);
  }
  // The Harness field renders the link, and app.js routes it to the module global.
  const appJs = read('src', 'webui', 'app.js');
  assert.match(appJs, /data-guide-component=/, 'Harness fields must render a guide deep-link');
  assert.match(appJs, /freechainGuide\??\.\s*openForComponent/, 'the deep-link must call into the Guide module');

  // Entry cards must point at real anchors too (chapter ids or page headings).
  const validAnchors = new Set([...ids, 'troubleshooting', 'sources', 'visual-foundations']);
  for (const card of ENTRY_CARDS) {
    assert.ok(validAnchors.has(card.id), `entry card "${card.title}" points at unknown anchor ${card.id}`);
  }
});

test('troubleshooting entries are symptom-first with concrete steps', () => {
  assert.ok(TROUBLESHOOTING.length >= 4);
  for (const entry of TROUBLESHOOTING) {
    assert.ok(entry.symptom && entry.id, 'each troubleshooting entry needs a symptom and id');
    assert.ok(Array.isArray(entry.steps) && entry.steps.length >= 2, `"${entry.symptom}" needs at least two steps`);
  }
});

test('the generated docs mirror is in sync with the content module', () => {
  // docs/user-guide/ is generated from guide-content.js. If they drift, the
  // repo mirror lies. Every chapter needs its file, and the MCP correction and
  // attribution must have made it into the markdown.
  for (const chapter of CHAPTERS) {
    const file = path.join(ROOT, 'docs', 'user-guide', 'visual-foundations', `${chapter.id}.md`);
    assert.ok(fs.existsSync(file), `missing generated chapter file for ${chapter.id} — run npm run build-guide-docs`);
  }
  const sources = read('docs', 'user-guide', 'sources.md');
  assert.match(sources, /2026-07-28/, 'sources.md must record the MCP protocol version');
  assert.match(sources, /bytebytego\.com\/12-AI-Visuals\.pdf/, 'sources.md must link the credited source');
  const mcpDoc = read('docs', 'user-guide', 'visual-foundations', '07-mcp.md');
  assert.match(mcpDoc, /Roots, Sampling and Logging/, 'generated MCP chapter must carry the legacy note');
});
