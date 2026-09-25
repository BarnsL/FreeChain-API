# FreeChain for Kiro Crew 0.1.2

A dedicated Kiro Crew app with the FreeChain 0.7.1 engine included. No standalone
FreeChain process, iframe, container or runtime npm installation is required.

## Install

1. Install Kiro Crew 0.7.0+ and Node.js 20+.
2. Download **freechain-kiro-crew-0.1.2.zip** below and extract it fully.
3. On Windows run **Install-FreeChain.cmd**. On Linux/macOS run **sh install.sh**.
   The equivalent command is `kirocrew app install "/path/to/freechain-kiro-crew"`.
4. In **Kiro Crew > Library > FreeChain**, grant app trust if requested and enable
   the app. Add provider credentials under Providers and try Chat.

Download the named app ZIP, not GitHub's automatically generated source archive.
The ZIP contains ready-to-load UI code. **SHA256SUMS.txt** verifies the download.
The included README covers the CLI, updates and Windows startup requirements.

## Included

- Original Overview, Local keys, Providers, Chain, Harness, Guide, Logs and Chat.
- All existing model-source navigation, with colors and fonts following the active
  Kiro Crew theme.
- Private app-owned keys, configuration, harnesses and request journals.
- CLI commands for status, models, providers, chain, harnesses, logs, chat and
  signed administrative requests; a bundled skill teaches Crew agents to use it.
- Authenticated OpenAI-compatible API, defaulting to `127.0.0.1:4863/v1`.
- Typed context-limit errors for client compression/retry, failover on malformed
  provider responses, and safe error messages without raw upstream bodies.

The app uses Kiro Crew's SDK, signed proxy and process lifecycle. Administration
requires a signed host/CLI request; the client API requires a local access key.
Windows private data ACLs restrict access to the owner and administrators.

## Installation boundaries

Kiro Crew must permit this app to execute. A Windows host without a supported
sandbox may require the owner's supported unsandboxed-execution setting. That
setting affects the whole host and provides no OS sandbox isolation. Neither the
installer nor this app changes it or grants itself trust.

Existing standalone installations are untouched by installation. Credentials are
not included or silently imported. Moving an existing installation is a separate
backed-up migration; retire its old process and startup entries only after testing
the replacement. An occupied API port causes a startup error rather than taking
over another process.

## Verification

The packaged runtime checks exercise Kiro proxy authentication, API authentication,
provider failover, streaming, signed mutations, CLI and restart independently of
the standalone application. Browser checks cover all eight pages, three themes,
1280/380 px layouts with long provider text, and navigation cleanup/remount.
Kiro Crew's installer accepts the package manifest; enabling it remains subject
to the destination host's trust and execution policy.

Local Windows result: **128 tests passed, 1 expected POSIX-permission skip, 0
failures**. All eight pages, three themes and both viewport widths passed with
zero browser errors. The bundled Windows installer was exercised against a
separate Kiro Crew data home.

GitHub Actions could not start Windows, Linux or macOS jobs because the repository
owner's account is locked by a billing issue. These are runner startup failures,
not test results. Linux/macOS execution remains unverified for this release.
