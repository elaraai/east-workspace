# Design & Execution: `ClaudeChat` — a type-aware agentic chat for e3

> Status: **proposed (v2)** · 2026-05-21
> Supersedes the v1 single-component framing. This is a **detailed design
> *and* execution document**: every interface is given in full TypeScript,
> every East value in full East types, with architectural diagrams.

## 0. How to read this

The system is **four layers** with a **one-way dependency DAG** and a **stable
wire-protocol seam** that lets the open-source reference service and the
closed-source `east-aws` cloud service be swapped without touching the IR or
the renderer. Read §2 for the shape, then §3 (the contract types — the source
of truth), §4–§5 (binding model + the agent-tool spectrum), §6 (the agent
service), §7 (security + key custody), §8 (the renderer), §9–§12 (execution
plan, prior art, risks).

Planned section map (this rewrite lands them in groups):

```
1  Goals
2  Architecture            ← this group: layers, DAG, abstractions, turn sequence, exec tiers
3  Contract layer (e3-ui)  — FULL East + TS types: transcript, config, tools, payload, factory, tool-schema, protocol
4  Binding model           — Data.bind; apply policy from mode/patch
5  Agent-tool spectrum     — value writes · ad hoc East functions · generative UI · delegate-to-e3
6  Agent service (east-agent) — FULL TS contracts; reference AgentRuntime = Agent SDK + east-claude-plugin
7  Security & key custody  — what the boundary guarantees; cloud keyless auth; injection/egress/sanitization
8  Renderer (e3-ui-components) — bsys compliance + production React (thin streaming client)
9  File-by-file plan
10 Phased execution
11 Prior art, leverage, quality bar
12 Risks & open decisions
```

### Notation: proposed vs existing

Everything this design introduces is **proposed (new code to be built)** unless
marked EXISTING — names here are coined *by this document*, not citations of
current APIs. **New** (do not exist yet): the `libs/east-agent` lib and all its
contracts (`AgentRuntime`, `AgentE3Gateway`, `AgentSecretProvider`, `AgentToolPolicy`,
`AgentIRBuilder`, `AgentSessionStore`); the `ClaudeChat*` IR + `ConversationType` +
`protocol.ts`; `eastTypeToToolSchema`; the `EastChakraClaudeChat` renderer +
`createProxyTransport` + `useTurnStream`; and the §5.7 e3 `adHocExecute*` API (a
change request on e3).

They build on these **EXISTING, verified-in-repo** APIs: `compileFunctionIR`,
`IRType`, `FunctionIR`, `decodeBeast2For`, `analyzeIR`, `East.Blob.encodeBeast`
(`@elaraai/east`, `@elaraai/east/internal`); `EncodedEastFunction`,
`EastChakraComponent`, `Markdown`, `Diff` walker/format, `EastValueViewer`, and
the `frame`/`eyebrowRow`/`commitBar`/`status` recipes
(`@elaraai/east-ui[-components]`); `EastUI.component` / `implementUIComponent`;
`Data.bind` / `DiffBindingType` / `StagedStore` / `ReactiveDatasetCache` /
`getBindingTypes` (`@elaraai/e3-ui[-components]`); `toJSONFor` / `fromJSONFor` /
`toEastTypeValue`; `PatchType` / `diffFor` / `applyFor`; `e3-api-client` (`datasetGet`, `dataflowExecute*`,
`workspaceDeploy`, `packageImport`, …); the Claude Agent SDK (`query`,
`ClaudeAgentOptions`, `plugins`, `hooks`, `agents`); and the `east-claude-plugin`
(skills, `east`, hooks).

## 1. Goals

1. **Read and write bound e3 inputs precisely.** The conversation transcript is
   itself a bound dataset (a typed East value); the assistant reads from and
   proposes writes to *other* bound inputs, each with a statically-known
   `EastType`.
2. **Leverage East's static types end-to-end.** Each bound input's `EastType`
   does triple duty — it **generates** the tool's JSON Schema (so the model
   shapes correct values before sending), **validates** the model's output
   (`fromJSONFor`), and **is** the value staged through the binding. The same
   applies one level up: the assistant can author whole **East functions** that
   the type-checker constrains, the compiler validates, and whose typed result
   we render / stage / display.
3. **Be a real agent, server-side.** The reasoning + codegen loop runs in a
   dedicated **agent service** built on the **Claude Agent SDK**, which loads
   the **`east-claude-plugin`** (skills, the `east` example index, and
   the hook that preemptively injects canonical East examples) — the same
   machinery that makes Claude Code good at East.
4. **Delegate execution to e3.** Durable transformations become **e3 tasks on a
   draft branch** (reviewed/merged like any change); e3 owns provenance,
   caching, runners, and remote-repo access. The agent reaches e3 **through the
   API** (`e3-api-client`), so remote repos and the cloud work unchanged.
5. **Generalise for `east-aws` with correct abstractions.** Following the
   `e3-core ↔ e3-cloud` precedent, the service **defines interfaces + a
   reference implementation**; `east-aws` supplies production implementations
   (multi-tenant, managed/keyless auth, scaled execution) **without forking**.
6. **Never leak secrets.** The browser↔service wire protocol has **no field
   that can carry a secret**; keys are confined to a server-only
   `AgentSecretProvider`; the cloud can run **keyless** (Bedrock/Vertex IAM). See §7.
7. **Comply precisely with bsys** (`east-ui-showcase/dist-design/index__bsys.html`):
   one `Frame` shape, mono eyebrow rows, status = dot + word,
   `brand-tint = dirty`, Commit.Bar over pending writes, banners over modals.
8. **Production-grade renderer.** Silky streaming at any token rate, virtualised
   threads, native-editor composer, full a11y, clean abort/retry — the browser
   is a **thin streaming client**, not the agent loop.

## 2. Architecture

### 2.1 Four layers + the seam

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BROWSER (host app)                                                             │
│  @elaraai/e3-ui-components — EastChakraClaudeChat   (React · Chakra v3 · bsys)  │
│   • renders the transcript (a bound e3 dataset) + composer + live stream        │
│   • staged-write review (Diff / Commit.Bar) · ephemeral East previews (tier 1)  │
│   • ClaudeTransport = thin SSE client ───────────── speaks ─────────────┐       │
└─────────────────────────────────────────────────────────────────────────│──────┘
                                                                            │ HTTP/SSE
                          wire protocol  (e3-ui/src/protocol.ts)            │ ── NO secret,
                          minimal request: { conversationPath, userText }   │    NO tool schema,
                          stream of typed events                            │    NO config crosses
                                                                            ▼    this line
┌──────────────────────────────────────────────────────────────────────────────┐
│ libs/east-agent — headless agent service (Node; abstractions + reference impl)  │
│   AgentRuntime (ref = Claude Agent SDK + east-claude-plugin)                     │
│     · agent loop · skills · east · PREEMPTIVE example injection (hook)    │
│     · eslint-plugin-east (pre-write hook) · east-author subagent                 │
│   Tools over AgentE3Gateway · AgentIRBuilder(eval→IR) · AgentSecretProvider · AgentToolPolicy     │
└──────────┬───────────────────────────────────────────────────┬─────────────────┘
           │ e3-api-client (readDataset / stageWrite /          │ Anthropic  OR
           │ createTask(draftBranch) / runTask / readOutput)    │ Bedrock / Vertex
           ▼                                                    ▼ (key  OR  keyless IAM — §7)
┌────────────────────────────────────────┐          ┌──────────────────────────────┐
│ e3 — system of record + execution       │          │ LLM provider                  │
│ datasets · tasks · branches · runners · │          └──────────────────────────────┘
│ provenance/history   (local OR remote)  │
└────────────────────────────────────────┘

  shared contract (browser-safe; NO React, NO Agent SDK, NO secret-bearing field):
  @elaraai/e3-ui — IR types · ClaudeChat EastUI.component · eastTypeToToolSchema · protocol
```

The seam is the wire protocol in `e3-ui/src/protocol.ts`. Because the same
protocol is implemented by the OSS reference service **and** the `east-aws`
cloud service, the **identical `EastChakraClaudeChat`** renders against either
backend with only a transport URL change.

### 2.2 Dependency DAG & package placement

```
                         ┌──────────────────────┐
   @elaraai/east ───────▶│  @elaraai/east-ui    │   (UIComponentType, EastUI.component)
        ▲                └──────────┬───────────┘
        │                           │
   @elaraai/e3 ─────────────────────┤  (e3-ui depends on east-ui AND e3)
        ▲                           ▼
        │                ┌──────────────────────┐
        │                │  @elaraai/e3-ui      │  ← THE CONTRACT
        │                │  IR + component +    │     (browser-safe; no React; no SDK)
        │                │  tool-schema +       │
        │                │  protocol            │
        │                └───┬──────────────┬───┘
        │       depends on   │              │   depends on
        │   ┌────────────────▼──┐        ┌──▼──────────────────────────────────┐
        │   │ @elaraai/         │        │ libs/east-agent  (NEW top-level lib) │
        │   │ e3-ui-components  │        │ headless Node service                │
        │   │ (renderer)        │        │ deps: e3-ui, e3-api-client, east,    │
        │   └───────────────────┘        │ eslint-plugin-east, claude-agent-sdk │
        │                                │ loads: east-claude-plugin            │
        └────────────────────────────────┤ (also depends on east compiler) ────┘
                                          │
   east-aws (closed) ──implements──▶ east-agent contracts (AgentRuntime, AgentSecretProvider, …)
```

**Why `east-agent` is its own top-level lib** (not `libs/e3/packages/e3-agent`):
it needs both `e3-ui` (the `ConversationType` / `eastTypeToToolSchema` / protocol
contract) **and** `e3-api-client`. The established order is `east-ui → e3`
(east-ui depends on e3, never the reverse). Putting the agent in `libs/e3` would
force `e3 → east-ui` — a cycle. As its **own lib downstream of both**, it can
depend on each without reversing anything. It is **headless**: it exposes an
HTTP/SSE API and **never** React or UI components. The renderer and the agent
never depend on each other — only on the shared `e3-ui` contract.

### 2.3 Abstraction boundaries (OSS reference impl ↔ east-aws production impl)

`east-agent` mirrors the **e3-core ↔ e3-cloud** pattern: it **defines
interfaces and ships a working reference (self-host) implementation**;
`east-aws` provides **production** implementations of the *same* interfaces
**without forking** — exactly as e3-cloud implements e3-core's `TaskRunner`,
`DataflowOrchestrator`, `ObjectStore`, `OidcProvider`, … (full TS interfaces in
§6.1).

| `east-agent` interface | Reference impl (OSS, self-host) | `east-aws` (production) | e3 analogue |
|---|---|---|---|
| `AgentRuntime` — the agent loop | Claude Agent SDK + east-claude-plugin, env-key auth | cloud LLM routing (Bedrock / Vertex / Managed Agents); **keyless IAM**; tenant model policy | `DataflowOrchestrator` |
| `AgentE3Gateway` — datasets / tasks / branches / **one-shot ad-hoc exec** (§5.7) | `e3-api-client` (local **and** remote repos) | cloud-internal e3 access, tenant-scoped | already abstract (`e3-api-client`) |
| `AgentSecretProvider` — LLM auth | env / config | secrets manager + rotation, or **no key** (IAM) | `OidcProvider` |
| `AgentToolPolicy` — tool/binding scoping, quotas | static config + user-token passthrough | per-tenant authz + rate limits | `RepoStore` authz |
| `AgentIRBuilder` — eval model source → IR + type-check **(authoring only; never executes)** | local isolate | sandboxed cloud worker | (build step) |
| `AgentSessionStore` — session/transcript continuity | filesystem JSONL (SDK) + the e3 transcript dataset | hosted store | `ExecutionStateStore` |

### 2.4 A turn, end to end

```
User    Renderer (browser)            Agent service                 e3 (via AgentE3Gateway)      LLM
 │ type  │                             │                              │                      │
 ├──────▶│ append user message         │                              │                      │
 │       ├─ conversation.write ────────┼─────────────────────────────▶│ transcript dataset   │
 │       ├─ POST /turn  (open SSE) ────▶│ AgentTurnRequest             │                      │
 │       │                             ├─ resolve authoritative tools+config from the          │
 │       │                             │  deployed ui() task payload ─▶│  (NOT from client)   │
 │       │                             ├─ read context dataset values ▶│                      │
 │       │                             ├─ AgentRuntime.run() ──────────┼──────────────────────▶│
 │       │  ◀═══ text_delta / thinking_delta (SSE) ════════════════════┤  token stream        │
 │       │ rAF-coalesced repaint of    │                              │                      │
 │       │ the single StreamingRow     │  ◀── tool_use ────────────────┼──────────────────────┤
 │       │                             ├─ AgentToolPolicy.allow? · validate (fromJSONFor)           │
 │       │                             │  OR AgentIRBuilder.buildAndCheck(source→IR)             │
 │       │                             ├─ stageWrite | createTask(draft)+runTask ─────────────▶│
 │       │  ◀═══ tool_use + tool_result events ════════════════════════┤  tool_result ───────▶│  loop
 │       │ ToolUseCard (brand-tint if  │                              │      until end_turn   │
 │       │ staged) / inline component  │  ◀── message_done {usage} ────┤                      │
 │       ├─ persist assistant turn ────┼─────────────────────────────▶│ transcript dataset   │
 │ review│ Commit.Bar appears (dirty)  │                              │                      │
 ├──────▶│ Apply → binding.commit ─────┼─────────────────────────────▶│ dataset updated;     │
 │       │                             │                              │ dataflow recomputes  │
```

Key invariants visible here: the **client request is minimal** (`conversationPath`
+ `userText` + optional `sessionId`); the **authoritative tool set and config
are resolved server-side** from the deployed `ui()` task — the browser cannot
expand its own tool access. The transcript is written by the renderer (it owns
the bound dataset); the agent service proposes changes that land via the
staged-review / draft-branch gates.

### 2.5 Two execution tiers — both run on e3

The agent **authors + validates** (lint + type-check → IR); **e3 executes**.
e3 is the one execution engine — it owns runtime targeting (east-c / east-py /
east-node) and managed execution (orchestration, limits, cancellation, caching,
provenance). The agent is never a second runtime.

```
TIER A — ONE-SHOT AD-HOC  (e3, ephemeral)        TIER B — DEPLOYED TASK  (e3, durable)
  "compute / answer X" · generative UI             "build / keep this" · feeds downstream dataflow
  agent: eval source → IR + type-check             agent: eval source → IR + type-check
  e3:  executeAdHoc(ir, inputPaths, runner)        e3:  workspaceDeploy(draft) → dataflowExecute
       (§5.7 — NEW e3 capability; no deploy)             → datasetGet  (real runner, cached)
  result returned inline; NOT in the graph         output = a bound dataset; chat binds + renders
        └─ runtime-targeted, resource-managed             └─ provenanced; promoted under human review
```

**Tier A requires a new e3 capability** (one-shot execution of a not-yet-deployed
task against existing datasets — §5.7). Until it lands, Tier A degrades to Tier B
against a scratch workspace (correct, heavier). Both tiers keep any *mutation*
behind a human gate (staged review or workspace promotion); reads/compute do not.

---

## 3. The contract layer (`@elaraai/e3-ui`)

This is the **single source of truth**. It is browser-safe (no React, no Agent
SDK, no Node), and it owns three things: the **East types** of the durable
transcript and the component payload, the **`eastTypeToToolSchema`** generator,
and the **wire-protocol** TS types. Every public export carries full TypeDoc
(per `[Full TypeDoc always]`); factory interfaces accept `SubtypeExprOrValue<T>`.

Imports used throughout (`@elaraai/east`): `StructType`, `VariantType`,
`ArrayType`, `DictType`, `OptionType`, `FunctionType`, `StringType`,
`IntegerType`, `FloatType`, `BooleanType`, `DateTimeType`, `NullType`,
`BlobType`, `variant`, `some`, `none`. From `@elaraai/e3-types`: `TreePathType`.
From `@elaraai/east-ui`: `UIComponentType`, `DensityType`. The binding carrier
`DiffBindingType` is re-exported from `./data.js` (defined for `Diff`).

### 3.1 Transcript types (`e3-ui/src/chat.ts`) — the durable East value

```ts
// ── Message role. `system` is config (instructions), not a transcript role. ──
export const ChatRoleType = VariantType({
    user:      NullType,
    assistant: NullType,
});
export type ChatRoleType = typeof ChatRoleType;

// ── Lifecycle of a tool call as recorded in the transcript. ──
export const ChatToolUseStatusType = VariantType({
    proposed: NullType,    // model emitted it; not yet validated/run
    staged:   NullType,    // validated + buffered through a `staged` binding (dirty)
    applied:  NullType,    // committed to the dataset / merged from a draft branch
    rejected: NullType,    // user discarded
    failed:   StringType,  // validation/compile/runtime error — message carried
});
export type ChatToolUseStatusType = typeof ChatToolUseStatusType;

// ── A tool invocation. Covers both typed value-writes (§5.2) and run_east (§5.3). ──
// `inputJson` is the model's raw JSON arguments in East-JSON convention; it is
// re-validated against the resolved tool's EastType by `fromJSONFor` before any
// effect. For `run_east` the JSON carries the function spec (name/source/inputs/outKind).
export const ChatToolUseType = StructType({
    id:        StringType,           // Anthropic tool_use id (stable within a turn)
    tool:      StringType,           // resolved tool name (e.g. "update_roster", "run_east")
    inputJson: StringType,           // raw JSON args (East-JSON convention)
    status:    ChatToolUseStatusType,
});
export type ChatToolUseType = typeof ChatToolUseType;

// ── The result fed back to the model AND shown in the thread. ──
export const ChatToolResultType = StructType({
    toolUseId: StringType,           // pairs with ChatToolUseType.id
    ok:        BooleanType,          // false ⇒ is_error on the wire to the model
    summary:   StringType,           // markdown summary (human + model facing)
});
export type ChatToolResultType = typeof ChatToolResultType;

// ── One content block within a message. Extensible by adding a variant case. ──
// `component` carries a RENDERED generative-UI snapshot (a UIComponentType value),
// dispatched through the existing EastChakraComponent. A LIVE/reactive view is a
// separate e3 `ui()` task the chat binds to (Tier-2, §2.5) — not stored inline.
export const ChatContentBlockType = VariantType({
    text:       StringType,          // markdown (GFM)
    thinking:   StringType,          // extended-thinking text (display-only; see §6.5)
    toolUse:    ChatToolUseType,
    toolResult: ChatToolResultType,
    component:  UIComponentType,     // inline generative UI (chart/table/stat/…)
});
export type ChatContentBlockType = typeof ChatContentBlockType;

// ── A single turn. ──
export const ChatMessageType = StructType({
    id:        StringType,                       // crypto.randomUUID(); used for idempotent writes
    role:      ChatRoleType,
    content:   ArrayType(ChatContentBlockType),
    model:     OptionType(StringType),           // model id that produced an assistant turn
    createdAt: OptionType(DateTimeType),
    interrupted: OptionType(BooleanType),        // true if a Stop/error truncated this turn
});
export type ChatMessageType = typeof ChatMessageType;

// ── Transcript metadata; `schemaVersion` enables forward migration. ──
export const ConversationMetadataType = StructType({
    schemaVersion: IntegerType,
    title:         OptionType(StringType),
    created:       DateTimeType,
    updated:       DateTimeType,
});
export type ConversationMetadataType = typeof ConversationMetadataType;

// ── The full durable transcript: what the conversation binding's dataset holds. ──
export const ConversationType = StructType({
    messages: ArrayType(ChatMessageType),
    metadata: OptionType(ConversationMetadataType),
});
export type ConversationType = typeof ConversationType;
```

Authors declare the transcript dataset with this type:

```ts
const thread = e3.input("assistant_thread", ConversationType, {
    messages: [],
    metadata: none,   // OptionType(ConversationMetadataType)
});
```

### 3.2 Config & tool-exposure types (`e3-ui/src/chat.ts`)

```ts
// ── Sampling + behaviour. NO secrets — the key never appears in the IR. ──
export const ChatConfigType = StructType({
    model:        StringType,                 // e.g. "claude-opus-4-7" (resolved server-side too)
    instructions: OptionType(StringType),     // system prompt
    maxTokens:    OptionType(IntegerType),    // renderer/service default if none (§6.5)
    temperature:  OptionType(FloatType),      // omitted when thinking is enabled (§6.5)
    thinking:     OptionType(BooleanType),    // enable extended thinking
});
export type ChatConfigType = typeof ChatConfigType;

// ── How a tool binding may be used by the model. ──
export const ChatToolAccessType = VariantType({
    read:      NullType,
    write:     NullType,
    readWrite: NullType,
});
export type ChatToolAccessType = typeof ChatToolAccessType;

// ── A dataset exposed to the model as a tool. `binding.mode` decides apply policy (§4). ──
export const ChatToolType = StructType({
    binding:     DiffBindingType,   // { source: TreePath, patch: Option<TreePath>, mode: staged|direct }
    name:        StringType,        // tool name the model sees (sanitised to ^[A-Za-z0-9_-]{1,64}$)
    description: StringType,        // when/why to read or write this dataset
    access:      ChatToolAccessType,
});
export type ChatToolType = typeof ChatToolType;

// ── Visual escape hatches; all OptionType(StringType); defaults from bsys tokens. ──
export const ClaudeChatStyleType = StructType({
    frameBackground:     OptionType(StringType),
    frameBorderColor:    OptionType(StringType),
    headerBackground:    OptionType(StringType),
    assistantAccent:     OptionType(StringType),  // the 2px left rule on assistant turns
    thinkingColor:       OptionType(StringType),
    composerBackground:  OptionType(StringType),
    commitBarBackground: OptionType(StringType),
    commitBarBorder:     OptionType(StringType),
});
export type ClaudeChatStyleType = typeof ClaudeChatStyleType;
```

### 3.3 Component payload, `EastUI.component`, and the `ClaudeChat.Root` factory

```ts
// ── The IR shape the renderer decodes (declared via the extension mechanism). ──
export const ClaudeChatPayloadType = StructType({
    conversation:  DiffBindingType,                // the transcript binding (read+write)
    tools:         ArrayType(ChatToolType),        // datasets exposed as tools
    context:       ArrayType(DiffBindingType),     // read-only datasets injected as context
    config:        ChatConfigType,
    readonly:      OptionType(BooleanType),         // hide all mutation surfaces
    hideComposer:  OptionType(BooleanType),
    density:       OptionType(DensityType),
    onTurn:        OptionType(FunctionType([], NullType)),           // after a completed assistant turn
    onToolApplied: OptionType(FunctionType([StringType], NullType)), // tool name committed
    style:         OptionType(ClaudeChatStyleType),
});
export type ClaudeChatPayloadType = typeof ClaudeChatPayloadType;

// ── Internal EastUI.component carrier — the renderer registers against this. ──
export const ClaudeChatComponent =
    EastUI.component("ClaudeChat", ClaudeChatPayloadType, { optional: true });
```

The developer-facing factory mirrors `Diff.Root` / `Ontology.Root` exactly —
ergonomic options in, `none` defaults applied, an `ExprType<UIComponentType>`
out:

```ts
export interface ClaudeChatOptions {
    /** The transcript binding. Pass `view.binding` from a Data.bind handle whose
     *  source dataset is typed `ConversationType`. */
    conversation: SubtypeExprOrValue<DiffBindingType>;
    /** Model + instructions + sampling. No secrets. */
    config: SubtypeExprOrValue<ChatConfigType>;
    /** Datasets exposed as tools. Default: none. */
    tools?: SubtypeExprOrValue<ArrayType<ChatToolType>>;
    /** Read-only context datasets. Default: none. */
    context?: SubtypeExprOrValue<ArrayType<DiffBindingType>>;
    /** Hide all mutation surfaces. Default false. */
    readonly?: SubtypeExprOrValue<OptionType<BooleanType>>;
    /** Hide the composer (read-only transcript view). Default false. */
    hideComposer?: SubtypeExprOrValue<OptionType<BooleanType>>;
    /** Information-density preset. */
    density?: SubtypeExprOrValue<OptionType<DensityType>> | DensityLiteral;
    /** Fired after each completed assistant turn. */
    onTurn?: SubtypeExprOrValue<OptionType<FunctionType<[], NullType>>>;
    /** Fired when a staged tool write is committed; arg = tool name. */
    onToolApplied?: SubtypeExprOrValue<OptionType<FunctionType<[StringType], NullType>>>;
    /** Visual escape hatches. */
    style?: SubtypeExprOrValue<OptionType<ClaudeChatStyleType>>;
}

export const ClaudeChat = {
    Root(options: ClaudeChatOptions): ExprType<UIComponentType> {
        const density = options.density === undefined
            ? none
            : typeof options.density === "string"
                ? some(East.value(variant(options.density, null), DensityType))
                : options.density;
        return ClaudeChatComponent.Root({
            conversation:  options.conversation,
            tools:         options.tools         ?? [],
            context:       options.context       ?? [],
            config:        options.config,
            readonly:      options.readonly      ?? none,
            hideComposer:  options.hideComposer  ?? none,
            density,
            onTurn:        options.onTurn        ?? none,
            onToolApplied: options.onToolApplied ?? none,
            style:         options.style         ?? none,
        });
    },
    Component: ClaudeChatComponent,
    Types: {
        Conversation:        ConversationType,
        ConversationMetadata: ConversationMetadataType,
        Message:             ChatMessageType,
        ContentBlock:        ChatContentBlockType,
        ToolUse:             ChatToolUseType,
        ToolUseStatus:       ChatToolUseStatusType,
        ToolResult:          ChatToolResultType,
        Role:                ChatRoleType,
        Config:              ChatConfigType,
        Tool:                ChatToolType,
        ToolAccess:          ChatToolAccessType,
        Payload:             ClaudeChatPayloadType,
        Style:               ClaudeChatStyleType,
    },
} as const;
```

Author-side usage (the `Data.bind` calls are what `deriveManifest` scans, so the
`ui()` task preloads every referenced dataset — same as Diff/Ontology):

```ts
const thread  = e3.input("assistant_thread", ConversationType, { messages: [], metadata: none });
const roster  = e3.input("roster", RosterType, defaultRoster);
const policy  = e3.input("workforce_policy", PolicyType, defaultPolicy);

export const assistant = ui("assistant", [], East.function([], UIComponentType, _$ =>
  Reactive.Root(East.function([], UIComponentType, $ => {
    const convo   = $.let(Data.bind([ConversationType], thread.path, { mode: "direct" }));
    const rosterB = $.let(Data.bind([RosterType], roster.path, { mode: "staged" }));   // writes reviewed
    const policyB = $.let(Data.bind([PolicyType], policy.path));                        // read-only context
    return ClaudeChat.Root({
      conversation: convo.binding,
      config: { model: "claude-opus-4-7", instructions: "Help operators tune the roster.", thinking: some(true) },
      tools:   [ { binding: rosterB.binding, name: "update_roster",
                   description: "Propose changes to the weekly roster.", access: variant("write", null) } ],
      context: [ policyB.binding ],
    });
  })),
));
```

### 3.4 `eastTypeToToolSchema` (`e3-ui/src/tool-schema.ts`)

Pure, dependency-free, dispatching on `toEastTypeValue(type).type` exactly like
`toJSONFor`. It emits JSON Schema in **East's JSON conventions**, so the model's
output is accepted by `fromJSONFor(type)` verbatim (no translation step).

```ts
/** The subset of JSON Schema we emit (Anthropic `input_schema` compatible). */
export interface JsonSchema { [key: string]: unknown }

export interface ToolSchemaOptions {
    /** A concrete current value, encoded via toJSONFor, attached as `examples[0]`. */
    example?: unknown;
    /** Per-field descriptions keyed by dotted path (e.g. "shifts.region"). */
    descriptions?: Record<string, string>;
    /** Recursion cap for self-referential (Recursive/Ref) types; default 8. */
    maxDepth?: number;
}

/** EastType → Anthropic tool input_schema (East-JSON convention). */
export function eastTypeToToolSchema(
    type: EastType | EastTypeValue,
    options?: ToolSchemaOptions,
): JsonSchema;
```

Mapping (mirrors `toJSONFor`/`fromJSONFor` exactly):

| EastType | JSON Schema | Note |
|---|---|---|
| `Null` | `{ type: "null" }` | |
| `Boolean` | `{ type: "boolean" }` | |
| `Integer` | `{ type: "string", pattern: "^-?[0-9]+$" }` | bigint encoded as a **string** |
| `Float` | `{ type: "number" }` | |
| `String` | `{ type: "string" }` | |
| `DateTime` | `{ type: "string", format: "date-time" }` | RFC 3339 |
| `Blob` | `{ type: "string", pattern: "^0x([0-9a-f]{2})*$" }` | hex; usually omitted from tools |
| `Option(T)` | `{ type:"object", properties:{ type:{enum:["some","none"]}, value: schema(T) }, required:["type"] }` | East Option is a Variant |
| `Array(T)` | `{ type: "array", items: schema(T) }` | |
| `Set(T)` | `{ type: "array", items: schema(T), uniqueItems: true }` | |
| `Dict(String,V)` | `{ type:"object", additionalProperties: schema(V) }` | string keys |
| `Dict(K,V)` | `{ type:"array", items:{ type:"array", prefixItems:[schema(K),schema(V)], minItems:2, maxItems:2 } }` | non-string keys → pairs |
| `Struct({…})` | `{ type:"object", properties:{…}, required:[non-Option fields], additionalProperties:false }` | |
| `Variant({…})` | `{ type:"object", properties:{ type:{enum:[…tags]}, value:{ oneOf:[…] } }, required:["type","value"] }` | tags → enum |
| `Tuple([…])` | `{ type:"array", prefixItems:[…], minItems:n, maxItems:n }` | |
| `Recursive`/`Ref` | `{ $ref: "#/$defs/…" }` + a `$defs` table | depth-capped |

**Anthropic requires the tool `input_schema` root to be an object.** So the
write tool's schema is:

- **`T` is a `Struct`** → spread its fields at the root (`{ type:"object",
  properties: <fields>, required: <non-option> }`); the model fills the struct
  directly.
- **`T` is not a `Struct`** → wrap: `{ type:"object", properties:{ value:
  schema(T) }, required:["value"] }`; the model sends `{ "value": … }` and we
  read `.value` before `fromJSONFor(T)`.

What makes the *pre-send* values correct: `Variant` tags become an `enum` (no
invented cases); `Option` fields drop out of `required` (the model knows what's
omittable); per-field `description`s + the current value as `examples[0]` anchor
the edit to a valid baseline.

### 3.5 The wire protocol (`e3-ui/src/protocol.ts`) — the stable seam

Plain TS (the wire is JSON/SSE). **By construction, no field can carry a
secret, a tool schema, or a config override** — the request is minimal and the
service resolves the authoritative tools/config from the deployed `ui()` task.

```ts
import type { TreePath } from "@elaraai/e3-types";

/** Client → service. Deliberately minimal (see §2.4). */
export interface AgentTurnRequest {
    /** Which transcript dataset this turn belongs to. */
    conversationPath: TreePath;
    /** The new user message text. */
    userText: string;
    /** Resume an Agent-SDK session for multi-turn continuity. */
    sessionId?: string;
}

export type ToolUseStatusLiteral = "proposed" | "staged" | "applied" | "rejected" | "failed";
export type StopReasonLiteral     = "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "pause_turn";
export type ErrorClassLiteral     = "aborted" | "auth" | "rate_limit" | "overloaded" | "network" | "invalid_request" | "server";

export interface Usage {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
}

/** Service → client, streamed over SSE. A discriminated union on `type`. */
export type AgentStreamEvent =
    | { type: "session";        sessionId: string }                                   // emitted once at start
    | { type: "text_delta";     text: string }
    | { type: "thinking_delta"; text: string }
    | { type: "tool_use";       id: string; tool: string; status: ToolUseStatusLiteral;
                                 /** East-JSON preview of the proposed/issued input (truncated). */
                                 preview?: unknown }
    | { type: "tool_result";    toolUseId: string; ok: boolean; summary: string }
    | { type: "component";      /** base64 beast2 of a UIComponentType value (generative UI). */
                                 payloadB2: string }
    | { type: "message_done";   stop: StopReasonLiteral; usage: Usage }
    | { type: "error";          errorClass: ErrorClassLiteral; message: string };
```

The renderer's `ClaudeTransport` (§8) consumes `AgentStreamEvent`s and maps them
onto transient streaming state + (on completion) `ChatContentBlockType` values it
persists into the transcript. Note `component` events stream **rendered**
generative UI as a beast2 `UIComponentType`, decoded and dispatched through the
existing `EastChakraComponent`.

---

## 4. The binding model

The component takes three kinds of binding, all `DiffBindingType` carriers
(`{ source: TreePath, patch: Option<TreePath>, mode: staged|direct }`) produced
by `Data.bind`:

| Binding | Cardinality | Direction | Purpose |
|---|---|---|---|
| `conversation` | 1 | read + write | the durable transcript dataset (`ConversationType`) |
| `tools[]` | 0..N | read / write / readWrite | datasets exposed to the model as tools |
| `context[]` | 0..N | read-only | datasets injected as context (current value shown) |

### 4.1 Apply policy comes from the binding's `mode`, not a new flag

How a tool write lands is **already encoded** in the binding the developer
created — there is no separate per-tool apply policy:

- **`staged`** → a tool write **buffers** the typed value (`brand-tint = dirty`)
  via the `StagedStore`; it surfaces as a pending change the user reviews and
  applies via the Commit.Bar / a paired `Diff` card. The model is told "staged,
  pending review" so it does not assume the dataset changed.
- **`direct`** → the write goes through immediately (`write` / `writeAndStart`
  kicks the dataflow). For low-stakes / scratch datasets.
- **`patch` present** → writes target the patch dataset; `commit` applies it to
  source. Identical matrix to `Diff`.

So the safety posture is chosen at `Data.bind([T], path, { mode: "staged" })`
time, and the chat honours it. The review surface is literally
`Diff.Root({ bindings: writableToolBindings })` composed beside the thread —
*composition over invention*. (Tier-2 e3 tasks are gated by workspace promotion
instead; §5.5.)

## 5. The agent-tool spectrum (typed e3 state in, typed results out)

Every capability is an **agent tool** the service registers (§6.3). They form a
spectrum from "set one field" to "author and run a whole typed program," all
flowing through the same review/promotion gates.

### 5.1 The type system's triple duty

At **both** the value level and the function level, the static `EastType` does
three jobs:

1. **Generates** the JSON Schema (`eastTypeToToolSchema`, §3.4) / the function
   parameter types — so the model produces conforming output *before sending*.
2. **Validates** what comes back — `fromJSONFor(T)` for values; the East
   **compiler** (type-check) for functions. Failures return a
   `tool_result { is_error: true }` with the message, and the model self-corrects.
3. **Is** the artifact — the validated value is staged through the binding; the
   compiled function is run; the typed result decides render / stage / display.

### 5.2 Typed writes — one tool: `patch_<name>`

A write **is a patch**. For each `write`/`readWrite` binding the service
registers a single `patch_<name>` tool — there is no separate whole-value tool.
`PatchType(T)` already subsumes wholesale replacement (its `replace` op), and the
binding/staged/commit/Diff system is itself **patch-native** (commit computes
`diffFor`; the patch dataset is `PatchType(T)`; the `Diff` `walker` renders
`PatchTypeOf<T>`). So a patch write has **zero impedance**, and "delete one row
from a 10k-row `Dict(K, Struct)`" costs one key + a `delete` — never the whole
table, which a `set` often couldn't even fit in the output-token budget. A `set`
would just be `diffFor`'d into a patch on commit anyway.

**The model supplies a *forward-only* edit; the service makes it invertible.**
East patches are invertible — the encoding is
`VariantType({ unchanged, replace: { before, after }, patch: … })`, and dict
`delete` carries the removed value — for conflict-detection + undo. The model
must **not** transcribe those `before`/old values (it can't reliably know them
and they're token-heavy). So `patch_<name>`'s `input_schema` is the **forward
shape** of `PatchType(T)` — the same variant structure but with the inverse
fields stripped: `replace` carries only `after`; dict/set `delete` carries only
the key (no removed value); `insert` carries the value; `update` recurses as a
forward sub-edit. The service then:

1. validates the forward edit against `T`;
2. applies it to the **current** value → `next`;
3. computes the canonical invertible patch `diffFor(T)(current, next)`;
4. stages it (or writes through, per the binding's `mode`) → `tool_result`.

So "delete row K" is literally `{ patch: { "K": { delete: null } } }` — no row
payload — and the service fills the removed value from current state. The `Diff`
walker renders the resulting patch for review unchanged. (A path-addressed
edit-ops sugar — set/insert/delete by dotted path — can sit on top later, but the
forward-Patch shape is the canonical input.)

Both staged and direct end at `AgentE3Gateway.stageWrite` / write-through. All of
this reuses existing East machinery: `PatchType(T)`, `diffFor` / `applyFor`, and
the binding's `patch` mode (`Data.bind({ patch })`, already a `PatchType(T)`
dataset).

### 5.3 Ad hoc East functions — `run_east` (compute / transform)

For anything needing a *transformation*, the model authors a typed East
function over named bindings. The tool input:

```ts
/** Input schema for the `run_east` tool (fixed; not generated from a dataset type). */
export interface RunEastInput {
    /** Identifier (also the task name if promoted to Tier-2). */
    name: string;
    /** Markdown: what it computes and why. */
    summary: string;
    /** Binding/context names the function reads, in parameter order. Each resolves
     *  to its dataset's EastType → the function's parameter types. */
    inputs: string[];
    /** What the result is for, so we know how to handle it. */
    outKind:
        | { kind: "value" }                  // display via EastValueViewer + summarise for the model
        | { kind: "ui" }                     // render the UIComponentType inline (generative UI, §5.4)
        | { kind: "write"; tool: string };   // stage into a writable binding (out type = that binding's T)
    /** A full East-DSL expression: `East.function([...], Out, ($, a, b) => …)`.
     *  Its parameter arity/types must match `inputs`; verified at compile. */
    source: string;
    /** false (default) ⇒ Tier-1 ephemeral run; true ⇒ Tier-2 durable e3 task (§5.5). */
    durable?: boolean;
}
```

The pipeline — the **agent authors + validates; e3 executes**. The agent is
never a second execution engine (§6.1):

```
   model `source` (grounded by the plugin's example injection + skills, §6.2)
        │  ── agent service: AUTHORING ONLY (no execution) ───────────────────
   1. LINT       eslint-plugin-east over `source`           → idiom diagnostics
   2. BUILD IR   eval the East.function(...) in an isolate  → beast2 FunctionIR
                 (static reject of import/require/eval/Function/globals; timeout)
   3. TYPECHECK  East `analyzeIR` against the resolved input EastTypes + arity
                 vs `inputs`                                → type errors (fast, no round-trip)
        │  ── e3: EXECUTION (managed, multi-runtime) ────────────────────────
   4. EXECUTE    AgentE3Gateway.executeAdHoc(ir, inputPaths, runner)  — ONE-SHOT (§5.7);
                 e3 runs it on east-c / east-py / east-node, resource-managed,
                 against the repo's current datasets; nothing deployed
        │
   5. typed result → §5.4 (ui) / §5.2-style stage (write) / EastValueViewer (value)
```

The agent **never** compiles-to-runnable or executes — it produces validated IR
(`East.Blob.encodeBeast` + `analyzeIR` from `@elaraai/east`) and hands it to e3.
e3 owns execution: **runtime targeting** (east-c / east-py / east-node) and
**managed execution** (orchestration, resource limits, cancellation, caching,
provenance). Lint + type errors (steps 1–3, with source locations) come back as
`tool_result { is_error: true }` for fast self-correction *before* any e3
round-trip; runtime errors come back from e3 (§5.7).

### 5.4 Generative UI — `run_east` with `outKind: "ui"`

A UI component **is** an East function returning `UIComponentType`. So when
`outKind = "ui"`, the **one-shot e3 execution** (§5.3 step 4) returns a
`UIComponentType` **value**; the service streams it as a
`{ type: "component", payloadB2 }` event; the renderer decodes and dispatches it
through the existing `EastChakraComponent`, persisting it as a
`ChatContentBlockType.component` block. **e3 does the data computation; the browser
only renders the resulting value** (the normal east-ui render path, including any
interactive sub-components). No new rendering path — generative UI falls out of
§5.3 for free. A *live*, data-reactive view is instead a durable `ui()` task
(§5.5) the chat binds like any dataset.

### 5.5 Delegate to e3 — `create_task` (durable, provenanced)

When `durable: true` (or the user asks to "keep"/"save" a transformation), the
service promotes the validated function to a real **e3 task**, executed by e3.
This is the answer to *"can the agent write and run an arbitrary e3 task and
return results?"* — yes, via the package/workspace mechanism, entirely through
`e3-api-client` (so local **and** remote repos work):

```
   compiled FunctionIR + declared input dataset paths + output path
        │  AgentE3Gateway (over e3-api-client):
   1. ASSEMBLE   build a package containing `e3.task(name, [inputs], fn)`
   2. DEPLOY     workspaceDeploy / packageImport → a SCRATCH/DRAFT workspace (isolated)
   3. RUN        dataflowExecuteLaunch → dataflowExecutePoll  (real e3 runner; cached)
   4. READ       datasetGet(outputPath)  → beast2 bytes → decode → typed result
   5. PROVENANCE taskExecutionList / taskLogs available (bsys "trust is visible")
        │
   6. result returned to the user; the task PERSISTS only in the draft workspace
      until PROMOTED (deploy to the canonical workspace) under human review.
```

Safety bounds (precise): the function is **pure East** compiled with an
empty/curated `SAFE_PLATFORM` (no I/O); its **inputs** are only datasets
`AgentToolPolicy` permits; execution is **e3's sandboxed runner** (resource-capped);
it lands in an **isolated scratch workspace** behind a **human promotion gate**;
and the service uses the **user's scoped e3 token** — never more authority than
the user has. So it is "arbitrary *computation over permitted inputs*", not
arbitrary side effects.

### 5.6 The tool catalog (what the service registers)

| Tool | Input | Effect | Tier / gate |
|---|---|---|---|
| `read_<name>` | `{}` | `AgentE3Gateway.readDataset` → `toJSONFor` (truncated) | read-only |
| `patch_<name>` | forward `PatchType(T)` shape | validate → apply → `diffFor(T)(current,next)` → stage (or direct) | binding `mode` |
| `run_east` | `RunEastInput` | build IR (agent) + **e3 one-shot exec** (§5.7); no deploy | result reviewed if it writes |
| `create_task` | `RunEastInput` (+ output path) | build IR (agent) + **deploy + run** a durable e3 task on a draft workspace | promotion gate |
| `list_datasets` | `{}` | `AgentE3Gateway.listDatasets` (+ types) | read-only |
| `search_east_examples` | `{ query }` | the plugin's `east` MCP (grounding) | read-only |

`read_<name>` is preferred over bulk `context[]` injection (tokens + egress,
§7). `run_east`/`create_task` are scoped by `AgentToolPolicy`; both keep mutation
behind a gate (staged review or workspace promotion).

### 5.7 Required e3 capability: one-shot ad-hoc execution

Tier-A execution (§2.5) needs e3 to run a **single, not-yet-deployed** task
against existing datasets and return the result **without mutating the graph**.
e3 does not do this today (it runs only *deployed* tasks). This is a **generic
e3 feature** with **no dependency on this component** — equally useful for
notebooks, dry-run/preview-before-deploy, what-if analysis, debugging, and
external tooling — so it is specified as a **standalone change request** the e3
team can implement independently:

> **→ [`e3-adhoc-execution.md`](../../../../e3/design/e3-adhoc-execution.md)**
> (`libs/e3/design/`). `adHocExecute(repo, workspace, { commandIr, inputs,
> runner?, at?, output?, limits?, platform? })` with async launch/poll/cancel
> mirroring `dataflowExecute*`; read-only inputs, authority-free by default,
> runtime-targeted (east-c / east-py / east-node), ephemeral (no task object, no
> durable output, no downstream trigger). It is `dataflowExecute` specialised to
> one transient task, reusing the existing runner/orchestrator/dataset-read
> machinery.

This component is just **one downstream consumer**: it supplies a ready
`commandIr` (authoring is its concern, §5.3) and e3 owns execution. Until the
capability ships, it falls back to **deploy-to-scratch-workspace** (§5.5) for
every ad-hoc run — correct but heavier (deploys a task it then discards).

---

## 6. The agent service (`libs/east-agent`)

A headless Node service: it owns the reasoning + codegen loop, authors + validates
East (never executes it), and reaches e3 through the API. It is **abstractions +
a reference implementation** (§2.3); `east-aws` supplies production impls of the
same interfaces.

### 6.1 Contracts (`libs/east-agent/src/contracts.ts`) — full TS

```ts
import type { TreePath } from "@elaraai/e3-types";
import type { EastTypeValue } from "@elaraai/east";
import type { AgentTurnRequest, AgentStreamEvent } from "@elaraai/e3-ui"; // the wire protocol (§3.5)
import type { AdHocExecuteRequest, AdHocExecuteResult } from "@elaraai/e3-api-client"; // §5.7

/** Per-request identity/scope, derived from the CALLER's e3 token (no escalation). */
export interface AgentContext {
    repo: string;
    workspace: string;
    /** The caller's scoped e3 token — the agent acts AS the user, never above. */
    e3Token: string;
    /** Stable subject id for session + audit scoping. */
    subject: string;
}

/** LLM auth. Server-only; the value NEVER crosses the wire protocol, is never
 *  logged, and is never serialised into a response. The keyless variants mean
 *  there is no long-lived key to store or leak at all (§7.3). */
export type AgentAuth =
    | { kind: "apiKey"; apiKey: string }                     // self-host; in-memory only
    | { kind: "bedrock"; region: string }                   // IAM role — NO key
    | { kind: "vertex"; project: string; location: string } // workload identity — NO key
    | { kind: "managed" };                                  // Anthropic-hosted Managed Agents

export interface AgentSecretProvider {
    /** Resolve auth for one runtime construction. Consumed only by AgentRuntime
     *  setup; the returned value must not be returned/logged elsewhere. */
    resolveAuth(ctx: AgentContext): Promise<AgentAuth>;
}

/** e3 access. Reference impl wraps `e3-api-client` (local AND remote repos). */
export interface AgentE3Gateway {
    // reads (gated by AgentToolPolicy + the caller's e3 read scope)
    readDataset(ctx: AgentContext, path: TreePath): Promise<Uint8Array | undefined>; // beast2
    datasetType(ctx: AgentContext, path: TreePath): Promise<EastTypeValue | undefined>;
    listDatasets(ctx: AgentContext): Promise<Array<{ path: TreePath; type: EastTypeValue }>>;
    // typed value writes (§5.2) — buffered or direct per the binding's mode (§4)
    stageWrite(ctx: AgentContext, path: TreePath, beast2: Uint8Array): Promise<void>;
    // Tier-A: one-shot ad-hoc execution (§5.7 — the required generic e3 capability)
    executeAdHoc(ctx: AgentContext, req: AdHocExecuteRequest): Promise<AdHocExecuteResult>;
    // Tier-B: durable task deployed to a draft workspace, run via the dataflow
    deployTask(ctx: AgentContext, draftWorkspace: string, spec: AgentTaskDeploySpec): Promise<void>;
    runDataflow(ctx: AgentContext, draftWorkspace: string): Promise<void>;
}
export interface AgentTaskDeploySpec {
    name: string;
    commandIr: Uint8Array;   // beast2 FunctionIR from AgentIRBuilder
    inputs: TreePath[];
    output: TreePath;
    runner?: string[];       // ['east-c','run'] | ['east-py','run'] | ['east-node','run']
}

/** East authoring: source → IR + type-check. NEVER compiles-to-runnable, NEVER
 *  executes. Execution is always e3's (§5.3). */
export interface AgentIRBuilder {
    buildAndCheck(
        source: string,                 // a full `East.function(...)` expression
        paramTypes: EastTypeValue[],    // resolved from the named input datasets
        outType?: EastTypeValue,        // declared/inferred result type
    ): Promise<AgentBuildResult>;
}
export interface AgentBuildResult {
    ok: boolean;
    irBytes?: Uint8Array;               // beast2 FunctionIR → executeAdHoc / deployTask
    outType?: EastTypeValue;
    diagnostics: Diagnostic[];          // lint (eslint-plugin-east) + type errors, with locations
}
export interface Diagnostic {
    severity: "error" | "warning";
    message: string;
    loc?: { line: number; column: number };
    ruleId?: string;                    // for lint findings
}

/** Authz/quotas for tools. */
export interface AgentToolPolicy {
    allow(ctx: AgentContext, tool: string, target?: TreePath): boolean;
    checkQuota?(ctx: AgentContext, tool: string): Promise<boolean>;
}

/** Session continuity: the Agent-SDK session + a pointer to the transcript. */
export interface AgentSessionStore {
    load(ctx: AgentContext, sessionId: string): Promise<AgentSessionState | undefined>;
    save(ctx: AgentContext, sessionId: string, state: AgentSessionState): Promise<void>;
}
export interface AgentSessionState { sdkSessionId: string; conversationPath: TreePath; }

/** The agent loop. Reference impl = Claude Agent SDK (§6.2). */
export interface AgentRuntime {
    /** Drive one turn: resolve authoritative tools/config server-side, run the
     *  loop, emit events, honour the abort signal. */
    run(ctx: AgentContext, req: AgentTurnRequest, sink: AgentEventSink, signal: AbortSignal): Promise<void>;
}
export interface AgentEventSink { emit(event: AgentStreamEvent): void; }
```

### 6.2 Reference `AgentRuntime` = Claude Agent SDK + `east-claude-plugin`

This is the quality keystone (§1.3). The Agent SDK runs the loop and **loads the
Claude Code plugin**, so the assistant inherits the *same* East expertise Claude
Code has.

```ts
// libs/east-agent/src/runtime/sdk-runtime.ts
import { query, type ClaudeAgentOptions } from "@anthropic-ai/claude-agent-sdk";

export function createSdkAgentRuntime(deps: {
    e3: AgentE3Gateway; compiler: AgentIRBuilder; policy: AgentToolPolicy; secrets: AgentSecretProvider;
}): AgentRuntime {
    return {
        async run(ctx, req, sink, signal) {
            const auth = await deps.secrets.resolveAuth(ctx);     // env/IAM; never logged/returned
            // AUTHORITATIVE tools/config come from the DEPLOYED ui() task payload,
            // resolved via e3 — NOT from the client (a client cannot widen its tools):
            const { config, tools, context } = await resolveDeployedPayload(deps.e3, ctx, req.conversationPath);

            const options: ClaudeAgentOptions = {
                plugins:        [eastClaudePlugin],   // → skills + east MCP + hooks
                settingSources: [],                   // do NOT load ambient ~/.claude / project settings
                model:          config.model,
                systemPrompt:   buildSystemPrompt(config, context),  // + current context values (toJSONFor)
                // Custom in-process tools over AgentE3Gateway / AgentIRBuilder, each AgentToolPolicy-gated:
                mcpServers:     { e3: e3ToolServer(deps, ctx, tools) },
                allowedTools: [
                    "mcp__e3__read", "mcp__e3__write", "mcp__e3__run_east",
                    "mcp__e3__create_task", "mcp__e3__list_datasets",
                    "mcp__plugin_east_east__search_east_examples",   // grounding (also auto-injected)
                    "Agent",                                                // to invoke the subagent
                ],
                agents:         { "east-author": eastAuthorSubagent(deps) }, // codegen subagent
                permissionMode: "default",
                hooks:          { PreToolUse: [stagedWriteGate(deps.policy, ctx)] }, // enforce the gate
                resume:         req.sessionId,
                // auth flows via env configured from `auth` (apiKey) or ambient IAM (keyless)
            };

            for await (const message of query({ prompt: req.userText, options })) {
                const event = mapSdkMessage(message, deps, ctx);   // → AgentStreamEvent (§3.5)
                if (event) sink.emit(event);
            }
        },
    };
}
```

What the plugin brings (all loaded by the SDK, no reimplementation):

- **Skills** — `east` / `e3` / `east-ui` / `e3-ui` `SKILL.md` as agent skills.
- **`east` MCP server** — the ~1400-entry example index as a tool.
- **The `UserPromptSubmit` hook = preemptive example injection.** It scans
  context for keywords, hits the index, and injects canonical compiling examples
  *before* the model writes — the single biggest East-codegen quality lever,
  with zero tool-call latency. (These are the `<east-examples>` blocks Claude
  Code already receives.)
- **The `pre-write` hook = `eslint-plugin-east`** — idiom violations
  (`compareFor`, no hand-rolled variants, …) caught + fed back as structured
  diagnostics, not just type errors.
- **The `east-author` subagent** — the main conversational agent delegates
  "produce a function/task that does X" to a codegen-specialised subagent scoped
  to the search / `run_east` / `create_task` tools.

The service maps each SDK tool call to an effect: `patch_*` → validate
forward-edit → apply to current → `diffFor` → `AgentE3Gateway.stageWrite`;
`run_east` → `AgentIRBuilder.buildAndCheck` →
`AgentE3Gateway.executeAdHoc`; `create_task` → `buildAndCheck` → `deployTask` +
`runDataflow`. The `PreToolUse` hook enforces that any mutation is staged /
draft-branch only.

### 6.3 The SSE protocol server

`POST /turn` (per `AgentTurnRequest`, §3.5) opens an SSE stream, constructs a
`AgentContext` from the caller's e3 token, runs `AgentRuntime.run(...)`, and
relays each `AgentStreamEvent` as an SSE `data:` line. `mapSdkMessage`
translates SDK message types into the protocol union — text/thinking deltas,
tool-use lifecycle (with East-JSON `preview`), `component` (a beast2
`UIComponentType` from a `run_east outKind:"ui"`), `message_done` (with
`usage`), and classified `error`s (§7.5). The transcript itself is written by
the **renderer** (it owns the bound dataset); the service only proposes changes
through the gates.

### 6.4 Anthropic-API correctness — who owns what

With the Agent SDK backing the proxy, the **SDK owns** the fiddly bits: the tool
loop, `input_json_delta` accumulation, **thinking-block + signature replay**
across the tool loop, multi-turn **sessions** (`resume`), and provider retries.
The **service still owns**: mapping tool calls to e3 effects (validate / build
IR), enforcing the staged gate, surfacing `stop_reason` (`max_tokens` → a
"Continue" affordance to the client; `pause_turn` → resume), configuring
**prompt caching** (`cache_control` on the stable system + tool prefix), and
extracting **usage**. The **browser-direct fallback** (no SDK, raw Messages API)
must hand-roll *all* of this itself — which is the main reason it is dev-only and
lower-fidelity.

### 6.5 Sessions & the transcript

Two layers of "memory", deliberately distinct:

- **Durable transcript** = the bound `ConversationType` dataset, written by the
  renderer on each completed turn (§8). The **source of truth**; diffable;
  survives restarts; what a fresh session replays from.
- **Agent-SDK session** (`resume`) = the in-flight working context for a
  multi-turn exchange (files read, tool results, thinking signatures). Backed by
  `AgentSessionStore`. An optimisation over replaying the whole transcript each turn;
  it is *not* the source of truth and may be evicted.

## 7. Security & key custody

### 7.1 The trust boundary

```
            TRUST BOUNDARY = the wire protocol (e3-ui/src/protocol.ts)
  BROWSER (untrusted)        ┊  AGENT SERVICE (trusted, server)         ┊  LLM PROVIDER
  ──────────────────────────┊──────────────────────────────────────────┊───────────────────
  AgentTurnRequest ─────────┊─▶ AgentContext (caller's scoped e3 token)┊
   { conversationPath,      ┊   resolve tools/config from DEPLOYED task ─┊─ (e3)
     userText, sessionId? } ┊   AgentSecretProvider.resolveAuth(ctx) ─────────┊─▶ apiKey  (self-host;
                            ┊     └─ AgentAuth: in-memory only           ┊      in service env only)
                            ┊        · never logged                      ┊   OR  IAM role / workload
  ◀──── AgentStreamEvent ───┊◀── stream(text/thinking/tool/usage/error)  ┊      identity → NO KEY (cloud)
   (the type has NO         ┊   e3 effects via the caller's token only   ┊
    secret-bearing field)   ┊   (no privilege escalation)                ┊

  CANNOT cross the boundary: the LLM key · tool schemas · config overrides ·
  raw dataset bytes (except what an explicit read tool returns, gated by §7.4)
```

### 7.2 What the boundary guarantees (and what it does not)

The earlier question — *does a dedicated interface ensure no key leak / unsafe
storage?* — answered precisely:

- **Guaranteed by construction (cannot leak via these paths):** the wire
  protocol type (`AgentTurnRequest` / `AgentStreamEvent`) has **no field that
  can carry a secret**, so a client can neither send nor receive a key — you
  can't leak what the type can't represent. The renderer bundle never imports
  the LLM SDK (separate subpath, §8). The key is never an East value / dataset /
  task-metadata / beast2-payload field (an IR invariant). These remove the
  client-, bundle-, and persistence-side leak paths at compile time.
- **Confined, not magicked:** the key lives only behind `AgentSecretProvider` +
  `AgentRuntime` construction in the service process. The interface doesn't stop
  a *careless* impl from logging it — so the contract specifies `AgentAuth` is
  consumed only at runtime setup and never logged/returned, plus a redaction +
  "no-secret-in-any-protocol-message/log" test in CI. It is one small, auditable
  surface — like e3's `OidcProvider`.
- **Strongest in the cloud — no key at all (§7.3).**

### 7.3 Cloud: keyless auth

Because `AgentRuntime` + `AgentSecretProvider` are abstractions, `east-aws` resolves
`AgentAuth` to `bedrock` / `vertex` (IAM role / workload identity) — the Agent
SDK supports `CLAUDE_CODE_USE_BEDROCK` / `_VERTEX`. Then **there is no long-lived
API key in the system to store or leak**: auth is an ambient, per-tenant cloud
credential. The self-host reference impl uses an env `apiKey`; the cloud uses
keyless IAM — same interface, no fork.

### 7.4 Prompt injection · data egress · write guardrails · sanitisation

- **Prompt injection.** Context / `read_*` dataset content may carry adversarial
  "instructions". Mitigations: the system prompt frames dataset content as
  **data, not instructions**; reads are wrapped in delimited result blocks; and
  the **gate is the hard backstop** — a `staged` write or a draft-workspace task
  cannot change anything without explicit human Apply/promotion, so an injected
  "write X" is *reviewable*, not silent.
- **Data egress.** Whatever is in `context[]` or returned by `read_*` is sent to
  the LLM provider. Documented as the egress surface; the design **prefers
  on-demand `read_*` over bulk `context[]`** (tokens *and* egress), and supports
  a per-binding redaction hook in `AgentE3Gateway`.
- **Write guardrails.** Only `write`/`readWrite` bindings are writable; value
  writes validate via `fromJSONFor`; `run_east`/`create_task` are pure
  (authority-free) and `AgentToolPolicy`-scoped; a large-diff threshold can require an
  extra confirm before Apply.
- **Untrusted markdown.** Model text is rendered through `rehype-sanitize` (no
  raw-HTML injection); links carry `rel="noopener noreferrer"`.

### 7.5 Error taxonomy & retry

The service classifies failures into the `ErrorClassLiteral` union (§3.5) so the
renderer responds differently — a generic "something went wrong" is not
gold-plated:

| Class | Source | Response |
|---|---|---|
| `aborted` | Stop / unmount | not an error — keep partial, no banner |
| `auth` (401/403) | bad/missing credential | `banner.error`, **not** retryable; points at service config |
| `rate_limit` (429) | quota | auto-retry with backoff honouring `retry-after` |
| `overloaded` (529) | provider load | auto-retry, exponential backoff + jitter |
| `network` | fetch failure | bounded auto-retry, then a Retry button |
| `invalid_request` (400) | bad payload | `banner.error` with detail, not retried |
| `server` (5xx) | transient | bounded backoff retry |

The Agent SDK already retries some classes; the service maps provider errors to
this taxonomy and the renderer (§8) renders the response. Aborts tear down the
turn cleanly with no orphan state.

---

## 8. The renderer (`@elaraai/e3-ui-components`)

`EastChakraClaudeChat` is a **thin streaming client**, registered against the
extension at module load via
`implementUIComponent(ClaudeChat.Component, EastChakraClaudeChat)`. It does **not**
run the agent loop, hold keys, call the LLM, or execute East — all of that is the
agent service (§6).

### 8.1 Responsibilities

**Owns:** rendering the transcript (the bound `ConversationType` dataset) +
composer; opening a turn and consuming the `AgentStreamEvent` stream (§3.5);
persisting **completed** turns to the conversation binding; the staged-write
review surface (`Diff` / Commit.Bar, §4); rendering `component` events (generative
UI) through `EastChakraComponent`; gold-plated streaming/scroll/a11y.
**Does not own:** the agent loop, tool execution, key custody, East execution,
Anthropic-API correctness (§6.4) — except in the dev-only browser-direct fallback.

### 8.2 bsys compliance

Composes **only** bsys building blocks (per `[bsys building blocks]`):
`layerStyle="frame"`, the `eyebrowRow` / `commitBar` / `status` slot-recipes,
`chip`/`tag` recipes, `banner.*` layer-styles — never raw Chakra defaults or hex.

```
┌ frame (1px border.strong · 10px radius · paper · no shadow · overflow hidden) ┐
│ eyebrow-row   ASSISTANT · roster copilot          claude-opus-4-7 · ● READY   │  ← mono 11px/0.18em; status = dot+word (rule 04)
├───────────────────────────────────────────────────────────────────────────┤
│ thread (scroll)                                                              │
│   YOU                                                                        │  ← mono eyebrow, ink-4; NO bubble (rules 04/05)
│   Move 3 SE shifts from Patel → Cho                                          │
│   CLAUDE                                          ▎(2px brand-d left rule)    │
│   Here's the plan… (Markdown / GFM)                                          │
│   ▸ THINKING (collapsible, muted)                                            │
│   ┌ inset · dashed · paper-2 ── update_roster ──────────────┐               │  ← Inset role; brand-tint if staged+pending
│   │ typed value preview (Diff/EastValueViewer)               │               │
│   └────────────────────────────────────────────────────────┘               │
│   ┌ inset ── chart (generative UI via EastChakraComponent) ──┐               │  ← `component` event → UIComponentType
│   └────────────────────────────────────────────────────────┘               │
├───────────────────────────────────────────────────────────────────────────┤
│ composer   [ textarea (auto-grow) ………………… ]   ⏎ send · ⇧⏎ newline   [Send] │  ← footer; [Stop] while streaming
└───────────────────────────────────────────────────────────────────────────┘
  ┌ Commit.Bar (sticky · brand-tint · 1px brand-d · 8px radius) ─────────────┐
  │ ● N changes pending · roster.se.shifts        Override · Modify · Apply   │   ← only when staged writes are dirty
  └──────────────────────────────────────────────────────────────────────────┘
```

Rules honoured: one Frame shape (eyebrow/body/footer; Inset for tool-use +
component cards); **status = dot + word** (`● THINKING` brand-pulsing /
`● READY` pos / `● ERROR` neg), never a tinted pill; **`brand-tint = dirty` and
nowhere else** (a staged, un-applied write tints its inset + raises the
Commit.Bar); **messages are not coloured bubbles** (mono role eyebrow + 2px
brand-d left rule on assistant turns); **banners over modals** for errors/stale;
mono labels everywhere; density presets; `EmptyState` for the zero state.

### 8.3 Component tree & files (`e3-ui-components/src/chat/`)

```
EastChakraClaudeChat   index.tsx        memo(equalFor(payload) && storageKey); frame + ChatCommitBar
├ ChatHeader           ChatHeader.tsx   eyebrow-row: agent name · model chip · StatusDot · usage
├ Thread               Thread.tsx       scroll container + virtualizer + scroll-pinning + "↓ New" pill
│  ├ MessageRow        MessageRow.tsx   memo(equalFor(ChatMessageType)); one committed turn
│  │  ├ TextBlock      → Markdown (reused) + rehype-sanitize + shiki + rehype-katex
│  │  ├ ThinkingBlock  Collapsible, muted, mono "THINKING" eyebrow
│  │  ├ ToolUseCard    ToolUseCard.tsx  Inset; StatusDot; typed-value preview; inline Apply/Discard
│  │  ├ ComponentBlock → EastChakraComponent (generative UI)
│  │  └ ToolResultBlock compact ok/err line
│  └ StreamingRow      StreamingRow.tsx the in-flight turn; the ONLY row repainting mid-stream
├ Composer             Composer.tsx     auto-grow textarea + Send/Stop + mono hint
└ ErrorBanner          banner.error + Retry

  bind-runtime.ts   useBindingConversation() (read/append/persist) + useToolBinding() (resolve type, current value, stage)
  useTurnStream.ts  open a turn via the transport, consume AgentStreamEvent, drive streaming state, persist completed turn
  transport.ts      ClaudeTransport interface + ClaudeChatProvider + createProxyTransport (SSE client of the agent service)
  format.ts         typed-value previews (reuse Diff walker/format + EastValueViewer)

  (subpath) ./anthropic   createBrowserDirectTransport — dev-only fallback: raw Anthropic + the hand-rolled
                          loop of §6.4. Lives behind a subpath so @anthropic-ai/sdk never enters the core bundle.
```

The transport is now a **consumer of `AgentStreamEvent`** (not raw Anthropic):

```ts
export interface ClaudeTransport {
    /** Open a turn; receive protocol events; return an aborter. */
    openTurn(req: AgentTurnRequest, onEvent: (e: AgentStreamEvent) => void): { abort(): void };
}
```

`createProxyTransport({ url })` POSTs `AgentTurnRequest` and parses the SSE
stream into `AgentStreamEvent`s. (The browser-direct fallback implements the same
interface by hand-rolling §6.4 against the raw API — dev-only.)

### 8.4 The streaming engine — silky at any token rate

Decouple the wire from the paint. `AgentStreamEvent` deltas accumulate into a
**ref**; a `requestAnimationFrame` coalescer flushes to state at most once per
frame, so paint cost is independent of token rate:

```ts
const draftRef = useRef<Draft>(emptyDraft());            // { text, thinking, toolUses, components }
const [draft, setDraft] = useState<Draft>(draftRef.current);
const rafRef = useRef<number | null>(null);
const scheduleFlush = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => { rafRef.current = null; setDraft({ ...draftRef.current }); });
}, []);
// onEvent({type:"text_delta", text}): draftRef.current.text += text; scheduleFlush();
```

Only `StreamingRow` consumes `draft`; committed `MessageRow`s are `memo`'d on
`equalFor(ChatMessageType)` and do **not** repaint mid-stream. A blinking block caret
(`prefers-reduced-motion` aware) trails the streamed text. Incomplete markdown is
tolerated (an unterminated ``` fence renders as a provisional code block).
"Smooth steady reveal" (a small reveal buffer, à la `smoothStream`) sits on top
of the coalescer for polish.

### 8.5 `useTurnStream` — open / consume / persist (StrictMode-safe)

```ts
type Phase = "idle" | "streaming" | "error";
function useTurnStream(args: {
    conversation: UseBindingConversation;
    transport: ClaudeTransport;
    tools: ResolvedTool[];     // for client-side validation/staging of write tool_use previews
}): { phase: Phase; draft: Draft; error: Error | null; send(text: string): void; stop(): void; retry(): void };
```

- `send(text)`: build a `user` `ChatMessageType` with a **stable id**; persist via
  `conversation.write` (the binding is `direct`; this *is* the durable write —
  "commit" is reserved for staged tool Apply, §4); then `transport.openTurn(...)`.
- On events: `text_delta`/`thinking_delta` → coalesced draft (§8.4); `tool_use`
  (status `staged`) → stage the previewed typed write through the matching
  binding so the Commit.Bar lights; `component` → decode beast2 → push a
  `ChatContentBlockType.component`; `message_done` → assemble the final assistant
  `ChatMessageType` and persist it; `error` → §7.5 handling.
- **Idempotent**: messages keyed by pre-generated id (no dup under StrictMode /
  retry). **Abortable**: `stop()`/unmount aborts the SSE; partial kept +
  `interrupted: true`. East callbacks (`onTurn`, `onToolApplied`) via
  `queueMicrotask`.

### 8.6 Composer — native-editor feel

Local `useState` + `useEffect([prop])` sync (interactive-state pattern; never
writes the dataset until send). Auto-grow to ~8 rows then internal scroll
(mirror-element measure). `Enter` (no Shift, `!e.nativeEvent.isComposing`) →
send; `Shift+Enter` → newline; IME composition respected. While streaming, Send
→ **Stop** (`faStop`), send disabled (no queueing v1). Mono hint `⏎ send · ⇧⏎
newline` via `Kbd`; refocus after send.

### 8.7 Scroll — follow, never fight

Track **pinned-to-bottom** via a bottom sentinel + `IntersectionObserver` (no
scroll-event spam); while pinned, each rAF flush scrolls to bottom; on scroll-up,
unpin + show a `↓ New` pill (bsys chip) that re-pins. Smooth vs instant honours
`prefers-reduced-motion`. Scroll position is **not** persisted.

### 8.8 Performance

Virtualize the committed list with `@tanstack/react-virtual` past ~40 messages
(dynamic measure); `StreamingRow` renders **outside** the virtualizer (always
pinned) so it isn't re-measured each frame. Module-scope `equalFor` + pure
converters; `useMemo` for derived props; `useCallback` + `queueMicrotask` for
handlers. `MessageRow` is the memo boundary that keeps streaming O(1) in
committed-message count.

### 8.9 Accessibility

Thread `role="log"` `aria-live="polite"` `aria-atomic="false"`; `aria-busy`
during streaming; announcements throttled to **message-complete**, not per token.
Composer textarea labelled; Send/Stop labelled icon-buttons; full keyboard
operability with Chakra `focus-visible` rings. Status dot is `aria-hidden` (the
word carries meaning). All motion behind `prefers-reduced-motion`.

### 8.10 Tool-use card & generative UI

`ToolUseCard` (Inset): mono tool name + `StatusDot` (`proposed` warn · `staged`
brand · `applied` pos · `failed` neg); body is a **typed preview** — for staged
writes, the `Diff` walker/formatter shows `source → proposed` as a mini diff; for
fresh values, `EastValueViewer`. `staged+pending` → brand-tint + inline
Apply/Discard (or deferred to the Commit.Bar); `failed` → inline `banner.error`
with the diagnostic. `ComponentBlock` decodes a `component` event's beast2
`UIComponentType` and dispatches it through `EastChakraComponent` (interactive
sub-components render via the normal path).

### 8.11 Reuse vs build

**Reuse:** `Markdown` (GFM, themed) + `CodeBlock`; `Diff` walker/format +
`EastValueViewer`; `EastChakraComponent`; `Data.bind` + `StagedStore` +
`ReactiveDatasetCache` + `getBindingTypes`; `frame`/`eyebrowRow`/`commitBar`/
`status`/`banner.*`; `Collapsible`/`Kbd`/`EmptyState`; TanStack Virtual;
`use-local-storage-state`. **Build:** the streaming engine (§8.4),
`useTurnStream` (§8.5), Composer (§8.6), scroll-pinning (§8.7), `useToolBinding`,
the proxy transport, the tool-use/component cards. **New deps:** `rehype-sanitize`,
`shiki`, `remark-math` + `rehype-katex`; `@anthropic-ai/sdk` only on the
`./anthropic` dev subpath.

### 8.12 Definition of done (renderer)

Silky streaming at high token rate; thread fast at 1k+ messages (virtualized);
composer matches native key/IME behaviour; abort/retry leave no orphan state
(StrictMode-clean); a11y audited (roles, throttled live region, keyboard,
reduced-motion); staged tool writes preview/diff/stage/commit through the binding;
generative-UI `component` events render; every state (empty / streaming /
thinking / tool-staged / tool-failed / component / error / dirty-commit-bar /
readonly) snapshotted and Read against bsys.

---

## 9. File-by-file plan

**`@elaraai/e3-ui` (contract — browser-safe; no React, no SDK):**
- `src/chat.ts` — all §3.1–§3.3 East types + `ClaudeChatComponent` +
  `ClaudeChat` factory + `Types`. Re-export `DiffBindingType`. Full TypeDoc.
- `src/tool-schema.ts` — `eastTypeToToolSchema` (§3.4) + `JsonSchema` /
  `ToolSchemaOptions`.
- `src/protocol.ts` — `AgentTurnRequest`, `AgentStreamEvent`, `Usage`, the
  literal unions (§3.5).
- `src/index.ts` — export the above.
- `test/chat.spec.ts` (IR/factory compliance), `test/tool-schema.spec.ts`
  (mapping for every East type incl. nested/recursive + property test:
  `fromJSONFor(toJSONFor(v))` round-trips and the schema validates `toJSONFor(v)`).

**`@elaraai/e3-ui-components` (renderer):** create `src/chat/` per §8.3
(`index.tsx`, `ChatHeader`, `Thread`, `MessageRow`, `StreamingRow`,
`ToolUseCard`, `Composer`, `bind-runtime.ts`, `useTurnStream.ts`,
`transport.ts`, `format.ts`).
- `src/index.ts` — `import './chat/index.js'`; export `EastChakraClaudeChat`,
  `ClaudeChatProvider`, `createProxyTransport`, the transport type.
- `package.json` — add `"./anthropic"` export (dev-only browser-direct adapter;
  `@anthropic-ai/sdk` optional, only on that subpath); add `rehype-sanitize`,
  `shiki`, `remark-math`, `rehype-katex`. Reuse `Markdown` from
  `@elaraai/east-ui-components`.

**`libs/east-agent` (NEW top-level lib — headless service):**
- `src/contracts.ts` — §6.1 interfaces.
- `src/runtime/sdk-runtime.ts` — reference `AgentRuntime` (§6.2).
- `src/tools.ts` — the in-process e3 MCP tool server over `AgentE3Gateway` /
  `AgentIRBuilder` (`read_*` / `patch_*` / `run_east` / `create_task` /
  `list_datasets`), each `AgentToolPolicy`-gated; the `PreToolUse` staged gate.
- `src/ir-builder.ts` — `AgentIRBuilder` reference impl (isolate: lint + eval +
  `analyzeIR`; no execution — never compiles-to-runnable, never runs).
- `src/e3-gateway.ts` — `AgentE3Gateway` reference impl over `e3-api-client`.
- `src/server.ts` — SSE endpoint implementing the protocol (§6.3).
- `src/index.ts`, `package.json` (deps: `@elaraai/e3-ui`,
  `@elaraai/e3-api-client`, `@elaraai/east`, `@elaraai/eslint-plugin-east`,
  `@anthropic-ai/claude-agent-sdk`; loads `east-claude-plugin`), `Makefile`
  (mirrors the standard `build`/`test`/`lint` targets), `STANDARDS.md`,
  `CLAUDE.md`.
- `test/` — contract conformance + a fake `AgentE3Gateway`/`AgentRuntime` for the
  tool-mapping + gate tests.

**`@elaraai/e3-ui-showcase`:** `src/chat.ts` — a scene (transcript + a staged
write tool + a read-only context) bundled like `diff.ts`, with a `make` target;
served against a local `east-agent` (or a stub transport for snapshots).

**`libs/e3` (dependency — separate team):** implement the generic one-shot
ad-hoc execution capability per **`libs/e3/design/e3-adhoc-execution.md`**. Not
on this lib's critical path until Phase 4 (fallback exists).

## 10. Phased execution

Each phase ends with **rebuild + re-snapshot + Read the PNG** (per
`[Always visually verify]`), via `make` targets only (per `[Use Makefile targets]`).

- **Phase 0 — contract.** `e3-ui`: `chat.ts`, `tool-schema.ts`, `protocol.ts`,
  `index.ts` + the two specs. No renderer/service. `cd libs/east-ui && make build test`.
- **Phase 1 — renderer read-side.** Frame + eyebrow + thread (Markdown +
  `rehype-sanitize` + `shiki` + `rehype-katex`) + ThinkingBlock + EmptyState +
  density, bound to `ConversationType`; Composer appends + persists; a **stub
  transport** so scenes snapshot without a service. Showcase scene + snapshot.
- **Phase 2 — agent service + streaming.** `east-agent` reference impl
  (`contracts`, `sdk-runtime` + plugin load, `e3-gateway` over `e3-api-client`,
  `compiler` isolate, `server` SSE); renderer `createProxyTransport` +
  `useTurnStream` + the rAF streaming engine + Stop/abort + status dot+word +
  usage + §7.5 errors. Real conversation, no tools yet (or read-only context).
- **Phase 3 — typed writes (patch).** The single `patch_<name>` tool (forward
  `PatchType(T)` shape → validate → apply → `diffFor` → stage per binding
  `mode`); `ToolUseCard` renders the resulting patch via the `Diff` walker;
  Commit.Bar over staged tool bindings (compose `Diff.Root`); the `PreToolUse`
  gate. Scenes: staged-review (e.g. delete one row of a large table) +
  direct-write.
- **Phase 4 — ad hoc functions + generative UI.** `run_east` + `create_task`:
  `AgentIRBuilder` authoring → e3 execution. Ships against **Tier-B
  deploy-to-scratch-workspace** first; switches to **Tier-A one-shot** the moment
  the e3 capability (§5.7) lands — no renderer change. `outKind:"ui"` →
  `component` events → `EastChakraComponent`. The `east-author` subagent +
  example-injection grounding.
- **Phase 5 — conversation polish.** Copy / regenerate / edit-and-resend /
  continue-on-`max_tokens` / 👍👎; keyboard shortcuts; then branching, citations,
  attachments/multimodal, resumable streams, transcript windowing.

The **e3 one-shot capability** (§5.7) runs as a **parallel track** by the e3
team; Phase 4 degrades gracefully to Tier-B until it lands.

## 11. Prior art, leverage, and the quality bar

### 11.1 Reference implementations

| Project | Role here |
|---|---|
| **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) | **the chosen engine** for `east-agent` — loads `east-claude-plugin` (skills/search/hooks/subagents), owns the loop/sessions/retries |
| **`east-claude-plugin`** (in-repo) | the East-quality keystone: skills, `east` index, preemptive example-injection hook, `eslint-plugin-east` pre-write hook |
| **`assistant-ui`** (`@assistant-ui/react`, MIT) | the **renderer UX blueprint** — Thread/Message/Composer decomposition, auto-scroll-with-unpin, edit/regenerate/branch |
| **`@anthropic-ai/sdk`** (MIT) | the dev-only browser-direct `./anthropic` adapter |
| **Vercel AI SDK** (`ai`, Apache-2.0) | alternative engine if not using the Agent SDK; `smoothStream` + resumable-stream patterns worth copying |
| **Anthropic Quickstarts** (`financial-data-analyst`, MIT) | reference for tool-call → chart "artifacts" (our generative UI, §5.4) |

### 11.2 Leverage map

- **In-repo (reuse):** `Markdown`/`CodeBlock`; `Diff` walker/format +
  `EastValueViewer`; `EastChakraComponent`; `Data.bind` + `StagedStore` +
  `ReactiveDatasetCache` + `getBindingTypes`; `frame`/`eyebrowRow`/`commitBar`/
  `status`/`banner.*`; `Collapsible`/`Kbd`/`EmptyState`; TanStack Virtual;
  `e3-api-client`; the East compiler + `analyzeIR`; `eslint-plugin-east`;
  `east-claude-plugin` (skills/search/hooks); East `toJSONFor`/`fromJSONFor`/
  `diff`/`applyPatch`/`encodeBeast2For`.
- **New deps:** `@anthropic-ai/claude-agent-sdk` (service); `rehype-sanitize`,
  `shiki`, `remark-math`+`rehype-katex` (renderer markdown); `@anthropic-ai/sdk`
  (dev subpath only).

### 11.3 Quality bar — checklist (maps to phases)

Streaming: rAF-coalesced + steady reveal (P2) · incomplete-markdown tolerance
(P1) · `shiki` (P1) · KaTeX (P1) · sanitised HTML (P1). UX: copy/regenerate/
edit-resend/continue/👍👎 + shortcuts (P5) · branching/citations/attachments/
resumable (P5). Agent correctness (SDK-owned, P2/P4): `input_json_delta`,
thinking-signature replay, tool pairing, tool-loop cap, prompt caching, usage.
Robustness: error taxonomy + backoff (P2) · abort hygiene (P2). Performance:
virtualized thread · memoized rows · isolated streaming row (P1). A11y:
`role="log"` + throttled live region + keyboard + reduced-motion (P1). Security:
no-secret protocol + keyless cloud + staged/promotion gates + sanitisation (P2/P3).
Trust/visual: strict bsys + typed, diffable tool writes (every phase). East
codegen quality: plugin example-injection + eslint + types + subagent (P4).

A feature ships "gold-plated" only when its checklist row is done **and** its
rendered state is snapshotted and Read against bsys.

## 12. Risks & open decisions

- **e3 one-shot capability is a dependency (§5.7).** Mitigation: Phase 4 ships on
  the Tier-B deploy-to-scratch fallback; Tier-A is a drop-in when e3 lands it.
- **Model East-codegen quality.** Mitigated by the plugin's preemptive example
  injection + `eslint-plugin-east` + real type errors + the `east-author`
  subagent + a bounded revise loop. Still expect iteration; surfaces as
  `tool_result` errors, not user-visible failures.
- **East-JSON conventions** in tool schemas (int-as-string, `{type,value}`
  variants) — v1 mirrors them exactly for `fromJSONFor` fidelity; a
  "model-friendly" schema + normaliser is a clean later option.
- **Transcript growth.** The transcript is the durable source of truth and stays
  diffable (only completed turns written); windowing/summarisation is Phase 5,
  helped by Agent-SDK sessions for working context.
- **Tool-result truth.** A staged (not applied) write reports "staged, pending
  review" so the model never assumes the dataset changed.
- **Writes are patches (one `patch_*` tool, §5.2).** A write is a forward
  `PatchType(T)` edit; the service makes it invertible (`diffFor` against current)
  and stages it. No separate whole-value tool — `replace` is just a patch op, and
  whole-value rewrites of a large `Dict(K,Struct)` (e.g. to delete one row) would
  blow the output-token budget. Forward-only input means the model never
  transcribes `before`/removed values. A path-addressed edit-ops sugar can layer
  on top later.
- **Prompt injection / egress.** Dataset content is framed as data; the
  staged/promotion gate is the hard backstop; prefer on-demand `read_*` over bulk
  `context[]`; per-binding redaction hook (§7.4).
- **Transcript schema migration.** `metadata.schemaVersion` lets the renderer
  migrate older transcripts as the content model grows.
- **Resolved (not open):** key custody (no-secret protocol + server-only
  `AgentSecretProvider` + keyless cloud, §7); package boundaries + the
  abstraction split for `east-aws` (§2); execution ownership (e3, never the
  agent, §5).

---

> **Document complete.** Companion change request for the e3 team:
> [`libs/e3/design/e3-adhoc-execution.md`](../../../../e3/design/e3-adhoc-execution.md).
