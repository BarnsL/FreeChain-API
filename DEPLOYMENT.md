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
│   └── webui/
│       ├── index.html         Dashboard shell. Sidebar nav, four page sections, toast overlay.
│       ├── app.css             Full stylesheet. Dark theme, shadcn token convention, responsive.
│       └── app.js             Dashboard behaviour. State fetch, provider/chain/access-key rendering.
│
├── test/
│   ├── chain.test.js          Failover logic against real local HTTP upstreams.
│   ├── keys.test.js           Credential resolution: slot fan-out, key rotation, env var forms.
│   ├── admin.test.js          .env round-tripping, key masking, access key gating, path traversal.
│   ├── cli.test.js            Isolated no-UI startup and access-key gating.
│   ├── deep-health.test.js    Explicit live-probe auth, rate-limit, redaction, and abort behavior.
│   └── supervisor.test.js     Worker restart delay, recovery, and shutdown behavior.
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
4. **On success**: returns the response, reports the serving provider in `X-Freechain-*` headers.
5. **On retryable failure** (429, 5xx, network error): penalises the candidate with a cooldown, moves to the next.
6. **On fatal failure** (400, 422): stops immediately. OmniRoute's diagnostic 400 for an exhausted internal pool is the one exception and advances the outer chain.
7. **If all fail**: returns 502 with the list of attempts.

### Default chain order (14 links)

| Priority | Provider | Models | Free? |
|---|---|---|---|
| 1-2 | OmniRoute (local) | auto/coding:free, auto/best-free | Yes (no key needed) |
| 3-6 | OpenCode Zen | 4 free models | Yes |
| 7-14 | OpenRouter | 8 free models | Yes |

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
- **Access key gating.** Every `/v1/chat/completions` and `/v1/health/deep` request is checked
  against the access key. Without it, other processes on the machine cannot spend provider
  credentials or trigger external probes.
- **Constant-time comparison.** `crypto.timingSafeEqual` prevents timing attacks on the
  access key.
- **Path traversal prevention.** Static file serving checks that the resolved path starts
  with the webui directory. The test suite asserts `../../package.json` is refused.
- **.env file permissions.** Written with mode 0600 (owner-only) on Unix.
- **No secrets in chain.config.json.** The config file is safe to commit. It contains
  provider names and model IDs only.
- **Request body size limit.** 8 MB cap on POST bodies to prevent memory exhaustion.

## Configuration

### CLI flags

```
freechain [--port 4853] [--host 127.0.0.1] [--chain <file>] [--verbose] [--no-ui]
freechain --status     # show which links have credentials, then exit
```

`--worker` is an internal flag used by the normal launcher. Do not use it for
manual starts: the default command is the supervising parent. A worker crash
restarts after 1, 2, 4, 8, 16, then a maximum of 30 seconds. If the selected
endpoint already responds, the parent exits without disturbing that instance.
The supervisor does not replace a Windows sign-in or reboot launcher.

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

Four pages served at `http://127.0.0.1:4853/`:

1. **Overview**: endpoint URL, configured links/total, candidate count, requests served/failed,
   per-source status cards, cooling-off table.
2. **Access key**: reveal/copy/rotate the local API key. Code snippets (curl, Python, Node,
   env vars, editor settings) with live key substitution.
3. **Model sources**: per-provider slot grid. Add/remove keys, test connectivity.
4. **Chain**: ordered table of all chain links with credential status.

Plain HTML/CSS/JS. No framework, no build step, no CDN. Dark theme, responsive layout.
State is refetched from `/admin/state` after every mutation and on a 10-second poll.

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

Three test files, all using Node's built-in test runner against real local HTTP servers:

- **chain.test.js** (11 tests): failover walk, rate-limit advance, fatal stop, OmniRoute
  diagnostic fallback, cooling
  demotion, model pinning, streaming pass-through, server routes.
- **keys.test.js** (14 tests): all env var forms, slot isolation, vendor fallback, fan-out
  ordering, candidate expansion, cross-slot rotation.
- **admin.test.js** (10 tests): .env round-tripping, key masking, access key gating,
  constant-time compare, path traversal, dashboard on/off.
- **cli.test.js** (1 test): no-UI startup generates and requires the access key.
- **deep-health.test.js** (4 tests): explicit probe redaction, rate limit, access control,
  and client-disconnect cancellation.
- **supervisor.test.js** (2 tests): bounded restart delay, worker recovery, and clean stop.

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
