# Design: e3-ui function bindings — calling `e3.function` from a UI

> Status: **draft for review** · 2026-06-12 · updated for the sync-only
> function surface (PR #27: async call endpoints removed; the sync path's
> server-owned deadline is the contract).
> Audience: e3-ui maintainers + an implementing agent. Companion to
> `e3-functions.md` (the `e3.function` execution primitive this binds to) and
> `e3-ui.md` (the `e3.ui()` / `Data.bind` surface this extends). Implementation
> lands in `libs/east-ui` (`e3-ui` + `e3-ui-components`); no e3 server or
> api-client changes are required — the feature is a pure client of the
> existing workspace function-call API.

## 1. Summary

`Data.bind` gives a UI task a reactive handle on a **dataset**. This design
adds the same move for a **named package function**: `Func.bind` returns a
handle struct with one entry point and the familiar binding observation
surface —

- `call(args…)` **launches** the function fire-and-forget from any sync UI
  callback (onClick) and returns immediately;
- `read()` returns `Option(Output)` — the last successful result;
- `status()` / `pending()` / `error()` track the call lifecycle reactively,
  driving spinners and error surfaces through `Reactive.Root` exactly like
  `Data.bind`'s `status` / `pending`.

Like `Data.bind`, the binding is declared with statically-known identity (the
function name), is derivable into the UI task's manifest by a static IR walk,
and is implemented browser-side as an `optional: true` platform function. The
runtime drives `@elaraai/e3-api-client`'s **synchronous** workspace call
(`workspaceFunctionCall`) — the only call surface; the tracked lifecycle is
client-side state around the in-flight HTTP request, not server-side call
state (which no longer exists).

```
UI (East IR)                       browser runtime                       e3 server
Func.bind([[I…], O], "forecast")   function_bind platform impl
  .call(12n, 1.05)      ────────►  encode args → POST (fire-&-forget) ─►  POST …/workspaces/<ws>/functions/forecast
  .read()/.status()     ◄────────  in-flight registry (reactive)          (sync; server-owned deadline)
```

**Scope framing** (inherited from the sync-only decision): an `e3.function`
is a *bounded* RPC — the server enforces a wall-clock deadline on the sync
path (`SERVER_SYNC_DEADLINE_MS = 120s` locally,
`e3-api-server/src/handlers/functions.ts:50`) and an `ExecuteResult` size
limit. Long compute is what dataflow tasks are for (`Data.bind`'s
`writeAndStart`); this binding intentionally does not try to be a job queue.

## 2. Motivation

`e3.function` (see `e3-functions.md`) gives packages named, typed RPC
endpoints — but today they are reachable only from the CLI (`e3 call`) and raw
HTTP. A UI task that wants a "Run forecast" button has no sanctioned way to
invoke one: `Data.bind` only moves dataset values, and `writeAndStart` only
kicks the dataflow. Authors end up encoding "commands" as input datasets — a
worse RPC with dataflow side effects.

The function-call API was designed for exactly this client: bounded inline
results, workspace scoping so the UI calls whatever package version is
deployed where it runs, and a server-owned deadline that keeps a misbehaving
call from wedging the page.

## 3. Goals / non-goals

Goals:

1. Invoke a workspace-scoped named function from East UI code, with arguments
   as ordinary typed East values — no manual beast2 encoding.
2. Reactive call lifecycle: `idle → running → succeeded | failed | cancelled`,
   driving spinners/disabled states through `Reactive.Root` like every other
   e3-ui binding.
3. The result is read back through the binding (`read()` →
   `Option(Output)`), structurally typed so components reject handles bound
   to the wrong signature at compile time.
4. Static derivability: a UI task's bound functions appear in its manifest the
   same way its bound dataset paths do.
5. Early type safety: a bound signature that disagrees with the deployed
   package surfaces as a typed error before (or at) first call.

Non-goals (v1):

- **A raw awaitable callable on the handle** (`fn: AsyncFunctionType`):
  today's UI callback slots are sync (`FunctionType([], NullType)`, e.g.
  `Button.onClick`, `east-ui/src/component.ts:294`), so an async callable has
  no surface to be awaited from; `call` + reactive `read` covers the UI
  shape. Revisit alongside async UI callbacks (§10).
- **One-shot execution** from the UI (`oneShotExecute`): role-gated remote
  code execution; deliberately excluded until there's a concrete need.
- **Runner overrides / limits** per call from the UI: the deployed function's
  runner is authoritative. (`FunctionCallRequest.runner/limits` stay `none`.)
- **Package-scoped calls** (`functionCall(pkg, version, …)`): UI tasks always
  run against a workspace; workspace scope is the only addressing mode.
- **Call history / queueing / job semantics**: one tracked in-flight call per
  binding key, latest-wins. Anything longer-lived than the server deadline
  belongs in the dataflow, and a durable decision/action journal already has
  a home in the Decision components.

## 4. User-facing API (`@elaraai/e3-ui`)

### 4.1 `Func.bind`

```ts
// libs/east-ui/packages/e3-ui/src/func.ts
export const Func = {
  /**
   * Bind a named workspace function to a reactive call handle.
   *
   * @typeParam Inputs - Positional parameter East types.
   * @typeParam Output - Return East type.
   * @param types - `[[...Inputs], Output]`, mirroring `East.function`'s shape.
   * @param name - The function's name in the deployed package. Must be a
   *   statically-known string (manifest derivation walks the IR for it).
   */
  bind<Inputs extends EastType[], Output extends EastType>(
    types: [[...Inputs], Output],
    name: string,
  ): BoundFunc<Inputs, Output>;
} as const;
```

Mirrors `Data.bind`'s conventions: type args first, statically-known identity
second, returns a handle struct. No options bag in v1 (see §3 non-goals; a
future `{ channel }` option is sketched in §10).

### 4.2 The handle struct

```ts
// All fields exist regardless of state; all closures are sync.
export const FuncBindHandleType = <I extends EastType[], O extends EastType>(
  inputs: [...I], output: O,
) => StructType({
  /** The one entry point: encode args, issue the call fire-and-forget,
   *  return null immediately — callable from any sync UI callback
   *  (onClick). Latest-wins: calling while a tracked call is in flight
   *  abandons the previous one (see §7.2). Observe the outcome through
   *  `read` / `status` / `error`. */
  call:    FunctionType(inputs, NullType),

  /** Last successful result. `none` until the first `succeeded` call;
   *  survives until the next launch overwrites it. */
  read:    FunctionType([], OptionType(output)),

  /** Lifecycle of the most recent `call`. */
  status:  FunctionType([], FuncStatusType),

  /** Last failure, with the server's outcome detail. `none` unless
   *  status is `failed`. */
  error:   FunctionType([], OptionType(FuncErrorType)),

  /** True while a call is in flight. (== status is `running`.) */
  pending: FunctionType([], BooleanType),

  /** Stop waiting for the in-flight call (no-op when idle or terminal).
   *  Client-side only: there is no server-side cancel — the server runs
   *  the call to completion or its deadline regardless; the late response
   *  is discarded (§7.2). */
  cancel:  FunctionType([], NullType),

  /** Descriptor — the bound name, for inspector surfaces. */
  binding: FuncBindingType,
});

export type BoundFunc<I extends EastType[], O extends EastType> =
  ExprType<ReturnType<typeof FuncBindHandleType<I, O>>>;
```

The field set is deliberately the function-shaped subset of
`DataBindHandleType`'s vocabulary — `read` / `status` / `pending` mean the
same kind of thing they mean on a dataset binding, plus the call-specific
`call` / `error` / `cancel`. As with `DataBindHandleType`, the value types
live **structurally** in the field signatures (`call`, `read`), so a
component requiring `BoundFunc<[IntegerType], FloatType>` rejects a handle
bound to any other signature at compile time, and the information survives
`$.let` plumbing.

### 4.3 Status and error types

```ts
/** Tracked-call lifecycle. Client-defined (there is no server-side call
 *  state on the sync-only surface): `idle` = never launched, `cancelled` =
 *  the client stopped waiting via `cancel()` or supersession. */
export const FuncStatusType = VariantType({
  idle:      NullType,
  running:   NullType,
  succeeded: NullType,
  failed:    NullType,
  cancelled: NullType,
});

/** Failure detail, mirroring ExecuteResult's outcome arms (e3-types
 *  api.ts) plus client-side transport errors. stdout/stderr ride along
 *  exactly as the server returns them (already truncated server-side). */
export const FuncErrorType = StructType({
  kind: VariantType({
    failed:    StructType({ exitCode: IntegerType }),
    invalid:   StructType({ diagnostics: ArrayType(StringType) }),  // rendered DiagnosticType
    too_large: StructType({ bytes: IntegerType, limit: IntegerType }),
    timed_out: StructType({ ms: IntegerType }),                     // server deadline hit
    transport: StructType({ message: StringType }),                 // HTTP/decode failures
  }),
  message: StringType,   // one-line human summary, always present
  stdout:  StringType,
  stderr:  StringType,
});

export const FuncBindingType = StructType({
  name: StringType,
});
```

Decision note — diagnostics arrive as `DiagnosticType` on the wire; v1
renders them to strings at the boundary rather than re-exporting the full
diagnostic struct into UI IR. Revisit if an inspector wants structured spans.

### 4.4 Usage

```ts
// Package side (already shipped, e3-functions.md):
const forecast = e3.function(
  'forecast',
  East.function([IntegerType, FloatType], FloatType, ($, periods, growth) => { /* … */ }),
);

// UI side:
const dashboard = e3.ui('dashboard', East.function([], UIComponentType, _$ =>
  Reactive.Root(East.function([], UIComponentType, $ => {
    const forecastFn = $.let(Func.bind([[IntegerType, FloatType], FloatType], "forecast"));

    const run = $.const(East.function([], NullType, $ => {
      $(forecastFn.call(12n, 1.05));
    }));

    return VStack.Root([
      Button.Root("Run forecast", { onClick: run, loading: forecastFn.pending() }),
      forecastFn.status().match({
        idle:      _ => Text.Root("Not run yet"),
        running:   _ => Text.Root("Running…"),
        succeeded: _ => Text.Root(East.str`Forecast: ${forecastFn.read().unwrap("some")}`),
        failed:    _ => Alert.Root("error", forecastFn.error().unwrap("some").message),
        cancelled: _ => Text.Root("Cancelled"),
      }),
    ]);
  }))));
```

The launch/observe split is the same shape `Data.bind` uses for `write`
(sync IR, async effects behind the platform, observed reactively): `call`
never blocks the UI thread or the East interpreter, and everything you'd
want back from the call arrives through `read` / `status` / `error` on the
next reactive render.

## 5. Addressing, manifest, and validation

### 5.1 Workspace scoping

UI tasks run against a workspace; the runtime resolves calls against the
deployed package via the workspace endpoints
(`/repos/<repo>/workspaces/<ws>/functions/<fn>`,
`e3-api-client/src/functions.ts` — `workspaceFunctionList` /
`workspaceFunctionDescribe` / `workspaceFunctionCall`). The workspace
identity comes from the same renderer context `Data.bind` uses (the dataset
cache's workspace).

### 5.2 Manifest derivation

`e3.ui()` derives its manifest by a static IR walk
(`e3-ui/src/derive.ts`). Extend the walk to also collect `function_bind`
platform calls — `arguments[0]` must be a literal `Value(string)` name,
mirroring the `TreePath` literal rule, anything else throws at export time.

`DataManifestType` (`e3-ui/src/manifest.ts:21`) gains a field:

```ts
export const DataManifestType = StructType({
  paths:     ArrayType(TreePathType),
  functions: ArrayType(StringType),
});
```

**Wire compatibility** — manifests are beast2 blobs in task `metadata`, and
adding a struct field is a breaking decode change. Follow the precedent set by
`decodePackageObject` in e3-functions.md (§ status note): `decodeManifest`
becomes **dual-decode** — try the new shape, fall back to the legacy
`{ paths }` shape with `functions: []`. `encodeManifest` always writes the new
shape. Consequence (same landing-order constraint as PR-1): viewers must
update before UIs exporting function manifests are deployed to shared repos —
old viewers cannot decode new manifests.

### 5.3 Signature validation

`Func.bind` declares `[Inputs, Output]`; the deployed package is the source
of truth. On first use of each bound name, the runtime fetches the workspace's
signatures (`workspaceFunctionList`, cached per workspace) and compares the
declared signature with `equalFor(EastTypeType)` — the same structural-type
agreement check `bind-runtime.ts` applies to duplicate dataset bindings. A
mismatch (or unknown name) parks the binding in `failed` with
`kind: invalid` and a message naming both signatures. Calls are never sent
with a mismatched signature — the server would reject them anyway, but the
client-side check produces a better message and works offline.

## 6. Platform function (`@elaraai/e3-ui`)

```ts
// e3-ui/src/func.ts — single generic over the fully-instantiated handle type.
export const funcBindPlatformFn = East.genericPlatform(
  "function_bind",
  ["H"],
  [StringType],          // function name
  "H",                   // the handle struct
  { optional: true },
);
```

The factory instantiates `H = FuncBindHandleType(inputs, output)` and applies
`funcBindPlatformFn([H], East.value(name, StringType))`. The runtime
implementation recovers the signature by **introspecting `H`** — `Inputs`
from the `call` field's `FunctionType` and `Output` from the `read` field's
`OptionType` — so there are no duplicate signature arguments to drift out of
sync. This is the one structural difference from `data_bind` (which is
generic over the bare `T` and rebuilds its fixed handle shape around it):
the handle's shape *is* the signature here, so the handle type is the honest
generic.

`optional: true` keeps the IR analyzable without an implementation (tests,
export) exactly like `data_bind` (`e3-ui/src/data.ts:146-163`) — and, as with
`Data.*`, **`Func.*` must be used inside `Reactive.Root`'s inner function**,
both for reactivity and to avoid async promotion of the outer UI function.

## 7. Runtime implementation (`@elaraai/e3-ui-components`)

New `src/platform/func-runtime.ts`, registered alongside `bind-runtime.ts` via
`registerPlatformImplementation` + `registerReactiveTracker`
(`east-ui-components/platform`).

### 7.0 Shared core: rebase the cache machinery on `@tanstack/query-core`

**Plan of record** (supersedes an earlier `ReactiveKeyStore`-extraction
sketch): both the existing dataset cache and the new function runtime sit on
`@tanstack/query-core` — the framework-agnostic engine under TanStack Query,
which is **already a dependency of this package** (the sibling status/repo
hooks use TanStack Query 5.x), so this adds no new supply chain.

The motivation is a review of the hand-rolled `ReactiveDatasetCache`
(`dataset-store.ts`), which found real races and lifecycle leaks — all of
them problems query-core already solves:

| # | Finding (hand-rolled cache) | query-core mechanism |
|---|---|---|
| 1 | A poll racing a `write()` can refetch and **resurrect the pre-write value** (optimistic write deletes `knownHashes`, in-flight/lagging status poll sees hash "changed", refetches old content over the optimistic bytes) | mutation lifecycle: `onMutate` snapshot → optimistic `setQueryData` → `onSettled` invalidate; invalidation discards in-flight stale fetches |
| 2 | Concurrent `write()`s to one key corrupt each other's **rollback snapshots** (B's `previous` is A's optimistic value) | per-mutation context snapshots + documented optimistic-update rollback pattern |
| 3 | **Double-unsubscribe disconnects unrelated subscribers** (stale captured `Set` deletes the key's *new* subscriber set) | `QueryCache`/`QueryObserver` subscription management |
| 4 | **Cache-key ambiguity** — `"${workspace}.${path.join('.')}"` collides across workspace/path splits and dot-containing fields | structured array query keys, no string joins |
| 5 | **Pollers only grow** — paths never removed, intervals never lengthen, polling never stops while the page lives | per-query `refetchInterval` + observer counts + `gcTime`: polling stops when the last observer goes |
| 6 | **No retry/backoff/abort** — failed polls re-hammer at full cadence; a hung fetch wedges the dedup map forever | built-in retries with exponential backoff, `AbortSignal` to fetchers, online/offline pause |
| 7 | `write()` ignores `destroyed` after its await; assorted smaller leaks | client teardown via `queryClient.clear()` / unmount semantics |

What stays custom (the genuinely e3-specific part):

- **Hash-based reconciliation** — one `workspaceStatus` poll *query* per
  workspace; its success handler diffs dataset hashes and **invalidates**
  the per-dataset content queries that moved (content fetches stay
  hash-gated, exactly today's two-tier design).
- **Sync read shim** — `queryClient.getQueryData` is synchronous, so the
  East platform closures (`read` / `has` / `status`) keep working unchanged.
- **`subscribe` / `getKeyVersion` adapter** — a thin layer over
  `QueryCache.subscribe` events maintaining the existing key-version
  contract, so `bind-runtime`, the reactive tracker, and
  `ReactiveDatasetCacheInterface` consumers see **no interface change**.
- **`DatasetApi` seam** — unchanged; query/mutation functions call through
  it, tests keep stubbing it.

`FuncRuntime` then reuses the same client: a tracked call is a query-core
**mutation** (its `idle/pending/success/error` machine maps 1:1 onto
`FuncStatusType`, with `cancelled` layered on via latest-wins supersession),
and the remaining shared pieces follow the existing conventions:

- **Reactive tracking.** The same `registerReactiveTracker` registration
  `BindRuntime` uses — func reads push their `func:…` keys into the tracking
  context so `Reactive.Root` re-renders pick up dataset and function keys
  uniformly.
- **API seam + config.** Workspace identity and client wiring come from the
  same `E3Config` / provider; like `DatasetApi`, a narrow `FunctionApi`
  interface (`list`, `call`) is what tests stub and the showcase harness
  (§8) swaps for an in-memory implementation.
- **Codec memoization.** Extract the structural-type-keyed `SortedMap`
  memoizer from `getBindingHelpers` (`bind-runtime.ts:106`) into a shared
  `memoizeByEastType` helper used by both runtimes.
- **Lifecycle conventions.** Process-global default instance + constructible
  for test isolation, exactly like `BindRuntime` / `getStagedStore`.

### 7.1 Call registry

A `FuncRuntime` class (process-global default instance, constructible for
tests — same pattern as `BindRuntime`) holds one entry per binding key:

```
key = `func:${workspace}:${name}`
entry = {
  status: 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled',
  launchSeq: number,      // monotonic; responses for superseded launches are dropped
  result?: unknown,       // decoded Output (succeeded)
  error?: FuncError,      // (failed)
}
```

There is no `callId` and no polling — the sync-only surface has no
server-side call state. A tracked call is simply an un-awaited
`workspaceFunctionCall` promise tagged with the `launchSeq` it was issued
under; whichever settles with the **current** seq writes the terminal state.

All handles bound to the same name in the same workspace **share the entry**
— one component launches, another renders the spinner — mirroring how
`Data.bind` handles share the dataset cache by path. (Independent channels:
§10.)

### 7.2 Closure semantics

| field | behaviour |
|---|---|
| `call(args…)` | Encode each arg with `encodeBeast2For(inputTypes[i])`; bump `launchSeq`; issue `workspaceFunctionCall({ args, runner: none, limits: none })` **without awaiting**; set `running`; return `null` immediately. On settle: if the response's seq is still current, map it to `succeeded` (decode `outcome.success.value` with `decodeBeast2For(outputType)` into `result`) or `failed` (per the §4.3 outcome mapping) and notify; otherwise discard (latest-wins — a relaunch or `cancel` superseded it). Launch/transport failures → `failed` with `kind: transport`. |
| `read()` / `status()` / `error()` / `pending()` | Read the registry entry (tracked via `registerReactiveTracker` on `key`, so `Reactive.Root` re-renders on transitions). `read` returns `some(result)` only after at least one `succeeded` call. |
| `cancel()` | Bump `launchSeq` (orphaning the in-flight promise) and set `cancelled`; notify. Client-side only — the server runs the call to completion or its deadline either way; the late response is discarded by the seq check. No-op when not `running`. |
| `binding` | Constant descriptor `{ name }`. |

Timeouts need no client logic: the server enforces its own sync deadline and
returns a terminal `ExecuteResult` with the `timed_out` outcome, which maps to
`failed` / `kind: timed_out` like any other outcome. (A client-side fetch
abort via `AbortController` would free the connection earlier, but
`RequestOptions` doesn't currently plumb a signal — noted as a possible
api-client enhancement in §10, not required for v1.)

### 7.3 Codecs

Per-signature codecs (`encodeBeast2For` per input, `decodeBeast2For` for the
output) are memoized by structural type key in a `SortedMap` keyed with
`compareFor(EastTypeType)` — the same memoization (and the same reason) as
`getBindingHelpers` in `bind-runtime.ts:106`.

## 8. Renderer surfaces

No new React components are required for v1 — the handle is consumed from
East IR. Two existing surfaces gain awareness:

- **Task preview / inspector** (`e3-ui-components`): show a UI task's bound
  functions from its manifest next to its bound paths.
- **Showcase harness** (`east-ui-showcase` / `e3-ui-showcase` seeding): the
  harness supplies an in-memory `FunctionApi` (§7.0) whose `call` resolves
  against locally-registered example implementations, so examples render
  deterministic `succeeded` states without a server — the same seam the
  dataset cache already uses for its snapshot seeding.

## 9. Testing

- **e3-ui (IR)**: `test/func.spec.ts` + `test/func.examples.ts` — handle
  shape, `$.let` plumbing, manifest derivation (literal-name rule, dedup,
  dual-decode fallback), TypeDoc↔examples parity per EXAMPLES_AUTHORING.
- **e3-ui-components (runtime)**: unit tests against a stubbed api-client —
  the full closure-semantics table in §7.2, latest-wins supersession,
  cancel-then-relaunch, late-response discard after cancel, outcome→error
  mapping (incl. `timed_out`), signature-mismatch parking. Async settles
  asserted by **polling test state, not sleeping** (per e3 testing
  conventions).
- **Integration (optional, e3-api-tests precedent)**: one happy-path test
  against a real `e3-api-server` workspace exercising call → decode.

## 10. Future extensions (explicitly out of v1)

- **`{ channel: string }` bind option** — independent tracked channels for
  the same function (key becomes `func:<ws>:<name>:<channel>`), for surfaces
  that fan out the same RPC with different arguments.
- **Raw awaitable callable** — an `fn: AsyncFunctionType(Inputs, Output)`
  field on the handle for direct request/response composition. Only earns
  its place once east-ui callbacks can be async (`onClick:
  AsyncFunctionType([], NullType)`) — an east-ui-wide change with its own
  design; until then it has no surface to be awaited from.
- **Abortable requests** — plumb an `AbortSignal` through api-client
  `RequestOptions` so `cancel()` frees the connection instead of only
  abandoning the wait.
- **One-shot binding** (`Func.oneShot`) — caller-supplied IR with
  dataset-bound args; needs the role-gating story first.
- **Call timeline** — surfacing launch/duration history; belongs with the
  Decision journal components.

## 11. Implementation plan

| # | Package | Work |
|---|---|---|
| 0 | `e3-ui-components` | **Rebase `ReactiveDatasetCache` on `@tanstack/query-core`** (§7.0): interface-preserving rewrite of `dataset-store.ts`; explicit `@tanstack/query-core` dependency; existing dataset/bind suites stay green; new regression tests for review findings #1–#7. |
| 1 | `e3-ui` | `src/func.ts` (types, platform fn, `Func` namespace), export from `index.ts`/`internal.ts`; `manifest.ts` field + dual-decode; `derive.ts` walks `function_bind`. |
| 2 | `e3-ui-components` | `src/platform/func-runtime.ts` (mutation-backed registry, closures, `FunctionApi` seam, `memoizeByEastType` extraction), registration in `src/index.ts`; in-memory `FunctionApi` for the showcase harness. |
| 3 | tests | per §9 — all runnable headless under `make test` (stubbed `FunctionApi`/`DatasetApi`, fake clocks; no server, no browser). |
| 4 | docs | `e3-ui` SKILL/USAGE updates (coordinate — plugin skill files). |

Definition of done: `cd libs/east-ui && make build && make lint && make test`
clean, plus examples visible in the showcase with a deterministic mocked
`succeeded` flow.
