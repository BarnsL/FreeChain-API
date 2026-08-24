# FreeChain API Deployment Map

## What It Is

FreeChain is a zero-dependency Node.js HTTP server that presents a single OpenAI-compatible
endpoint (`/v1/chat/completions`) to every app on the machine. Behind that endpoint sits an
ordered failover chain of model providers. The server holds the real provider credentials;
client apps never see them, they only need the one local access key.

## Runtime Requirements

| Requirement | Detail |
|---|---|
| Node.js | >= 20 (ESM, native `fetch`, `node:test`) |
| Dependencies | None. Zero `node_modules`. |
| OS | Any platform Node runs on. Developed on Windows. |
| Network | Outbound HTTPS to provider APIs. Loopback only for the listening socket by default. |

## File Map

```
freechain/
├── bin/
│   └── freechain.mjs          CLI parent. Parses flags and supervises the router worker.
│
├── src/
│   ├── server.js              HTTP server. OpenAI-compatible routes + admin API + static file serving.
│   ├── supervisor.js          Bounded restart/backoff policy and local listener probe.
│   ├── chain.js               Failover walk. Expands chain links into candidates, tries each in order.
│   ├── config.js              Chain loader. Reads chain.config.json and resolves credentials from env.
│   ├── providers.js           Provider catalog. Defines all known providers and their numbered account slots.
│   ├── admin.js               Admin logic. Key masking, access key management, slot key CRUD, live testing.
│   ├── envfile.js             .env reader/writer. Round-trip safe editing of credential files.
│   ├── request-journal.js     Sanitized lifecycle schema, JSONL recovery/rotation, filters, usage meters.
│   ├── runtime.js             Detects a packaged single-executable build so paths resolve next to the exe.
│   └── webui/
│       ├── index.html         Dashboard shell, including the static cooling-error legend beneath the live table.
│       ├── app.css            Full stylesheet and the source-card status-anchor layout contract.
│       └── app.js             Dashboard behaviour; renderOverview paints the state-driven card/table data.
│
├── test/
│   ├── chain.test.js          Failover logic against real local HTTP upstreams.
│   ├── keys.test.js           Credential resolution: slot fan-out, key rotation, env var forms.
│   ├── admin.test.js          .env round-tripping, key masking, access key gating, path traversal.
│   ├── cli.test.js            Isolated no-UI startup and access-key gating.
│   ├── deep-health.test.js    Explicit live-probe auth, rate-limit, redaction, and abort behavior.
│   ├── request-journal.test.js  Schema sanitization, SSE metering, filtering, persistence, and rotation.
│   ├── request-logging.test.js  HTTP auth, usage, failover, cooling, API, CORS, and audit integration.
│   ├── supervisor.test.js     Worker restart delay, recovery, and shutdown behavior.
│   └── source-integrity.test.js  Browser-source contracts that cannot be imported by node:test directly.
│
├── scripts/
│   └── build-release.mjs      Release builder. Bundles to CJS, produces the single executable and zips.
│
├── chain.config.json          Ordered failover chain. No secrets. Safe to commit.
├── .env.example               Template showing every env var the server reads.
├── .env                       [gitignored] Actual credentials. Written by the web UI or by hand.
├── package.json               Project metadata. No runtime dependencies.
├── LICENSE                     MIT
└── .gitignore                  Excludes .env, node_modules, .gitnexus, .claude, CLAUDE.md, AGENTS.md
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                          Clients                                │
│  (editor assistants, agent frameworks, curl, OpenAI SDKs)       │
│              model: "auto"  +  access key                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │  HTTP POST /v1/chat/completions
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    FreeChain Server                               │
│                 http://127.0.0.1:4853                             │
│                                                                  │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────────┐   │
│  │ server.js│──│  admin.js    │──│  webui/ (dashboard)       │   │
│  │          │  │  key CRUD    │  │  index.html + app.css/js  │   │
│  │  routes: │  │  access key  │  └───────────────────────────┘   │
│  │  /v1/*   │  │  masking     │                                  │
│  │  /admin/*│  │  testing     │  ┌───────────────────────────┐   │
│  │  /healthz│  └──────────────┘  │  envfile.js               │   │
│  │  static  │                    │  .env read/write           │   │
│  └────┬─────┘                    └───────────────────────────┘   │
│       │                                                          │
│       ▼                                                          │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                    chain.js                              │    │
│  │  Failover walk: expand links into candidates,            │    │
│  │  try each (link x slot x key) until one answers.         │    │
│  │  Cooldown map: skip rate-limited candidates temporarily. │    │
│  └────┬─────────────────────────────────────────────────────┘    │
│       │                                                          │
│       ▼                                                          │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                   config.js                              │    │
│  │  Loads chain.config.json. Resolves credentials at        │    │
│  │  request time from process.env (seeded from .env).       │    │
│  │  Never writes keys back to disk. Never logs them.        │    │
│  └────┬─────────────────────────────────────────────────────┘    │
│       │                                                          │
│       ▼                                                          │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                  providers.js                            │    │
│  │  Provider catalog. Each provider gets:                   │    │
│  │   - 1 bare slot (e.g. "openrouter")                     │    │
│  │   - 10 numbered slots (openrouter0 .. openrouter9)      │    │
│  │   - Up to 10 keys per slot                              │    │
│  │  Total capacity: 110 credentials per provider family.    │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
                           │
          fetch() to each provider's /chat/completions
                           │
     ┌─────────────────────┼─────────────────────────┐
     ▼                     ▼                         ▼
┌──────────┐      ┌──────────────┐          ┌──────────────┐
│ OmniRoute│      │ OpenCode Zen │          │  OpenRouter   │
│ (local)  │      │              │          │              │
│ :20128   │      │ opencode.ai  │          │openrouter.ai │
│ no key   │      │   /zen/v1    │          │  /api/v1     │
└──────────┘      └──────────────┘          └──────────────┘
                   ... and 8 more provider families ...
```

## HTTP Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/v1/chat/completions` | Access key (Bearer) | Main proxy endpoint. Walks the chain. |
| POST | `/v1/health/deep` | Access key (Bearer) | Explicit live probe. Sends a 1-token request to every configured chain link, no more than once per minute globally. Results contain no provider bodies or credentials. |
| GET | `/v1/models` | Access key (Bearer) | Lists "auto" plus every model in the chain. |
| GET | `/v1/logs` | Access key (Bearer) | Returns the sanitized journal. Supports limit/cursor/status/provider/app/route/search filters, sends `no-store`, and excludes its own reads. |
| GET | `/healthz`, `/v1/status` | None | Credential configuration, cooling state, uptime stats. Does not contact providers. |
| GET | `/admin/state` | None (loopback only) | Full inventory for the dashboard. Keys are masked. |
| GET | `/admin/access-key` | None (loopback only) | Reveals the access key (for copy to clipboard). |
| POST | `/admin/access-key/rotate` | None (loopback only) | Generates a new access key. Immediate effect. |
| POST | `/admin/keys` | None (loopback only) | Save/delete keys for a provider slot. |
| POST | `/admin/test` | None (loopback only) | Send a 1-token probe through a slot. |
| POST | `/admin/chain/reorder` | None (loopback only) | Reorder chain links; persists to `chain.config.json`. |
| GET | `/` | None | Dashboard (index.html). Disabled with `--no-ui`. |
| OPTIONS | `*` | None | CORS preflight. |

## The Failover Chain

The chain in `chain.config.json` is an ordered list of `{ provider, model }` entries.
For each incoming request, the server:

1. **Expands** each chain link into candidates: one per (account slot, key) pair.
2. **Sorts** candidates: non-cooling first, cooling last (demoted but not dropped).
3. **Tries** each candidate via `fetch()` to the provider's `/chat/completions`.
4. **On non-streaming success**: returns the response and reports the serving provider in `X-Freechain-*` headers.
5. **On streaming HTTP success**: reads a bounded SSE prefix until usable model output appears before accepting the candidate.
6. **On retryable failure** (429, 5xx, network error, or early `stream-error`): penalises the candidate with a cooldown and moves to the next.
7. **On fatal failure** (400, 422): stops immediately unless the body identifies a wrapped upstream or nested-router failure.
8. **If all fail**: returns 502 with the list of attempts.

### Default chain order (34 links)

| Priority | Provider | Models | Free? |
|---|---|---|---|
| 1 | OpenCode Zen #1 | Ox Alpha (`x-preview-f-free`) | Yes |
| 2 | OpenRouter | Ox Alpha (`stealth/ox-alpha`) | Yes |
| 3-33 | OpenRouter, OmniRoute, OpenCode Zen #1, NVIDIA, Google, Groq, Cerebras | Verified and existing free fallbacks | Yes |
| 34 | OpenCode Zen #0 | Ox Alpha, retained failing credential pinned last | Yes, but currently unhealthy |

The identifiers were reverified on 2026-08-21 against the official
[OpenCode Zen catalog](https://opencode.ai/docs/zen/) and the
[OpenRouter model catalog](https://openrouter.ai/api/v1/models). OpenCode exposes Ox Alpha Free as
`x-preview-f-free`; OpenRouter exposes Ox Alpha as `stealth/ox-alpha`. Both routes were also
validated with streamed required-tool calls before deployment.

Every OpenCode link before the final row is pinned to account slot 1. A bare OpenCode family link
would fan out across all configured slots and accidentally try the known failing slot near the top.
The final slot remains configured by explicit owner request and is available only after every other
link has been exhausted.

### Streaming first-event gate

An HTTP 200 status is not sufficient proof that an SSE completion started successfully. Routers can
return 200 and place an upstream provider error or only protocol metadata in early data events.
`dispatch()` therefore owns the response until it sees a complete SSE event carrying usable model
output:

1. Scan at most 64 KiB of complete SSE prefix events, including comments and keepalives. If a
   usable event ends early inside a larger transport chunk, retain and replay that whole chunk.
2. Parse `data:` lines without re-encoding the raw bytes.
3. Reject an explicit error event, top-level JSON `error`, malformed data event, empty close,
   `[DONE]` before usable output, read failure, or exceeded prefix ceiling.
4. Record `stream-error`, cool that candidate, and continue through normal failover.
5. Treat substantive nested values in content, refusal, reasoning, reasoning details, audio,
   function calls, and tool calls as usable output. Structural IDs, indexes, roles, type tags,
   signatures, annotations, metadata, status fields, empty deltas, keepalives, comments, and
   usage-only events remain buffered and do not commit the route.
6. For usable output, replay every buffered byte exactly and continue from the same upstream reader.

After the first usable output event reaches the client, FreeChain cannot retry a later stream failure
without risking duplicated text or tool calls. The client receives that later failure or truncation.
This is the intentional boundary between reliable early failover and genuine streaming.

## Credential System

### How keys are stored

Keys live in `.env` (gitignored, file permissions 0600 on Unix). Three env var forms per slot:

```
FREECHAIN_OPENROUTER_API_KEY     = sk-one           # singular
FREECHAIN_OPENROUTER_API_KEYS    = sk-one,sk-two    # comma/space list
FREECHAIN_OPENROUTER_API_KEY_1   = sk-one           # numbered, 1..10
```

All three forms combine; duplicates are collapsed. The web UI writes the plural form.

### Account slots

Every provider family has 11 slots: 1 bare + 10 numbered (0..9).
Rate limits are typically per-account, so multiple slots let the chain exhaust one
account's quota and continue on the next before downgrading to a weaker model.

### Vendor fallback

The bare slot also checks the provider's conventional env var (e.g. `OPENROUTER_API_KEY`),
so existing environments work without renaming.

### Access key

A locally generated `fc-...` token that gates `/v1/chat/completions` and `/v1/health/deep`.
Generated on the first server start, including `--no-ui`, stored in `.env` as
`FREECHAIN_ACCESS_KEY`, and compared in constant time. Can be
rotated from the dashboard.

## Security Model

- **Loopback only by default.** `--host 0.0.0.0` must be explicitly passed; the server
  warns when bound to anything other than 127.0.0.1.
- **Keys never leave the server.** The admin API returns masked keys. The `inventory()`
  function masks every key before it touches the response. The test suite asserts this.
- **Access key gating.** Chat, deep health, model discovery, and journal reads are checked against
  the access key. Without it, other processes on the machine cannot spend provider credentials,
  trigger external probes, or inspect operational metadata.
- **Constant-time comparison.** `crypto.timingSafeEqual` prevents timing attacks on the
  access key.
- **Path traversal prevention.** Static file serving checks that the resolved path starts
  with the webui directory. The test suite asserts `../../package.json` is refused.
- **.env file permissions.** Written with mode 0600 (owner-only) on Unix.
- **No secrets in chain.config.json.** The config file is safe to commit. It contains
  provider names and model IDs only.
- **Request body size limit.** 8 MB cap on POST bodies to prevent memory exhaustion.
- **Fixed journal schema.** The journal retains no prompt/response content, tool bodies,
  credentials, arbitrary headers, raw IP addresses, or raw provider diagnostics. Files use mode
  0600 where supported, rotate at 5 MiB, retain one predecessor, and recover past malformed lines.

## Configuration

### CLI flags

```
freechain [--port 4853] [--host 127.0.0.1] [--chain <file>] [--verbose] [--no-ui]
          [--log <path>] [--no-log]
freechain --status     # show which links have credentials, then exit
```

`--worker` is an internal flag used by the normal launcher. Do not use it for
manual starts: the default command is the supervising parent. A worker crash
restarts after 1, 2, 4, 8, 16, then a maximum of 30 seconds. If the selected
endpoint already responds, the parent exits without disturbing that instance.
The supervisor does not replace a Windows sign-in or reboot launcher. `--log`
selects the JSONL path. `--no-log` disables disk persistence but preserves the
newest 500 in-memory records for the API and dashboard.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `FREECHAIN_PORT` | 4853 | Listening port |
| `FREECHAIN_HOST` | 127.0.0.1 | Bind address |
| `FREECHAIN_ACCESS_KEY` | auto-generated | Gates `/v1/*` requests |
| `FREECHAIN_ENV_FILE` | `.env` in project root | Override credential file location |
| `FREECHAIN_<PROVIDER>_API_KEY[S]` | (none) | Provider credentials |

### chain.config.json settings

| Key | Default | Purpose |
|---|---|---|
| `requestTimeoutMs` | 90000 | Per-candidate timeout |
| `cooldownMs` | 60000 | How long a failed candidate is skipped |
| `maxAttempts` | (all) | Cap on candidates tried per request |

## Web Dashboard

Five pages served at `http://127.0.0.1:4853/`:

1. **Overview**: endpoint URL, configured links/total, candidate count, requests served/failed,
   per-source status cards, cooling-off table, and a static HTTP-error legend immediately below it.
2. **Access key**: reveal/copy/rotate the local API key. Code snippets (curl, Python, Node,
   env vars, editor settings) with live key substitution.
3. **Model sources**: per-provider slot grid. Add/remove keys, test connectivity.
4. **Chain**: ordered table of all chain links with credential status.
5. **Logs**: filtered request and admin lifecycle metadata, request correlation, client-reported
   app/session, attempt trails, exact/estimated token summaries, errors, and cooling. It refreshes
   every 10 seconds only while visible and keeps the last safe snapshot marked stale after errors.

Plain HTML/CSS/JS. No framework, no build step, no CDN. Dark theme, responsive layout.
State is refetched from `/admin/state` after every mutation and on a 10-second poll.

### Request journal data flow

1. `bin/freechain.mjs` creates one `RequestJournal` per supervised worker. The default path is
   `logs/requests.jsonl` under the source or packaged runtime root.
2. `src/server.js` creates a UUID and safe client/network metadata before authentication for every
   journaled route. A finish/close guard writes exactly one terminal record.
3. Authentication rejects are recorded before body parsing with
   `inputSummary: unavailable-before-auth`. Authenticated chat bodies are reduced immediately to
   model, streaming, role/count, character, tool-count, and max-token metadata.
4. `dispatch()` remains the routing authority. It classifies an early HTTP 200 SSE failure as
   `stream-error` before accepting a route. The server copies only provider/model/key ordinal,
   outcome, status, and latency from each attempt. Attempt detail and provider bodies are dropped by
   the journal allowlist.
5. JSON replies are summarized after receipt. SSE chunks are counted as they pass through and only
   a partial line buffer is held. Exact provider usage wins; otherwise input/output characters are
   converted to a clearly labelled four-character estimate.
6. `GET /v1/logs` authenticates through the normal access-key matcher, filters the in-memory view,
   returns `Cache-Control: no-store`, and never creates another record. The dashboard obtains the
   key through its existing same-origin reveal path and retains it in page memory only.
7. `src/webui/app.js` paints the summary, filters, compact rows, expandable safe details, and
   loading/empty/error/stale states. `test/source-integrity.test.js` protects the browser-only
   navigation and state contract.

## Dashboard data and layout contract

This section is the handoff map for the Overview page. Keep these files in sync when changing its
status cards or cooling guidance:

1. `src/server.js` serialises `cooldowns.snapshot()` as the `cooling` array in `/admin/state`.
   Each row contains a candidate identifier, the last stored error, and the remaining cooldown seconds.
2. `src/webui/app.js` calls `renderOverview()` after every state refresh. It filters providers that
   occur in the configured chain and renders the dynamic source cards and cooling table from that
   response. It does not issue a health probe.
3. `src/webui/app.css` makes `source-card-header` a two-column grid: the label receives the flexible
   column and the badge occupies the fixed trailing column. Long labels may wrap, but every `ready`
   or `no key` badge remains pinned to the same card-relative position.
4. `src/webui/index.html` owns `#coolingErrorLegend`, directly after `#coolingBox`. The legend is
   static because it explains the failover policy, while the table is dynamic because it shows only
   the candidates cooling right now.
5. `test/source-integrity.test.js` is the regression guard for this browser-only contract. It checks
   the semantic hooks, grid declaration, legend groups, and the existence of this handoff section;
   browser verification remains necessary for final layout confirmation.

### Opt-in retention

The journal stores metadata by default: who called, which provider answered,
how long it took, how many tokens. None of the traffic itself is written. A
host debugging their own router can change that on **Chat → Settings → Log
policy**, one switch at a time:

| Switch | What it writes |
|---|---|
| `promptSummary` | The newest few messages, truncated, with URLs, paths, emails and key-shaped strings stripped |
| `rawPrompts` | `messages` verbatim, unredacted |
| `rawResponses` | Model output verbatim, streaming included |
| `rawToolBodies` | `tools` and `tool_choice` verbatim |
| `credentials` | The bearer token each caller presented, in clear text |

Four properties hold regardless of how the switches are set:

1. **Fail closed.** Every switch requires an explicit `true`. A missing policy,
   an empty policy, or a truthy-but-not-`true` value all capture nothing —
   `summarizeInput(body)` with no policy is metadata-only.
2. **The cap is not negotiable.** Policy decides whether a field is captured,
   never how large it may grow. `RAW_HARD_CAP` (64k characters) is applied on
   persist whatever `maxRawChars` asked for, and truncation is marked in the
   stored value rather than done silently, so the journal's 5 MiB rotation
   budget cannot be consumed by one enormous request.
3. **The model cannot turn these on.** `set_log_policy` is an allowlisted
   operator action, but `stripHumanOnlyLogFlags()` removes the four content
   switches from anything the model proposes. Enabling them requires a human on
   the Settings tab. The system prompt says the same thing; this is the part
   that enforces it.
4. **The Logs page states the policy in force.** Its retention callout ships
   hidden and empty, and `renderRetentionNotice()` fills it from the live
   settings only while something is actually being retained. There is no static
   "never stored" sentence to become a lie: the page is silent when nothing is
   captured and amber when something is, which is the only arrangement that
   stays true at the moment it matters.

#### On `credentials`

This one is different in kind, and worth being blunt about. It writes working
bearer tokens to `logs/requests.jsonl` in clear text. Anyone who can read that
file — a backup, a screen share, a stray `git add -f` — has working keys, and
recovering means rotating every provider key in the chain.

It answers exactly one question well: *what did this app actually send?*, when
a key is being rejected and the caller's config is not visible. `keyIndex` on
each attempt already tells you which stored key was used, so for anything else
you almost certainly do not need this. Turn it on, reproduce the failure, turn
it off, then clear the journal from the operator.

### Chat page

The operator surface is a page inside the dashboard (`#page-chat`, nav key
`chat`, directly after Logs), not a separate document. It previously shipped as
a standalone `/operator.html` with its own stylesheet; that drifted visually
from the dashboard immediately, so the page, its markup and its styles now live
in `index.html`, `app.css` and `operator.js` alongside everything else.

`src/webui/operator.js` is kept deliberately in step with SubChain's file of the
same name — the two dashboards present the same surface, so a fix to one belongs
in the other. Every id on the page is namespaced `op*` to stay clear of the
dashboard's own ids, and the whole page is loaded lazily on first visit so it
costs nothing until opened.

Guarantees the page must keep:

- all `/admin/operator/*` routes are loopback-only and reject cross-site
  mutations;
- the model receives sanitized status only — never provider keys, prompts, or
  responses;
- a model proposal is inert. It becomes a pending action from a fixed allowlist,
  and only an explicit confirm request reaches the executor;
- prompt-summary retention is opt-in, exposed on the Settings tab.

### Text containment

Shared rule with the other two chain dashboards: no string may overflow its card, and the page
itself never scrolls sideways. `src/webui/app.css` ends with a zero-specificity `:where()` block
that gives every card-like container `min-width: 0` and `overflow-wrap: anywhere`, and pushes
anything genuinely unwrappable (`<pre>`, tables) into its own horizontal scroll box.

It is structural rather than per-component on purpose. Provider ids, model names, base URLs, request
ids, key chips and raw upstream error text are all lengths this project does not control, so fixing
one card only moves the bug to the next card someone adds. Writing the block with `:where()` keeps
its specificity at zero, so deliberate widths set elsewhere still win.

Change it in FreeChain, SubChain and VisionChain together, and verify at 1280px and at 380px.

### Grids size on the container, not the viewport

A card grid must be `repeat(auto-fit, minmax(<real minimum>, 1fr))`, never a fixed column count
with a media query as its escape hatch.

The failure this prevents is not hypothetical. The Logs summary was `repeat(4, minmax(0, 1fr))`
relaxed to two columns below an 880px viewport. At a 960px window the 248px sidebar is still
present, so the content column is only ~620px: above the breakpoint, but four tiles wide. Each
tile got 105px of usable width for a 95px label, and the filter row — a fixed five columns —
clipped its placeholders to "chain or provide". The viewport was never the constraint; the
container was, and a viewport media query cannot see it.

`minmax(0, ...)` is the specific trap. It permits a track to shrink to nothing, which is right for
a scroll container and wrong for anything holding text. Give every text-bearing track a minimum it
can actually be read at.

Verify by narrowing the window with the sidebar visible, not by narrowing past the breakpoint —
the bug lives between those two states.


### Cooling error classifications

`src/chain.js` treats a genuine HTTP 400 or 422 caller-request failure as fatal, so it stops the chain
and does not add a cooldown. A nested router can wrap a server-side failure in one of those statuses;
specific upstream-error markers and OmniRoute's diagnostic pool envelope advance instead. Every
other HTTP status, timeout, network error, and early `stream-error` belongs to the individual
candidate. FreeChain records it in the cooling snapshot, temporarily demotes that candidate, and
continues to the next candidate. HTTP 429 may use a provider `Retry-After` value, capped at five
minutes; other cooldowns use `chain.config.json`'s `cooldownMs`.

The Overview's `ready` badge is deliberately not a reachability claim. It says only that the
provider has a configured key or is key-optional. Use the explicit deep-health endpoint or a live
request when the question is whether an upstream provider currently answers.

## GitNexus integration boundary

GitNexus can use FreeChain as the active OpenAI-compatible Nexus AI provider while the indexed
repository is also FreeChain itself. These are separate roles:

```text
GitNexus provider settings
  -> FreeChain at http://127.0.0.1:4853/v1, model auto
  -> sanitized provider identity in Nexus AI context
  -> provider/model/repository/request badges in the GitNexus UI

FreeChain repository index
  -> application surfaces and execution processes
  -> FreeChain-specific trigger guide
  -> graph citations and expected dashboard results

GitNexus managed runtime action
  -> GitNexus-owned FreeChain process with runtime probes
  -> function events in the bottom Runtime Activity dock
```

Provider health does not prove runtime tracing. A FreeChain process that was started outside
GitNexus can answer Nexus AI requests normally while the Runtime Activity dock remains at zero.
FreeChain's supervisor exits successfully when it detects an existing listener. GitNexus now reports
that terminal result as an external, untraced app instead of leaving the start card at `running`.

### Operator sequence

1. Start or verify GitNexus on loopback port 4747 and open its web UI, normally on port 5173 in
   development.
2. In GitNexus AI Settings, choose the FreeChain custom provider, OpenAI compatibility, loopback port
   4853, and a tool-capable model. The verified route uses `openai/gpt-oss-120b`. Use the access key
   through the existing credential field; never place it in repository documentation or graph context.
3. Select the FreeChain index. Confirm Nexus AI identifies FreeChain as its provider and FreeChain as
   the indexed application.
4. Ask Nexus for a dashboard or API trigger path. The guide should name exact FreeChain controls,
   explain which indexed process is expected to run, describe the visible dashboard result, and cite
   repository nodes.
5. If trace events are required, resolve the current port-4853 PID and executable before stopping
   anything. Stop only the verified FreeChain parent, then use GitNexus's confirmed managed action.
6. Exercise the guided FreeChain UI or API path and confirm function events appear in GitNexus's
   bottom dock. GitNexus must never stop an external FreeChain process it did not start.

### Failure interpretation

| Observation | Meaning | Recovery |
|---|---|---|
| Nexus request succeeds, Runtime Activity stays at zero | FreeChain provider transport works, but the process is external or uninstrumented | Keep it external or perform a controlled managed restart |
| GitNexus reports FreeChain already running outside GitNexus | Port 4853 belongs to a pre-existing process | Verify ownership; do not click Stop because GitNexus does not own it |
| Provider badge is missing or names another provider | The current browser profile has different AI settings | Open AI Settings in that profile and save the intended FreeChain provider |
| Tool card reports that the provider ended before the result | The selected model route did not complete GitNexus tool calling | Use a tool-capable route such as the verified `openai/gpt-oss-120b` model |
| A previously saved browser profile returns 401 after the 2026-08-17 proof | The local access key was rotated after a diagnostic surface exposed the prior token | Copy the current key from the FreeChain dashboard into that browser profile and save it again |
| Guide has low confidence or missing steps | The current index lacks enough deterministic UI/runtime evidence | Refresh the index and inspect the cited files before acting |
| FreeChain `ready` badge shows but a request fails | The badge means configured, not live upstream reachability | Use the authenticated deep-health route or a real bounded request |

The corresponding GitNexus deployment map is `docs/RUNTIME-ACTIVITY-DEPLOYMENT.md` in the
`codex/runtime-gui-controls` worktree. Its rollback anchor is commit `6f304340`, branch
`codex/runtime-intelligence-milestone-2026-08-16`, and tag
`milestone/runtime-intelligence-2026-08-16`.

### Live proof, 2026-08-17

An isolated GitNexus build used FreeChain as its visible provider against this indexed repository.
The provider/model/repository badges were correct, the request lifecycle completed visibly, and the
FreeChain served counter moved from 45 to 53 across successful guide and edit flows. Nexus rendered
a structured FreeChain application guide and correctly reported that the existing port-4853 process
was external and untraced. The instrumented startup attempt emitted 35 Node events before exiting on
the existing listener, which proved the event transport and bottom-table layout without claiming
ownership of the external process.

The one-file edit proof changed `ISSUES.md` only after exact-diff review. GitNexus Undo restored the
pre-apply SHA-256 byte-for-byte and removed the temporary marker. A diagnostic accessibility dump
exposed the prior loopback access token during setup, so the access key was rotated immediately and
the isolated browser profile was rebound. Any other browser profile with the old token must be
refreshed from the local dashboard.

## Running

```bash
# Start with defaults (port 4853, loopback, dashboard on)
node bin/freechain.mjs

# Check credential status without starting
node bin/freechain.mjs --status

# Custom port, verbose logging
node bin/freechain.mjs --port 8080 --verbose
```

The standard command launches a parent and a router worker. Ctrl+C sends a
clean stop to both. An unexpected worker exit keeps the same configured port
and is restarted with bounded backoff; no scheduled task or external process
manager is required for that recovery.

## Testing

```bash
node --test "test/*.test.js"
```

Thirteen test files use Node's built-in test runner. Provider and server integration tests use real
local HTTP servers; deterministic stream-boundary tests use controlled Web Streams. The current
suite contains 111 tests, with one expected Windows permission skip.

- **admin.test.js** (23 tests): environment-file round-tripping, key masking, access-key gating,
  settings persistence, path traversal, dashboard serving, and shortcut boundaries.
- **chain.test.js** (20 tests): failover, fatal stops, wrapped errors, cooling, model pinning,
  streamed usable-output gating, nested output-field coverage, exact replay, metadata-only starts,
  oversized chunks, aborts, and server routes.
- **cli.test.js** (2 tests): help controls and no-UI access-key startup.
- **deep-health.test.js** (4 tests): probe redaction, rate limiting, access control, and disconnect cancellation.
- **default-chain.test.js** (1 test): the shipped chain contains no paid fallback.
- **guide.test.js** (7 tests): chapter coverage, navigation, source attribution, deep links, and generated-doc sync.
- **harness.test.js** (9 tests): Harness persistence, activation, composition, metadata, and live request application.
- **keys.test.js** (20 tests): variable forms, slot isolation, vendor fallback, fan-out ordering, and candidate rotation.
- **operator-control-plane.test.js** (3 tests): inert proposals, failover diagnosis, and raw-retention protection.
- **request-journal.test.js** (9 tests): summaries, sanitization, persistence, rotation, and opt-in raw capture.
- **request-logging.test.js** (4 tests): authentication, usage, streaming failover, CORS, and metadata-only audits.
- **source-integrity.test.js** (6 tests): control bytes and dashboard structure contracts.
- **supervisor.test.js** (3 tests): bounded restart delay, worker recovery, and clean stop.

## Provider Families

| ID | Label | Base URL | Free tier? | Key required? |
|---|---|---|---|---|
| `omniroute` | OmniRoute | `http://127.0.0.1:20128/v1` | N/A (local) | No |
| `opencode-zen` | OpenCode Zen | `https://opencode.ai/zen/v1` | Yes | Yes |
| `openrouter` | OpenRouter | `https://openrouter.ai/api/v1` | Yes (`:free` suffix) | Yes |
| `longcat` | LongCat | `https://api.longcat.chat/openai/v1` | No | Yes |
| `groq` | Groq | `https://api.groq.com/openai/v1` | Yes (limited) | Yes |
| `cerebras` | Cerebras | `https://api.cerebras.ai/v1` | Yes (limited) | Yes |
| `nvidia` | NVIDIA NIM | `https://integrate.api.nvidia.com/v1` | Yes (limited) | Yes |
| `deepseek` | DeepSeek | `https://api.deepseek.com/v1` | No | Yes |
| `google` | Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` | Yes (limited) | Yes |
| `openai` | OpenAI | `https://api.openai.com/v1` | No | Yes |
| `local` | Local server | `http://127.0.0.1:11434/v1` | N/A | No |
