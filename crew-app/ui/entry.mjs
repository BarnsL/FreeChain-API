import React, { useEffect, useRef, useState } from 'react';
import { useAppApi } from '@kirocrew/app-sdk';
import markup from 'freechain:markup';
import css from 'freechain:css';
import { mount as dashboard } from 'freechain:app';
import { mount as operator } from 'freechain:operator';
import { mount as guide } from 'freechain:guide';

const h = React.createElement;
const theme = {
  '--fc-bg': 'var(--bg)', '--fc-text': 'var(--text)', '--fc-card': 'var(--card)',
  '--fc-muted': 'var(--text-muted, var(--muted))', '--fc-border': 'var(--border)',
  '--fc-accent': 'var(--accent)', '--fc-accent-fg': 'var(--accent-fg, var(--bg))',
  '--fc-hover': 'var(--bg-hover, var(--bg))', '--fc-ok': 'var(--ok)',
  '--fc-warn': 'var(--warn)', '--fc-danger': 'var(--danger)',
  '--fc-font': 'var(--font-body)', '--fc-mono': 'var(--mono)',
  height: '100%', minHeight: 0, minWidth: 0, flex: '1 1 auto', display: 'flex',
};

export function mountDashboard(root, api, endpoint) {
  const lifetime = new AbortController();
  const intervals = new Set(); const timeouts = new Set(); const frames = new Set();
  const scopedDocument = {
    body: root, documentElement: root,
    querySelector: selector => root.querySelector(selector),
    querySelectorAll: selector => root.querySelectorAll(selector),
    getElementById: id => root.querySelector(`#${CSS.escape(id)}`),
    createElement: tag => document.createElement(tag),
    addEventListener: (name, callback, options = {}) => root.addEventListener(name, callback, { ...(typeof options === 'object' ? options : { capture: options }), signal: lifetime.signal }),
  };
  const localWindow = { freechainGuide: undefined };
  const scopedWindow = new Proxy(localWindow, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'scrollY') return root.scrollTop;
      if (key === 'scrollTo') return (...args) => root.scrollTo(...args);
      if (key === 'addEventListener') return (name, callback, options = {}) => root.addEventListener(name, callback, { ...(typeof options === 'object' ? options : { capture: options }), signal: lifetime.signal });
      const value = window[key]; return typeof value === 'function' ? value.bind(window) : value;
    },
  });
  const fetch = async (route, options = {}) => {
    if (lifetime.signal.aborted) throw new DOMException('Unmounted', 'AbortError');
    if (!/^\/(admin|v1)\//.test(route)) throw new Error('Unsupported FreeChain route.');
    const method = (options.method || 'GET').toLowerCase();
    const target = `/apps/freechain/api${route}`;
    try {
      const data = await api[method === 'delete' ? 'del' : method](target, method === 'get' ? { signal: lifetime.signal } : options.body ? JSON.parse(options.body) : undefined);
      if (lifetime.signal.aborted) throw new DOMException('Unmounted', 'AbortError');
      return new Response(JSON.stringify(data), { status: 200 });
    } catch (error) {
      if (lifetime.signal.aborted) throw error;
      return new Response(JSON.stringify({ error: { message: error.message } }), { status: 502 });
    }
  };
  const context = {
    document: scopedDocument, window: scopedWindow, location: { origin: endpoint.replace(/\/v1$/, '') }, fetch,
    localStorage: { getItem: key => localStorage.getItem(`crew.${key}`), setItem: (key, value) => localStorage.setItem(`crew.${key}`, value) },
    setInterval: (callback, delay) => { const id = window.setInterval(callback, delay); intervals.add(id); return id; },
    clearInterval: id => { window.clearInterval(id); intervals.delete(id); },
    setTimeout: (callback, delay) => { const id = window.setTimeout(() => { timeouts.delete(id); if (!lifetime.signal.aborted) callback(); }, delay); timeouts.add(id); return id; },
    clearTimeout: id => { window.clearTimeout(id); timeouts.delete(id); },
    requestAnimationFrame: callback => { const id = window.requestAnimationFrame(() => { frames.delete(id); if (!lifetime.signal.aborted) callback(); }); frames.add(id); return id; },
  };
  guide(context); dashboard(context); operator(context);
  for (const id of ['opTheme', 'opFont']) {
    const field = root.querySelector(`#${id}`);
    if (field) { field.disabled = true; field.title = 'Appearance follows the active Crew theme.'; }
  }
  const note = document.createElement('p');
  note.className = 'crew-theme-note'; note.textContent = 'Colors and fonts follow your active Crew theme.';
  root.querySelector('#opTheme')?.closest('label')?.parentElement?.append(note);
  return () => {
    lifetime.abort();
    intervals.forEach(id => window.clearInterval(id)); timeouts.forEach(id => window.clearTimeout(id)); frames.forEach(id => window.cancelAnimationFrame(id));
    root.replaceChildren();
  };
}

export default function FreeChainApp() {
  const api = useAppApi(); const root = useRef(null);
  const [error, setError] = useState(''); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false; let cleanup;
    setError('');
    api.get('/apps/freechain/api/runtime').then(runtime => {
      if (cancelled) return;
      root.current.innerHTML = `<style>${css}</style>${markup}`;
      cleanup = mountDashboard(root.current, api, runtime.endpoint);
    }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; cleanup?.(); };
  }, [api, attempt]);
  return h('div', { className: 'freechain-host', style: theme },
    error ? h('div', { role: 'alert', style: { padding: 24 } }, h('h2', null, 'FreeChain could not connect'), h('p', null, error), h('p', null, 'Check that FreeChain is enabled in Crew Library.'), h('button', { onClick: () => setAttempt(n => n + 1) }, 'Retry')) : null,
    h('div', { ref: root, className: 'freechain-crew', style: { display: error ? 'none' : 'block', flex: 1, minWidth: 0, overflow: 'auto' } }, h('p', { role: 'status', style: { padding: 24 } }, 'Connecting to FreeChain…')));
}
