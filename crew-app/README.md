# FreeChain for Kiro Crew

An external Crew app containing the FreeChain 0.7.1 engine, all eight dashboard
pages, model-source links, a complete guide, and a local CLI. Crew manages the
process. The standalone FreeChain app is not a dependency.

## Install

Requires Kiro Crew 0.7.0 or newer and Node.js 20 or newer on the host's PATH.
No npm install, standalone FreeChain executable, container, or separate server is
needed. This package includes the engine, UI, CLI and agent skill.

1. Download `freechain-kiro-crew-0.1.2.zip` from the GitHub release, then extract
   it completely. Use this release asset, not GitHub's automatic source ZIP.
2. **Windows:** double-click `Install-FreeChain.cmd` inside the extracted folder.
   **Linux/macOS:** run `sh install.sh` from that folder.
   Or use Kiro Crew's CLI directly: `kirocrew app install "/path/to/freechain-kiro-crew"`.
   If the CLI is not on PATH, use the terminal/environment where Kiro Crew is
   installed. A Python installation also supports `python -m kiro_crew app install
   "/path/to/freechain-kiro-crew"` with its own interpreter.
3. Open **Kiro Crew > Library > FreeChain**, grant trust through the app controls
   if requested, and enable it. Open Providers to add credentials, then Chat to
   test a request. Crew starts and stops the bundled engine.

If Node was just installed, restart Kiro Crew so it receives the updated PATH.
The installers report failures and leave host security policy unchanged. They
do not auto-import credentials, enable untrusted code, or stop existing services.

To verify the download on Windows, run `Get-FileHash .\freechain-kiro-crew-0.1.2.zip
-Algorithm SHA256` and compare with `SHA256SUMS.txt` from the same release.
On Linux/macOS use `sha256sum` or `shasum -a 256`.

Crew must also be able to launch external app backends on this host. A Windows
Crew installation can reject startup with `SandboxUnavailableError` when it has
no supported isolation backend and its unsandboxed fallback is disabled. This
is a host execution setting, not an app trust grant. The fallback affects Crew
subprocesses beyond FreeChain and requires an explicit owner decision. Installing
or enabling this package does not change that setting. An enabled Library entry
alone does not prove that the backend is running.

Open Providers to enter provider credentials. This is an independent installation:
existing standalone keys, configuration and logs are not silently imported.
The default API is `http://127.0.0.1:4863/v1`. Local keys shows the actual endpoint
and the app's generated access key. Use model `auto` for chain failover.

## CLI

Use the **installed** app directory, not the extracted download. With Kiro Crew's
default home, run:

```powershell
node "$HOME/.kiro/crew/apps/freechain/bin/freechain.mjs" status
node "$HOME/.kiro/crew/apps/freechain/bin/freechain.mjs" chat "Reply with OK"
```

With a custom Kiro Crew home, `kirocrew app info freechain` locates the app.
Run `node <installed-app-directory>/bin/freechain.mjs help`, or use
`bin/freechain.cmd` on Windows. Commands: `status`, `models`, `providers`, `chain`, `harnesses`, `logs`,
`chat "prompt"`, and `request METHOD /admin/...`. Mutation JSON comes from stdin.
The installed skill teaches Crew agents to discover and use this CLI.

The CLI locates the app's runtime automatically. It cannot launch a second engine
or accidentally attach to the standalone installation. Disable/enable in Library
to stop/start the app. Data remains in the app's `data` directory across restarts.
An occupied API port is an error; no other service is stopped or adopted.
Set `FREECHAIN_PORT` in the app's private `.env` to change the API port at restart.

## UI and security

Overview, Local keys, Providers, Chain, Harness, Guide, Logs and Chat reuse the
original markup and behavior. Crew's active colors and fonts override standalone
appearance settings. The embedded DOM, CSS, timers, and event handlers are scoped
to the app and disposed when navigating away. There is no iframe or external
dashboard dependency.

The administration listener requires Crew's signed proxy request or the app's
private CLI signature. The public loopback listener exposes only authenticated
OpenAI-compatible routes. Provider keys remain masked. Logs default to metadata.
The operator retains its confirmation workflow for proposed actions.

On Windows, startup removes inherited permissions from the private data directory
and Crew proxy-secret file, granting access to their owner, SYSTEM and administrators.
Startup fails if that protection cannot be applied. This protects against other
ordinary Windows accounts; it does not isolate processes running as the owner.
Upstream error bodies are bounded and replaced with safe diagnostics. Context
overflow retains its typed error code so clients can compress and retry.
The shared standalone engine also rejects cross-origin browser administration
and non-loopback hostnames to prevent CSRF and DNS rebinding. Crew administration
instead uses the host's authenticated, signed in-process dispatch.

## Updates and migration

For updates, use Kiro Crew's app update controls with the newly extracted package.
Keep a protected backup of app data before updating. Do not uninstall and delete
data or copy the release ZIP over a running installation.

Standalone installations have separate settings and credentials. Moving them is
an explicit migration: back up state, stop the old process, copy state through
the migration helper, then verify the API, CLI and provider chat before retiring
old startup entries. Installing this package does not deprecate another user's
standalone installation or change their API port. Never share a migration archive.

## Build

Build from the FreeChain repository with `npm ci` then `npm run build:crew`.
The distributable is `dist/freechain-crew`. Keep `data`, `.app_secret`, and
`installed.json` out of any archive. Upgrades must preserve the installed data.
No trust grant or host security-policy change is bundled with the app.
`python scripts/package-crew-app.py` produces the release ZIP and SHA-256 file.
The optional `node scripts/build-crew-app.mjs --host=codex` compatibility build
goes to a separate directory and is not the Kiro Crew release asset.
