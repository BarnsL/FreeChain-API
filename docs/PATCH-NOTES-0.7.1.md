# FreeChain 0.7.1 Patch Notes

**Release date:** 2026-09-08
**Issue:** FC-021
**Severity:** P1

## Fixed

FreeChain now sends OpenCode's dynamic request identity on every OpenCode Zen request, including the dashboard's explicit Analyze/deep-health probes. This prevents valid requests from reaching the provider with an empty `x-opencode-session` value and being rejected before the configured chain can serve them.

## Root cause

The installed OpenCode shortcut resolves to OpenCode Desktop 1.18.4 with no command-line arguments. The executable identity is static application metadata; it does not contain a reusable conversation or request identifier.

The exact failed Nous Man request dump contained only `Authorization` and `Content-Type` at the FreeChain boundary. OpenCode's published integration contract and 1.18.4 source require a stable `x-opencode-session` for a conversation and construct request identifiers dynamically. FreeChain forwarded static link headers only, so both normal provider dispatch and its separate Analyze probe omitted the required identity.

## Behavior

For providers in the `opencode-zen` family, FreeChain now sends:

- `x-opencode-session`: the sanitized caller session when present, otherwise the FreeChain request ID;
- `x-opencode-request`: the FreeChain request ID;
- `x-opencode-client`: `freechain`; and
- `User-Agent`: `FreeChain/0.7.1`.

The identity is resolved once per request and remains stable while FreeChain walks candidates. OpenCode, FreeChain, SubChain, Hermes, and standard session-header names are accepted through a fixed allowlist. Other caller headers are not forwarded.

Non-OpenCode providers receive none of the OpenCode-specific fields. FreeChain does not claim to be OpenCode Desktop, does not reuse another application's session, and does not invent an OpenCode project identifier.

## Test-first evidence

Before the implementation, the focused dispatch test failed because `x-opencode-session` was absent. The focused server and Analyze group then failed in three places: session aliases were ignored, the caller session was replaced by an unrelated request fallback, and the Analyze probe sent no OpenCode identity.

After the implementation:

```text
OpenCode request identity group: 2 passed, 0 failed
Server and Analyze identity group: 3 passed, 0 failed
```

The loopback tests inspect the actual HTTP headers received by a real local upstream rather than asserting source text or a mocked fetch.

## Release and installed-runtime evidence

- `npm test`: 117 tests total, 116 passed, 0 failed, and 1 expected Windows permission skip.
- `npm run build`: produced the Windows single executable, portable archives, source-portable archive, and the 0.7.1 Inno Setup installer.
- The built executable was copied over the verified installed target only after creating a timestamped backup. Source and installed SHA-256 digests matched after replacement.
- The existing Start Menu shortcut still resolves to the installed executable.
- The replacement runtime owns port 4853 as exactly one supervisor and one worker.
- `/healthz` returned HTTP 200 with 34 configured links.
- The authenticated Analyze operation returned HTTP 200 for all 34 bounded probes. Fifteen links answered successfully; the OpenCode `mimo-v2.5-free` link returned HTTP 200. Other link-specific credential, timeout, and availability results remained visible independently.
- A fresh authenticated streamed request pinned to `mimo-v2.5-free` returned HTTP 200 from `opencode-zen1` in one attempt, emitted 4,844 bytes, exposed a FreeChain request ID, and ended with `[DONE]`.

The successful OpenCode Analyze probe and the separate streamed completion were both produced by the replacement process epoch, after installation. Neither proof retained or printed provider output content.

## Security and privacy

- Credentials remain isolated to the existing authorization path.
- Session inputs are control-character stripped, trimmed, and length capped before forwarding.
- Only the session field is selected from caller metadata; arbitrary caller headers are not copied upstream.
- Request IDs contain no prompt or response content.
- Provider-specific identity is added only for the exact OpenCode provider family.

## Rollback

Restore the timestamped pre-0.7.1 installed executable backup and restart the existing FreeChain supervisor. Source rollback is limited to the header composer, its two server call sites, the session-header aliases, and their regressions; there is no configuration or data migration.
