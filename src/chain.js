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

// A 4xx from an aggregator is ambiguous: the same status code covers two very
// different failures.
//   * A genuine caller error — bad model id, malformed messages, an
//     unsupported parameter — that every provider would reject identically.
//     Advancing burns all 30-odd candidates on an error none can fix, so it
//     must stay fatal.
//   * A server-side or upstream failure the aggregator wrapped in a 4xx body.
//     OpenRouter returns `{"error":{"type":"server_error",...}}` with HTTP 400;
//     the "Console" router answers "Upstream request failed: [404] Provider
//     returned error" with a 400; OmniRoute wraps pool exhaustion the same way.
//     The request is valid, so the chain should advance to the next provider.
//
// Keying the fatal/retryable decision on the status code alone treated the
// second kind as the first, so one flaky provider at the head of the chain took
// the entire failover down (RCA 2026-08-18 / FC-018). We inspect the body, not
// just the status, to tell them apart. Markers are deliberately specific to
// server/upstream failures so genuine validation errors keep failing fast.
const WRAPPED_SERVER_ERROR =
  /server[_ ]error|upstream (?:error|request failed)|provider returned error|no (?:endpoints|allowed providers|instances)|temporarily unavailable|over(?:loaded|capacity)|internal server error|bad gateway|gateway time-?out|service unavailable|\[(?:404|408|409|425|429|5\d\d)\]/i;

/**
 * Whether a fatal-status (400/422) body is actually a wrapped, retryable
 * upstream failure rather than a genuine caller error, so `dispatch()` advances
 * the chain instead of failing terminally.
 *
 * OmniRoute's diagnostic pool envelope always advances (the original known
 * case, kept for behaviour parity). Everything else is gated on
 * `settings.advanceOnWrappedServerErrors` (default on): clearing it restores
 * the strict "any 400 is fatal" behaviour for operators debugging an
 * over-matching provider.
 */
export function wrapsRetryableUpstreamError(link, status, detail, settings = {}) {
  if (link.provider === 'omniroute' && /"diagnostics"\s*:\s*\{/.test(detail)) return true;
  if (settings.advanceOnWrappedServerErrors === false) return false;
  return WRAPPED_SERVER_ERROR.test(detail);
}

/** Parse a `Retry-After` header (seconds or an HTTP date) into a millisecond delay, capped at 5 minutes. */
function retryAfterMs(res) {
  const raw = res.headers.get('retry-after');
  if (!raw) return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.min(secs * 1000, 300_000);
  const when = Date.parse(raw);
  return Number.isFinite(when) ? Math.max(0, when - Date.now()) : undefined;
}

const SSE_PREFIX_LIMIT = 64 * 1024;

/**
 * Read through the first meaningful SSE event before a 200 response is accepted.
 * Providers sometimes report an upstream failure as a top-level `error` event
 * after the HTTP status has already succeeded. Until a valid event is seen, the
 * dispatcher still owns failover and can try another candidate.
 *
 * The returned Response replays every buffered byte unchanged, then continues
 * from the same reader. Nothing is decoded and re-encoded on the success path.
 */
async function gateSseResponse(response, signal) {
  if (!response.body) return { ok: false, reason: 'empty-body' };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const chunks = [];
  let prefix = '';
  let scannedBytes = 0;

  const fail = async (reason) => {
    await reader.cancel(reason).catch(() => {});
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException('The operation was aborted', 'AbortError');
    }
    return { ok: false, reason };
  };

  try {
    while (scannedBytes <= SSE_PREFIX_LIMIT) {
      const { done, value } = await reader.read();
      if (done) return fail('empty-close');
      if (signal?.aborted) {
        await reader.cancel(signal.reason).catch(() => {});
        throw signal.reason instanceof Error
          ? signal.reason
          : new DOMException('The operation was aborted', 'AbortError');
      }
      chunks.push(value);
      prefix += decoder.decode(value, { stream: true });

      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(prefix))) {
        const event = prefix.slice(0, boundary.index);
        scannedBytes += encoder.encode(prefix.slice(0, boundary.index + boundary[0].length)).byteLength;
        prefix = prefix.slice(boundary.index + boundary[0].length);
        if (scannedBytes > SSE_PREFIX_LIMIT) return fail('prefix-limit');
        const lines = event.split(/\r?\n/);
        const eventType = lines
          .find((line) => line.startsWith('event:'))
          ?.slice('event:'.length)
          .trim();
        const data = lines
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice('data:'.length).trimStart())
          .join('\n');

        // Comments and keepalive events carry no data. Keep buffering until a
        // meaningful event appears or the fixed prefix ceiling is reached.
        if (!data) continue;
        if (data === '[DONE]') return fail('empty-done');

        let payload;
        try {
          payload = JSON.parse(data);
        } catch {
          return fail('malformed-data');
        }
        if (eventType === 'error' || payload?.error) return fail('provider-error');

        const structuralFields = new Set([
          'annotations',
          'id',
          'index',
          'metadata',
          'role',
          'signature',
          'status',
          'type',
        ]);
        const hasSubstantiveValue = (value) => {
          if (typeof value === 'string') return value.length > 0;
          if (Array.isArray(value)) return value.some(hasSubstantiveValue);
          if (!value || typeof value !== 'object') return false;
          return Object.entries(value).some(
            ([field, nested]) => !structuralFields.has(field) && hasSubstantiveValue(nested),
          );
        };
        const hasUsableOutput = payload?.choices?.some((choice) => {
          const output = choice?.delta ?? choice?.message;
          if (!output || typeof output !== 'object') return false;
          return [
            output.content,
            output.refusal,
            output.reasoning,
            output.reasoning_content,
            output.reasoning_details,
            output.tool_calls,
            output.function_call,
            output.audio,
          ].some(hasSubstantiveValue);
        });
        // Roles, usage, empty deltas, and structural nested fields are protocol
        // scaffolding. Keep the route uncommitted until substantive output.
        if (!hasUsableOutput) continue;

        let bufferedIndex = 0;
        const body = new ReadableStream({
          async pull(controller) {
            if (bufferedIndex < chunks.length) {
              controller.enqueue(chunks[bufferedIndex++]);
              return;
            }
            try {
              const next = await reader.read();
              if (next.done) controller.close();
              else controller.enqueue(next.value);
            } catch (error) {
              controller.error(error);
            }
          },
          cancel(reason) {
            return reader.cancel(reason);
          },
        });
        return {
          ok: true,
          response: new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          }),
        };
      }
      if (scannedBytes + encoder.encode(prefix).byteLength > SSE_PREFIX_LIMIT) {
        return fail('prefix-limit');
      }
    }
    return fail('prefix-limit');
  } catch (error) {
    if (signal?.aborted) throw error;
    return fail('read-error');
  }
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
      if (body.stream && /\btext\/event-stream\b/i.test(res.headers.get('content-type') || '')) {
        const gated = await gateSseResponse(res, signal);
        if (signal?.aborted) {
          if (gated.ok) await gated.response.body?.cancel(signal.reason).catch(() => {});
          throw signal.reason instanceof Error
            ? signal.reason
            : new DOMException('The operation was aborted', 'AbortError');
        }
        if (!gated.ok) {
          cooldowns.penalise(cand.id, 'stream error');
          record('stream-error', `200 SSE ${gated.reason}`);
          continue;
        }
        res = gated.response;
      }
      cooldowns.clear(cand.id);
      record('ok', `${res.status}`);
      return { response: res, link, provider, keyIndex, attempts };
    }

    const detail = (await res.text().catch(() => '')).slice(0, 400);

    if (FATAL_STATUS.has(res.status) && !wrapsRetryableUpstreamError(link, res.status, detail, chain.settings)) {
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
