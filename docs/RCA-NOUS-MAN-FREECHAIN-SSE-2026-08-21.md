# RCA: Nous Man retried an HTTP 200 stream that contained an upstream error

- **Incident date:** 2026-08-21
- **Affected path:** Nous Man Discord DM to FreeChain `POST /v1/chat/completions`, `model=auto`, streaming enabled
- **Impact:** Two owner turns ended with the generic provider-failed notice after three retries. No usable assistant output was delivered for either turn.
- **Root-cause confidence:** High
- **Contributing-factor confidence:** High for compression route drift, high for the failing numbered OpenCode credential

## Supplied incident notice

```text
[12:47 PM] APP Nous Man: still chewing through it
[12:48 PM] APP Nous Man: ⚠️ The model provider failed after retries. I kept raw provider details out of chat; check gateway logs for diagnostics.
[1:02 PM] Sleepy Cat [AMD]: Try again
[1:03 PM] APP Nous Man: ⚠️ The model provider failed after retries. I kept raw provider details out of chat; check gateway logs for diagnostics.
```

## Executive summary

Nous Man reached FreeChain with valid authentication. FreeChain selected its first configured route, an OpenRouter-hosted Nvidia model. OpenRouter returned HTTP 200, so `dispatch()` immediately classified the candidate as successful and handed its live body to the server. The first meaningful SSE data from that body was an upstream overload error rather than a completion.

Because HTTP headers had already succeeded, FreeChain did not apply a cooldown or walk the remaining chain. Hermes saw the streamed application error and retried the whole request. Each retry selected the same uncooled top candidate and failed the same way.

This incident is the concrete production case anticipated by FC-003. The correct ownership boundary is the first meaningful SSE event, before FreeChain commits its downstream response headers.

## Timeline

| Local time | Evidence |
|---|---|
| 12:47:48 | Nous Man opened a streaming `model=auto` request through the loopback FreeChain endpoint. |
| 12:47:52 | The stream reported a temporary Nvidia overload before delivering usable output. Hermes marked API attempt 1 failed. |
| 12:47:54 to 12:48:05 | Hermes retried twice. FreeChain chose the same top route each time because it had recorded HTTP 200 and no cooldown. |
| 12:48:05 | Hermes exhausted three attempts and emitted the privacy-safe provider-failed notice. |
| 13:02:38 | The retry turn initially completed one FreeChain tool-call response successfully. |
| 13:02:55 | Conversation compression began at roughly 200,000 input tokens. Its configured OpenCode model was unsupported, a duplicate custom route lacked authentication, and two paid OpenRouter routes failed credit preflight. |
| 13:03:21 | A later free OpenRouter fallback completed compression. The next main request again selected the same top Nvidia route. |
| 13:03:25 to 13:03:38 | Three more HTTP 200 streams reported the same overload before usable output. Hermes emitted the second notice. |

## Correlated FreeChain evidence

The privacy-safe request journal recorded the affected requests as follows:

- Authentication result: accepted.
- Requested model: `auto`.
- Streaming: true.
- Served provider: OpenRouter.
- Served model: the former first Nemotron link.
- Attempt count: one per Hermes retry.
- Provider status: 200.
- Attempt outcome: `ok`.
- Usable output characters: zero on failed streams.
- Cooling candidates: zero.

That combination proves the failure happened after the HTTP decision but before a valid streamed completion. It also explains why outer failover did not run.

## Root cause

`dispatch()` treated `response.ok` as the terminal success condition. For streaming responses, that checks only HTTP status. It did not inspect the first SSE event before clearing cooldown state, recording `ok`, and returning the live response.

The server then sent downstream status 200 and began forwarding chunks. At that point a transparent retry was unsafe because the client-visible response had already started.

## Contributing conditions

1. The former first route was temporarily overloaded at its underlying Nvidia provider.
2. Successful HTTP status cleared any earlier cooldown before the stream proved usable.
3. Hermes retries started a new FreeChain request, so the same candidate won again.
4. Compression used an unsupported LongCat model for OpenCode Zen and carried duplicate stale custom routes.
5. One numbered FreeChain OpenCode credential returned 401 in a bounded live probe. The owner explicitly required that credential to remain configured, so it is pinned to the final chain position rather than removed.

## Ruled out

- **The prior FreeChain access-key drift:** ruled out. Every affected chat request was authenticated and reached provider dispatch.
- **A normal HTTP 5xx failover defect:** ruled out. The provider returned HTTP 200, not 5xx.
- **FreeChain exhausting its candidates:** ruled out. The journal recorded one successful HTTP candidate per retry and no cooling entries.
- **Compression as the first visible failure:** ruled out. The 12:48 failure happened before the later compression sequence. Compression drift was a separate reliability problem discovered during the 13:02 turn.

## Resolution

1. Add a 64 KiB first-event gate for successful `text/event-stream` responses. The bound counts bytes through event boundaries, so later bytes in one large transport chunk cannot reject an already valid first event.
2. Accept a streaming candidate only after one complete, valid, non-error data event.
3. Treat an explicit SSE error, top-level JSON error, malformed first data event, empty early close, read failure, or exceeded prefix bound as `stream-error`.
4. Penalize that candidate and continue through the existing failover order without persisting raw provider details. A caller abort is rechecked after reads and cancellation, and never cools or advances the chain.
5. Replay accepted buffered bytes exactly, then continue from the same upstream reader.
6. Put healthy OpenCode Ox Alpha first and OpenRouter Ox Alpha second.
7. Move the healthy OpenCode credential to its own pinned slot. Retain the failing numbered credential as the final pinned link.
8. Remove the live-proven unsupported OpenCode DeepSeek free link.
9. Replace Nous Man compression's unsupported and duplicate routes with supported Ox Alpha routes and one known free fallback.

## Residual limitation

After the first valid event has been released, a later stream failure cannot be retried transparently without risking duplicate text or duplicate tool calls. Clients must receive the later error or truncation. The gate addresses early provider-error envelopes, including this incident, while preserving true streaming.

## Verification evidence

- Pre-change full suite: 104 passed, 0 failed, 1 expected Windows permission skip.
- Regression RED: the dispatcher returned the first link instead of the second.
- Regression GREEN: an HTTP 200 SSE error produced `stream-error`, cooled the first candidate, selected the second link, and preserved the accepted stream byte-for-byte.
- Focused chain suite after review fixes: 18 passed, 0 failed.
- Post-review full suite: 108 passed, 0 failed, 1 expected Windows permission skip.
- Independent review found and verified fixes for two edge cases: a valid event inside an oversized reader chunk, and a caller abort arriving while cancellation settled. No review findings remain.
- OpenCode Ox Alpha: healthy credential passed streaming and required-tool probes.
- OpenRouter Ox Alpha: both configured credentials passed streaming and required-tool probes.
- Retained numbered OpenCode credential: returned HTTP 401 in a bounded probe.
- Older OpenCode links: Nemotron, MiMo, and Laguna passed bounded probes; the DeepSeek free identifier returned a server-side 400 and was removed.
- Release build: the Windows executable and both portable packages built successfully. The installed executable's SHA-256 matched the new build, its supervisor and worker owned the loopback listener, and the existing Start Menu shortcut still targeted the installed executable.
- Installed chain: 34 links, `opencode-zen1/x-preview-f-free` first, `openrouter/stealth/ox-alpha` second, and the retained `opencode-zen0/x-preview-f-free` credential last. The bad slot remained present and failed with 502 only when explicitly targeted through FreeChain.
- Packaged provider path: `auto` streamed a required `ping` tool call through OpenCode Ox in one attempt. The explicit OpenRouter Ox route did the same in one attempt. Neither stream contained an error event.
- Dashboard: the installed Chain view showed the same positions. An unsaved 118-character hostile string inside a dashboard card produced `pageOverflow=false` and `problems=0` across 70 cards at both 1280 px and 380 px.
- Nous Man: compression now uses OpenCode Ox, then OpenRouter Ox, then free Nemotron. The gateway restarted, reported running, emitted a Discord-ready marker with no fatal startup marker, retained mention-only channel safeguards, and a local Hermes one-shot through configured FreeChain returned the exact `NOUSMAN_OX_OK` sentinel.
- Recovery: timestamped backups exist for the pre-deployment FreeChain executable, web UI, chain file, environment file, and Hermes configuration.

## Rollback

Restore the timestamped installed executable, web UI, chain file, FreeChain environment file, and Hermes configuration backup. Restart FreeChain and the Hermes gateway, then verify the original route order and listener ownership. Rollback restores the old behavior, including the FC-003 limitation, so it is for deployment recovery only.
