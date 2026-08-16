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
ok   opencode-zen   3 keys / 2 slots   north-mini-code-free  [opencode-zen opencode-zen0]
ok   openrouter     5 keys / 3 slots   nvidia/nemotron-3-ultra-550b-a55b:free  [openrouter openrouter0 openrouter1]
--   longcat        —                  meituan/longcat-2.0

17/18 links ready, 68 candidate(s) to try.
```

```bash
node bin/freechain.mjs
```

Serves `http://127.0.0.1:4853/v1`. Flags: `--port`, `--host`, `--chain <file>`,
`--verbose`.

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
any non-empty string as the API key — FreeChain holds the real credentials, so
the calling app never needs one and no key ends up in a browser or a config UI.

```bash
curl http://127.0.0.1:4853/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"hello"}]}'
```

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:4853/v1", api_key="freechain")
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
| `POST /v1/chat/completions` | Chat, streaming and non-streaming |
| `GET /v1/models` | `auto` plus every distinct model in the chain |
| `GET /healthz` | Per-link slot and key counts, and which candidates are cooling off |

Naming a specific model instead of `auto` pins the chain to links serving that
model — so key rotation still works, but it will never silently answer with a
different model than the one asked for.

## The chain

`chain.config.json`, in order. No secrets in it — safe to commit and share.

```json
{ "provider": "opencode-zen", "model": "north-mini-code-free" }
```

`free: false` marks a paid link; it is informational and appears in
`/v1/models`. `baseUrl` may be overridden per entry. Providers and their
default base URLs live in `src/providers.js`.

A **candidate** is one link paired with one account slot and one of that
slot's keys. Eighteen links across a handful of slots is easily 60+ candidates,
all tried in order before the request is given up on.

## Failover rules

What advances the chain and what stops it is the core of the design:

| Upstream result | Behaviour |
|---|---|
| `429`, `5xx`, timeout, connection refused | Next candidate. That one cools off (honours `Retry-After`) |
| `401`, `403`, `404` | Next candidate — a bad key is that account's problem |
| `400`, `422` | **Stop.** The request is malformed; every candidate would reject it identically |

Cooldowns are tracked per candidate, so one exhausted account never sidelines
the others on the same provider.

Cooling candidates are demoted to the back of the order, not dropped. If
everything is rate-limited, a stale one still beats no answer.

## Security

The process holds every provider credential, so:

- It binds `127.0.0.1` unless `--host` says otherwise, and warns when it does.
- `.env` is gitignored. Keys are read from the environment at request time and
  never logged — `--status`, `/healthz` and the response headers report slot
  names and counts, never key material.
- Anything that can reach the port can spend the keys. Do not expose it to a
  network you do not control.

## Tests

```bash
npm test
```

Failover, slot fan-out and key rotation are tested against real local HTTP
upstreams rather than a mocked `fetch`, so the tests exercise the actual
request path.

## License

MIT. See [LICENSE](LICENSE).
