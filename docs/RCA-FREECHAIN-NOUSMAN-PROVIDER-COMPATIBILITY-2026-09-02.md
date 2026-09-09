# RCA: Nous Man provider compatibility errors stopped FreeChain failover

**Date:** 2026-09-02
**Status:** Fixed, built, deployed, and integrated-route verified
**Severity:** P1
**Scope:** FreeChain candidate classification and Nous Man tool-bearing chat requests

## Executive summary

Recent Nous Man requests reached FreeChain and authenticated correctly, but several streamed
requests ended at HTTP 502 after a provider returned an HTTP 400 validation error. The two observed
categories were a provider tool-array item ceiling and a provider-specific opaque tool-call
signature requirement. FreeChain classified both as globally fatal caller errors, so it stopped
instead of trying a later configured model that could accept the same request.

The fix keeps ordinary malformed-request HTTP 400 and 422 responses fatal, while narrowly
classifying the two observed candidate compatibility categories as eligible for failover. The
operator setting `advanceOnWrappedServerErrors=false` still restores strict hard-fail behavior.

## Impact

- Nous Man could exhaust its application retries even though FreeChain still had untried links.
- Adjacent non-streaming requests succeeded during the incident, which ruled out a general
  FreeChain outage or stale local access key.
- No request or response content, credentials, or raw private Discord text is included here.
- Public-channel tool authorization remains unchanged. This fix only selects another provider.

## Evidence and timeline

The installed request journal recorded four streamed `model=auto` requests ending at status 502
between approximately 6:55 AM and 6:57 AM local time. Attempt metadata showed multiple retryable
upstream failures followed by an HTTP 400 that terminated the chain. Hermes gateway diagnostics
identified the terminal categories as:

1. a tool-array validation ceiling of 128 items; and
2. a missing provider-only thought signature on an earlier function-call part.

Nous Man assembled 160 model-visible tool definitions. Its existing automatic progressive
disclosure decision considered schema tokens relative to the model context window, but did not
consider the provider's independent item-count ceiling. That upstream issue is fixed at the Hermes
tool-assembly boundary. FreeChain still needs the failover defense because provider capabilities
and opaque history requirements differ across chain links.

## Root cause

`dispatch()` delegates HTTP 400 and 422 classification to
`wrapsRetryableUpstreamError()`. The classifier already advanced on wrapped upstream failures, but
it did not recognize provider-specific request compatibility limits. As a result, the first such
response was labeled `fatal` even though a later link could serve the unchanged request.

The missing signature must not be fabricated. It is opaque provider state authored by a different
model or provider. The safe action is to preserve the request exactly and try a compatible link.

## Fix

`src/chain.js` now contains a narrow compatibility marker for the two observed categories. The
marker participates in the existing retryable-wrapper decision, so it inherits the same operator
override and cooldown/attempt accounting rather than adding a second dispatch mechanism.

The change deliberately does not:

- broaden all HTTP 400 or 422 responses into retries;
- rewrite tool definitions or tool-call history;
- invent or strip thought signatures;
- change chain order, credentials, streaming bytes, or the first-usable-output boundary; or
- weaken Hermes public-channel tool policy.

## Risk and blast radius

GitNexus upstream impact analysis for `wrapsRetryableUpstreamError` reported LOW risk: one direct
caller (`dispatch`), nine impacted symbols, one process family, and the existing chain, keys,
request-logging, harness, admin, and deep-health test modules.

The main residual risk is overmatching a future provider message. The expression therefore names
only the two exact observed error shapes, and the pre-existing strict-mode switch remains intact.

## Test evidence

Red phase:

```text
node --test --test-name-pattern="provider-specific tool validation errors" test/chain.test.js
0 passed, 1 failed
The first 400 terminated dispatch after one fatal attempt.
```

Focused green phase:

```text
node --test --test-name-pattern="provider-specific tool validation errors|a 400 stops the chain|wrapped-error exception" test/chain.test.js
3 passed, 0 failed
```

The regression covers both observed compatibility categories, requires a second upstream attempt
and success, and runs beside the retained generic-400 hard-fail and strict-override tests.

## Deployment and final verification

Completed FreeChain evidence:

- `node --test test/chain.test.js`: 21 passed, 0 failed;
- `npm test`: 112 total, 111 passed, 0 failed, 1 expected Windows permission skip;
- `npm run build`: the single executable, portable archives, and Inno Setup installer built;
- the installed executable matches the tested release build, with a timestamped prior executable
  retained under the installation's `backups` directory;
- `/healthz` returned HTTP 200, and authenticated deep health returned HTTP 200 with 34 link
  results, 16 reachable at that point in time;
- exactly one supervisor and one worker own the loopback listener; and
- a new authenticated `model=auto` request returned HTTP 200 through the installed executable
  after four attempts. Its privacy-safe journal record is terminal `served` with attempts
  `http-error`, `http-error`, `http-error`, then `ok`, and retains neither prompt nor response
  content.

Initial integrated proof completed after the first managed Nous Man restart:

- the current runtime assembled 158 incoming tools, retained 29 direct tools, deferred 129, and
  sent 32 model-visible tools after adding the three bridge tools;
- the correlated installed FreeChain request summary records exactly 32 tools and a streamed
  `model=auto` request;
- FreeChain reached terminal HTTP 200 `served` after eight attempts, ending in `ok`, with exact
  usage metadata and no prompt or response content retained;
- Hermes produced a substantive response; and
- an official Discord API read-back confirmed a fresh bot-authored referenced message containing
  1,797 characters in the source channel.

The integrated request required multiple provider attempts because several external links were
unavailable or returned unusable streams. That availability is point-in-time provider state. The
fixed behavior is that compatible candidates remained reachable and the request completed.

Independent review then found and closed additional Hermes count-validation and Discord-admission
seams. After those corrections, the gateway drained active work and completed another managed
replacement. Final-runtime evidence is:

- the independent reviewer returned READY with no Critical or Important findings;
- the current gateway is the only gateway process, is running, and is Discord-connected;
- its first production assembly after startup again reduced 158 incoming tools to 29 direct plus
  three bridge schemas, with 129 deferred and 32 model-visible;
- replaying the exact failed 160-tool catalog produced 29 direct plus three bridge schemas, with
  131 deferred and a hard maximum of 128; and
- post-startup FreeChain journal records include 32-tool requests reaching terminal HTTP 200
  `served` with no prompt or response content retained.

A genuine human-authored Discord reply could not be created after the final replacement because
the authorized desktop-control bridge, replay service, and browser session were unavailable. A bot
REST call or webhook would not exercise the human-reply admission boundary, so no substitute was
used. The official Discord read-backs above remain valid pre-final-replacement behavioral evidence,
not proof of a new human reply on the final process. This is an evidence-generation limitation, not
a known remaining code failure.

## Rollback

Restore the timestamped pre-deployment executable backup and restart the installed FreeChain
supervisor. Source rollback is the single compatibility marker plus its table-driven regression.
No configuration migration or data rollback is required.
