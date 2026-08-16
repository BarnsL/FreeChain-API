# Adding Providers to FreeChain

Step-by-step instructions for agents and contributors adding new model providers
to the FreeChain failover router.

## Prerequisites

Every provider added to FreeChain **must** speak the OpenAI chat-completions wire
format (`POST /v1/chat/completions` with the standard request/response schema).
If the provider uses a different API shape, it cannot be added without writing a
translation layer, which is out of scope for the current architecture.

## Step 1: Register the provider in `src/providers.js`

Add a new entry to the `BASE_PROVIDERS` object.

```js
'example-provider': {
  label: 'Example Provider',
  baseUrl: 'https://api.example.com/v1',
  vendorEnv: ['EXAMPLE_PROVIDER_API_KEY'],
},
```

### Field reference

| Field | Required | Description |
|---|---|---|
| `label` | Yes | Human-readable name shown in the dashboard and logs. |
| `baseUrl` | Yes | The provider's OpenAI-compatible base URL. Must NOT include a trailing slash. `/chat/completions` is appended by the chain walker. |
| `vendorEnv` | Yes | Array of conventional env var names the provider's own tooling uses (e.g. `OPENROUTER_API_KEY`). These are checked as fallbacks for the bare slot only. Set to `[]` if no convention exists. |
| `keyOptional` | No | Set to `true` only for providers that work without authentication (e.g. local servers). Defaults to `false`. |
| `headers` | No | Object of extra HTTP headers sent with every request to this provider. Use for attribution headers, app identification, etc. |

### What happens automatically

The provider registration loop in `providers.js` will:
- Create the bare slot (e.g. `example-provider`) with env var `FREECHAIN_EXAMPLE_PROVIDER_API_KEY`
- Create 10 numbered slots (`example-provider0` through `example-provider9`)
- Wire up the vendor env fallback for the bare slot only

You do NOT need to manually create slots, env vars, or UI entries.

## Step 2: Add the dashboard link in `src/admin.js`

Add an entry to the `PROVIDER_LINKS` object so the dashboard can link users to the
provider's site and key management page.

```js
'example-provider': {
  site: 'https://example.com/',
  keys: 'https://example.com/api-keys'
},
```

Set `keys: null` if the provider has no dedicated key management page (e.g. local servers).

## Step 3: Add chain entries in `chain.config.json`

Add one or more entries to the `chain` array. Position determines failover priority
(tried top to bottom).

```json
{ "provider": "example-provider", "model": "example-model-v1", "note": "optional description" }
```

### For paid providers

Mark the entry with `"free": false` so the dashboard shows it as a paid link:

```json
{ "provider": "example-provider", "model": "example-model-v1", "free": false, "note": "paid fallback" }
```

**Placement guidance for paid providers:**
- Place paid models AFTER all free alternatives in the chain.
- A paid model should be a last resort, not a first choice.
- Consider adding a comment in the `note` field explaining why this paid provider is included.

### Overriding the base URL per link

If a single chain entry needs a different endpoint (e.g. a staging server), add
`baseUrl` directly to the chain entry:

```json
{ "provider": "example-provider", "model": "staging-model", "baseUrl": "https://staging.example.com/v1" }
```

## Step 4: Update `.env.example`

Add commented-out entries so users can see the available variables:

```
# -- Example Provider -- https://example.com/api-keys
# FREECHAIN_EXAMPLE_PROVIDER_API_KEYS=
# FREECHAIN_EXAMPLE_PROVIDER0_API_KEYS=
```

## Step 5: Test

1. **Verify registration**: `node bin/freechain.mjs --status` should list the new provider.
   Links without keys show `--`, which is expected.

2. **Add a key and test connectivity**: start the server, open the dashboard, navigate to
   Model Sources, paste a key into the new provider's slot, and click Test.

3. **Run the test suite**: `node --test "test/*.test.js"`. All existing tests must pass.
   The test suite uses local HTTP servers and does not contact real providers, so no
   key is needed to run tests.

4. **Verify failover**: with verbose logging (`--verbose`), send a request through the
   chain and confirm the new provider appears in the attempt log.

## Handling Paid Providers

Paid providers need extra care because they cost real money on every request.

### Cost awareness

FreeChain has no built-in spending controls. Every request that reaches a paid provider
incurs the provider's standard charges. The only protection is chain ordering: paid
links should sit at the bottom so free alternatives are exhausted first.

### Recommended practices

1. **Chain position**: always place paid entries after ALL free alternatives.
2. **Cooldown tuning**: if a paid provider has aggressive rate limits, consider setting
   a longer `cooldownMs` in chain.config.json to avoid burning through quota quickly.
3. **Account slots**: use numbered slots (e.g. `openrouter0`, `openrouter1`) to spread
   load across multiple accounts. Each slot is rate-limited independently.
4. **Key rotation**: the plural env var form (`_API_KEYS=k1,k2,k3`) lets multiple keys
   be tried within one slot before moving down the chain.

### Adding a paid-only provider

If the provider has no free tier at all:

1. Follow all the steps above.
2. Set `"free": false` on every chain entry for that provider.
3. Add a prominent note in `.env.example` warning that this provider is paid.
4. Consider whether the provider belongs in the default chain at all. If it is only
   useful for specific users, leave it out of `chain.config.json` and document it as
   an optional addition.

## Complete Example: Adding Together AI

### 1. `src/providers.js`

```js
together: {
  label: 'Together AI',
  baseUrl: 'https://api.together.xyz/v1',
  vendorEnv: ['TOGETHER_API_KEY'],
},
```

### 2. `src/admin.js`

```js
together: { site: 'https://together.ai/', keys: 'https://api.together.xyz/settings/api-keys' },
```

### 3. `chain.config.json`

```json
{ "provider": "together", "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free", "note": "Together free tier" }
```

### 4. `.env.example`

```
# -- Together AI -- https://api.together.xyz/settings/api-keys
# FREECHAIN_TOGETHER_API_KEYS=
# FREECHAIN_TOGETHER0_API_KEYS=
```

### 5. Test

```bash
node bin/freechain.mjs --status
# Should show: --  together       --                 meta-llama/Llama-3.3-70B-Instruct-Turbo-Free
```

## What NOT to Do

- **Never hardcode API keys** in any source file. Keys go in `.env` only.
- **Never commit `.env`**. It is gitignored for a reason.
- **Never log or expose full keys**. The admin API masks keys via `maskKey()`. If you
  add any new endpoint that touches credentials, mask them before they reach the response.
- **Never add a provider that does not speak the OpenAI wire format.** FreeChain sends
  a standard `{ model, messages, ... }` body and expects a standard response. If the
  provider needs a different schema, it cannot participate in the chain.
- **Never place paid providers above free ones in the chain** unless the user explicitly
  wants to prioritize them for quality reasons.
- **Never add `baseUrl` entries with trailing slashes.** The chain walker appends
  `/chat/completions` directly.
