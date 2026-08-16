// The failover walk.
//
// One request enters; candidates are tried in order until one answers.
// A candidate is a (chain link × account slot × key) triple, so a link whose
// provider has three accounts of two keys each gives six chances before the
// chain moves on — a rate limit is usually per-account, not per-provider.
//
// Which failures advance and which stop is the whole design: advancing on a
// client's own malformed request would burn every provider on an error that
// none of them can fix.

import { resolveAccounts } from './config.js';

/**
 * Thrown when `dispatch()` gives up: every candidate was tried (or the first
 * one hit a fatal, non-retryable status) and none answered. `attempts` is the
 * full per-candidate trail so the server can report it without re-deriving
 * it, and `server.js` maps this straight to an HTTP 502.
 */
export class ChainError extends Error {
  constructor(message, attempts) {
    super(message);
    this.name = 'ChainError';
    this.attempts = attempts;
  }
}

// Per-candidate failure memory, so a rate-limited account is skipped for a
// while instead of being retried on every single request.
export class Cooldowns {
  constructor(cooldownMs) {
    this.cooldownMs = cooldownMs;
    this.until = new Map();
    this.lastError = new Map();
  }
  /** Skip this candidate for `retryAfterMs` (or the default cooldown), remembering why. */
  penalise(id, reason, retryAfterMs) {
    this.until.set(id, Date.now() + (retryAfterMs ?? this.cooldownMs));
    this.lastError.set(id, reason);
  }
  /** Make a candidate immediately eligible again, e.g. after it answers successfully. */
  clear(id) {
    this.until.delete(id);
    this.lastError.delete(id);
  }
  /** Whether this candidate is currently being skipped. Expired entries clean themselves up. */
  isCooling(id) {
    const t = this.until.get(id);
    if (t === undefined) return false;
    if (Date.now() >= t) {
      this.until.delete(id);
      return false;
    }
    return true;
  }
  /** Every candidate currently cooling, for the dashboard's "Cooling off" table. */
  snapshot() {
    const now = Date.now();
    return [...this.until.entries()].map(([id, t]) => ({
      id,
      secondsRemaining: Math.max(0, Math.round((t - now) / 1000)),
      lastError: this.lastError.get(id) || null,
    }));
  }
}

// 400 and 422 mean the request itself is wrong — every candidate would reject
// it identically, so fail immediately and report it honestly. Everything else
// (auth, rate limit, server error, network) belongs to that candidate, not the
// caller, so move on.
const FATAL_STATUS = new Set([400, 422]);

// OmniRoute uses a 400 wrapper when its own candidate pool is exhausted. The
// request is valid, so let the outer FreeChain chain try its next provider.
// A normal OmniRoute 400 remains fatal; only its diagnostic pool envelope gets
// this treatment.
const isOmniRoutePoolFailure = (link, status, detail) =>
  link.provider === 'omniroute' &&
  status === 400 &&
  /"diagnostics"\s*:\s*\{/.test(detail);

/** Parse a `Retry-After` header (seconds or an HTTP date) into a millisecond delay, capped at 5 minutes. */
function retryAfterMs(res) {
  const raw = res.headers.get('retry-after');
  if (!raw) return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.min(secs * 1000, 300_000);
  const when = Date.parse(raw);
  return Number.isFinite(when) ? Math.max(0, when - Date.now()) : undefined;
}

/**
 * Expand the chain into (link, account slot, key) candidates.
 * Credentials are read fresh each call so a .env edit takes effect without a
 * restart. `keyIndex` counts keys within one account slot, so it stays a
 * meaningful ordinal when several slots are configured.
 */
export function candidatesFor(chain, requestedModel) {
  const wanted = requestedModel && requestedModel !== 'auto' ? requestedModel : null;
  const out = [];

  for (const link of chain.links) {
    if (wanted && link.model !== wanted && `${link.provider}/${link.model}` !== wanted) continue;

    const accounts = resolveAccounts(link.provider);
    if (accounts.length) {
      const perSlot = new Map();
      for (const { provider, key } of accounts) {
        const keyIndex = perSlot.get(provider) ?? 0;
        perSlot.set(provider, keyIndex + 1);
        out.push({
          link,
          provider,
          key,
          keyIndex,
          id: `${link.index}:${provider}:${keyIndex}`,
        });
      }
    } else if (link.keyOptional) {
      out.push({
        link,
        provider: link.provider,
        key: null,
        keyIndex: 0,
        id: `${link.index}:${link.provider}:0`,
      });
    }
  }
  return out;
}

/**
 * Try each candidate until one responds.
 * `onAttempt` receives every attempt so callers can log or surface them.
 * Returns { response, link, provider, keyIndex, attempts }, where `provider` is
 * the account slot that answered. `response` is a live Response.
 */
export async function dispatch(chain, cooldowns, body, { signal, onAttempt } = {}) {
  const candidates = candidatesFor(chain, body.model);
  const attempts = [];

  if (!candidates.length) {
    throw new ChainError(
      body.model && body.model !== 'auto'
        ? `No chain link serves model "${body.model}" with a configured credential.`
        : 'No chain link has a configured credential. Set provider keys in .env or the environment.',
      attempts
    );
  }

  // Cooling candidates go to the back rather than being dropped: if every
  // account is rate-limited, a stale one beats returning nothing at all.
  const ready = candidates.filter((c) => !cooldowns.isCooling(c.id));
  const cooling = candidates.filter((c) => cooldowns.isCooling(c.id));
  const limit = chain.settings.maxAttempts ?? candidates.length;
  const order = [...ready, ...cooling].slice(0, limit);

  for (const cand of order) {
    const { link, provider, key, keyIndex } = cand;
    const started = Date.now();
    const timeout = AbortSignal.timeout(chain.settings.requestTimeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    const record = (outcome, detail) => {
      const attempt = {
        provider, // the account slot that was tried, e.g. "openrouter2"
        model: link.model,
        keyIndex,
        outcome,
        detail,
        ms: Date.now() - started,
      };
      attempts.push(attempt);
      onAttempt?.(attempt);
    };

    let res;
    try {
      res = await fetch(`${link.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: combined,
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
          ...link.headers,
        },
        // The caller's model name is replaced by this link's own model id.
        body: JSON.stringify({ ...body, model: link.model }),
      });
    } catch (err) {
      if (signal?.aborted) throw err; // client hung up; stop walking
      cooldowns.penalise(cand.id, `network: ${err.message}`);
      record('network-error', err.message);
      continue;
    }

    if (res.ok) {
      cooldowns.clear(cand.id);
      record('ok', `${res.status}`);
      return { response: res, link, provider, keyIndex, attempts };
    }

    const detail = (await res.text().catch(() => '')).slice(0, 400);

    if (FATAL_STATUS.has(res.status) && !isOmniRoutePoolFailure(link, res.status, detail)) {
      record('fatal', `${res.status} ${detail}`);
      throw new ChainError(`Upstream rejected the request (${res.status}): ${detail}`, attempts);
    }

    cooldowns.penalise(cand.id, `http ${res.status}`, retryAfterMs(res));
    record('http-error', `${res.status} ${detail}`);
  }

  throw new ChainError(
    `All ${order.length} candidate(s) failed. Last: ${attempts.at(-1)?.detail ?? 'unknown'}`,
    attempts
  );
}
