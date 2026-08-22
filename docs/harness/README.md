# The Harness, in practice

A Harness is a saved bundle of instructions and request defaults. FreeChain
composes every request with exactly one of them, so it is the place to put
anything you would otherwise paste into every client you own.

This is the practical guide. [docs/HARNESS.md](../HARNESS.md) is the component
reference, and [enforcement-boundaries.md](enforcement-boundaries.md) says what
each field actually enforces, which is the thing people most often get wrong.

## Open it

Start FreeChain, open `http://127.0.0.1:4853`, and choose **Harness** in the
sidebar. It sits between Chain and Logs. Like the rest of the dashboard it is
loopback only, so it is not reachable from another machine.

## The five things you will actually do

### 1. Know which Harness is live

FreeChain authenticates every caller with one access key, so there is nothing to
assign a Harness to. Instead one Harness in the library is **active**, and it
composes every request that key serves.

The workspace at the top of the page holds two separate ideas, and confusing them
is the most common mistake:

- **Editing** picks which Harness you are looking at. Changing it does nothing to
  live traffic.
- **Make active** promotes the Harness you are editing to the live one.

The line above the button always tells you which state you are in, and the
dropdown marks the live one with `· active`.

This is the one place FreeChain and SubChain deliberately differ. SubChain issues
many local keys and assigns a Harness per key, so what a client gets depends on
which key it holds. FreeChain has one key, so the choice belongs to the library.

### 2. Fill in the components

Eight text fields, each with a one line guide underneath and an **i** button
carrying more detail plus explicit "belongs here" and "not here" notes.

You do not have to use all eight. An empty field is skipped entirely, and so is
a field containing only the word `auto`.

If you are starting from nothing, fill **Identity** and **Operating
instructions** and leave the rest empty. Those two carry most of the weight.
Reach for the others when you have a specific reason.

Changes save automatically. There is no save button and no confirmation step.

### 3. Set generation defaults, if you need them

Under **Generation defaults**: temperature, top P, top K, max tokens, stop
sequences, reasoning effort. Leave a field empty to use whatever the provider
does by default.

One rule governs all of them, and it is worth memorising: **a value the client
sends always wins.** These are defaults for requests that stayed silent, not
limits on requests that did not. Setting max tokens to 500 does not stop a client
asking for 8000.

Top K is honoured by some providers and silently ignored by others. Leave it
empty unless a provider in your chain actually uses it.

### 4. Borrow from the preset library

Below the editor is the imported preset library. Presets are published system
prompts from public collections, imported as inert local text.

The library is empty until you fill it:

```bash
npm run import-presets
```

They land in private application data, never in the repository. Once imported:

- **Browse presets** next to any component opens the library already filtered to
  presets classified for that component.
- Select one to preview it, choose **Apply to** and whether to replace or append,
  then apply.
- Point a preset at a component it was not written for and the page says so
  before you commit, naming the component it was classified as.

Take that warning seriously. Putting persona text into Safety policy breaks
nothing mechanically, and that is exactly the problem. It quietly becomes part of
the composed instructions in the wrong slot.

### 5. Keep more than one

**Create Harness** adds another to the library, which is useful when you want a
strict research setup and a loose drafting setup without retyping either. Only
one is active at a time, and the Default Harness cannot be deleted.

## What actually gets sent

The eight components are joined in a fixed order, blank line separated, and
prepended to the request as a single `system` message:

Identity, Operating instructions, Safety policy, Tool policy, Reasoning policy,
Output style, Behavioral mode, Persona.

That is the same order the fields appear in on the page, reading top to bottom
through the four sections, so what you see is what the model gets. It does not
change per provider, and collapsing a section does not remove it.

Everything else either edits fields on the outbound request (generation defaults,
model aliases) or, in one case, does nothing at all yet. See
[enforcement-boundaries.md](enforcement-boundaries.md) for the field by field
breakdown, including the one field that is stored but never sent.

## Where it is stored

| Platform | Location |
| --- | --- |
| Windows | `%APPDATA%\FreeChain\harnesses.json` |
| macOS | `~/Library/Application Support/FreeChain/harnesses.json` |
| Linux | `$XDG_CONFIG_HOME/freechain/harnesses.json` |

`FREECHAIN_DATA_DIR` overrides the directory. The file is written atomically at
mode 600 and is never part of the repository.

The format is shared with [SubChain](https://github.com/BarnsL/SubChain-API), so
a `harnesses.json` written by one is readable by the other.

## Troubleshooting

**My instructions do not seem to apply.** Check the line above **Make active**.
Editing a Harness is not the same as activating it.

**The model ignored my safety or tool policy.** Those fields are prompt text, not
enforcement. Nothing in FreeChain inspects, redacts or blocks. See
[enforcement-boundaries.md](enforcement-boundaries.md).

**My max tokens setting is not capping anything.** It is a default, not a cap. A
client sending its own value overrides it.

**The preset library is empty.** Run `npm run import-presets`. The page says so
too, rather than implying your search was too narrow.

**I changed the Harness page in source and the running app does not show it.**
The installed build is separate from this checkout. Rebuild with `npm run build`
and redeploy, or run the checkout directly. Both listen on 4853, so they cannot
run at the same time.

**Which Harness served a request?** The Logs page records the Harness id per
request. It does not record the composed instructions, by design.
