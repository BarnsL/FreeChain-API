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

/** Paint the Model sources page: one card per provider family, one row per account slot. */
function renderProviders() {
  $('#providerList').innerHTML = state.providers
    .map((p) => {
      const slots = p.slots
        .map((s) => {
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
        })
        .join('');

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

// ── boot ──────────────────────────────────────────────────────────────

/** Re-fetch server state and repaint every page from it. The single source of truth for the whole dashboard. */
async function refresh() {
  state = await api('/admin/state');
  renderOverview();
  renderProviders();
  renderChain();
  renderSnippet();
  const journal = state.journal || {};
  const rotation = Number(journal.rotateAtBytes) / (1024 * 1024);
  $('#logStorage').textContent = journal.persistence === 'persistent'
    ? `Storage: persistent private JSONL · ${number(journal.maxEntries)} in memory · rotates at ${number(rotation)} MiB + ${number(journal.predecessors)} predecessor. Restart with --no-log for memory only, or --log <path> for another private location.`
    : `Storage: memory only · ${number(journal.maxEntries)} retained for this process. Restart without --no-log to restore private JSONL persistence.`;
  $('#serverDot').style.color = 'var(--success)';
  $('#serverStatus').textContent = `running · ${state.stats.uptimeSeconds}s`;
}

refresh().catch((err) => {
  $('#serverDot').style.color = 'var(--danger)';
  $('#serverStatus').textContent = 'unreachable';
  toast(err.message, true);
});
loadShortcutPrompt();

setInterval(() => {
  refresh().catch(() => {});
  if ($('#page-logs').classList.contains('active') && !logsPaused) refreshLogs();
}, 10_000);
setInterval(updateLogStatus, 1_000);
