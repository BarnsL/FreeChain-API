# RCA: Hermes reported OpenRouter HTTP 402 while FreeChain was expected

## Incident summary

- **Incident time:** 2026-08-17 03:54:18 UTC / 2026-08-16 20:54:18 PDT
- **Surface:** Nous Man public Discord thread
- **User-visible result:** The turn produced no assistant answer. The public-channel terminal response was suppressed by the Discord operational-output policy and the technical failure was sent to the owner.
- **Classification:** Routing/configuration incident with an external billing trigger
- **Confidence:** High that FreeChain was not on the failing request path; high that no main-agent fallback was configured; medium on the exact OpenRouter mechanism that derived the 65,536-token reservation.

The failure was not emitted by FreeChain. At incident time Hermes was configured for the `openrouter` provider, the `meituan/longcat-2.0` model, and the direct OpenRouter base URL. The captured outbound request confirms a direct POST to OpenRouter. OpenRouter rejected that paid-model request because the account could not fund the provider's calculated maximum completion reservation.

FreeChain was already running and healthy, but Hermes did not select it until a separate provider-apply operation seven minutes after the incident. That saved configuration still requires a Hermes gateway restart before Discord uses it.

## Impact

- One observed Discord turn failed before any completion tokens were returned.
- Hermes made one primary model call, marked its sole OpenRouter credential exhausted, found no additional credential, found no main-agent fallback, and terminated.
- The public thread did not receive the raw operational failure because the configured Discord policy intentionally suppresses terminal diagnostics outside direct messages.
- The same depleted OpenRouter lane was also selected for auxiliary title generation. That auxiliary path detected the payment error and continued to its own fallback, so it was not the cause of the missing conversational response.

## Timeline

| Time | Event | Evidence |
|---|---|---|
| 2026-08-16 08:38:55 UTC | The currently running FreeChain process started. | `/healthz` reported this `startedAt` value and returned HTTP 200. |
| 2026-08-17 03:54:15 UTC | Hermes created the turn's client as `provider=openrouter`, `model=meituan/longcat-2.0`, using the direct OpenRouter base URL. | `logs/agent.log` lines 11985 and 11989-11990. |
| 2026-08-17 03:54:18 UTC | The outbound request went directly to OpenRouter and returned HTTP 402. | Session request dump plus `logs/agent.log` lines 11991-11995. |
| 2026-08-17 03:54:18 UTC | Hermes marked the only OpenRouter credential exhausted and found no available pool entry. | `logs/agent.log` lines 11993-11994. |
| 2026-08-17 03:54:19 UTC | Hermes classified the response as a non-retryable billing failure. With no main fallback available, it terminated. | `logs/agent.log` lines 11995-11997 and `agent/conversation_loop.py`. |
| 2026-08-17 03:54:21 UTC | The gateway suppressed the operational final response in the public thread and rerouted it to the owner. | `logs/agent.log` line 12001 and `gateway/run.py` lines 13892-13920. |
| 2026-08-17 04:01:43 UTC | A later console operation saved and selected `freechain` with model `auto` and imported the local access credential. | `logs/nousman-console.log` and `config.yaml.bak-20260816-210143`. |
| Current verification | Saved-provider chat probe reached FreeChain successfully and resolved to a configured free model. | `scripts/nousman_provider_probe.py chat --provider freechain` returned success in 1,032.3 ms. |

## Root cause

### 1. The desired FreeChain route was not active for the incident

The pre-change configuration snapshot contains:

```yaml
model:
  base_url: https://openrouter.ai/api/v1
  default: meituan/longcat-2.0
  provider: openrouter
```

The captured request independently confirms the effective runtime route:

```text
POST https://openrouter.ai/api/v1/chat/completions
model=meituan/longcat-2.0
```

No evidence from the failing turn contains the FreeChain loopback endpoint. FreeChain therefore had no opportunity to intercept the 402 or advance its own provider chain.

### 2. OpenRouter rejected the direct paid-model request during credit preflight

OpenRouter reported that the account could afford at most 26,684 tokens but that the request could require up to 65,536. The captured outbound JSON body contains `model`, `messages`, `tools`, and `extra_body`, but no explicit `max_tokens` or `max_completion_tokens` field.

Therefore:

- the 65,536 figure was not added by FreeChain;
- it was not an explicit output cap in the captured HTTP body;
- it was derived by OpenRouter's handling of the selected route/model, most likely from the model's default or advertised maximum output capacity.

The exact OpenRouter-side derivation is the only medium-confidence part of this RCA. The direct endpoint, selected model, absent token cap, and billing rejection are captured facts.

### 3. Hermes had no remaining main-agent recovery path

Hermes correctly classified HTTP 402 as `billing`, with credential rotation and provider fallback permitted. Recovery still ended because:

- the OpenRouter credential pool contained one usable entry, which was marked exhausted;
- the incident configuration had no active main `fallback_model` or `fallback_providers` chain;
- the fallback chains present under auxiliary vision/compression settings do not recover the primary conversational turn.

The notice saying a fallback would be used "if configured" was accurate. None was configured for this turn.

## Why FreeChain would have changed the outcome

When Hermes uses the current intended settings, it sends `model=auto` to the FreeChain loopback endpoint. FreeChain then selects each link's configured model and walks candidates until one succeeds.

FreeChain treats only HTTP 400 and 422 as fatal caller errors, with a documented OmniRoute diagnostic exception. HTTP 402 is candidate-owned, so FreeChain cools that candidate and continues to the next configured candidate. A paid-provider credit failure would therefore not terminate the outer chain by itself.

An explicit `meituan/longcat-2.0` request would not be equivalent. FreeChain pins explicit model names and the current chain has no LongCat link, so it would reject that request rather than silently substitute another model. The saved `model=auto` setting is the correct integration contract.

## Contributing factors

1. **Saved state and active gateway state are separate.** The console provider apply writes `config.yaml` and `.env`, but returns `restart_required=true`. Its own UI states that provider probes use saved files immediately while Discord requires a gateway restart.
2. **The operational notice omitted endpoint provenance.** It named the model and status, but not the actual base URL. That made a direct OpenRouter request look like a FreeChain failure to an operator who expected FreeChain to be selected.
3. **The direct paid route had no explicit output cap.** This allowed OpenRouter to price or reserve against a much larger potential completion than the account could fund.
4. **There was no main fallback.** Hermes' error classification and credential rotation worked, but there was nowhere else to go.

## Ruled out

- **FreeChain process outage:** Ruled out. The live process reports a start time well before the incident and its health endpoint returns HTTP 200.
- **FreeChain returning the 402:** Ruled out. The request dump records the direct OpenRouter URL.
- **FreeChain failover stopping on 402:** Ruled out by `src/chain.js`; only 400 and 422 are fatal. The focused FreeChain tests also pass.
- **Hermes misclassifying the 402:** Ruled out. The classifier correctly returned billing exhaustion, non-retryable, rotate credential, and allow fallback.
- **Discord suppression causing the model failure:** Ruled out. Suppression happened after the terminal result and only controlled where diagnostics were displayed.

## Corrective and preventive actions

### Immediate operational action

1. Restart the Hermes gateway so the saved `freechain` provider becomes the Discord runtime provider.
2. Run one controlled Discord turn and verify the gateway log shows:
   - `provider=freechain`
   - the loopback FreeChain base URL
   - `model=auto`
3. Confirm FreeChain reports the serving provider/model through its response headers or verbose attempt log.

This restart and Discord turn were not performed during the RCA because the requested scope was diagnosis, and a gateway restart changes live external behavior.

### Product changes

| Priority | Owner | Action | Acceptance evidence |
|---|---|---|---|
| P0 | Nous Man Console | Do not present a newly saved provider as active runtime state until the required gateway restart succeeds. Offer the restart as the next explicit action. | Console distinguishes saved, restart pending, and runtime-active states. |
| P0 | Hermes Gateway | Include sanitized effective provider and endpoint provenance in owner-only terminal diagnostics. | A direct OpenRouter failure and a FreeChain failure are distinguishable from the notice alone. |
| P0 | Integration | After provider apply and restart, run a bounded chat probe through the gateway's effective configuration, not only through the saved-file probe. | Probe log records provider, loopback endpoint, requested `auto`, and resolved model. |
| P1 | Hermes | When a paid direct provider is used, set an explicit conservative output cap or require one. | Captured outbound JSON contains the configured cap and a low-credit account no longer reserves the model maximum. |
| P1 | Hermes | Configure a main-agent fallback for direct-provider mode, or disallow direct OpenRouter as the active Nous Man route when FreeChain is intended. | A simulated 402 advances to a distinct provider or router. |
| P1 | FreeChain | Add an explicit HTTP 402 failover regression test. | A local first upstream returns 402 and the second upstream serves the request. |

## Verification performed

- GitNexus index for `FreeChain-API` was current at commit `9b120fa`; exact context for `dispatch` confirmed its callers and failover callees. Text search was degraded because the local FTS extension was unavailable, so exact symbol context and source reads were used.
- `node --test test/chain.test.js test/keys.test.js`: 32 passed, 0 failed.
- `GET http://127.0.0.1:4853/healthz`: HTTP 200.
- One-token authenticated call directly through FreeChain: HTTP 200, one attempt, served by the first configured free OpenRouter model.
- Saved Hermes provider probe through `freechain`: success, `configured_model=auto`, assistant content returned in 1,032.3 ms.
- No post-change Discord turn was observed. The gateway process predates the provider apply, and the console marks activation as restart-required. End-to-end Discord adoption remains unverified until restart.

## Scope and repository state

No FreeChain or Hermes runtime source code was changed during this RCA. Existing uncommitted FreeChain web UI, deployment, and test changes were preserved untouched.
