# 7. MCP

> Guide version 2026-07-28 · last verified 2026-08-18

**Enforcement: Requires agent runtime.** Needs something that owns the execution loop. FreeChain does not.

Host, client and server roles, and why FreeChain is a model endpoint rather than an MCP host.

## The concept

The Model Context Protocol standardizes how an agent host reaches tools, resources and prompts exposed by a server. A host embeds a client, and the client talks to servers.

```text
MCP Host
  '-- MCP Client
        '-- MCP Server
              |-- Tools
              |-- Resources
              |-- Prompts
              '-- Extensions
```

## What it means in FreeChain

FreeChain can serve as the OpenAI-compatible model endpoint an MCP host talks to. That is the whole of its relationship to MCP.

### Legacy compatibility note

Older MCP material, including the visual guide this chapter’s topic sequence came from, shows Roots, Sampling and Logging as core features. The 2026-07-28 specification moved to a stateless, self-describing core and deprecates those three for new implementations. Treat them as legacy compatibility only, and build against tools, resources, prompts, extensions and explicit authorization instead.

## What FreeChain enforces

- Serving an OpenAI-compatible endpoint that a host may point at.

## What your client must provide

- Being the host. FreeChain does not become one, does not connect to MCP servers, does not execute MCP tools, does not approve tool actions, and does not transfer MCP credentials.

## Example

```text
Point your MCP host’s model setting at the FreeChain endpoint with your access key. The host keeps owning its servers and its approvals.
```

## Common failure

Assuming that naming a tool in the Harness connects to an MCP server. Naming is description. Connection is configuration in the host.

## Related FreeChain settings

Access key, Harness › Tool policy (guidance only)

### Source and version

- [MCP 2026-07-28 specification release](https://blog.modelcontextprotocol.io/posts/2026-07-28/)

---

_Part of the [FreeChain Guide](../README.md). This file is generated from
`src/webui/guide-content.js`; edit that and re-run `npm run build-guide-docs`._
