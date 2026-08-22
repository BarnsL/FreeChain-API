/* FreeChain Guide content.

   Original explanations and diagrams. The topic sequence is adapted from
   ByteByteGo's "12 AI Visuals" as a learning framework; no graphic from that
   PDF is reproduced, bundled, or redistributed here. See SOURCE below.

   Enforcement vocabulary is shared verbatim with SubChain's harness schema:
   prompted | gateway | runtime | client | unavailable. One vocabulary across
   both products is deliberate, so a user reading either guide learns the same
   words for the same boundary.

   Diagrams are preformatted text on purpose. They render identically offline,
   at any width, in both themes, and carry no external asset. */

export const ENFORCEMENT_LABEL = {
  prompted: 'Prompted',
  gateway: 'Gateway-enforced',
  runtime: 'Requires agent runtime',
  client: 'Requires client cooperation',
  unavailable: 'Not available here',
};

export const ENFORCEMENT_BLURB = {
  prompted: 'Placed in the system message. Influences the model, guarantees nothing.',
  gateway: 'FreeChain applies or rejects this before the request leaves the process.',
  runtime: 'Needs something that owns the execution loop. FreeChain does not.',
  client: 'Only holds if the calling application cooperates.',
  unavailable: 'Not implemented in this deployment.',
};

export const SOURCE = {
  title: 'Visual learning reference',
  body: 'This guide was informed by ByteByteGo’s 12 AI Visuals. FreeChain uses original diagrams and product-specific explanations rather than reproducing the source graphics.',
  url: 'https://assets.bytebytego.com/12-AI-Visuals.pdf',
  linkText: 'Open the original ByteByteGo PDF',
};

export const ENTRY_CARDS = [
  { id: '04-prompt-engineering', title: 'Write reliable instructions', body: 'Keep roles, rules, examples and output requirements small enough for heterogeneous models.' },
  { id: '01-ai-agent', title: 'Where FreeChain fits', body: 'What this gateway does, and what still belongs to the application calling it.' },
  { id: '09-ai-stack', title: 'Understand the stack', body: 'Which layer a given problem belongs to, by category rather than by vendor.' },
  { id: '08-rag', title: 'Add retrieval or tools', body: 'What the calling application must provide for RAG, browsers, tools and MCP.' },
  { id: '07-mcp', title: 'MCP, current version', body: 'Host, client and server roles, and which older concepts are now legacy.' },
  { id: 'troubleshooting', title: 'Diagnose a response', body: 'Symptom-first fixes for ignored rules, invalid JSON, provider errors and silent tools.' },
];

export const CHAPTERS = [
  {
    id: '01-ai-agent', number: 1, title: 'What is an AI agent?',
    summary: 'An agent is a model plus state, goals, context, tools and an environment. FreeChain supplies one part of that.',
    enforcement: 'gateway',
    harnessAnchors: ['identity'],
    concept:
      'An agent is not a model. A model maps input to output. An agent wraps a model in a loop that holds a goal, remembers what happened, perceives an environment, chooses actions, executes them, and observes what changed.',
    diagram: `User
  |
Application or Agent Runtime
  |-- Memory
  |-- Retrieval
  |-- Tools
  |-- Browser
  '-- Approval UI
  |
FreeChain
  |-- Access authentication
  |-- Harness compilation
  |-- Provider chain and failover
  '-- Response streaming
  |
Model Provider`,
    inProduct:
      'FreeChain occupies one band of that stack. It authenticates the caller, composes the active Harness into the request, routes through the ordered chain, retries past failures, and streams the answer back.',
    enforced: [
      'Access key authentication on every request.',
      'Harness composition, applied before anything else reads the body.',
      'Provider selection, cooldowns and failover across the chain.',
      'Privacy-safe request metadata in the journal.',
    ],
    clientMustProvide: [
      'The agent loop itself: goals, iteration and stopping conditions.',
      'Memory that survives between requests.',
      'Tool execution, and any approval before a tool runs.',
      'Retrieval, browsing and filesystem access.',
    ],
    example:
      'A coding agent decides to read a file. It reads the file itself, puts the contents in a message, and sends that message to FreeChain. FreeChain never saw the file and never could have.',
    commonFailure:
      'Writing "you may read files in ./src" into the Harness and expecting file access to exist. It does not. The sentence reaches the model, the capability does not.',
    relatedSettings: 'Harness › Identity, Harness › Operating instructions',
  },
  {
    id: '02-nine-ai-concepts', number: 2, title: 'Nine AI concepts',
    summary: 'A compact glossary, marking which concepts FreeChain implements and which it only carries.',
    enforcement: 'prompted',
    harnessAnchors: [],
    concept:
      'The vocabulary around models blurs together fast. These nine come up constantly, and separating them makes the rest of the guide readable.',
    diagram: `Concept              Who implements it
-------------------  -----------------------------
Tokenization         Provider
Context window       Provider
Few-shot examples    You, in the Harness
System prompt        FreeChain, from the Harness
RAG                  Your client, before FreeChain
Fine-tuning          Provider, out of band
Planning             Your client, or the model
Tool calling         Your client's loop
Streaming            FreeChain and the provider`,
    inProduct:
      'Only two rows in that table are FreeChain’s: the system prompt it composes, and the streaming it relays. Everything else is either upstream of it or downstream of it.',
    enforced: [
      'System prompt composition from the Harness components.',
      'Streaming relay, including a default stream setting when the client sends none.',
    ],
    clientMustProvide: [
      'Retrieval, if the model needs external knowledge.',
      'The tool-calling loop, if the model is to use tools.',
      'Any few-shot examples, which live in the Harness as ordinary text.',
    ],
    example:
      'Few-shot examples belong in Operating instructions. Two short examples usually beat six long ones, especially on smaller models.',
    commonFailure:
      'Confusing a large context window with good recall. A model that accepts 200k tokens does not attend to all of it equally. Send what the task needs.',
    relatedSettings: 'Harness › Operating instructions, Harness › Generation defaults',
  },
  {
    id: '03-agent-glossary', number: 3, title: 'Agent responsibility map',
    summary: 'Twenty agent concepts, grouped by who owns each one.',
    enforcement: 'runtime',
    harnessAnchors: ['toolPolicy'],
    concept:
      'Most confusion about agents is really confusion about ownership. This map answers one question per concept: when this goes wrong, whose code do I open?',
    diagram: `FREECHAIN OWNS
  Model routing      Failover         Harness compilation
  Access control     Request journal  Response streaming

YOUR CLIENT OWNS
  Goals         State       Memory       Knowledge
  Planning      Tools       Actions      Approvals
  Orchestration Handoffs    Environment

THE PROVIDER OWNS
  Weights       Tokenization    Context window
  Sampling      Reasoning budget`,
    inProduct:
      'Six things are FreeChain’s. Eleven belong to whatever calls it. Five belong to the provider. Nothing written in the Harness moves an item between columns.',
    enforced: [
      'Everything in the FreeChain column, on every request.',
    ],
    clientMustProvide: [
      'Everything in the client column. A Harness can describe these, and describing is all it does.',
    ],
    example:
      'A handoff between two agents is orchestration. It happens entirely in your runtime, and FreeChain sees two unrelated requests.',
    commonFailure:
      'Filing a bug against FreeChain because the model did not call a tool. FreeChain does not expose tools or execute them. Check the client loop.',
    relatedSettings: 'Harness › Tool policy, Guide › Enforcement boundaries',
  },
  {
    id: '04-prompt-engineering', number: 4, title: 'Prompting weaker models reliably',
    summary: 'The central FreeChain chapter: one role, one objective, a short ordered rule list, an explicit output shape.',
    enforcement: 'prompted',
    harnessAnchors: ['identity', 'operatingInstructions', 'outputStyle'],
    concept:
      'FreeChain routes to free, open and often smaller models. Instructions a frontier model absorbs effortlessly will be partially followed, reordered, or silently dropped by a weaker one. Compactness is not stylistic here. It is what makes the output reproducible.',
    diagram: `ROLE
  One sentence describing the assistant.

OBJECTIVE
  One primary outcome.

REQUIRED RULES
  Five to eight short ordered rules.

OUTPUT
  Exact format, length, required sections.

INPUT
  The current task, and only the context it needs.`,
    inProduct:
      'That contract maps onto Harness components directly. ROLE is Identity. OBJECTIVE and REQUIRED RULES are Operating instructions. OUTPUT is Output style. INPUT is what your client sends per request.',
    enforced: [
      'The components are joined in a fixed order and prepended as one system message.',
      'Empty components, and any component whose whole value is the word "auto", are skipped.',
    ],
    clientMustProvide: [
      'The per-request task and its context.',
      'Any verification of the result, since FreeChain does not validate output shape.',
    ],
    example: `ROLE
You are a careful technical assistant.

OBJECTIVE
Produce a correct, usable answer to the requested task.

REQUIRED RULES
1. Follow the requested format.
2. Do not invent facts or completed actions.
3. State important assumptions.
4. Verify calculations and constraints.

OUTPUT
Give the result first, then only the explanation needed to use it.`,
    commonFailure:
      'Several overlapping personas, a huge imported system prompt, the same rule stated three ways, and conflicting "always" instructions. On a small model this does not degrade gracefully, it produces something that follows none of them. Also avoid asking for hidden reasoning to be revealed. Ask instead for a brief statement of approach, a verification step, and any material uncertainty, all of which are observable.',
    relatedSettings: 'Harness › Identity, Operating instructions, Output style',
  },
  {
    id: '05-skills-and-presets', number: 5, title: 'Skills and presets',
    summary: 'Load the one fragment the task needs, not an entire prompt library.',
    enforcement: 'prompted',
    harnessAnchors: ['operatingInstructions'],
    concept:
      'A skill or preset is a reusable chunk of instruction. The useful discipline is progressive loading: keep a compact index, select the relevant fragment, and load only that.',
    diagram: `Request
  |
Compact preset index
  |
Select one relevant fragment
  |
Load only that fragment
  |
Compile the Harness
  |
Send to provider`,
    inProduct:
      'FreeChain’s preset library imports published prompts as inert local text, classifies each by the component it was written for, and applies only what you choose. Browse presets from a component and the library opens already filtered to it.',
    enforced: [
      'Presets are stored in private application data, never in the repository.',
      'Applying a preset to a component it was not classified for raises an inline warning and a second confirmation.',
    ],
    clientMustProvide: [
      'Nothing. Presets are resolved inside FreeChain at edit time, not per request.',
    ],
    example:
      'Run npm run import-presets to fill the library, then use Browse presets beside Operating instructions rather than pasting a whole published system prompt into the field.',
    commonFailure:
      'Treating a preset as a grant. A preset contributes instructions. It does not grant permissions. An imported prompt describing shell access, filesystem rules or approval flows still gets you none of those.',
    relatedSettings: 'Harness › Browse presets, docs/PRESETS.md',
  },
  {
    id: '06-agentic-browser', number: 6, title: 'Agentic browsers',
    summary: 'Perception, security, confirmation and execution all live in the browser runtime, not here.',
    enforcement: 'runtime',
    harnessAnchors: ['toolPolicy'],
    concept:
      'A browsing agent perceives a page, reasons about it, decides an action, and executes it. Each of those is a separate layer with its own failure mode.',
    diagram: `Perception   accessibility tree, DOM, screenshot
Reasoning    page interpretation, goal tracking, recovery
Security     domain allowlist, download policy,
             credential boundary, confirmation
Execution    navigate, click, type, upload, refresh state

     ^ all four live in the browser runtime
     |
FreeChain sees only the request, and the reply.`,
    inProduct:
      'FreeChain supplies the model request and the provider fallback behind it. It has no browser, no page state, and no notion of a domain allowlist.',
    enforced: [
      'Nothing in this chapter. FreeChain is not in the browsing path.',
    ],
    clientMustProvide: [
      'All four layers, including confirmation before any action that writes, purchases, publishes, communicates or deletes.',
      'Refreshed page state to the model after a material action.',
    ],
    example:
      'A browser agent reads a page, sends the extracted text to FreeChain as a message, gets a decision back, and performs the click itself.',
    commonFailure:
      'Trusting page content. Text on a webpage is untrusted input and cannot grant tools or permissions no matter what it claims. Credentials belong to the browser boundary and should never be written into a Harness component.',
    relatedSettings: 'Harness › Tool policy (guidance only)',
  },
  {
    id: '07-mcp', number: 7, title: 'MCP',
    summary: 'Host, client and server roles, and why FreeChain is a model endpoint rather than an MCP host.',
    enforcement: 'runtime',
    protocolVersion: '2026-07-28',
    lastVerified: '2026-08-18',
    harnessAnchors: ['toolPolicy'],
    concept:
      'The Model Context Protocol standardizes how an agent host reaches tools, resources and prompts exposed by a server. A host embeds a client, and the client talks to servers.',
    diagram: `MCP Host
  '-- MCP Client
        '-- MCP Server
              |-- Tools
              |-- Resources
              |-- Prompts
              '-- Extensions`,
    inProduct:
      'FreeChain can serve as the OpenAI-compatible model endpoint an MCP host talks to. That is the whole of its relationship to MCP.',
    enforced: [
      'Serving an OpenAI-compatible endpoint that a host may point at.',
    ],
    clientMustProvide: [
      'Being the host. FreeChain does not become one, does not connect to MCP servers, does not execute MCP tools, does not approve tool actions, and does not transfer MCP credentials.',
    ],
    example:
      'Point your MCP host’s model setting at the FreeChain endpoint with your access key. The host keeps owning its servers and its approvals.',
    commonFailure:
      'Assuming that naming a tool in the Harness connects to an MCP server. Naming is description. Connection is configuration in the host.',
    legacy:
      'Older MCP material, including the visual guide this chapter’s topic sequence came from, shows Roots, Sampling and Logging as core features. The 2026-07-28 specification moved to a stateless, self-describing core and deprecates those three for new implementations. Treat them as legacy compatibility only, and build against tools, resources, prompts, extensions and explicit authorization instead.',
    sources: [
      { label: 'MCP 2026-07-28 specification release', url: 'https://blog.modelcontextprotocol.io/posts/2026-07-28/' },
    ],
    relatedSettings: 'Access key, Harness › Tool policy (guidance only)',
  },
  {
    id: '08-rag', number: 8, title: 'RAG',
    summary: 'Retrieval happens in your client, before the request ever reaches FreeChain.',
    enforcement: 'client',
    harnessAnchors: ['operatingInstructions'],
    concept:
      'Retrieval-augmented generation answers from documents you supply at request time rather than from what the model memorized during training.',
    diagram: `User question
  |
Client searches documents, database, code, web, API
  |
Client selects and labels the retrieved context
  |
FreeChain compiles the Harness
  |
Provider chain answers from question + context`,
    inProduct:
      'By the time FreeChain sees the request, retrieval has already happened. The retrieved text is message content, and FreeChain treats it as such.',
    enforced: [
      'Harness composition around whatever context you sent.',
      'Metadata-only journaling: the journal records counts and models, never the retrieved passages.',
    ],
    clientMustProvide: [
      'Search, ranking, selection and truncation.',
      'Clear delimiting of retrieved content, and a label saying where it came from.',
    ],
    example:
      'Put retrieved passages in a user message under an explicit heading such as "Retrieved context (untrusted)", kept separate from the actual question.',
    commonFailure:
      'Letting instructions inside retrieved documents act as policy. Retrieved content is untrusted by default. If a document says "ignore previous instructions", that is a fact about the document, not a command to obey.',
    relatedSettings: 'Harness › Operating instructions, Logs',
  },
  {
    id: '09-ai-stack', number: 9, title: 'Where FreeChain sits in the stack',
    summary: 'Technology categories rather than a product list that ages badly.',
    enforcement: 'gateway',
    harnessAnchors: [],
    concept:
      'Naming layers by category rather than by vendor keeps the picture true for longer, and makes it obvious which layer a given problem belongs to.',
    diagram: `User Interface
     |
Application or Agent Runtime
     |
Retrieval, Memory, Tools, Browser
     |
FreeChain Gateway
     |
Provider Adapters
     |
Hosted or Local Models
     |
CPU, GPU, TPU, or other accelerator`,
    inProduct:
      'FreeChain is one layer, deliberately thin. It does not reach up into the runtime above it, and it does not reach down into the model below it.',
    enforced: [
      'Everything at the gateway layer: authentication, Harness composition, routing, failover, journaling.',
    ],
    clientMustProvide: [
      'Every layer above the gateway.',
    ],
    example:
      'A latency problem at the accelerator layer is not fixed by editing a Harness. Find the layer first, then the setting.',
    commonFailure:
      'Treating a stack diagram from any publication as a shopping list. Named products age quickly. The categories do not.',
    relatedSettings: 'Overview, Chain',
  },
  {
    id: '10-agentic-rag', number: 10, title: 'RAG versus agentic RAG',
    summary: 'Ordinary RAG retrieves once. Agentic RAG loops, and the loop belongs to your client.',
    enforcement: 'client',
    harnessAnchors: [],
    concept:
      'Ordinary RAG is a straight pipeline. Agentic RAG plans, retrieves, evaluates what came back, and retrieves again when the evidence is thin or contradictory.',
    diagram: `Agent runtime
  |-- Plans
  |-- Chooses retrieval source
  |-- Retrieves
  |-- Evaluates result
  |-- Retrieves again when needed
  '-- Maintains task state
        |
     FreeChain
        |
   Model provider`,
    inProduct:
      'Every arrow in that loop is your runtime’s. FreeChain sees each pass as an independent request with no memory of the last.',
    enforced: [
      'Per-request composition and routing, identically on every pass through the loop.',
    ],
    clientMustProvide: [
      'The loop, its iteration budget, and its stopping condition.',
      'Task state between passes, since FreeChain holds none.',
    ],
    example:
      'Cap iterations in your client. FreeChain has no maximum-steps control to protect you, because it does not own the loop.',
    commonFailure:
      'Expecting FreeChain to stop a runaway retrieval loop. It cannot see that a loop exists.',
    relatedSettings: 'Logs, for spotting repeated near-identical requests',
  },
  {
    id: '11-rag-vs-fine-tuning', number: 11, title: 'RAG versus fine-tuning',
    summary: 'RAG supplies information at request time. Fine-tuning changes the model through training.',
    enforcement: 'unavailable',
    harnessAnchors: [],
    concept:
      'These solve different problems, and are often posed as a choice when they are not mutually exclusive.',
    diagram: `RAG                          Fine-tuning
-------------------------    -------------------------
Information at request time  Behaviour learned in training
Changes per request          Changes the endpoint
Citable, inspectable         Opaque once trained
Private data stays outside   Data absorbed into weights
Cheap to update              Retraining to update`,
    inProduct:
      'FreeChain routes to whatever endpoint your chain names, base or fine-tuned, and applies the Harness to either. It does not train anything.',
    enforced: [
      'Routing to the configured endpoint, and applying the Harness identically regardless of how that endpoint was produced.',
    ],
    clientMustProvide: [
      'Retrieval, for the RAG side.',
      'Any training, dataset building and evaluation, entirely out of band.',
    ],
    example:
      'Use RAG when information changes often, citations matter, or private knowledge should stay out of weights. Consider a fine-tuned endpoint when stable behaviour must be learned from many examples and you have evaluation data.',
    commonFailure:
      'Believing a large imported system prompt is a form of fine-tuning. It is not. It is text, sent on every request, competing for the same context.',
    relatedSettings: 'Chain, Model sources',
  },
  {
    id: '12-compute-accelerators', number: 12, title: 'Compute accelerators',
    summary: 'An optional appendix for self-hosting decisions, not a Harness setting.',
    enforcement: 'unavailable',
    harnessAnchors: [],
    concept:
      'Inference runs on a CPU, a GPU, a TPU or another accelerator. The differences matter when you self-host, and are nearly invisible when you use a hosted provider.',
    diagram: `CPU          orchestration, small models, high per-token cost
GPU          parallel tensor work, the common case
TPU / other  specialised accelerators, provider-managed

What actually decides throughput:
  model size, precision, batch size,
  memory bandwidth, context length, software stack`,
    inProduct:
      'Nothing in FreeChain configures this. It matters only when choosing between hosted providers and running a model yourself.',
    enforced: [
      'Nothing. This chapter is background for provider choice.',
    ],
    clientMustProvide: [
      'Any self-hosting decision, sizing and benchmarking.',
    ],
    example:
      'If a local model is too slow, look at quantization, batch size and context length before concluding the hardware is wrong.',
    commonFailure:
      'Repeating universal claims such as "CPU takes seconds, GPU milliseconds, TPU microseconds". Real performance depends on model, precision, batch size, memory bandwidth and software, so benchmark your own workload.',
    relatedSettings: 'Model sources',
  },
];

export const TROUBLESHOOTING = [
  {
    id: 'rule-ignored',
    symptom: 'The model ignores one of my rules',
    steps: [
      'Reduce the rule count. Five to eight beats twenty.',
      'Remove duplicates and rules that restate each other.',
      'Put required rules in priority order.',
      'Convert prose into an explicit output constraint.',
      'Test against the weakest model in your chain, not the strongest.',
    ],
  },
  {
    id: 'invalid-json',
    symptom: 'JSON comes back invalid',
    steps: [
      'State the exact shape in Output style, with a short example.',
      'Ask for the object alone, with no prose around it.',
      'Validate in your client and retry once. FreeChain does not validate response shape.',
      'On smaller models, prefer a flat object over a deeply nested schema.',
    ],
  },
  {
    id: 'provider-400',
    symptom: 'One provider returns 400 while others might work',
    steps: [
      'Check whether a Harness generation default is unsupported by that provider.',
      'Top K in particular is honoured by some providers and rejected by others.',
      'Clear the setting and retry to confirm which field caused it.',
      'Check Logs for the attempt list and the error classification.',
    ],
  },
  {
    id: 'tools-silent',
    symptom: 'Tool calls never execute',
    steps: [
      'Confirm your application implements the tool loop. FreeChain does not.',
      'Confirm the client validates arguments before acting.',
      'Confirm the client asks for approval where it should.',
      'Do not add permission language to Tool policy as a substitute. It grants nothing.',
    ],
  },
  {
    id: 'harness-inactive',
    symptom: 'My Harness edits are not affecting live traffic',
    steps: [
      'Check the line above Make active on the Harness page.',
      'Editing a Harness is not the same as activating it.',
      'The dropdown marks the live one with "active".',
    ],
  },
];

/** Which guide chapter a Harness component's "Read the guide" link opens. */
export const HARNESS_COMPONENT_CHAPTER = {
  identity: '01-ai-agent',
  operatingInstructions: '04-prompt-engineering',
  safetyPolicy: '03-agent-glossary',
  toolPolicy: '03-agent-glossary',
  reasoningPolicy: '04-prompt-engineering',
  outputStyle: '04-prompt-engineering',
  behavioralMode: '04-prompt-engineering',
  persona: '04-prompt-engineering',
};
