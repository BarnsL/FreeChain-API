# Quick start

Five steps from a running FreeChain to a first answer.

## 1. Open the dashboard

Start FreeChain and open `http://127.0.0.1:4853`. Everything below happens on
that loopback-only dashboard.

## 2. Copy your access key

**Access key** in the sidebar shows the single key every request must present.
FreeChain authenticates one caller identity; the key is what proves it.

## 3. Confirm a chain exists

**Chain** lists the ordered providers a request tries in turn. **Model sources**
is where you paste provider API keys. A link with no key is skipped at request
time rather than failing the whole request.

## 4. Choose a Harness

**Harness** holds the instructions composed into every request. The Default
Harness is empty, which is fine to start. If you want instructions, fill
**Identity** and **Operating instructions** and leave the rest empty. One
Harness is *active* at a time; the line above **Make active** tells you which.

See [How FreeChain works](how-freechain-works.md) and the
[prompt-engineering chapter](visual-foundations/04-prompt-engineering.md) for
writing instructions weaker models actually follow.

## 5. Send a request

Point any OpenAI-compatible client at the endpoint:

```bash
curl http://127.0.0.1:4853/v1/chat/completions \
  -H "Authorization: Bearer YOUR_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Say hello in one sentence."}]}'
```

The active Harness is composed in, a provider is chosen from the chain, and the
answer streams back. **Logs** records what happened as metadata: which model,
which provider attempts, latency, and the Harness id, never the prompt or reply.

## Next

- [How FreeChain works](how-freechain-works.md)
- [Visual foundations](visual-foundations/README.md)
- [Troubleshooting](troubleshooting.md)

---

_Part of the [FreeChain Guide](README.md)._
