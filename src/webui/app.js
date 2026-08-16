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

// ── helpers ───────────────────────────────────────────────────────────

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

let toastTimer;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('err', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
}

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

function goto(page) {
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${page}`));
  $$('.nav-item[data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  window.scrollTo(0, 0);
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
      return `<div class="stat">
        <div class="row-between">
          <div class="stat-label">${esc(p.label)}</div>
          <span class="badge ${ok ? 'badge-ok' : ''}"><span class="dot"></span>${ok ? 'ready' : 'no key'}</span>
        </div>
        <div class="stat-value" style="font-size:22px">${p.totalKeys || (p.keyOptional ? '—' : 0)}</div>
        <div class="stat-sub">${p.totalKeys ? `${p.totalKeys} key(s) across ${p.activeSlots} slot(s)` : p.keyOptional ? 'no key required' : 'awaiting a key'} · ${p.modelCount} model(s)</div>
      </div>`;
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
    body: JSON.stringify({ slot: slotId, keys: [...slot.keys.map((k) => ` keep:${k.index}`), value] }),
  });
  input.value = '';
  await refresh();
  toast('Key added');
}

async function deleteKey(slotId, index) {
  const provider = state.providers.find((p) => p.slots.some((s) => s.id === slotId));
  const slot = provider.slots.find((s) => s.id === slotId);
  const keep = slot.keys.filter((k) => k.index !== Number(index)).map((k) => ` keep:${k.index}`);

  await api('/admin/keys', { method: 'POST', body: JSON.stringify({ slot: slotId, keys: keep }) });
  await refresh();
  toast('Key removed');
}

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

// ── access key ────────────────────────────────────────────────────────

const MASK = '••••••••••••••••••••••••';

async function ensureKeyLoaded() {
  if (accessKeyValue) return accessKeyValue;
  const { key } = await api('/admin/access-key');
  accessKeyValue = key;
  return key;
}

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
  -d ${s(`'{"model":"auto","messages":[{"role":"user","content":"hello"}]}'`)}`,

    python: `${k('from')} openai ${k('import')} OpenAI

client = OpenAI(
    base_url=${s(`"${base}"`)},
    api_key=${s(`"${key}"`)},
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

// ── boot ──────────────────────────────────────────────────────────────

async function refresh() {
  state = await api('/admin/state');
  renderOverview();
  renderProviders();
  renderChain();
  renderSnippet();
  $('#serverDot').style.color = 'var(--success)';
  $('#serverStatus').textContent = `running · ${state.stats.uptimeSeconds}s`;
}

refresh().catch((err) => {
  $('#serverDot').style.color = 'var(--danger)';
  $('#serverStatus').textContent = 'unreachable';
  toast(err.message, true);
});

setInterval(() => refresh().catch(() => {}), 10_000);
