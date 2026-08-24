# RCA: Nous Man received no content after FreeChain committed before usable stream output

- **Incident date:** 2026-08-23
- **Affected path:** Nous Man private Discord thread to FreeChain `POST /v1/chat/completions`, `model=auto`, streaming enabled
- **Impact:** Nous Man exhausted its retries, produced no assistant reply, and emitted lifecycle plus terminal-failure notices.
- **Root-cause confidence:** High
- **Exact first-event-shape confidence:** Medium because raw provider bodies were intentionally not retained

## Supplied incident notice

```text
Nous Man operational notice [status/lifecycle] at 2026-08-23 15:00:07 UTC:
Model returned no content after all retries. No fallback providers configured.

Nous Man operational notice [terminal-failure] at 2026-08-23 15:00:08 UTC:
Final response suppressed because the model returned empty content after retries and any fallback providers.
```

The original surface identifier is intentionally omitted.

## Executive summary

Nous Man reached FreeChain with valid authentication and requested a streamed `auto` completion. FreeChain selected the first installed route, `opencode-zen1/x-preview-f-free`. The upstream returned HTTP 200 and at least one parseable non-error SSE event, so FreeChain recorded the attempt as `ok`, cleared any cooldown, and committed the route to the caller.

The stream never produced a completed journal result. The caller disconnected, and FreeChain recorded HTTP 499. Immediately afterward, Nous Man reported that all retries had returned no content.

The existing 64 KiB scanned-prefix gate rejected explicit errors, malformed data, `[DONE]` before any data, and empty closes. Its success condition was still too broad: any parseable JSON data event that was not an explicit error counted as a valid first event. Role-only deltas, empty deltas, usage-only events, and structurally non-empty nested scaffolds are protocol metadata, not usable assistant output. The implementation would accept any of those shapes; the journal proves premature commitment but intentionally does not retain which exact shape crossed the incident boundary. Once the gate returned success, FreeChain could no longer move safely to any of the other 33 configured links.

The correction keeps the route uncommitted until a choice contains non-empty content, refusal, reasoning, reasoning details, audio, a function call, or a tool call. Tool-call-only responses remain valid even when text output is zero characters.

## Timeline

| UTC time | Evidence |
|---|---|
| 14:55:00 to 15:12:00 | The privacy-safe FreeChain journal recorded 90 chat requests: 87 client-disconnected 499 outcomes from the first OpenCode route and 3 completed 200 outcomes from OpenRouter. |
| 14:59:58.211 | The request nearest the alert began. Authentication was accepted, `model=auto`, and streaming was enabled. |
| 15:00:06.638 | FreeChain had accepted the first OpenCode candidate after 8.427 seconds and recorded its attempt as `ok`, with no second candidate attempted. |
| 15:00:06.647 | The request ended as 499 `client-disconnected` with no completed stream-result summary. |
| 15:00:07 | Nous Man emitted the no-content-after-retries lifecycle notice. |
| 15:00:08 | Nous Man suppressed the final channel response and emitted the terminal-failure notice. |

## Correlated FreeChain evidence

The allowlisted request journal recorded the request nearest the alert as follows:

- Authentication: accepted.
- Requested model: `auto`.
- Streaming: true.
- Served provider: `opencode-zen1`.
- Served model: `x-preview-f-free`.
- Candidate attempts: one.
- Attempt outcome: `ok`.
- Terminal HTTP status: 499.
- Terminal outcome: `client-disconnected`.
- Completed result summary: absent.
- Configured chain links: 34.

Across the surrounding 17-minute window, 87 of 90 chat requests had the same false-success pattern. The three completed streams were OpenRouter tool-call responses with zero text characters. That distinction matters: zero text alone is not evidence of an empty model response, because a tool call is usable output.

Raw prompts, completions, credentials, authorization headers, and provider bodies were disabled in the log policy and were not read for this RCA.

## Root cause

`gateSseResponse()` parsed the first data event and rejected explicit errors, malformed JSON, and `[DONE]`. For every other parsed payload it immediately rebuilt the response stream and returned success.

That treated protocol validity as model-output validity. A payload such as a role-only empty delta is valid JSON and valid SSE, but it does not give the caller content, reasoning, refusal, audio, a function call, or a tool call. `dispatch()` therefore recorded `ok` and returned before the provider proved it could produce usable output.

The server then committed downstream status 200 and streamed from the accepted reader. Transparent failover was no longer safe because later output might already have reached the client. The downstream retry loop retried the whole request, repeatedly selecting the same uncooled first route.

## Contributing conditions

1. The first configured OpenCode route repeatedly satisfied the old protocol-validity gate, but the journal recorded no completed usable output before the caller left. The exact early SSE payload was not retained.
2. A successful gate clears prior cooldown state, so each new retry favored the same first route.
3. FreeChain had 34 configured links, but the premature success boundary prevented candidate two from being tried.
4. The downstream runtime reported no separate fallback providers, so all useful failover needed to remain inside FreeChain.

## Ruled out

- **FreeChain access-key drift:** ruled out. Authentication was accepted before dispatch.
- **No configured providers:** ruled out. The installed chain contained 34 links.
- **FreeChain chain exhaustion:** ruled out. Only one candidate was attempted and it was recorded as `ok`.
- **The earlier explicit SSE error defect:** ruled out for this request shape. The current gate already rejects `event: error` and top-level JSON `error`; this incident passed that check.
- **Tool-call-only output being inherently empty:** ruled out. Completed OpenRouter streams in the same window carried valid tool calls with zero text characters.

## Resolution

1. Add a regression whose first provider sends role-only and index-only tool-call scaffolds followed by `[DONE]`, while the second sends the same metadata prefix followed by a substantive tool call.
2. Keep scanning metadata-only events inside the existing 64 KiB decision prefix while retaining every received byte for exact replay.
3. Accept the route only when a choice contains non-empty content, refusal, reasoning, reasoning details, audio, a function call, or a tool call.
4. Preserve the existing `stream-error`, cooldown, next-candidate, abort, prefix-limit, and exact-byte replay behavior.
5. Document the stronger output boundary in `DEPLOYMENT.md` and FC-019.

## Verification evidence

- Pre-change full suite: 108 passed, 0 failed, 1 expected Windows permission skip.
- Regression RED: FreeChain returned the first stream after an index-only tool-call scaffold. The assertion expected the second substantive tool-call stream and failed with `first !== second`.
- Regression GREEN: the focused test passed after the gate correction and replayed metadata plus the substantive tool-call event exactly.
- Output-contract mutation check: temporarily removing `refusal` from the accepted fields made the new coverage fail with `200 SSE empty-done`; restoring it returned the test to green. The same test exercises reasoning, reasoning content, reasoning details, function calls, and audio.
- Focused chain suite: 20 passed, 0 failed.
- Full post-change suite: 111 total, 110 passed, 0 failed, 1 expected Windows permission skip.
- Packaging: `npm run build` completed successfully and produced the Windows executable plus the documented archive formats.
- Deployment: the installed executable was replaced only after a byte-for-byte rollback copy was created and verified. The supervisor and worker restarted from the installed path, `/healthz` returned healthy, and the worker owned the expected `127.0.0.1:4853` listener.
- Start Menu: the existing FreeChain shortcut still targets the installed executable.
- Fresh authenticated route: request `b42fc519-c920-409c-8132-57703d2a691f` used `model=auto` with streaming and a required local `ping` tool. It returned HTTP 200 after 22.789 seconds with `X-Freechain-Attempts: 2`, served `openrouter/stealth/ox-alpha`, emitted reasoning plus a tool call, and ended with `[DONE]`.
- Journal correlation: the same request ended status 200 with finish reason `tool_calls`, 4,997 streamed bytes, 244 exact tokens, and attempts `opencode-zen1/x-preview-f-free: http-error` followed by `openrouter/stealth/ox-alpha: ok`.
- Post-review installed route: request `8cc516ce-9772-4188-a69f-b253fbf9eef3` ran against the final rebuilt executable. It returned HTTP 200 after 10.900 seconds in one `opencode-zen1/x-preview-f-free` attempt, emitted `reasoning_content` plus a tool call, and ended with `[DONE]`.
- Final journal correlation: the post-review request ended status 200 with finish reason `tool_calls`, 1,814 streamed bytes, 244 exact tokens, and attempt outcome `ok`.
- Final deployment backup: the previously installed executable was preserved and hash-verified at `C:\Users\Burgboy\AppData\Local\FreeChain\backups\freechain.exe.20260823-171608.pre-substantive-stream-fix.bak` before the reviewed build replaced it.
- Scope checks: `git diff --check` passed. GitNexus detected 5 tracked files, 19 symbols, 1 affected execution flow, and medium aggregate risk. The changed runtime flow was the expected `gateSseResponse()` path; the remaining detected symbols were deployment, issue, and skill-observation documentation.

## Residual limitation

After FreeChain releases the first usable output event, a later upstream failure cannot be retried transparently without risking duplicated content or duplicated tool execution. The client receives that later truncation or error. The strengthened gate moves the ownership boundary to actual model output while preserving genuine streaming.

## Rollback

Restore `C:\Users\Burgboy\AppData\Local\FreeChain\backups\freechain.exe.20260823-082621.pre-empty-stream-fix.bak` to the installed executable path and restart FreeChain through its existing supervisor path. The backup length and SHA-256 matched the pre-deployment executable before replacement. Source rollback consists of reverting the metadata-only regression and the usable-output predicate in `gateSseResponse()`. Rollback restores the false-success behavior and is appropriate only if a provider uses an undocumented output field that must be added to the accepted field list.
