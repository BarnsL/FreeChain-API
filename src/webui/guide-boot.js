/* Guide page renderer.

   A module rather than part of app.js: the content is a data module, and the
   dashboard's CSP is script-src 'self', so this has to be an external file
   rather than an inline block. app.js stays a classic script and keeps owning
   navigation; this only fills #guideView and exposes one open() entry point
   for the Harness page's "Read the guide" links. */

import {
  CHAPTERS, ENTRY_CARDS, SOURCE, TROUBLESHOOTING,
  ENFORCEMENT_LABEL, ENFORCEMENT_BLURB, HARNESS_COMPONENT_CHAPTER,
} from './guide-content.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const list = (items) => `<ul class="guide-list">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;

function sourceCard() {
  return `<aside class="card guide-source" aria-labelledby="guide-source-title">
    <h2 id="guide-source-title">${esc(SOURCE.title)}</h2>
    <p>${esc(SOURCE.body)}</p>
    <a class="btn btn-sm" href="${esc(SOURCE.url)}" target="_blank" rel="noopener noreferrer">${esc(SOURCE.linkText)}</a>
  </aside>`;
}

function enforcementBadge(level) {
  return `<span class="badge guide-enforcement guide-enforcement-${esc(level)}" title="${esc(ENFORCEMENT_BLURB[level] || '')}">${esc(ENFORCEMENT_LABEL[level] || level)}</span>`;
}

function chapterBody(chapter) {
  const version = chapter.protocolVersion
    ? `<div class="guide-version mono">Guide version ${esc(chapter.protocolVersion)} · last verified ${esc(chapter.lastVerified || 'unrecorded')}</div>`
    : '';
  const legacy = chapter.legacy
    ? `<div class="guide-legacy"><strong>Legacy compatibility note.</strong> ${esc(chapter.legacy)}</div>`
    : '';
  const sources = chapter.sources?.length
    ? `<h4>Source and version</h4>${chapter.sources.map((s) => `<p><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a></p>`).join('')}`
    : '';
  return `${version}
    <h4>The concept</h4><p>${esc(chapter.concept)}</p>
    <pre class="guide-diagram" aria-label="Diagram">${esc(chapter.diagram)}</pre>
    <h4>What it means in FreeChain</h4><p>${esc(chapter.inProduct)}</p>
    ${legacy}
    <h4>What FreeChain enforces</h4>${list(chapter.enforced)}
    <h4>What your client must provide</h4>${list(chapter.clientMustProvide)}
    <h4>Example</h4><pre class="guide-example">${esc(chapter.example)}</pre>
    <h4>Common failure</h4><p>${esc(chapter.commonFailure)}</p>
    <h4>Related FreeChain settings</h4><p>${esc(chapter.relatedSettings)}</p>
    ${sources}`;
}

function render() {
  const root = document.querySelector('#guideView');
  if (!root) return;

  const cards = ENTRY_CARDS.map((card) =>
    `<button class="stat guide-entry" type="button" data-guide-open="${esc(card.id)}">
      <div class="stat-label">${esc(card.title)}</div>
      <div class="stat-sub">${esc(card.body)}</div>
    </button>`).join('');

  const chapters = CHAPTERS.map((chapter) =>
    `<section class="harness-section guide-chapter" id="guide-${esc(chapter.id)}">
      <button class="harness-toggle" type="button" data-guide-toggle="${esc(chapter.id)}" aria-expanded="false" aria-controls="guide-body-${esc(chapter.id)}">
        <h3><span class="guide-number">${chapter.number}</span>${esc(chapter.title)}</h3>
        ${enforcementBadge(chapter.enforcement)}
      </button>
      <div class="harness-body collapsed guide-chapter-body" id="guide-body-${esc(chapter.id)}">
        <p class="guide-summary">${esc(chapter.summary)}</p>
        ${chapterBody(chapter)}
      </div>
    </section>`).join('');

  const trouble = TROUBLESHOOTING.map((entry) =>
    `<section class="harness-section guide-chapter" id="guide-trouble-${esc(entry.id)}">
      <button class="harness-toggle" type="button" data-guide-toggle="trouble-${esc(entry.id)}" aria-expanded="false" aria-controls="guide-body-trouble-${esc(entry.id)}">
        <h3>${esc(entry.symptom)}</h3>
      </button>
      <div class="harness-body collapsed guide-chapter-body" id="guide-body-trouble-${esc(entry.id)}">${list(entry.steps)}</div>
    </section>`).join('');

  root.innerHTML = `
    <h1>FreeChain Guide</h1>
    <p class="lede">
      How FreeChain turns one OpenAI-compatible request into a compact instruction
      contract and routes it through an ordered chain of providers. Written for
      smaller and less instruction-capable models, and explicit about what this
      gateway enforces as opposed to what still belongs to the application calling it.
    </p>
    ${sourceCard()}
    <div class="guide-entries">${cards}</div>
    <h2 class="guide-heading" id="guide-visual-foundations">Visual foundations</h2>
    <p class="guide-note">Twelve chapters. Every one states what FreeChain enforces and what your client must provide.</p>
    ${chapters}
    <h2 class="guide-heading" id="guide-troubleshooting">Troubleshooting</h2>
    ${trouble}
    <h2 class="guide-heading" id="guide-sources">Sources</h2>
    ${sourceCard()}
    <div class="card guide-sources-note">
      <p>Protocol-sensitive chapters carry their own version and verification date. The MCP chapter reflects the 2026-07-28 specification, which uses a stateless core and deprecates Roots, Sampling and Logging for new implementations.</p>
      <p>FreeChain ships this guide locally. It works without an internet connection; only the external reference links above require one.</p>
    </div>`;

  root.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-guide-toggle]');
    if (toggle) {
      const body = document.querySelector(`#guide-body-${CSS.escape(toggle.dataset.guideToggle)}`);
      if (!body) return;
      const open = body.classList.toggle('collapsed') === false;
      toggle.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
      return;
    }
    const entry = event.target.closest('[data-guide-open]');
    if (entry) open(entry.dataset.guideOpen);
  });
}

/** Show the Guide page, expand one chapter, and scroll it into view. */
function open(chapterId) {
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-guide'));
  document.querySelectorAll('.nav-item[data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === 'guide'));

  // Both chapters (#guide-07-mcp) and page headings (#guide-troubleshooting)
  // share the guide- id prefix, so one lookup covers entry cards and deep links.
  const section = document.querySelector(`#guide-${CSS.escape(chapterId)}`);
  if (!section) {
    document.querySelector('#guideView')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const body = section.querySelector('.guide-chapter-body');
  const toggle = section.querySelector('.harness-toggle');
  if (body?.classList.contains('collapsed')) {
    body.classList.remove('collapsed');
    toggle?.classList.add('open');
    toggle?.setAttribute('aria-expanded', 'true');
  }
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

render();

/** Open the guide chapter a Harness component maps to. Falls back to chapter 1. */
function openForComponent(componentKey) {
  open(HARNESS_COMPONENT_CHAPTER[componentKey] || '01-ai-agent');
}

// app.js is a classic script and cannot import from a module, so the Harness
// page's guide links reach this through the one global below.
window.freechainGuide = { open, openForComponent, chapterForComponent: (k) => HARNESS_COMPONENT_CHAPTER[k] || '01-ai-agent' };
