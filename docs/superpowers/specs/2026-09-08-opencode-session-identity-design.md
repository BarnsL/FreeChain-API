# OpenCode Session Identity Design

**Date:** 2026-09-08
**Status:** Approved by the owner's explicit request to repair, verify, document, and publish the OpenCode route

## Problem

FreeChain currently forwards provider credentials and configured static headers, but it does not compose the dynamic request identity expected by OpenCode Zen. A failed Nous Man request reached FreeChain with only authorization and content-type headers, then OpenCode rejected the request because `x-opencode-session` was absent. The dashboard's explicit Analyze operation uses a separate deep-health request path that omits the same identity.

The installed OpenCode 1.18.4 shortcut contains no arguments or reusable session value. Its exact request implementation confirms that OpenCode identities are generated at request time, not stored in the shortcut.

## Requirements

- Add OpenCode routing identity only to the OpenCode Zen provider family.
- Send a non-empty `x-opencode-session` for normal dispatch, self-completion, and Analyze probes.
- Preserve a sanitized caller session identifier when FreeChain receives one.
- Fall back to FreeChain's per-request identifier when the caller supplies no session identifier.
- Send `x-opencode-request`, `x-opencode-client`, and a truthful FreeChain user agent.
- Do not spoof OpenCode Desktop, reuse an unrelated OpenCode session, expose credentials, or send an invented project identifier.
- Preserve existing link headers and leave non-OpenCode providers unchanged.
- Keep one resolved identity stable across every candidate attempted for the same FreeChain request.
- Verify normal dispatch and Analyze with real loopback HTTP upstreams, then verify the installed runtime against OpenCode.

## Architecture

`src/chain.js` will own one small header-composition function because it already owns every outbound chat-completions attempt. The function receives a link plus request metadata, retains the link's configured headers, and adds the OpenCode contract only when the provider belongs to the `opencode-zen` family. `dispatch()` resolves the request and session identifiers once before entering the candidate loop so failover does not change identity.

`src/server.js` will pass the existing journal request ID and sanitized request metadata into `dispatch()`. Its separate `probeLink()` path will use the same composer with a fresh probe identity, making Analyze exercise the same OpenCode contract. `requestMetadata()` will recognize the existing FreeChain/SubChain correlation names plus standard OpenCode, Hermes, and session headers; values remain control-character stripped and length capped before storage or forwarding.

The fallback request ID is intentionally per request. It prevents an empty-session rejection without falsely merging unrelated conversations. Clients that provide a stable conversation ID receive stable OpenCode routing and prompt-cache affinity across turns.

## Error Handling and Security

- Header values are normalized to visible, bounded text before leaving the process.
- Provider credentials continue to be applied independently through `Authorization` and are never logged by this change.
- Caller-supplied headers are not forwarded wholesale; only the allowlisted session identity is considered.
- The OpenCode identity does not alter HTTP status classification or weaken failover.
- Missing-session responses remain observable as provider errors if the upstream rejects a non-empty, contract-compliant identity for another reason.

## Test Design

1. A loopback OpenCode link captures the outbound request and proves it receives the caller session, FreeChain request ID, truthful client name, and FreeChain user agent.
2. A request without caller session metadata proves the request ID becomes the non-empty session fallback.
3. A non-OpenCode link proves no OpenCode-specific headers are added.
4. A loopback Analyze probe proves the deep-health request carries a non-empty OpenCode session and request identity.
5. The full suite, release build, installed health endpoint, authenticated Analyze operation, and a fresh authenticated chat completion provide release evidence.

## Release and Documentation

Ship as FreeChain 0.7.1. Add dedicated patch notes with the root cause, exact compatibility contract, security boundary, test evidence, deployment evidence, and rollback. Reconcile the existing uncommitted provider-compatibility work, run GitNexus change detection before commit, install the rebuilt executable, restart the supervised runtime, verify the user-visible service, then push the tested commit to the configured remote.
