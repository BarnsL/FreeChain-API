/* FreeChain dashboard behaviour.
   Plain DOM, no framework — the server ships zero dependencies and this keeps
   the UI in the same spirit. State is refetched from /admin/state after any
   mutation rather than patched locally, so the page can never disagree with
   what is actually on disk. */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ORIGIN = location.origin;
let state = null;
let revealed = false;
let accessKeyValue = null;
let logsPage = null;
let logsLoading = false;
let logsLastUpdatedAt = 0;
let logsNextRefreshAt = 0;
let logsStale = false;
let logsPaused = false;

// ── helpers ───────────────────────────────────────────────────────────

// HTML-escape for anything interpolated into an innerHTML template below —
// provider labels, model ids, and the like all pass through server data that
// this file must not trust blindly.
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

let toastTimer;
/** Show a transient status message. A second call while one is showing replaces it and resets the timer. */
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('err', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/** Fetch a JSON admin endpoint and throw the server's own error message on a non-2xx response. */
async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
}

/** Copy to the clipboard and toast the result — clipboard access can be blocked by the browser. */
async function copy(text, what = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(what);
  } catch {
    toast('Clipboard blocked — select and copy manually', true);
  }
}

const icon = {
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2 3 14h8l-1 8 10-12h-8l1-8Z"/></svg>',
  grip: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m18 15-6-6-6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>',
};

// ── navigation ────────────────────────────────────────────────────────

/** Switch the visible page and highlight the matching nav item. Pure client-side — no navigation, no reload. */
function goto(page) {
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${page}`));
  $$('.nav-item[data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  window.scrollTo(0, 0);
  if (page === 'logs' && !logsLoading) refreshLogs();
}
$$('.nav-item[data-page]').forEach((b) => b.addEventListener('click', () => goto(b.dataset.page)));
document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-goto]');
  if (link) {
    e.preventDefault();
    goto(link.dataset.goto);
  }
});

// ── overview ──────────────────────────────────────────────────────────

/**
 * Paint the Overview page's stat tiles, source cards, and cooling table from the current `state`.
 *
 * Source-card layout contract: every card uses `source-card-header`, a two-column grid whose
 * second column is reserved for the configuration-status badge. This keeps every badge on the
 * same right-hand anchor even when a provider label wraps to several lines. `ready` still means
 * a key is configured (or the provider needs no key), never that a live upstream probe passed.
 *
 * The HTTP-error legend is static markup in index.html, below `#coolingBox`: it documents the
 * failover classifications without duplicating mutable cooldown state in the renderer.
 */
function renderOverview() {
  const { totals, stats, providers, cooling } = state;
  $('#statEndpoint').textContent = `${ORIGIN}/v1`;
  $('#statReady').textContent = totals.ready;
  $('#statReadySub').textContent = `of ${totals.links} chain links`;
  $('#statCandidates').textContent = totals.candidates;
  $('#statServed').textContent = stats.served;
  $('#statFailed').textContent = stats.failed ? `${stats.failed} failed` : 'none failed';

  const withKeys = providers.filter((p) => p.totalKeys > 0);
  $('#noKeysCallout').classList.toggle('hidden', withKeys.length > 0);

  $('#sourceCards').innerHTML = providers
    .filter((p) => p.inChain)
    .map((p) => {
      const ok = p.totalKeys > 0 || p.keyOptional;
      return `<article class="stat source-card">
        <div class="source-card-header">
          <div class="stat-label source-card-label">${esc(p.label)}</div>
          <span class="badge source-card-status ${ok ? 'badge-ok' : ''}"><span class="dot"></span>${ok ? 'ready' : 'no key'}</span>
        </div>
        <div class="stat-value" style="font-size:22px">${p.totalKeys || (p.keyOptional ? '—' : 0)}</div>
        <div class="stat-sub">${p.totalKeys ? `${p.totalKeys} key(s) across ${p.activeSlots} slot(s)` : p.keyOptional ? 'no key required' : 'awaiting a key'} · ${p.modelCount} model(s)</div>
      </article>`;
    })
    .join('');

  $('#coolingBox').innerHTML = cooling.length
    ? `<div class="table-wrap"><table><thead><tr><th>Candidate</th><th>Last error</th><th>Retry in</th></tr></thead><tbody>${cooling
        .map(
          (c) =>
            `<tr><td class="mono">${esc(c.id)}</td><td style="color:var(--muted-foreground)">${esc(c.lastError || '—')}</td><td class="num">${c.secondsRemaining}s</td></tr>`
        )
        .join('')}</tbody></table></div>`
    : `<div class="card" style="color:var(--muted-foreground);font-size:13px">Nothing cooling off. Every configured candidate is available.</div>`;
}

// ── providers ─────────────────────────────────────────────────────────

// Provider families whose empty account slots are expanded. Empty slots stay
// collapsed by default so a card shows the keys that exist, not ten blank rows.
const expandedSlots = new Set();

/** Paint the Model sources page: one card per provider family, one row per account slot. */
function renderProviders() {
  $('#providerList').innerHTML = state.providers
    .map((p) => {
      const filled = p.slots.filter((s) => s.keys.length);
      const empty = p.slots.filter((s) => !s.keys.length);
      // With no key anywhere, keep the first empty slot visible so there is
      // always somewhere obvious to paste one.
      const shown = filled.length ? filled : empty.slice(0, 1);
      const collapsed = filled.length ? empty : empty.slice(1);
      const isOpen = expandedSlots.has(p.family);

      const renderSlot = (s) => {
        const chips = s.keys.length
          ? s.keys
              .map(
                (k) =>
                  `<span class="keychip"><span class="mono">${esc(k.masked)}</span>
                    <button data-del-slot="${esc(s.id)}" data-del-index="${k.index}" title="Remove this key">${icon.trash}</button></span>`
              )
              .join('')
          : `<span class="slot-empty">empty</span>`;

        return `<div class="slot">
          <div class="slot-name">${esc(s.label)}<span class="sub mono">${esc(s.id)}</span></div>
          <div class="slot-keys">${chips}</div>
          <div class="slot-add">
            <input class="input mono" type="password" placeholder="Paste API key" data-add-slot="${esc(s.id)}"
                   autocomplete="off" spellcheck="false" />
            <button class="btn btn-sm" data-save-slot="${esc(s.id)}">${icon.plus} Add</button>
            ${s.keys.length || p.keyOptional ? `<button class="btn btn-sm" data-test-slot="${esc(s.id)}" title="Send a 1-token request">${icon.bolt} Test</button>` : ''}
          </div>
        </div>`;
      };

      const slots = [...shown, ...(isOpen ? collapsed : [])].map(renderSlot).join('');
      const slotToggle = collapsed.length
        ? `<button class="btn btn-sm btn-ghost slot-toggle" data-toggle-slots="${esc(p.family)}"
                   aria-expanded="${isOpen}">${isOpen ? icon.up : icon.down}
             ${isOpen ? 'Hide' : 'Show'} ${collapsed.length} empty slot${collapsed.length === 1 ? '' : 's'}</button>`
        : '';

      const keyLink = p.links.keys
        ? `<a class="btn btn-sm" href="${esc(p.links.keys)}" target="_blank" rel="noopener noreferrer">${icon.ext} Get a key</a>`
        : '';
      const siteLink = p.links.site
        ? `<a class="btn btn-sm btn-ghost" href="${esc(p.links.site)}" target="_blank" rel="noopener noreferrer">${esc(new URL(p.links.site).host)}</a>`
        : '';

      return `<div class="card provider">
        <div class="provider-head">
          <div>
            <div class="provider-title">
              <h2>${esc(p.label)}</h2>
              ${p.inChain ? `<span class="badge badge-free">${p.modelCount} model(s) in chain</span>` : `<span class="badge">not in chain</span>`}
              ${p.keyOptional ? `<span class="badge">key optional</span>` : ''}
              ${p.totalKeys ? `<span class="badge badge-ok"><span class="dot"></span>${p.totalKeys} key(s)</span>` : ''}
            </div>
            <div class="provider-meta mono">${esc(p.baseUrl)}</div>
          </div>
          <div class="provider-actions">${siteLink}${keyLink}</div>
        </div>
        <div class="slots">${slots}</div>
        ${slotToggle}
      </div>`;
    })
    .join('');
}

// Add a key. Reads the adjacent input so one handler covers every slot.
async function addKey(slotId) {
  const input = $(`[data-add-slot="${CSS.escape(slotId)}"]`);
  const value = input.value.trim();
  if (!value) return toast('Paste a key first', true);

  const provider = state.providers.find((p) => p.slots.some((s) => s.id === slotId));
  const slot = provider.slots.find((s) => s.id === slotId);
  if (slot.keys.length >= state.limits.keysPerSlot) {
    return toast(`This slot already holds ${state.limits.keysPerSlot} keys`, true);
  }

  // Existing keys are masked here, so the server merges rather than replaces:
  // it is sent the new key plus a marker for each key to keep.
  await api('/admin/keys', {
    method: 'POST',
    body: JSON.stringify({ slot: slotId, keys: [...slot.keys.map((k) => ` keep:${k.index}`), value] }),
  });
  input.value = '';
  await refresh();
  toast('Key added');
}

/** Remove one key from a slot by re-saving the rest as "keep" markers, same round-trip as addKey. */
async function deleteKey(slotId, index) {
  const provider = state.providers.find((p) => p.slots.some((s) => s.id === slotId));
  const slot = provider.slots.find((s) => s.id === slotId);
  const keep = slot.keys.filter((k) => k.index !== Number(index)).map((k) => ` keep:${k.index}`);

  await api('/admin/keys', { method: 'POST', body: JSON.stringify({ slot: slotId, keys: keep }) });
  await refresh();
  toast('Key removed');
}

/** Send a live 1-token probe through one slot and report latency or the failure reason on the button itself. */
async function testSlot(slotId, button) {
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="spin" style="display:inline-block">${icon.bolt}</span> Testing`;
  try {
    const r = await api('/admin/test', { method: 'POST', body: JSON.stringify({ slot: slotId }) });
    toast(r.ok ? `${slotId} answered in ${r.ms}ms` : `${slotId}: ${r.reason}`, !r.ok);
  } catch (err) {
    toast(err.message, true);
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}

$('#providerList').addEventListener('click', (e) => {
  const save = e.target.closest('[data-save-slot]');
  if (save) return addKey(save.dataset.saveSlot).catch((err) => toast(err.message, true));

  const del = e.target.closest('[data-del-slot]');
  if (del) return deleteKey(del.dataset.delSlot, del.dataset.delIndex).catch((err) => toast(err.message, true));

  const test = e.target.closest('[data-test-slot]');
  if (test) return testSlot(test.dataset.testSlot, test);

  const toggle = e.target.closest('[data-toggle-slots]');
  if (toggle) {
    const family = toggle.dataset.toggleSlots;
    if (!expandedSlots.delete(family)) expandedSlots.add(family);
    return renderProviders();
  }
});

$('#providerList').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset.addSlot) {
    addKey(e.target.dataset.addSlot).catch((err) => toast(err.message, true));
  }
});

// ── chain ─────────────────────────────────────────────────────────────

let dragIdx = null;

/** Paint the Chain page's table: one draggable row per link, in the server's current order. */
function renderChain() {
  $('#chainBody').innerHTML = state.chain
    .map(
      (l, i) => `<tr draggable="true" data-chain-idx="${i}" class="chain-row">
        <td class="chain-grip" title="Drag to reorder">${icon.grip}</td>
        <td class="num">${i + 1}</td>
        <td><span class="mono">${esc(l.provider)}</span>${l.free ? '' : ' <span class="badge">paid</span>'}</td>
        <td class="mono">${esc(l.model)}</td>
        <td class="num">${l.keyCount ? `${l.keyCount} key(s) / ${l.accountCount} slot(s)` : '—'}</td>
        <td>${
          l.hasKey
            ? '<span class="badge badge-ok"><span class="dot"></span>configured</span>'
            : '<span class="badge badge-warn"><span class="dot"></span>no key</span>'
        }</td>
        <td class="chain-move">
          <button class="btn-move" data-move-up="${i}" ${i === 0 ? 'disabled' : ''} title="Move up">${icon.up}</button>
          <button class="btn-move" data-move-down="${i}" ${i === state.chain.length - 1 ? 'disabled' : ''} title="Move down">${icon.down}</button>
        </td>
      </tr>`
    )
    .join('');
}

/** Send a full reordering (array of old indices in new order) to the server and refresh, reverting on failure. */
async function applyOrder(order) {
  try {
    await api('/admin/chain/reorder', {
      method: 'POST',
      body: JSON.stringify({ order }),
    });
    await refresh();
    toast('Chain reordered');
  } catch (err) {
    toast(err.message, true);
    await refresh();
  }
}

/** Move one link from index `from` to index `to`, used by both the move buttons and drag-and-drop. */
function swapChain(from, to) {
  const order = state.chain.map((_, i) => i);
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  applyOrder(order);
}

$('#chainBody').addEventListener('click', (e) => {
  const up = e.target.closest('[data-move-up]');
  if (up) { const i = Number(up.dataset.moveUp); if (i > 0) swapChain(i, i - 1); return; }
  const down = e.target.closest('[data-move-down]');
  if (down) { const i = Number(down.dataset.moveDown); if (i < state.chain.length - 1) swapChain(i, i + 1); return; }
});

$('#chainBody').addEventListener('dragstart', (e) => {
  const row = e.target.closest('[data-chain-idx]');
  if (!row) return;
  dragIdx = Number(row.dataset.chainIdx);
  row.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(dragIdx));
});

$('#chainBody').addEventListener('dragend', (e) => {
  dragIdx = null;
  $$('.chain-row', $('#chainBody')).forEach((r) => r.classList.remove('dragging', 'drag-over'));
});

$('#chainBody').addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const row = e.target.closest('[data-chain-idx]');
  $$('.chain-row', $('#chainBody')).forEach((r) => r.classList.remove('drag-over'));
  if (row && Number(row.dataset.chainIdx) !== dragIdx) row.classList.add('drag-over');
});

$('#chainBody').addEventListener('drop', (e) => {
  e.preventDefault();
  const row = e.target.closest('[data-chain-idx]');
  if (!row || dragIdx === null) return;
  const to = Number(row.dataset.chainIdx);
  if (to === dragIdx) return;
  swapChain(dragIdx, to);
});

// ── harness ───────────────────────────────────────────────────────────
//
// Same component vocabulary as SubChain, and the same file format, so a
// Harness written in one is legible in the other. The difference is where the
// choice lives: SubChain assigns a Harness per local key, FreeChain has one
// access key, so one Harness in the library is *active* and every request the
// access key serves is composed with it.

const HARNESS_COMPONENTS = [
  { key: 'identity', label: 'Identity' },
  { key: 'operatingInstructions', label: 'Operating instructions' },
  { key: 'safetyPolicy', label: 'Safety policy' },
  { key: 'toolPolicy', label: 'Tool policy' },
  { key: 'reasoningPolicy', label: 'Reasoning policy' },
  { key: 'outputStyle', label: 'Output style' },
  { key: 'behavioralMode', label: 'Behavioral mode' },
  { key: 'persona', label: 'Persona' },
];

// Per-component guidance. `guide` is the always-visible line under the label;
// `detail` is the tooltip body. `belongs`/`avoid` exist because the components
// are easy to confuse — the usual mistake is putting process into Identity or
// formatting into Behavioral mode, which quietly weakens both.
const HARNESS_GUIDE = {
  identity: {
    guide: 'Who the model is. Keep it short and stable.',
    detail: 'A standing role statement prepended to every request on this Harness. It answers "who am I" and nothing else, so it stays true no matter what the user asks.',
    belongs: 'A role and its domain: "You are a senior Go reviewer for a payments team."',
    avoid: 'Step-by-step process. That is Operating instructions.',
  },
  operatingInstructions: {
    guide: 'How the model should work through a task.',
    detail: 'The working method: what to do first, when to ask instead of assume, how to sequence a job, what "done" means. This is the largest component in most Harnesses.',
    belongs: 'Workflow, ordering, verification steps, when to check in.',
    avoid: 'Refusal rules (Safety policy) and formatting (Output style).',
  },
  safetyPolicy: {
    guide: 'What the model must refuse, confirm, or escalate.',
    detail: 'Hard limits, expressed as rules rather than preferences. Keep it separate from Operating instructions so a workflow edit can never silently loosen a limit.',
    belongs: 'Prohibited actions, required confirmations, escalation paths.',
    avoid: 'Tone and formatting. Those never belong in a limit.',
  },
  toolPolicy: {
    guide: 'When and how tools may be called.',
    detail: 'Which tools are in scope, which need confirmation before they take effect, and how results should be treated. Applies on top of whatever the client already enforces.',
    belongs: 'Allowed tools, confirmation before side effects, retry and failure handling.',
    avoid: 'How hard to think before acting. That is Reasoning policy.',
  },
  reasoningPolicy: {
    guide: 'How much to think before answering.',
    detail: 'Depth and verification: when to slow down, when to check work, when a quick answer is the right answer. Pairs with the Reasoning effort generation default.',
    belongs: 'Depth rules, self-checks, when to explore alternatives.',
    avoid: 'Output length or formatting. That is Output style.',
  },
  outputStyle: {
    guide: 'How the answer is shaped on the page.',
    detail: 'Presentation only: length, structure, markdown, code fences, tables, whether to show intermediate work. Changing this must never change what the model is willing to do.',
    belongs: 'Formatting, length targets, structure, code-block conventions.',
    avoid: 'Behavioural rules. Those change conduct, not presentation.',
  },
  behavioralMode: {
    guide: 'The operating mode the model runs in.',
    detail: 'A named mode that shifts overall conduct — plan-first, minimal, focused, review-oriented. Modes compose badly, so prefer one clear mode over several blended ones.',
    belongs: 'Mode definitions: plan before acting, minimal output, review-only.',
    avoid: 'Identity. A mode is what it does, not who it is.',
  },
  persona: {
    guide: 'Voice and personality.',
    detail: 'Register and manner: warm or terse, formal or casual, humour or none. Purely expressive — a persona must never be able to grant a capability or relax a limit.',
    belongs: 'Tone, register, verbosity of manner, humour.',
    avoid: 'Capabilities and permissions. Those live in Tool and Safety policy.',
  },
  temperature: { guide: 'Randomness. Lower is more deterministic.', detail: 'Typically 0 to 2. Leave empty to use whatever the provider defaults to; not every free provider interprets the scale identically.' },
  top_p: { guide: 'Nucleus sampling cutoff.', detail: 'Typically 0 to 1. Tune this or Temperature, rarely both — together they interact in ways that are hard to reason about.' },
  top_k: { guide: 'Limits sampling to the K most likely tokens.', detail: 'Supported by some providers and silently ignored by others. Leave empty unless a provider in your chain honours it.' },
  max_tokens: { guide: 'Ceiling on response length.', detail: 'A hard cap on output tokens, not a target. Set too low, answers truncate mid-sentence; leave empty for the provider default.' },
  effort: { guide: 'How much reasoning budget to request.', detail: 'Maps onto provider reasoning controls where they exist. Pairs with Reasoning policy: this buys the budget, that spends it.' },
  stream: { guide: 'Whether responses stream by default.', detail: 'A client asking for streaming explicitly still wins. This only sets the default when the request does not say.' },
  service_tier: { guide: 'Provider service tier.', detail: 'Passed through to providers that support tiers; ignored elsewhere. Affects latency, cost and priority, never behaviour.' },
  user_id: { guide: 'Stable identifier sent to the provider.', detail: 'Used by some providers for abuse tracking and caching. Use an opaque value — never a real name, email, or anything identifying.' },
  aliases: { guide: 'Rewrite model names before routing.', detail: 'A JSON object mapping the name a client asks for to the model actually used, so you can retarget a client whose model picker you do not control.' },
  headers: { guide: 'Extra HTTP metadata on every upstream request.', detail: 'A JSON object of additional request headers. Credential, cookie, host and connection headers are rejected, so this cannot be used to smuggle authentication.' },
};

const HARNESS_SECTIONS = [
  { key: 'identity-operating', label: 'Identity and operating instructions', fields: HARNESS_COMPONENTS.slice(0, 2).map((field) => ({ ...field, type: 'textarea', scope: 'components' })) },
  { key: 'safety-tools', label: 'Safety and tools', fields: HARNESS_COMPONENTS.slice(2, 4).map((field) => ({ ...field, type: 'textarea', scope: 'components' })) },
  { key: 'reasoning-output', label: 'Reasoning and output', fields: HARNESS_COMPONENTS.slice(4, 6).map((field) => ({ ...field, type: 'textarea', scope: 'components' })) },
  { key: 'behavior-persona', label: 'Behavior and persona', fields: HARNESS_COMPONENTS.slice(6, 8).map((field) => ({ ...field, type: 'textarea', scope: 'components' })) },
  { key: 'generation', label: 'Generation defaults', fields: [
    { key: 'temperature', label: 'Temperature', type: 'number', scope: 'generation', min: 0, max: 2, step: 0.1 },
    { key: 'top_p', label: 'Top P', type: 'number', scope: 'generation', min: 0, max: 1, step: 0.05 },
    { key: 'top_k', label: 'Top K', type: 'number', scope: 'generation', min: 0, max: 100, step: 1 },
    { key: 'max_tokens', label: 'Max tokens', type: 'number', scope: 'generation', min: 0, max: 100000, step: 100 },
    { key: 'effort', label: 'Reasoning effort', type: 'select', scope: 'generation', options: ['', 'none', 'low', 'medium', 'high', 'xhigh', 'max'] },
  ]},
  { key: 'infrastructure', label: 'Infrastructure defaults', fields: [
    { key: 'stream', label: 'Stream', type: 'select', scope: 'infrastructure', options: ['', 'true', 'false'] },
    { key: 'service_tier', label: 'Service tier', type: 'select', scope: 'infrastructure', options: ['', 'auto', 'default', 'flex', 'priority'] },
    { key: 'user_id', label: 'Provider user identifier', type: 'text', scope: 'infrastructure' },
  ]},
  { key: 'aliases', label: 'Model aliases', type: 'json', scope: 'components' },
  { key: 'headers', label: 'Custom request metadata', type: 'json', scope: 'components' },
];

// Which sections the user left open. Server refreshes repaint this page, and
// without this every ten-second poll would collapse the section being edited.
const HARNESS_EXPANDED_KEY = 'freechain.harness.expanded.v1';
const harnessExpansion = (() => {
  let expanded;
  try {
    const parsed = JSON.parse(localStorage.getItem(HARNESS_EXPANDED_KEY) || '[]');
    expanded = new Set(Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string') : []);
  } catch {
    expanded = new Set();
  }
  return {
    isExpanded: (key) => expanded.has(key),
    setExpanded(key, value) {
      if (value) expanded.add(key);
      else expanded.delete(key);
      try { localStorage.setItem(HARNESS_EXPANDED_KEY, JSON.stringify([...expanded].sort())); } catch {}
    },
  };
})();

const presetLibrary = { loaded: false, loading: false, query: '', source: '', component: '', page: null, selected: null, request: 0, pendingTarget: '' };
let editedHarnessId = localStorage.getItem('freechain.harness.editing') || 'default';

const presetSourceLabel = (source) => ({
  cl4r1t4s: 'CL4R1T4S', tweakcc: 'tweakcc', 'claude-code-system-prompts': 'Claude Code system prompts',
  'deepseek-harness': 'DeepSeek Harness',
}[source] || source);

const componentLabel = (key) => HARNESS_COMPONENTS.find((item) => item.key === key)?.label || key;

/** Where this preset will land: an explicit field choice, else its classification. */
const presetTarget = (entry) =>
  presetLibrary.pendingTarget || entry?.suggestedComponent || 'operatingInstructions';

const isMismatched = (entry, target) =>
  Boolean(entry?.suggestedComponent) && entry.suggestedComponent !== target;

/**
 * Applying a Behavioral mode preset to Safety policy is allowed — the
 * classification is a guess from metadata, not a contract — but it is far more
 * often a slip than an intent, so say so plainly before it is applied.
 */
function mismatchNotice(entry, target) {
  if (!isMismatched(entry, target)) return '';
  const guide = HARNESS_GUIDE[target];
  return `<div class="preset-mismatch" role="alert">
      <strong>This preset was not written for ${esc(componentLabel(target))}.</strong>
      <p>FreeChain classified it as <strong>${esc(componentLabel(entry.suggestedComponent))}</strong>. Applying it here puts ${esc(componentLabel(entry.suggestedComponent).toLowerCase())} text into a field the model reads as ${esc(componentLabel(target).toLowerCase())}.</p>
      ${guide?.belongs ? `<p class="preset-mismatch-hint">${esc(componentLabel(target))} expects: ${esc(guide.belongs)}</p>` : ''}
      <p class="preset-mismatch-hint">Switch <em>Apply to</em> back to ${esc(componentLabel(entry.suggestedComponent))}, or continue if you meant it.</p>
    </div>`;
}

function renderPresetLibrary() {
  const root = $('#presetLibrary');
  if (!root) return;
  const page = presetLibrary.page;
  const items = page?.items || [];
  const sourceOptions = (page?.sources || []).map((source) =>
    `<option value="${esc(source.id)}" ${presetLibrary.source === source.id ? 'selected' : ''}>${esc(presetSourceLabel(source.id))} (${source.count})</option>`,
  ).join('');
  const componentOptions = (page?.components || []).map((component) => {
    const label = componentLabel(component.id);
    return `<option value="${esc(component.id)}" ${presetLibrary.component === component.id ? 'selected' : ''}>${esc(label)} (${component.count.toLocaleString()})</option>`;
  }).join('');
  // An empty library is the normal state until the user runs the importer, so
  // say which command fills it rather than implying the search was too narrow.
  const empty = page && !page.sources?.length
    ? '<div class="preset-empty">No presets imported yet. Run <span class="mono">npm run import-presets</span> to fetch them into private app data.</div>'
    : '<div class="preset-empty">No imported presets match this search.</div>';
  const results = presetLibrary.loading
    ? '<div class="preset-empty">Loading imported presets…</div>'
    : items.length
      ? items.map((entry) => `<button class="preset-result ${presetLibrary.selected?.id === entry.id ? 'selected' : ''}" type="button" data-preset-id="${esc(entry.id)}">
          <span><span class="preset-result-title">${esc(entry.title)}</span><span class="preset-result-detail">${esc(entry.description || entry.file)}</span></span>
          <span class="preset-source">${esc(componentLabel(entry.suggestedComponent))} · ${esc(presetSourceLabel(entry.source))}</span>
        </button>`).join('')
      : empty;
  const selected = presetLibrary.selected;
  const mismatch = selected ? isMismatched(selected, presetTarget(selected)) : false;
  const preview = selected ? `<div class="preset-preview">
      <div class="preset-preview-head"><h3>${esc(selected.title)}</h3><span class="preset-count">${selected.content.length.toLocaleString()} characters</span></div>
      <pre>${esc(selected.content.slice(0, 4000))}${selected.content.length > 4000 ? '\n\n[Preview truncated. Applying uses the complete imported preset.]' : ''}</pre>
      <div class="preset-apply">
        <label class="form-field">Apply to<select class="input" data-preset-target>${HARNESS_COMPONENTS.map((component) => `<option value="${component.key}" ${component.key === presetTarget(selected) ? 'selected' : ''}>${esc(component.label)}</option>`).join('')}</select></label>
        <label class="form-field">Mode<select class="input" data-preset-mode><option value="replace">Replace</option><option value="append">Append</option></select></label>
        <button class="btn btn-sm" type="button" data-apply-preset>${mismatch ? 'Apply anyway' : 'Apply preset'}</button>
      </div>
      ${mismatchNotice(selected, presetTarget(selected))}
    </div>` : '';
  root.innerHTML = `<div class="preset-library-head"><h2>Imported preset library</h2><span class="preset-count">${page ? `${page.total.toLocaleString()} matching` : 'Preparing library'}</span></div>
    <p>Presets are inert text. FreeChain classifies likely functions from metadata, then lets you choose the exact component before applying the complete source text.</p>
    <div class="preset-toolbar"><select class="input" aria-label="Preset source" data-preset-source><option value="">All imported sources</option>${sourceOptions}</select><select class="input" aria-label="Harness component" data-preset-component><option value="">All Harness components</option>${componentOptions}</select><input class="input" type="search" placeholder="Search preset names, descriptions, or files" value="${esc(presetLibrary.query)}" data-preset-query /></div>
    <div class="preset-results">${results}</div>${preview}`;
  if (!presetLibrary.loaded && !presetLibrary.loading) void loadPresetEntries();
}

async function loadPresetEntries() {
  const request = ++presetLibrary.request;
  presetLibrary.loading = true;
  renderPresetLibrary();
  const params = new URLSearchParams({ limit: '100' });
  if (presetLibrary.query) params.set('query', presetLibrary.query);
  if (presetLibrary.source) params.set('source', presetLibrary.source);
  if (presetLibrary.component) params.set('component', presetLibrary.component);
  try {
    const page = await api(`/admin/presets?${params}`);
    if (request !== presetLibrary.request) return;
    presetLibrary.page = page;
    presetLibrary.loaded = true;
  } catch (error) {
    if (request === presetLibrary.request) toast(error.message, true);
  } finally {
    if (request === presetLibrary.request) {
      presetLibrary.loading = false;
      renderPresetLibrary();
    }
  }
}

/**
 * Open the shared library scoped to one component. The filter is the whole
 * point: the classifier already knows which component a preset was written
 * for, so browsing from a field should never start from the full corpus.
 */
function browsePresetsFor(componentKey) {
  presetLibrary.component = componentKey;
  presetLibrary.selected = null;
  presetLibrary.pendingTarget = componentKey;
  renderPresetLibrary();
  void loadPresetEntries();
  $('#presetLibrary')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── field guidance ────────────────────────────────────────────────────

/**
 * One shared tooltip node. It auto-dismisses after three seconds so a tooltip
 * can never sit on top of the field it is describing, and any new trigger
 * cancels the pending timer rather than racing it.
 */
const TOOLTIP_MS = 3000;
let tooltipTimer;

function tooltipNode() {
  let node = $('#fieldTooltip');
  if (!node) {
    node = document.createElement('div');
    node.id = 'fieldTooltip';
    node.className = 'field-tooltip';
    node.setAttribute('role', 'tooltip');
    document.body.append(node);
  }
  return node;
}

function hideTooltip() {
  clearTimeout(tooltipTimer);
  const node = $('#fieldTooltip');
  if (node) node.classList.remove('visible');
}

function showTooltip(trigger) {
  const guide = HARNESS_GUIDE[trigger.dataset.tip];
  if (!guide) return;
  const node = tooltipNode();
  node.innerHTML = `<strong>${esc(trigger.dataset.tipLabel || '')}</strong><p>${esc(guide.detail)}</p>`
    + (guide.belongs ? `<p class="tip-belongs"><span>Belongs here</span> ${esc(guide.belongs)}</p>` : '')
    + (guide.avoid ? `<p class="tip-avoid"><span>Not here</span> ${esc(guide.avoid)}</p>` : '');
  node.classList.add('visible');

  // Measure only once visible, then keep the box inside the viewport.
  const box = trigger.getBoundingClientRect();
  const left = Math.min(Math.max(8, box.left), window.innerWidth - node.offsetWidth - 8);
  const below = box.bottom + 8;
  const fitsBelow = below + node.offsetHeight < window.innerHeight - 8;
  node.style.left = `${left}px`;
  node.style.top = `${fitsBelow ? below : Math.max(8, box.top - node.offsetHeight - 8)}px`;

  clearTimeout(tooltipTimer);
  tooltipTimer = setTimeout(hideTooltip, TOOLTIP_MS);
}

document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-tip]');
  if (trigger) { event.preventDefault(); showTooltip(trigger); return; }
  hideTooltip();
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hideTooltip(); });
window.addEventListener('scroll', hideTooltip, { passive: true, capture: true });

/** Label row: name, an info trigger, and for text components, preset access. */
function fieldHeader(field) {
  const guide = HARNESS_GUIDE[field.key];
  if (!guide) return `<label>${esc(field.label)}</label>`;
  const browse = field.scope === 'components' && field.type === 'textarea'
    ? `<button class="harness-presets" type="button" data-browse-presets="${esc(field.key)}">Browse presets</button>`
    : '';
  return `<div class="harness-field-head">
      <label>${esc(field.label)}</label>
      <button class="field-tip" type="button" aria-label="About ${esc(field.label)}" data-tip="${esc(field.key)}" data-tip-label="${esc(field.label)}">i</button>
      ${browse}
    </div>
    <p class="harness-guide">${esc(guide.guide)}</p>`;
}

function editedHarness() {
  return state?.harnesses?.find((harness) => harness.id === editedHarnessId)
    || state?.harnesses?.[0]
    || null;
}

function valueForField(harness, field) {
  if (field.scope === 'components') return harness.components?.[field.key];
  return harness.components?.[field.scope]?.[field.key];
}

function renderHarnessField(harness, field) {
  const value = valueForField(harness, field);
  const attributes = `data-harness-edit data-component-scope="${esc(field.scope)}" data-component-key="${esc(field.key)}"`;
  if (field.type === 'textarea') return `<div class="harness-field">${fieldHeader(field)}<textarea ${attributes}>${esc(value || '')}</textarea></div>`;
  if (field.type === 'select') {
    return `<div class="harness-field">${fieldHeader(field)}<select class="input" ${attributes}>${field.options.map((option) => `<option value="${esc(option)}" ${(value === option || (value === null && option === '')) ? 'selected' : ''}>${esc(option || '(provider default)')}</option>`).join('')}</select></div>`;
  }
  return `<div class="harness-field">${fieldHeader(field)}<input class="input" type="${field.type === 'number' ? 'number' : 'text'}" ${attributes} value="${value !== null && value !== undefined ? esc(value) : ''}" ${field.min !== undefined ? `min="${field.min}"` : ''} ${field.max !== undefined ? `max="${field.max}"` : ''} ${field.step ? `step="${field.step}"` : ''} placeholder="provider default" /></div>`;
}

function renderHarness() {
  if (!state?.harnesses?.length) return;
  if (!state.harnesses.some((harness) => harness.id === editedHarnessId)) editedHarnessId = state.harnesses[0].id;
  const harness = editedHarness();
  if (!harness) return;
  localStorage.setItem('freechain.harness.editing', editedHarnessId);
  const isActive = state.activeHarnessId === harness.id;
  const sections = HARNESS_SECTIONS.map((section) => {
    const expansionKey = `${harness.id}:${section.key}`;
    const expanded = harnessExpansion.isExpanded(expansionKey);
    let bodyHtml;
    if (section.type === 'json') {
      const help = section.key === 'headers' ? '<p class="form-hint">Optional HTTP metadata only. Credential, cookie, host, and connection headers are blocked.</p>' : '';
      bodyHtml = `<div class="harness-field">${fieldHeader({ ...section, label: `${section.label} (JSON object)` })}<textarea class="mono" data-harness-edit data-component-json="${esc(section.key)}" rows="4">${esc(JSON.stringify(harness.components?.[section.key] || {}, null, 2))}</textarea>${help}</div>`;
    } else {
      bodyHtml = section.fields.map((field) => renderHarnessField(harness, field)).join('');
    }
    return `<section class="harness-section"><button class="harness-toggle ${expanded ? 'open' : ''}" type="button" data-toggle="${esc(expansionKey)}" aria-expanded="${expanded}"><h3>${esc(section.label)}</h3>${icon.down}</button><div class="harness-body ${expanded ? '' : 'collapsed'}" data-harness-body="${esc(expansionKey)}">${bodyHtml}</div></section>`;
  }).join('');
  $('#harnessConfig').innerHTML = `<div class="card harness-workspace">
      <div class="harness-workspace-grid"><label class="form-field grow">Editing<select class="input" data-edited-harness>${state.harnesses.map((candidate) => `<option value="${esc(candidate.id)}" ${candidate.id === harness.id ? 'selected' : ''}>${esc(candidate.name)}${candidate.id === state.activeHarnessId ? ' · active' : ''}</option>`).join('')}</select></label><label class="form-field grow">Harness name<input class="input" data-harness-name maxlength="120" value="${esc(harness.name)}" /></label><button class="btn btn-ghost btn-danger" type="button" data-delete-harness ${harness.id === 'default' ? 'disabled' : ''}>Delete</button></div>
      <div class="row-between harness-workspace-meta"><span>${isActive ? 'Applied to every request the access key serves' : 'Not applied — activate it to compose requests with it'}</span><span>Changes save automatically</span></div>
      <div class="row-between harness-workspace-activation"><button class="btn btn-sm" type="button" data-activate-harness ${isActive ? 'disabled' : ''}>${isActive ? 'Active' : 'Make active'}</button><span class="mono">${esc(harness.id)}</span></div>
      <form class="form-row harness-create" data-create-harness><label class="form-field grow">New Harness name<input class="input" name="name" maxlength="120" placeholder="Research with strict citations" required /></label><button class="btn" type="submit">Create Harness</button></form>
    </div>${sections}`;
  renderPresetLibrary();
}

// Toggle harness sections
$('#harnessConfig').addEventListener('click', (e) => {
  const toggle = e.target.closest('.harness-toggle');
  if (!toggle) return;
  const key = toggle.dataset.toggle;
  const body = $(`[data-harness-body="${CSS.escape(key)}"]`, $('#harnessConfig'));
  body.classList.toggle('collapsed');
  toggle.classList.toggle('open');
  toggle.setAttribute('aria-expanded', String(!body.classList.contains('collapsed')));
  harnessExpansion.setExpanded(key, !body.classList.contains('collapsed'));
});

$('#harnessConfig').addEventListener('click', (event) => {
  const browse = event.target.closest('[data-browse-presets]');
  if (!browse) return;
  event.preventDefault();
  browsePresetsFor(browse.dataset.browsePresets);
});

$('#harnessConfig').addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-create-harness]');
  if (!form) return;
  event.preventDefault();
  try {
    const result = await api('/admin/harnesses', { method: 'POST', body: JSON.stringify({ name: new FormData(form).get('name') }) });
    editedHarnessId = result.harness.id;
    presetLibrary.selected = null;
    await refresh();
    toast('Harness created');
  } catch (error) { toast(error.message, true); }
});

$('#harnessConfig').addEventListener('change', (event) => {
  const select = event.target.closest('[data-edited-harness]');
  if (!select) return;
  editedHarnessId = select.value;
  localStorage.setItem('freechain.harness.editing', editedHarnessId);
  presetLibrary.selected = null;
  renderHarness();
});

$('#harnessConfig').addEventListener('click', async (event) => {
  if (!event.target.closest('[data-activate-harness]')) return;
  const harness = editedHarness();
  if (!harness) return;
  try {
    await api('/admin/harnesses/active', { method: 'POST', body: JSON.stringify({ id: harness.id }) });
    await refresh();
    toast(`${harness.name} is now active`);
  } catch (error) { toast(error.message, true); }
});

$('#harnessConfig').addEventListener('click', async (event) => {
  if (!event.target.closest('[data-delete-harness]')) return;
  const harness = editedHarness();
  if (!harness || !confirm(`Delete ${harness.name}?`)) return;
  try {
    await api(`/admin/harnesses/${encodeURIComponent(harness.id)}`, { method: 'DELETE' });
    editedHarnessId = 'default';
    await refresh();
    toast('Harness deleted');
  } catch (error) { toast(error.message, true); }
});

// Save harness on change (debounced)
let harnessDebounce;
$('#harnessConfig').addEventListener('input', (event) => {
  if (!event.target.closest('[data-harness-edit], [data-harness-name]')) return;
  clearTimeout(harnessDebounce);
  harnessDebounce = setTimeout(saveHarness, 800);
});
$('#harnessConfig').addEventListener('change', (event) => {
  if (!event.target.closest('[data-harness-edit], [data-harness-name]')) return;
  clearTimeout(harnessDebounce);
  saveHarness();
});

async function saveHarness() {
  const harness = editedHarness();
  if (!harness) return;
  const components = structuredClone(harness.components || {});
  $$('[data-harness-edit]', $('#harnessConfig')).forEach((el) => {
    if (el.dataset.componentJson) {
      try { components[el.dataset.componentJson] = JSON.parse(el.value); } catch {}
      return;
    }
    const scope = el.dataset.componentScope;
    const field = el.dataset.componentKey;
    let val = el.value;
    if (el.type === 'number') {
      val = val === '' ? null : Number(val);
    } else if (val === '') {
      val = null;
    } else if (val === 'true') {
      val = true;
    } else if (val === 'false') {
      val = false;
    }
    if (scope === 'components') components[field] = val ?? '';
    else {
      if (!components[scope]) components[scope] = {};
      components[scope][field] = val;
    }
  });
  try {
    const result = await api(`/admin/harnesses/${encodeURIComponent(harness.id)}`, {
      method: 'POST',
      body: JSON.stringify({ name: $('[data-harness-name]', $('#harnessConfig')).value, components }),
    });
    const index = state.harnesses.findIndex((candidate) => candidate.id === result.harness.id);
    if (index >= 0) state.harnesses[index] = result.harness;
  } catch (err) {
    toast(err.message, true);
  }
}

let presetSearchDebounce;
$('#presetLibrary').addEventListener('input', (event) => {
  const field = event.target.closest('[data-preset-query]');
  if (!field) return;
  presetLibrary.query = field.value;
  presetLibrary.selected = null;
  clearTimeout(presetSearchDebounce);
  presetSearchDebounce = setTimeout(loadPresetEntries, 180);
});
$('#presetLibrary').addEventListener('change', (event) => {
  const field = event.target.closest('[data-preset-source], [data-preset-component]');
  if (!field) return;
  if (field.matches('[data-preset-source]')) presetLibrary.source = field.value;
  else presetLibrary.component = field.value;
  presetLibrary.selected = null;
  presetLibrary.pendingTarget = '';
  void loadPresetEntries();
});
$('#presetLibrary').addEventListener('change', (event) => {
  if (!event.target.closest('[data-preset-target]')) return;
  presetLibrary.pendingTarget = event.target.value;
  renderPresetLibrary();
});
$('#presetLibrary').addEventListener('click', async (event) => {
  const choice = event.target.closest('[data-preset-id]');
  if (choice) {
    try {
      presetLibrary.selected = await api(`/admin/presets/read?id=${encodeURIComponent(choice.dataset.presetId)}`);
      if (presetLibrary.pendingTarget && presetLibrary.component !== presetLibrary.pendingTarget) presetLibrary.pendingTarget = '';
      renderPresetLibrary();
    } catch (error) { toast(error.message, true); }
    return;
  }
  if (!event.target.closest('[data-apply-preset]') || !presetLibrary.selected) return;
  const target = $('[data-preset-target]', $('#presetLibrary')).value;
  const mode = $('[data-preset-mode]', $('#presetLibrary')).value;
  const current = editedHarness()?.components?.[target];
  if (isMismatched(presetLibrary.selected, target)
    && !confirm(`This preset was classified as ${componentLabel(presetLibrary.selected.suggestedComponent)}, not ${componentLabel(target)}. Apply it to ${componentLabel(target)} anyway?`)) return;
  if (mode === 'replace' && current && !confirm(`Replace the current ${componentLabel(target)}?`)) return;
  try {
    const result = await api('/admin/harness/preset', { method: 'POST', body: JSON.stringify({ harnessId: editedHarnessId, id: presetLibrary.selected.id, target, mode }) });
    const index = state.harnesses.findIndex((harness) => harness.id === result.harness.id);
    if (index >= 0) state.harnesses[index] = result.harness;
    renderHarness();
    toast(`Preset applied to ${result.harness.name}`);
  } catch (error) { toast(error.message, true); }
});

// ── privacy-safe request logs ────────────────────────────────────────

const number = (value) => new Intl.NumberFormat().format(Number(value) || 0);
const duration = (value) => `${number(value)} ms`;

function logTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { day: 'Unknown date', time: '—' };
  return {
    day: date.toLocaleDateString([], { month: 'short', day: 'numeric' }),
    time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

function logBadge(outcome) {
  if (outcome === 'served') return 'badge-ok';
  if (outcome === 'auth-rejected' || outcome === 'rejected') return 'badge-warn';
  if (outcome === 'failed' || outcome === 'client-disconnected') return 'badge-err';
  return '';
}

function logDetailList(entries) {
  return `<dl>${entries
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`)
    .join('')}</dl>`;
}

function renderLogRecord(record) {
  const timestamp = logTimestamp(record.startedAt);
  const usage = record.result?.usage;
  const provider = record.served?.provider || record.attempts?.at(-1)?.provider || 'not reached';
  const model = record.served?.model || record.request?.model || '—';
  const app = record.client?.reportedApp || record.client?.sdk?.language || 'unreported';
  const roles = Object.entries(record.request?.inputSummary?.roles || {})
    .map(([role, count]) => `${role} ${count}`)
    .join(', ') || '—';
  const attempts = record.attempts?.length
    ? record.attempts.map((attempt, index) => `<span class="log-attempt"><strong>${index + 1}</strong> ${esc(attempt.provider || 'unknown')} · ${esc(attempt.model || 'unknown')} · ${esc(attempt.outcome || 'unknown')} · ${duration(attempt.ms)}</span>`).join('')
    : '<span class="log-attempt">No provider attempt</span>';
  const cooling = record.cooling?.candidates?.length
    ? record.cooling.candidates.map((candidate) => `${candidate.id} (${candidate.secondsRemaining}s)`).join(', ')
    : 'None';
  const error = record.error
    ? logDetailList([
        ['Code', record.error.code],
        ['Category', record.error.category],
        ['Gateway HTTP', record.error.httpStatus],
        ['Provider HTTP', record.error.providerStatus],
        ['Retryable', record.error.retryable === true ? 'yes' : record.error.retryable === false ? 'no' : undefined],
      ])
    : '<dl><dt>Error</dt><dd>None</dd></dl>';

  return `<details class="log-record" data-request-id="${esc(record.id)}">
    <summary class="log-record-summary">
      <span class="log-cell log-time">${esc(timestamp.time)}<small>${esc(timestamp.day)} · ${esc(record.id)}</small></span>
      <span class="log-cell log-outcome"><span class="badge ${logBadge(record.outcome)}"><span class="dot"></span>${esc(record.outcome || 'unknown')}</span></span>
      <span class="log-cell log-app" title="${esc(app)}">${esc(app)}</span>
      <span class="log-cell log-route"><strong>${esc(record.route || '—')}</strong><small>${esc(record.method || '—')} · ${esc(model)}</small></span>
      <span class="log-cell log-provider" title="${esc(provider)}">${esc(provider)}<small>${record.attempts?.length || 0} attempt(s)</small></span>
      <span class="log-cell log-duration">${duration(record.durationMs)}</span>
      <span class="log-cell log-tokens ${usage?.source || ''}">${usage ? number(usage.totalTokens) : '—'}<small>${esc(usage?.source || '')}</small></span>
      <span class="log-chevron" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></span>
    </summary>
    <div class="log-detail">
      <section class="log-detail-group"><h3>Request</h3>${logDetailList([
        ['Request ID', record.id],
        ['Route', `${record.method || '—'} ${record.route || '—'}`],
        ['Model', record.request?.model],
        ['Streaming', record.request?.stream === true ? 'yes' : record.request?.stream === false ? 'no' : undefined],
        ['Messages', record.request?.inputSummary?.messageCount],
        ['Roles', roles],
        ['Input characters', record.request?.inputSummary?.inputChars],
        ['Tools', record.request?.inputSummary?.toolCount],
        ['Requested max tokens', record.request?.inputSummary?.maxTokens],
        ['Prompt summary', record.request?.inputSummary?.promptSummary?.map((item) => `${item.role}: ${item.summary}`).join(' | ')],
        ['Input summary', typeof record.request?.inputSummary === 'string' ? record.request.inputSummary : undefined],
      ])}</section>
      <section class="log-detail-group"><h3>Result and usage</h3>${logDetailList([
        ['HTTP status', record.status],
        ['Outcome', record.outcome],
        ['Served by', record.served ? `${record.served.provider} / ${record.served.model} / key ${record.served.keyIndex}` : 'not served'],
        ['Choices', record.result?.choiceCount],
        ['Finish reasons', record.result?.finishReasons?.join(', ')],
        ['Output characters', record.result?.outputChars],
        ['Output bytes', record.result?.outputBytes],
        ['Input tokens', usage?.inputTokens],
        ['Output tokens', usage?.outputTokens],
        ['Total tokens', usage?.totalTokens],
        ['Usage source', usage?.source],
      ])}</section>
      <section class="log-detail-group"><h3>Client and lifecycle</h3>${logDetailList([
        ['Reported app', record.client?.reportedApp || 'unreported'],
        ['Reported session', record.client?.sessionId || 'unreported'],
        ['Network', record.client?.remoteCategory],
        ['SDK', record.client?.sdk ? `${record.client.sdk.language || ''} ${record.client.sdk.packageVersion || ''}`.trim() : 'unreported'],
        ['Runtime', record.client?.sdk ? `${record.client.sdk.runtime || ''} ${record.client.sdk.runtimeVersion || ''}`.trim() : 'unreported'],
        ['Auth', record.auth?.result],
        ['Duration', duration(record.durationMs)],
        ['Cooling after request', cooling],
        ['Audit action', record.audit?.action],
      ])}</section>
      <section class="log-detail-group wide"><h3>Attempt trail</h3><div class="log-attempts">${attempts}</div></section>
      <section class="log-detail-group wide"><h3>Error classification</h3>${error}</section>
    </div>
  </details>`;
}

function renderLogs(page) {
  const { summary, items } = page;
  const rows = $('#logRows');
  const openRequestIds = new Set($$('details.log-record[open]', rows).map((record) => record.dataset.requestId));
  const scrollY = window.scrollY;
  $('#logSummary').innerHTML = `
    <article class="stat"><div class="stat-label">Matching records</div><div class="stat-value">${number(summary.total)}</div><div class="stat-sub">newest first, up to 500 retained</div></article>
    <article class="stat"><div class="stat-label">Tokens observed</div><div class="stat-value">${number(summary.totalTokens)}</div><div class="stat-sub">${number(summary.exactRecords)} exact · ${number(summary.estimatedRecords)} estimated</div></article>
    <article class="stat"><div class="stat-label">Average latency</div><div class="stat-value">${number(summary.averageDurationMs)}<small> ms</small></div><div class="stat-sub">terminal gateway duration</div></article>
    <article class="stat"><div class="stat-label">Cooling involved</div><div class="stat-value">${number(summary.coolingRecords)}</div><div class="stat-sub">records ending with cooling candidates</div></article>`;
  rows.setAttribute('aria-busy', 'false');
  rows.classList.toggle('hidden', items.length === 0);
  $('#logEmpty').classList.toggle('hidden', items.length !== 0);
  rows.innerHTML = items.length ? `
    <div class="log-table-head" role="row"><span>Time / request</span><span>Outcome</span><span>App</span><span>Route / model</span><span>Provider</span><span style="text-align:right">Latency</span><span style="text-align:right">Tokens</span><span></span></div>
    ${items.map(renderLogRecord).join('')}` : '';
  $$('details.log-record', rows).forEach((record) => {
    if (openRequestIds.has(record.dataset.requestId)) record.open = true;
  });
  requestAnimationFrame(() => window.scrollTo(0, scrollY));
}

function updateLogStatus() {
  if (!$('#page-logs').classList.contains('active') || !logsLastUpdatedAt) return;
  const seconds = Math.max(0, Math.ceil((logsNextRefreshAt - Date.now()) / 1000));
  const age = Math.max(0, Math.round((Date.now() - logsLastUpdatedAt) / 1000));
  if (logsPaused) {
    $('#logStatus').textContent = `Paused · ${logsPage?.summary?.total || 0} matching · last updated ${age}s ago`;
    return;
  }
  $('#logStatus').textContent = logsStale
    ? `Stale snapshot · last updated ${age}s ago · retrying in ${seconds}s`
    : `Live while open · ${logsPage?.summary?.total || 0} matching · next refresh in ${seconds}s`;
}

async function fetchLogs(params) {
  let key = await ensureKeyLoaded();
  let response = await fetch(`/v1/logs?${params}`, { headers: { Authorization: `Bearer ${key}` } });
  if (response.status === 401) {
    accessKeyValue = null;
    key = await ensureKeyLoaded();
    response = await fetch(`/v1/logs?${params}`, { headers: { Authorization: `Bearer ${key}` } });
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
  return body;
}

async function refreshLogs() {
  if (logsLoading) return;
  logsLoading = true;
  $('#btnLogsRefresh').disabled = true;
  if (!logsPage) {
    $('#logRows').classList.remove('hidden');
    $('#logRows').setAttribute('aria-busy', 'true');
    $('#logStatus').textContent = 'Loading the local journal…';
  }
  const query = new URLSearchParams({ limit: '100' });
  const fields = new FormData($('#logFilters'));
  for (const [name, value] of fields) if (String(value).trim()) query.set(name, String(value).trim());
  try {
    logsPage = await fetchLogs(query);
    logsLastUpdatedAt = Date.now();
    logsNextRefreshAt = Date.now() + 10_000;
    logsStale = false;
    $('#logError').classList.add('hidden');
    renderLogs(logsPage);
    updateLogStatus();
  } catch (err) {
    logsStale = Boolean(logsPage);
    logsNextRefreshAt = Date.now() + 10_000;
    $('#logErrorMessage').textContent = logsPage ? err.message : `${err.message} No records are displayed.`;
    $('#logError').classList.remove('hidden');
    $('#logStatus').textContent = logsPage ? 'Stale snapshot · automatic retry remains active' : 'Journal unavailable · automatic retry remains active';
    if (!logsPage) {
      $('#logRows').classList.add('hidden');
      $('#logEmpty').classList.remove('hidden');
    }
  } finally {
    logsLoading = false;
    $('#btnLogsRefresh').disabled = false;
  }
}

$('#btnLogsRefresh').addEventListener('click', refreshLogs);
$('#btnLogsPause').addEventListener('click', () => {
  logsPaused = !logsPaused;
  $('#btnLogsPause').setAttribute('aria-pressed', String(logsPaused));
  $('#btnLogsPause').textContent = logsPaused ? 'Resume live' : 'Pause live';
  updateLogStatus();
  if (!logsPaused) refreshLogs();
});
$('#btnLogsClear').addEventListener('click', () => {
  $('#logFilters').reset();
  refreshLogs();
});
let logFilterTimer;
$('#logFilters').addEventListener('input', () => {
  clearTimeout(logFilterTimer);
  logFilterTimer = setTimeout(refreshLogs, 250);
});
$('#logFilters').addEventListener('change', refreshLogs);

// ── access key ────────────────────────────────────────────────────────

const MASK = '••••••••••••••••••••••••';

/** Fetch the real access key once and cache it in memory; never persisted beyond the page's lifetime. */
async function ensureKeyLoaded() {
  if (accessKeyValue) return accessKeyValue;
  const { key } = await api('/admin/access-key');
  accessKeyValue = key;
  return key;
}

/** Sync the access-key field, eye icon, and connection snippet to the current `revealed` flag. */
function applyReveal() {
  const field = $('#accessKey');
  field.value = revealed ? accessKeyValue : MASK;
  field.type = revealed ? 'text' : 'password';
  $('#eyeOpen').classList.toggle('hidden', revealed);
  $('#eyeShut').classList.toggle('hidden', !revealed);
  $('#revealLabel').textContent = revealed ? 'Hide' : 'Show';
  renderSnippet();
}

// Fetching the key is async, so the flag is flipped only after the await and
// concurrent clicks are dropped. Toggling state before awaiting would let a
// fast second click apply its DOM update first and leave the two disagreeing.
let toggling = false;
$('#btnReveal').addEventListener('click', async () => {
  if (toggling) return;
  toggling = true;
  try {
    const next = !revealed;
    if (next) await ensureKeyLoaded();
    revealed = next;
    applyReveal();
  } catch (err) {
    toast(err.message, true);
  } finally {
    toggling = false;
  }
});

$('#btnCopyKey').addEventListener('click', async () => copy(await ensureKeyLoaded(), 'Access key copied'));

$('#btnRotate').addEventListener('click', async () => {
  if (!confirm('Rotate the access key?\n\nEvery app using the current key stops working until you paste the new one.')) return;
  const { key } = await api('/admin/access-key/rotate', { method: 'POST' });
  accessKeyValue = key;
  applyReveal();
  toast('Access key rotated');
});

// ── snippets ──────────────────────────────────────────────────────────

let activeSnippet = 'ui';
$$('#snippetTabs .tab').forEach((tab) =>
  tab.addEventListener('click', () => {
    activeSnippet = tab.dataset.snip;
    $$('#snippetTabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
    renderSnippet();
  })
);

/** Render the connect-an-app code sample for whichever tab is active, substituting the real key only when revealed. */
function renderSnippet() {
  // The literal key is only substituted once revealed, so a screenshot of the
  // default view never leaks it.
  const key = revealed && accessKeyValue ? accessKeyValue : 'YOUR_ACCESS_KEY';
  const base = `${ORIGIN}/v1`;
  const c = (s) => `<span class="c">${esc(s)}</span>`;
  const k = (s) => `<span class="k">${esc(s)}</span>`;
  const s = (t) => `<span class="s">${esc(t)}</span>`;

  const snippets = {
    curl: `curl ${esc(base)}/chat/completions \\
  -H ${s(`"Authorization: Bearer ${key}"`)} \\
  -H ${s('"Content-Type: application/json"')} \\
  -H ${s('"X-FreeChain-App: My App"')} \\
  -H ${s('"X-FreeChain-Session-Id: optional-session-id"')} \\
  -d ${s(`'{"model":"auto","messages":[{"role":"user","content":"hello"}]}'`)}`,

    python: `${k('from')} openai ${k('import')} OpenAI

client = OpenAI(
    base_url=${s(`"${base}"`)},
    api_key=${s(`"${key}"`)},
    default_headers={${s('"X-FreeChain-App"')}: ${s('"My App"')}},
)

r = client.chat.completions.create(
    model=${s('"auto"')},   ${c('# let the chain choose')}
    messages=[{${s('"role"')}: ${s('"user"')}, ${s('"content"')}: ${s('"hello"')}}],
)
${k('print')}(r.choices[0].message.content)`,

    node: `${k('import')} OpenAI ${k('from')} ${s("'openai'")};

${k('const')} client = ${k('new')} OpenAI({
  baseURL: ${s(`'${base}'`)},
  apiKey: ${s(`'${key}'`)},
  defaultHeaders: { ${s("'X-FreeChain-App'")}: ${s("'My App'")} },
});

${k('const')} r = ${k('await')} client.chat.completions.create({
  model: ${s("'auto'")},
  messages: [{ role: ${s("'user'")}, content: ${s("'hello'")} }],
});
console.log(r.choices[0].message.content);`,

    env: `${c('# Most tools read these directly.')}
OPENAI_BASE_URL=${esc(base)}
OPENAI_API_KEY=${esc(key)}

${c('# Some expect the older name:')}
OPENAI_API_BASE=${esc(base)}`,

    ui: `${c('Any editor assistant or GUI with a custom OpenAI endpoint:')}

  Provider    OpenAI compatible ${c('(or "OpenRouter" — same wire format)')}
  Base URL    ${esc(base)}
  API key     ${esc(key)}
  Model       auto

${c('"auto" walks the whole chain. Naming a specific model from the')}
${c('Chain page pins it to links serving that model.')}`,
  };

  $('#snippet').innerHTML = snippets[activeSnippet];
}

// ── Start Menu shortcut ───────────────────────────────────────────────
// Windows exe/zip release only. Checked once at boot, not on every 10s
// refresh — the answer only changes because of an action taken right here.

/** Show the Start Menu banner only when eligible, not already created, and not yet answered. */
async function loadShortcutPrompt() {
  let status;
  try {
    status = await api('/admin/shortcut');
  } catch {
    return; // older server, or the route is unreachable — just stay hidden
  }
  const show = status.eligible && !status.exists && !status.state;
  $('#shortcutPrompt').classList.toggle('hidden', !show);
}

$('#btnShortcutCreate').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    await api('/admin/shortcut/create', { method: 'POST' });
    $('#shortcutPrompt').classList.add('hidden');
    toast('Shortcut added to the Start Menu');
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

$('#btnShortcutDismiss').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    await api('/admin/shortcut/dismiss', { method: 'POST' });
    $('#shortcutPrompt').classList.add('hidden');
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

async function loadOperatorAppearance() {
  try {
    const res = await fetch('/admin/operator/settings'); if (!res.ok) return; const settings = await res.json(); const ui = settings.ui || {};
    const theme = ui.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : (ui.theme || 'dark');
    document.documentElement.dataset.operatorTheme = theme; document.documentElement.dataset.operatorFont = ui.fontFamily || 'system'; document.documentElement.dataset.operatorDensity = ui.density || 'comfortable'; document.documentElement.style.setProperty('--operator-scale', Number(ui.fontScale) || 1);
    renderRetentionNotice(settings.logs || {});
  } catch {}
}

/**
 * Warn on the Logs page only when there is something to warn about.
 *
 * The retention switches live on Chat -> Settings, so this page cannot state a
 * fixed guarantee. In the shipped metadata-only posture it says nothing at all;
 * the moment some form of caller content is being written it says so, because a
 * silent Logs page is exactly how a forgotten debugging switch survives.
 */
function renderRetentionNotice(logs) {
  const node = $('#logRetentionNotice');
  const callout = $('#logRetentionCallout');
  if (!node || !callout) return;
  const on = [];
  if (logs.rawPrompts) on.push('prompts');
  if (logs.rawResponses) on.push('responses');
  if (logs.rawToolBodies) on.push('tool bodies');

  if (!logs.credentials && !on.length && !logs.promptSummary) {
    callout.classList.add('hidden');
    node.textContent = '';
    return;
  }

  const parts = [];
  if (on.length) parts.push(`raw ${on.join(', ')} verbatim`);
  if (logs.credentials) parts.push('presented access keys in clear text');
  if (logs.promptSummary) parts.push('bounded redacted prompt summaries');
  callout.classList.remove('hidden');
  node.innerHTML = `<strong>Retention is on.</strong> This journal is storing ${parts.join(', and ')}. `
    + 'Anyone who can read the journal file can read that content. Turn it off under '
    + '<span class="mono">Chat &rarr; Settings</span> and clear the log when you are done.';
}

// ── boot ──────────────────────────────────────────────────────────────

/**
 * Re-fetch server state and repaint every page from it. The single source of
 * truth for the whole dashboard.
 *
 * `preserveHarnessEditor` exists because the ten-second poll would otherwise
 * replace the textarea being typed into: the Harness page repaints from server
 * state, so a background refresh mid-edit would discard the caret and any
 * characters not yet debounced to the server.
 */
async function refresh({ preserveHarnessEditor = false } = {}) {
  state = await api('/admin/state');
  renderOverview();
  renderProviders();
  renderChain();
  if (!preserveHarnessEditor) renderHarness();
  renderSnippet();
  $('#serverDot').style.color = 'var(--success)';
  $('#serverStatus').textContent = `running · ${state.stats.uptimeSeconds}s`;
}

loadOperatorAppearance();
refresh().catch((err) => {
  $('#serverDot').style.color = 'var(--danger)';
  $('#serverStatus').textContent = 'unreachable';
  toast(err.message, true);
});
loadShortcutPrompt();

setInterval(() => {
  refresh({ preserveHarnessEditor: $('#page-harness').classList.contains('active') }).catch(() => {});
  if ($('#page-logs').classList.contains('active') && !logsPaused) refreshLogs();
}, 10_000);
setInterval(updateLogStatus, 1_000);
