---
name: freechain
description: Operate the self-contained FreeChain Crew app, inspect provider routing and request logs, use its local API, and manage its chain or harnesses through the bundled CLI.
---

# FreeChain in Kiro Crew

This app contains its own engine. It never needs the standalone FreeChain app.
Resolve this skill directory to its real filesystem target first (Crew can
register it as a junction or symlink), then take its parent twice to obtain the
installed app root. Confirm that root contains `app.json` and `bin/freechain.mjs`.
Run `node <app-root>/bin/freechain.mjs help` for the full command reference.

Start with `status`, then `providers`, `chain`, or `logs` as appropriate.
`chat "prompt"` exercises the actual chain. `models` lists model IDs.
Use the endpoint reported by `status`, not the standalone default port.
The host owns process lifecycle: enable/disable FreeChain through Crew Library.

All dashboard pages are preserved: Overview, Local keys, Providers, Chain,
Harness, Guide, Logs and Chat. Colors and fonts follow the active Crew theme.

For administration, use `request METHOD /admin/...`. POST, PUT and PATCH accept
JSON from stdin. Never put credentials in command arguments or tool output.
Provider values remain masked. The access key can be revealed in the Local keys
UI when the owner needs to configure a client; never print it into an agent chat.
Review operator proposals before confirming them. Do not enable raw prompt,
response, tool-body or credential retention without the owner's explicit request.

If the app is disabled, untrusted or cannot start, report the exact host state.
Do not weaken Crew's sandbox, create trust grants, or start an unmanaged engine
to work around an activation refusal.
