# Enforcement boundaries

The Harness page has fields that read like security controls. Most of them are
not. This page says, field by field, whether FreeChain **makes** something
happen or merely **asks** the model to.

Read it before you rely on a Harness field to stop anything.

## The one distinction that matters

FreeChain is a model gateway. It composes a request, picks a provider from the
chain, sends it, and streams the answer back. It does not run an agent loop, so
it never sees a tool being called, never approves anything, and never touches a
filesystem on the model's behalf.

That splits every Harness field into two kinds:

- **Gateway-enforced.** FreeChain changes the outbound request itself. The model
  cannot decline, because it never sees the alternative.
- **Prompted.** The text is placed in the system message. Whether it is honoured
  is up to the model, and a sufficiently determined user turn can argue with it.

A sentence in **Tool policy** saying "never delete files without confirming" is
prompted. It is a request, not a rule. If something in your stack must not
happen, it has to be prevented by whatever actually executes the tool.

## Field by field

### Gateway-enforced

| Field | What FreeChain actually does |
| --- | --- |
| The eight instruction components | Joined in one fixed order, blank line separated, prepended as a single `system` message. The composition is enforced. The content is only prompted, see below. |
| Model aliases | Rewrites `model` on the request before the chain sees it. |
| Temperature, Top P, Top K, Max tokens | Written onto the request **only when the client did not send that field**. A client value always wins. |
| Stop sequences | Written to `stop`, same client wins rule. |
| Reasoning effort | Written to `reasoning_effort`, same client wins rule. |
| Stream | Sets the default. An explicit `stream` from the client wins. |
| Service tier, User id | Written to `service_tier` and `user`, same client wins rule. |

Two properties of that table surprise people, so they are worth stating outright:

1. **Generation defaults fill gaps, they do not cap anything.** Setting Max
   tokens to 500 does not stop a client asking for 8000. It supplies 500 only
   when the client asked for nothing. It is a default, not a budget.
2. **Composition order is fixed.** It is Identity, Operating instructions,
   Safety policy, Tool policy, Reasoning policy, Output style, Behavioral mode,
   Persona, which is exactly the order the fields appear in on the page, reading
   top to bottom through the four sections. It does not change per provider and
   it does not depend on which sections you have expanded.

Empty components are skipped. So is any component whose entire value is the
literal word `auto`, which is read as "leave it to the provider".

The Harness is applied in `src/server.js` immediately after the body is parsed,
before the journal summarises it and before the dispatcher runs, so the journal,
the chain and the provider all see the same composed request.

### Prompted only

Text in these fields reaches the model as ordinary content in the system
message, and nothing more:

- **Safety policy.** Not a filter. FreeChain does not inspect the request or the
  response against it, does not redact, and does not block.
- **Tool policy.** Not a permission. FreeChain exposes no tools and executes
  none. If your client passes tool definitions, they are the client's, and this
  text does not constrain them.
- **Reasoning policy.** Not a compute control. To actually buy reasoning budget,
  use Reasoning effort under Generation defaults.
- **Output style.** Not a schema. FreeChain does not validate the response
  shape. If you need guaranteed JSON, validate it in your client.
- **Behavioral mode**, **Persona.** Tone and manner, nothing else.

### Stored but not sent

| Field | Status |
| --- | --- |
| Custom request metadata (headers) | **Has no effect on outbound requests today.** |

The value is validated and saved, and the sanitizer correctly refuses
`authorization`, `x-api-key`, `cookie`, `host` and the other credential and
framing headers, so nothing dangerous can be smuggled in. But nothing reads it
on the way out. Outbound headers in `src/chain.js` are `Content-Type`, the
provider `Authorization`, and the chain link's own configured headers. The
Harness value is not among them.

SubChain stores and sanitizes the same field and likewise never sends it, so
this is a shared gap rather than something FreeChain dropped.

Keep using it as a note to yourself if you like. Do not expect an upstream to
receive it.

### Not available at all

These belong to an agent runtime that owns the execution loop. FreeChain has no
such loop, so there is nothing for it to enforce: tool execution permission,
human approval before a tool runs, filesystem or network sandboxing, persistent
memory across requests, multi-agent handoffs, and limits on turns or total tool
calls.

If a preset you import asks for any of these, importing it changes nothing. The
text arrives in the system message and the capability does not appear.

## What the logs record

The request journal stores the Harness **id** that composed each request. It
does not store the composed system message, the component text, or the response.
Which Harness ran is a metadata question. What it said is not, and the journal
deliberately cannot answer it.

The journal's own retention model is described under "Request journal" in the
[root README](../../README.md#request-journal), and the record schema shared
across the three apps is in
[docs/CONTROL-PLANE-LOGS.md](../CONTROL-PLANE-LOGS.md).

## Related

- [README.md](README.md), the practical guide to the page.
- [docs/HARNESS.md](../HARNESS.md), the component reference.
