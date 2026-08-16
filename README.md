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
                    ├─ omniroute      auto/coding:free      ← self-hosted, if running
                    ├─ opencode-zen   north-mini-code-free
                    │                   ├─ opencode-zen   key 1 → key 2
                    │                   └─ opencode-zen0  key 1        ← account slots
                    ├─ opencode-zen   nemotron-3-ultra-free
                    ├─ openrouter     nvidia/nemotron-3-ultra-550b-a55b:free
                    │                   ├─ openrouter   key 1 → key 2
                    │                   ├─ openrouter0  key 1
                    │                   └─ openrouter1  key 1 → key 2
                    └─ ...            first candidate that answers wins
```

No runtime dependencies. Node 20+.

## Quick start

```bash
cp .env.example .env
```

Fill in the keys you have, then check what resolved:

```bash
node bin/freechain.mjs --status
```

```
ok   omniroute      no key needed      auto/coding:free
ok   opencode-zen   3 keys / 2 slots   nemotron-3-ultra-free  [opencode-zen opencode-zen0]
ok   openrouter     5 keys / 3 slots   nvidia/nemotron-3-ultra-550b-a55b:free  [openrouter openrouter0 openrouter1]

14/14 links configured, 68 candidate(s) to try.
```

```bash
node bin/freechain.mjs
```

```
freechain    http://127.0.0.1:4853/v1
dashboard    http://127.0.0.1:4853/
chain        17/18 links configured
```

Flags: `--port`, `--host`, `--chain <file>`, `--verbose`, `--no-ui`.

You don't need a key to start — open the dashboard and add one there.

### Local resiliency

The normal launcher is a small supervisor. It keeps the fixed endpoint on the
same port and restarts its router worker after an unexpected exit, waiting 1,
2, 4, 8, 16, then at most 30 seconds between attempts. Ctrl+C and normal
termination stop both processes cleanly. Starting the command again while the
endpoint is already live leaves the existing instance alone.

This is crash recovery after FreeChain has been launched. It cannot start a
process after a full Windows reboot, so launch FreeChain once after signing in
if you need it then.

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
- **Chain** — the ordered chain and each link's credential configuration state.

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
partly filled `.env` just gives you a shorter chain. The three providers the
default chain is built around:

| Provider | Env base name | Where to get a key | Notes |
|---|---|---|---|
| **OpenRouter** | `FREECHAIN_OPENROUTER_API_KEY` | [openrouter.ai/keys](https://openrouter.ai/keys) | Free `:free` model variants, generous catalogue |
| **OpenCode Zen** | `FREECHAIN_OPENCODE_ZEN_API_KEY` | [opencode.ai/zen](https://opencode.ai/zen) | Several zero-cost models |
| **OmniRoute** | `FREECHAIN_OMNIROUTE_API_KEY` | self-hosted | Loopback router; usually needs **no key** |

Also defined in `src/providers.js`, unused until you add chain entries for them:
`longcat`, `groq`, `cerebras`, `nvidia`, `deepseek`, `google`, `openai`, and
`local` (Ollama, LM Studio, llama.cpp, vLLM — no key needed).

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
```

`Provider` is the account slot that answered; `Key-Index` is its ordinal within
that slot. Neither is ever the key itself.

### Endpoints

| Route | Purpose |
|---|---|
| `POST /v1/chat/completions` | Chat, streaming and non-streaming. Requires the access key |
| `POST /v1/health/deep` | Explicit, rate-limited 1-token probe of every configured chain link. Requires the access key |
| `GET /v1/models` | `auto` plus every distinct model in the chain. Requires the access key |
| `GET /healthz` | Per-link slot and key counts, and which candidates are cooling off |
| `GET /` | Dashboard (unless `--no-ui`) |

Naming a specific model instead of `auto` pins the chain to links serving that
model — so key rotation still works, but it will never silently answer with a
different model than the one asked for.

## The chain

`chain.config.json`, in order. No secrets in it — safe to commit and share.

```json
{ "provider": "opencode-zen", "model": "north-mini-code-free" }
```

The shipped chain contains only free links. `free: false` is reserved for an
explicit future custom paid link and appears in `/v1/models`. `baseUrl` may be
overridden per entry. Providers and their default base URLs live in
`src/providers.js`.

A **candidate** is one link paired with one account slot and one of that
slot's keys. Eighteen links across a handful of slots is easily 60+ candidates,
all tried in order before the request is given up on.

## Failover rules

What advances the chain and what stops it is the core of the design:

| Upstream result | Behaviour |
|---|---|
| `429`, `5xx`, timeout, connection refused | Next candidate. That one cools off (honours `Retry-After`) |
| `401`, `403`, `404` | Next candidate — a bad key is that account's problem |
| `400`, `422` | **Stop.** The request is malformed, except OmniRoute's diagnostic 400 for an exhausted internal pool, which advances the outer chain. |

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
- `/v1/chat/completions` and `/v1/health/deep` require the access key, compared in constant time.
- The access key is generated on the first server start, including with `--no-ui`, so every proxy route remains gated.
- `.env` is gitignored and written `0600` where the OS supports it. Keys are
  read from the environment at request time and never logged — `--status`,
  `/healthz`, `/admin/state` and the response headers report slot names and
  counts, never key material.
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
request path.

## License

MIT. See [LICENSE](LICENSE).
