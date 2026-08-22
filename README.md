# FreeChain-API

One OpenAI-compatible endpoint in front of an ordered chain of model providers.
Point any OpenAI-speaking client at it, ask for the model `auto`, and the chain
is walked until something answers.

Built because most tools accept exactly one model and one API key. A free tier
that rate-limits at the wrong moment takes the whole feature down, and there is
nowhere in the client to express "try this, then that". FreeChain is that
nowhere.

```
client ──► http://127.0.0.1:4853/v1  (model: "auto")
                    │
                    ├─ 1  opencode-zen1  x-preview-f-free      ← Ox Alpha, pinned healthy slot
                    ├─ 2  openrouter      stealth/ox-alpha      ← Ox Alpha, all healthy slots
                    ├─ 3  openrouter      Nemotron Ultra :free
                    ├─ 4  omniroute       auto/coding:free      ← self-hosted, if running
                    ├─ …  direct and routed free fallbacks
                    └─ 34 opencode-zen0  x-preview-f-free      ← retained unhealthy slot, last
```

No runtime dependencies. Runs on Windows, macOS, and Linux.

## v0.6.1 hotfix

- **Logs stay inside their cards:** the desktop log grid now lets its flexible
  columns shrink with the available dashboard width. At 1280 px, long request
  ids and provider metadata remain contained without pushing the chevron past
  the log-record border or creating page overflow.
- **Shared UI contract restored:** the canonical card-containment selector
  block is byte-identical across FreeChain, SubChain, and VisionChain again.
  The 380 px mobile log layout is unchanged.

## v0.6.0 highlights

- **Ox Alpha first:** the healthy OpenCode Zen slot is first and OpenRouter Ox
  Alpha is second. Numbered provider ids pin account ownership, so a retained
  unhealthy OpenCode credential stays configured only at the final link.
- **Reliable streamed failover:** an HTTP 200 stream is accepted only after its
  first meaningful SSE event is valid. Early error envelopes, malformed starts,
  empty closes, and bounded-prefix failures cool that candidate and advance the
  chain without leaking raw provider details.
- **Operator controls:** the Chain page exposes timeout, cooldown, maximum
  attempts, and wrapped-upstream-error behavior. Changes persist and apply live.
- **Harness and Guide:** the dashboard includes the complete Harness editor and
  a twelve-chapter offline Guide with matching repository documentation.
- **Privacy-safe operations:** request lifecycle, attempts, usage, errors, and
  cooldowns remain visible in Logs without retaining conversation content by
  default.

## Install

### Download a build (no Node needed)

Grab the archive for your platform from the
[latest release](https://github.com/BarnsL/FreeChain-API/releases/latest),
unzip it, and run the `freechain` executable inside. Node is bundled into the
binary, so nothing else needs installing.

| Download | For |
|---|---|
| `freechain-win32-x64.zip` | Windows |
| `freechain-darwin-arm64.zip` | macOS (Apple Silicon) |
| `freechain-linux-x64.zip` | Linux |
| `freechain-portable-node.zip` | Any OS, if you already have Node 20+ — a few hundred KB instead of ~90 MB |

Keys you add are written to a `.env` file created next to the executable, so
the whole folder stays self-contained and portable.

macOS marks downloaded binaries as quarantined. If Gatekeeper blocks it:

```bash
xattr -d com.apple.quarantine ./freechain
```

### Run from source

Needs Node 20+.

```bash
cp .env.example .env
```

Fill in the keys you have, then check what resolved:

```bash
node bin/freechain.mjs --status
```

```
ok   opencode-zen1  1 key / 1 slot     x-preview-f-free
ok   openrouter     2 keys / 2 slots   stealth/ox-alpha  [openrouter openrouter0]
ok   openrouter     2 keys / 2 slots   nvidia/nemotron-3-ultra-550b-a55b:free  [openrouter openrouter0]
...
ok   opencode-zen0  1 key / 1 slot     x-preview-f-free

34/34 links configured, 43 candidate(s) to try.
```

```bash
node bin/freechain.mjs
```

```
freechain    http://127.0.0.1:4853/v1
dashboard    http://127.0.0.1:4853/
chain        34/34 links configured
journal      <runtime>/logs/requests.jsonl
```

Flags: `--port`, `--host`, `--chain <file>`, `--verbose`, `--no-ui`,
`--log <path>`, and `--no-log`. The last flag disables disk persistence but
keeps the bounded in-memory Logs view and API.

You don't need a key to start — open the dashboard and add one there.

### Local resiliency

The normal launcher is a small supervisor. It keeps the fixed endpoint on the
same port and restarts its router worker after an unexpected exit, waiting 1,
2, 4, 8, 16, then at most 30 seconds between attempts. Ctrl+C and normal
termination stop both processes cleanly. Starting the command again while the
endpoint is already live leaves the existing instance alone.

This is crash recovery after FreeChain has been launched. It cannot start a
process after a full reboot, so launch FreeChain once after signing in if you
need it then.

### Building the release artifacts

```bash
npm install
node scripts/build-release.mjs
```

Writes the executable and both zips for the current platform into `dist/`.
Single-file executables cannot be cross-compiled, so each platform is built on
its own CI runner (`.github/workflows/release.yml`) when a `v*` tag is pushed.

## Dashboard

Open `http://127.0.0.1:4853/` for a web console covering everything below:

- **Overview** — endpoint, configured links, candidate count, requests served, and
  which candidates are cooling off after a rate limit.
- **Access key** — the one fixed key your apps use, with show/hide, copy and
  rotate, plus ready-made snippets for curl, Python, Node, env vars and
  editor GUIs. Snippets show a placeholder until you reveal the key, so a
  screenshot of the default view leaks nothing.
- **Model sources** — every provider, its account slots, and the keys in each,
  with a one-request **Test** button per slot and a direct link to that
  provider's key page.
- **Chain** — the ordered chain and each link's credential configuration state,
  with drag reordering and live failover settings for request timeout, cooldown,
  candidate limits, and wrapped upstream errors.
- **Harness** — identity, operating, safety, tool, reasoning, output, behavior
  and persona components, plus generation and infrastructure defaults, model
  aliases and custom request metadata. One Harness in the library is active and
  composes every request the access key serves. Same component vocabulary and
  file format as SubChain. [docs/harness/README.md](docs/harness/README.md) is
  the practical guide,
  [docs/harness/enforcement-boundaries.md](docs/harness/enforcement-boundaries.md)
  states field by field what FreeChain enforces as opposed to merely prompts for,
  and [docs/HARNESS.md](docs/HARNESS.md) is the component reference.
- **Guide** — a first-class, offline learning page between Harness and Logs.
  Twelve original chapters (agents, prompting weaker models, skills, browsers,
  MCP, RAG, the AI stack, fine-tuning, accelerators) each state what FreeChain
  enforces versus what the calling application must provide, using the same
  enforcement vocabulary as the Harness page. Every instruction component
  deep-links into it. Informed by ByteByteGo's *12 AI Visuals* as a learning
  framework, credited and linked, with original diagrams rather than copied
  graphics. Mirrored for repo reading under
  [docs/user-guide/](docs/user-guide/README.md).
- **Logs** — newest-first request and admin lifecycle metadata, filters, token
  summaries, latency, provider attempts, error classifications, and cooling.
  Metadata only unless you deliberately turn on retention under **Chat →
  Settings → Log policy**; when you do, the Logs page says so in a warning it
  only shows while something is actually being retained.

The dashboard writes to `.env` on this machine. Provider keys are returned to
the page **masked only** (`sk-or••••••1234`) — the browser can prove a key
exists and delete it, but can never read one back. Only the access key, which
exists to be copied into other apps, is revealed on request. `--no-ui` disables
the dashboard and the admin API entirely.

### The access key

FreeChain generates one on first run and stores it in `.env`. Every request to
`/v1/*` must present it:

```
Authorization: Bearer fc-…
```

This is what stops any other process on the machine from spending your provider
credentials, and it means revoking access to every app at once is one click —
no provider account is touched. Rotating takes effect immediately.

## API keys

Every provider is optional. Links whose provider has no key are skipped, so a
partly filled `.env` just gives you a shorter chain. The providers the default
chain is built around:

| Provider | Env base name | Where to get a key | Notes |
|---|---|---|---|
| **OpenRouter** | `FREECHAIN_OPENROUTER_API_KEY` | [openrouter.ai/keys](https://openrouter.ai/keys) | Free `:free` model variants, generous catalogue |
| **OpenCode Zen** | `FREECHAIN_OPENCODE_ZEN_API_KEY` | [opencode.ai/zen](https://opencode.ai/zen) | Several zero-cost models |
| **OmniRoute** | `FREECHAIN_OMNIROUTE_API_KEY` | self-hosted | Loopback router; usually needs **no key** |
| **Groq** | `FREECHAIN_GROQ_API_KEY` | [console.groq.com/keys](https://console.groq.com/keys) | Fast free-tier inference, several open models |
| **Cerebras** | `FREECHAIN_CEREBRAS_API_KEY` | [cloud.cerebras.ai](https://cloud.cerebras.ai/) | Free-tier direct API |
| **NVIDIA NIM** | `FREECHAIN_NVIDIA_API_KEY` | [build.nvidia.com](https://build.nvidia.com/) | Large catalogue; coverage varies by model |
| **Google Gemini** | `FREECHAIN_GOOGLE_API_KEY` (or `GEMINI_API_KEY`) | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | OpenAI-compatible endpoint, free-tier models |

Also defined in `src/providers.js`, unused until you add chain entries for them:
`longcat`, `deepseek`, `openai`, and `local` (Ollama, LM Studio, llama.cpp,
vLLM — no key needed).

Each provider also accepts the plain vendor variable as a fallback, so an
existing `OPENROUTER_API_KEY` in your environment is picked up without renaming.

### Account slots

Every provider has ten numbered account slots, `<provider>0` through
`<provider>9`, alongside the bare name. A slot is one account on that service.
Slots are deliberately generic — no account is ever identified by a person, a
handle, or an organisation.

```bash
FREECHAIN_OPENROUTER_API_KEY=sk-a     # the bare account
FREECHAIN_OPENROUTER0_API_KEY=sk-b    # slot 0
FREECHAIN_OPENROUTER1_API_KEY=sk-c    # slot 1  … up to slot 9
```

Rate limits are per **account**, not per provider. A chain entry naming the
bare provider fans out across every slot you have configured, so a 429 on one
account is retried on the next — same model, no downgrade — before the chain
moves on. Adding an account is an edit to `.env`, never to `chain.config.json`.

To pin an entry to one account, name the slot as its provider:

```json
{ "provider": "openrouter3", "model": "openai/gpt-oss-20b:free" }
```

The vendor fallback (`OPENROUTER_API_KEY`) applies to the bare account only;
slots are explicit by nature.

### Multiple keys per slot

Each slot holds up to **10 keys**, in three interchangeable forms:

```bash
FREECHAIN_OPENROUTER0_API_KEY=sk-a                # one key
FREECHAIN_OPENROUTER0_API_KEYS=sk-a,sk-b,sk-c     # comma or whitespace list
FREECHAIN_OPENROUTER0_API_KEY_1=sk-a              # numbered, 1..10
FREECHAIN_OPENROUTER0_API_KEY_2=sk-b
```

Mix them freely. They combine in that order, duplicates are collapsed, and
numbered slots may be sparse. Ten slots of ten keys, plus the bare account, is
up to **110 credentials per provider**.

Credentials are read fresh on each request, so adding one to `.env` takes
effect without a restart.

## Using it

Any OpenAI client works. Base URL `http://127.0.0.1:4853/v1`, model `auto`, and
the access key from the dashboard — FreeChain holds the real provider
credentials, so no provider key ever ends up in an app's config or a browser.

```bash
curl http://127.0.0.1:4853/v1/chat/completions \
  -H 'Authorization: Bearer YOUR_ACCESS_KEY' \
  -H 'Content-Type: application/json' \
  -H 'X-FreeChain-App: My App' \
  -H 'X-FreeChain-Session-Id: optional-session-id' \
  -d '{"model":"auto","messages":[{"role":"user","content":"hello"}]}'
```

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:4853/v1", api_key="YOUR_ACCESS_KEY")
print(client.chat.completions.create(
    model="auto", messages=[{"role": "user", "content": "hello"}]
).choices[0].message.content)
```

Every response reports the candidate that served it:

```
X-Freechain-Provider:  openrouter1
X-Freechain-Model:     openai/gpt-oss-20b:free
X-Freechain-Key-Index: 0
X-Freechain-Attempts:  4
X-FreeChain-Request-Id: <request UUID>
```

`Provider` is the account slot that answered; `Key-Index` is its ordinal within
that slot. Neither is ever the key itself.

### Endpoints

| Route | Purpose |
|---|---|
| `POST /v1/chat/completions` | Chat, streaming and non-streaming. Requires the access key |
| `POST /v1/health/deep` | Explicit, rate-limited 1-token probe of every configured chain link. Requires the access key |
| `GET /v1/models` | `auto` plus every distinct model in the chain. Requires the access key |
| `GET /v1/logs` | Sanitized request journal with `limit`, `before`, `status`, `provider`, `app`, `route`, and `q` filters. Requires the access key and returns `Cache-Control: no-store` |
| `GET /healthz` | Per-link slot and key counts, and which candidates are cooling off |
| `GET /` | Dashboard (unless `--no-ui`) |

Naming a specific model instead of `auto` pins the chain to links serving that
model — so key rotation still works, but it will never silently answer with a
different model than the one asked for.

### Request journal

FreeChain keeps the newest 500 sanitized records in memory. By default it also
writes JSON Lines to `logs/requests.jsonl` below the runtime root, rotates at
5 MiB, and retains one predecessor at `requests.jsonl.1`. A malformed or torn
line is ignored during restart recovery without hiding later valid records.
Use `--log <path>` to choose another file or `--no-log` for memory only.

Each terminal record can include its request UUID, timestamps and duration,
route, remote network category, client-reported app/session, recognized SDK
metadata, authentication result, requested model, stream flag, message roles
and counts, character counts, tool count, max-token setting, provider attempts,
serving provider/model/key ordinal, response size, finish reasons, token usage,
error classification, and post-request cooling. When a provider reports token
usage it is marked `exact`; otherwise FreeChain records an explicit estimate of
one token per four input/output characters. Pre-authentication failures use
`inputSummary: unavailable-before-auth` because the body is never parsed.

The schema never accepts prompt or response content, tool definitions or
arguments, credentials, authorization or arbitrary headers, raw IP addresses,
or raw provider diagnostic bodies. `X-FreeChain-App` and
`X-FreeChain-Session-Id` are optional, sanitized, length-capped, and
client-reported. Do not put secrets in either value. Reads of `/v1/logs` are
excluded from the journal so polling cannot create recursive records.

## The chain

`chain.config.json`, in order. No secrets in it — safe to commit and share.

```json
{ "provider": "opencode-zen1", "model": "x-preview-f-free" }
```

The shipped chain contains only free links. `free: false` is reserved for an
explicit future custom paid link and appears in `/v1/models`. `baseUrl` may be
overridden per entry. Providers and their default base URLs live in
`src/providers.js`.

A **candidate** is one link paired with one account slot and one of that
slot's keys. The default chain has 34 free links. Bare provider ids fan out
across their configured account slots, while numbered ids pin one slot. This is
how a credential can remain configured at the final position without joining
earlier links from the same provider family.

## Failover rules

What advances the chain and what stops it is the core of the design:

| Upstream result | Behaviour |
|---|---|
| `429`, `5xx`, timeout, connection refused | Next candidate. That one cools off (honours `Retry-After`) |
| `401`, `403`, `404` | Next candidate. A bad key or missing model belongs to that account or route |
| `400`, `422` with a genuine validation error | **Stop.** Another provider would reject the same request |
| `400`, `422` wrapping a provider/server failure | Next candidate when wrapped-error advancement is enabled, including OmniRoute pool diagnostics |
| HTTP `200` SSE error before the first valid event | Next candidate. The failed stream cools before downstream headers are committed |
| Caller abort | Stop immediately without cooling or trying another provider |

The streamed first-event gate examines at most 64 KiB before a meaningful SSE
event. Accepted bytes are replayed unchanged. Once a valid event has reached the
client, later stream failures cannot be retried transparently without risking
duplicate text or tool calls.

`--status`, `/healthz`, and the dashboard's configured indicator report
credential configuration only. They do not contact providers. To deliberately
check live reachability for every configured chain link, send an authenticated
`POST /v1/health/deep`. It sends one 1-token request per link, at most once
per minute for the whole server, and reports only provider, model, latency,
outcome, and an HTTP or generic network reason. It never returns provider
response bodies or credentials.

Cooldowns are tracked per candidate, so one exhausted account never sidelines
the others on the same provider.

Cooling candidates are demoted to the back of the order, not dropped. If
everything is rate-limited, a stale one still beats no answer.

## Security

The process holds every provider credential, so:

- It binds `127.0.0.1` unless `--host` says otherwise, and warns when it does.
- `/v1/chat/completions`, `/v1/health/deep`, `/v1/models`, and `/v1/logs` require the access key, compared in constant time.
- The access key is generated on the first server start, including with `--no-ui`, so every proxy route remains gated.
- `.env` is gitignored and written `0600` where the OS supports it. Keys are
  read from the environment at request time and never logged — `--status`,
  `/healthz`, `/admin/state` and the response headers report slot names and
  counts, never key material.
- Journal files are created with owner-only mode where the OS supports it and
  contain only the fixed sanitized schema above. The API sends `no-store` and
  the dashboard keeps the access key in page memory only. Anyone with local
  account access or the FreeChain access key can still read operational
  metadata, so rotate it before sharing a machine or browser profile.
- The dashboard and its admin API have **no auth of their own** — they are
  reachable by anything that can reach the port, and they can write `.env`.
  That is the same trust boundary as a file on your disk while the server is on
  loopback, but it is why `--host 0.0.0.0` is a bad idea. Use `--no-ui` to turn
  the whole admin surface off.

## Tests

```bash
npm test
```

Failover, slot fan-out and key rotation are tested against real local HTTP
upstreams rather than a mocked `fetch`, so the tests exercise the actual
request path. The v0.6.0 suite contains 109 tests: 108 pass on Windows and one
owner-only permission-mode check is skipped where the operating system cannot
enforce the Unix mode assertion.

## License

MIT. See [LICENSE](LICENSE).
