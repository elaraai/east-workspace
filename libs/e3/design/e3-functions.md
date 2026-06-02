# Design: e3 functions — named package callables + graph-free execution

> Status: **proposed (review-ready)** · 2026-06-02
> Audience: e3 maintainers + an implementing agent. This is the **local/shared**
> spec (e3 monorepo). The AWS cloud implementation is specified in the companion
> doc `e3-cloud/design/e3-functions-cloud.md`, which depends on the published
> types defined here. Supersedes and absorbs `e3-one-shot-execution.md`.

## 0. Hand-off contract

This document is meant to be implementable end-to-end in **one PR in the e3
monorepo** by an agent with no prior context. Every new type, file, and function
is named with its exact path. The companion cloud doc is a **separate PR in the
`e3-cloud` repo** that consumes the `@elaraai/e3-types` / `@elaraai/e3-core` /
`@elaraai/e3-api-server` packages published from this one — see §12 (cross-repo
dependency + landing order).

**Definition of done.** The PR touches packages under `libs/e3` only. It is not
complete until **`cd libs/e3 && make build && make lint && make test`** all pass
clean — `make` (never raw `pnpm`/`tsc`/`eslint`) is the canonical entry point and
runs every e3 package in dependency order. This covers every package the PR
edits (`e3-types`, `e3`, `e3-core`, `e3-api-server`, `e3-api-client`, `e3-cli`):
new code compiles, lints with no new warnings, and the §13 tests pass. If any
touched package has its own lint/test gaps surfaced by the change, fix them in the
same PR.

## 1. Summary

Two related capabilities share one execution primitive.

- **`e3.function`** — a **named, typed function stored in a package**, invoked
  **by name** with argument **values** over the CLI and HTTP API. Unlike a task
  it is not wired to datasets, not part of the dataflow graph, and triggers no
  recomputation. e3's "stored procedure" / RPC method.
- **one-shot** — run an **anonymous** function whose **IR is supplied at call
  time**, optionally bound to existing workspace datasets, returning the result
  inline and persisting nothing. The interactive/throwaway sibling.

Both reduce to one operation — **`runDetached`**: *marshal inputs → run a body IR
on a chosen runner → return the result value inline; write nothing durable.* They
differ only in **where the IR comes from** and **where the inputs come from**:

| | inputs = **values** (request) | inputs = **datasets** (paths) |
|---|---|---|
| IR = **by name** (package) | **`e3.function`** (primary) | named fn over live data (ext.) |
| IR = **inline** (request) | ad-hoc lambda over literals (ext.) | **one-shot** |

The two named cells are this PR's deliverables; the off-diagonal cells fall out
of the shared `runDetached` core and are listed as extensions, not v1 scope.

### 1.1 Output model (decided)

The result is an **in-memory, bounded value returned inline** in the response. It
is **never promoted to a durable artifact**: no object-store root, no execution
record, no log entry, no dataset ref, no dataflow state. Precisely:

- The runner **always materialises its output** somewhere (it is a separate
  process writing a `.beast2` file). Locally that is a **scratch file** read back
  and returned inline, then deleted. In the cloud the executor writes an
  **unrooted S3 object** (the API reads it back inline; GC reclaims it). In
  neither case is the result rooted, recorded, or made a dataset.
- If the result exceeds the transport/response cap, the call **fails closed**
  with a diagnostic: *this result is a dataset — deploy a task and read it with
  `datasetGet`.* There is no spill-to-object and no presigned fallback for
  function results (that path is for datasets).
- The **async** path (long calls → launch/poll) must hold the finished result
  **transiently** until polled: an in-memory `Map` with a TTL locally; a
  short-TTL DynamoDB record in the cloud (the existing `ComputeResultStore`
  pattern). Never the durable object store.

Rejected alternative — *spill large results to a content-addressed object +
presigned download*: it duplicates what a deployed task + `datasetGet` already
provide, reintroduces GC-rooting/lifecycle concerns, and contradicts the
"function returns an in-memory value" contract. A result that doesn't fit inline
is a signal to use a task. (See §9 for the size budget.)

## 2. Contrast with tasks

| Aspect | `e3.task` (today) | `e3.function` (proposed) | one-shot |
|---|---|---|---|
| Body defined | author time | author time | **call time** (IR in request) |
| Stored in package | yes | **yes, by name** | no |
| Inputs | wired datasets (reactive) | **argument values** | dataset paths (or values) |
| Output | an output dataset | **returned inline to caller** | returned inline |
| In the dataflow graph | yes | **no** | no |
| Invoked | automatically by the dataflow | **by name, on demand** | by API, IR each call |
| Signature types | inferred from dataset structure | **stored on the function object** | from the supplied IR |
| Persistence | output object + exec record + logs | **none** | none |
| Needs a workspace | yes | **no — package-scoped (also ws)** | yes (if binding datasets) |
| Trust surface | author-published IR | author-published IR | **caller-supplied IR (RCE)** |

A function is **not** a macro (no compile-time expansion) and **not** a task with
zero inputs (a task is a reactive graph node with an output dataset). It is a
distinct primitive that *shares execution machinery* with tasks.

## 3. `e3.function` — authoring (SDK)

New SDK primitive in **`packages/e3/src/function.ts`**. The body is an ordinary
East function (sync or async); **its signature is the parameter list**, so there
is no separate type array to keep in sync — `e3.function` infers `inputTypes` /
`outputType` from the East function via `Expr.type(fn)` (the same mechanism
`task()` uses for its output type at `task.ts`).

```ts
// packages/e3/src/function.ts  (new)
export function function_<
  Name extends string,
  Inputs extends readonly EastType[],
  Output extends EastType,
>(
  name: Name,
  fn: FunctionExpr<Inputs, Output>
    | CallableFunctionExpr<Inputs, Output>
    | AsyncFunctionExpr<Inputs, Output>
    | CallableAsyncFunctionExpr<Inputs, Output>,
  config?: { runner?: Runner },
): FunctionDef<Inputs, Output>;
```

Usage:

```ts
const forecast = e3.function(
  "forecast",
  East.function([IntegerType, FloatType], ResultType, ($, periods, growthRate) => {
    // pure East body — no dataset reads; may be async (platform calls / IO)
    ...
  }),
  { runner: { runtime: "east-py", platforms: ["east-py-datascience"] } },
);

const pkg = e3.package("planning", "1.0.0", forecast /*, + inputs/tasks */);
```

`FunctionDef` (SDK-side, in **`packages/e3/src/types.ts`**, alongside `TaskDef`):

```ts
export interface FunctionDef<
  Inputs extends readonly EastType[] = readonly EastType[],
  Output extends EastType = EastType,
> {
  readonly kind: 'function';
  readonly name: string;
  // EastIR/AsyncEastIR constrain their first param to a MUTABLE any[]; a readonly
  // generic is rejected (TS2344). Type the field loosely and cast fn.toIR(),
  // exactly as task.ts does for its function_ir (task.ts:62, :70 `as any`).
  readonly body: EastIR<any, any> | AsyncEastIR<any, any>; // fn.toIR() as any
  readonly inputTypes: Inputs;   // Expr.type(fn).inputs (raw TS EastType[]) — converted to homoiconic values at export (§3.2)
  readonly outputType: Output;   // Expr.type(fn).output
  readonly runner: Runner;       // defaults to DEFAULT_RUNNER
  // NO deps, NO datasets, NO trees — not in the dataflow graph
}
```

Unlike a task, a function creates **no** `function_ir`/`output` dataset tree
nodes (it is not in the data tree) and **no** `commandIr` (see §3.1). Its body IR
is stored directly as a content object (§4); its signature lives on the function
object, not the structure.

### 3.1 No `commandIr` — build argv directly from the runner

A task stores a `commandIr` (an East IR that emits the launcher argv) because the
runner choice is baked into the task at author time and the function IR is passed
as `input[0]`. A function does not need this: it stores `runner` (the
`RunnerType` variant, §4) and the executor builds the argv **directly** at call
time via the shared `runnerToArgv` resolver (§5). This is simpler than tasks and
is what enables a **request-time runner override** and **cloud `custom`-gating**.

Keeping `FunctionDef` **out** of the `PackageItem` union (so the `export_` dep-walk
and its exhaustive `else`-throw stay intact) is correct, but it is **not free** —
it forces concrete changes at three call sites that an implementer must make
together, or the code does not compile and the export is lossy:

1. **`packages/e3/src/types.ts`** — add `readonly functions: Record<string, FunctionDef>`
   to `PackageDef`.
2. **`packages/e3/src/package.ts`** — `package_()`'s current signature is
   `...items: TItems extends (PackageItem | PackageDef<any>)[]`. **Widen** it to
   `(PackageItem | FunctionDef | PackageDef<any>)[]` (and keep `MergeDatasets` /
   `DatasetsOf` operating only over the non-`FunctionDef` subset — `FunctionDef`
   contributes no datasets). In the spread loop, **branch on `item.kind === 'function'`**:
   collect it into a `functions` record by name and `continue` (functions have no
   `deps`, so they are **not** passed to `collect()` and never enter `all_items`).
   Return `functions` on the `PackageDef`.
3. **`packages/e3/src/export.ts`** — the export writer must learn about functions
   (see §3.2). `export_` today iterates only `pkg.contents`; functions are not in
   `contents`, so without §3.2 nothing emits a `FunctionObject` and the §13.1
   round-trip test fails.

`e3.function` / `function_` are exported from **`packages/e3/src/index.ts`** as
`function` (the `e3.function` surface).

### 3.2 Export writer for functions (`packages/e3/src/export.ts`)

`export_` is the **sole** writer of objects + the `PackageObject`. Add a loop over
`pkg.functions` (after the existing `pkg.contents` pass), mirroring how tasks are
written:

```ts
const functions = new SortedMap<string, string>(compareFor(StringType)); // deterministic, like `tasks`
for (const [fname, fdef] of Object.entries(pkg.functions)) {
  const bodyIrHash = addObject(zipfile, Buffer.from(encodeEastIR(fdef.body)));   // same as a task's commandIr/function_ir
  const fnObject = {
    bodyIr:     bodyIrHash,
    inputTypes: fdef.inputTypes.map(toEastTypeValue),   // raw EastType -> homoiconic value, as export.ts:143 does
    outputType: toEastTypeValue(fdef.outputType),
    runner:     runnerToVariant(fdef.runner),           // Runner union -> RunnerType value (§5)
  };
  const fnHash = addObject(zipfile, Buffer.from(encodeBeast2For(FunctionObjectType)(fnObject)));
  functions.set(fname, fnHash);
}
// include `functions` in the emitted PackageObject (note field ORDER — §4):
const packageObject = { tasks, data: { structure, refs }, functions };
```

`toEastTypeValue` (used at `export.ts:143` for dataset types) is **required** — the
`FunctionObject` stores homoiconic type *values* (`EastTypeType`), not the raw TS
`EastType` definitions that `Expr.type(fn)` yields. `runnerToVariant` is the new
SDK helper from §5.

## 4. Package format change (e3-types)

One new object type and one new map on `PackageObjectType`, parallel to `tasks`.

```ts
// packages/e3-types/src/function.ts  (new)
export const FunctionObjectType = StructType({
  /** Hash of the encoded EastIR bundle (encodeEastIR), like a task's commandIr object. */
  bodyIr:     StringType,
  /** Positional parameter types — the IR's signature, surfaced for arity/type
   *  validation and `describe` without decoding the whole IR. */
  inputTypes: ArrayType(EastTypeType),
  /** Return type — used to decode the result `value` blob client-side. */
  outputType: EastTypeType,
  /** Author-chosen runtime; resolved to argv by runnerToArgv. Carries `custom`
   *  for author-trusted local use; gated at the cloud API (see cloud doc). */
  runner:     RunnerType,
});
export type FunctionObject = ValueTypeOf<typeof FunctionObjectType>;
```

```ts
// packages/e3-types/src/package.ts  — PackageObjectType gains `functions` AS THE LAST FIELD
export const PackageObjectType = StructType({
  tasks:     DictType(StringType, StringType),  // name -> TaskObject hash (existing)
  data:      PackageDataType,                    // existing
  functions: DictType(StringType, StringType),  // name -> FunctionObject hash (NEW — MUST be appended last; see §4.1)
});
```

⚠️ **Field order is load-bearing — append `functions` LAST, never insert it
between `tasks` and `data`.** BEAST2 encodes struct fields **positionally in
declaration order**, with no per-field tag/length/end-marker (`east` beast2 codec:
encode iterates fields in order; decode reads positionally). If `functions` were
placed in the middle (`{tasks, functions, data}`), decoding an **old** `{tasks,
data}` payload under the new type would read `tasks` correctly, then read the old
`data` struct's leading bytes **as** the `functions` Dict — which can
*succeed-with-garbage* (e.g. `data.structure`'s leading variant tag `0x00` reads as
the Dict's end-marker → empty `functions`, then `data` misaligns) instead of
throwing. The tolerant dual-decode in §4.1 depends on old bytes **failing
cleanly**; only an *appended* field guarantees that (the decoder runs past
end-of-buffer when it reaches `functions` → buffer-underflow throw → safe
fallback). Treat this as a hard rule: **append-only, never insert.**

`EastTypeType` is the same homoiconic type value the structure already stores at
`value.type`, so `inputTypes`/`outputType` introduce no new representation.
`inputTypes`/`outputType` duplicate what the IR encodes; storing them explicitly
lets `describe` (§7.2) and signature validation work from the small function
object without loading the IR bundle, and gives dynamic callers (CLI literal
parsing, non-TS clients) the types they need to encode arguments.

### 4.1 ⚠️ Backward-compatibility (breaking wire change) — REQUIRED handling

`PackageObjectType` is a BEAST2 `StructType`; adding `functions` changes the
on-disk encoding. **Already-exported package bundles and already-deployed
workspaces reference a `PackageObject` hash whose bytes lack the field** and will
fail to decode under the new type. The implementer MUST handle this; do **not**
silently break existing repos. Two options:

- **(Recommended) Tolerant dual-decode.** Add a helper
  `decodePackageObject(bytes): PackageObject` in `packages/e3-types` (or e3-core):
  attempt the new type; on decode failure decode against a retained
  `PackageObjectTypeV1` (`{tasks, data}`) and lift with `functions = new Map()`.
  New exports always write the new (append-last) shape; encode sites always use
  the new type. This is only sound because `functions` is appended last (§4
  rule).
- **(Alternative) Re-export migration.** Treat it as a hard format bump: require
  `e3 package export` + re-deploy for every package. Simpler code, breaks existing
  deployments until re-deployed — acceptable only if no long-lived deployments
  exist.

Pick one explicitly in the PR; recommended is dual-decode (zero disruption).

**This is NOT a single `packageRead` choke point — every decode site must route
through `decodePackageObject`.** `PackageObjectType` is decoded inline at ~10
independent sites in e3-core (most NOT via `packageRead`), **plus the API client
and server**, and version skew goes both ways (new CLI ↔ old repo, old CLI ↔ new
repo), so the client must dual-decode too. The PR checklist must cover all of:

- **e3-core** (~10): `packages.ts` (×2: `packageRead` + `packageExport`),
  `tasks.ts`, `workspaces.ts` (decode + the matching encode), `workspaceStatus.ts`,
  `dataflow.ts`, `trees.ts` (×2), `LocalOrchestrator.ts`, `dataflow/steps.ts` —
  including the two `await import('@elaraai/e3-types')` dynamic-import sites.
- **e3-api-server** `handlers/packages.ts` — `getPackage` re-encodes via
  `sendSuccess(PackageObjectType, pkg)` under the **new** type; an old-CLI client
  must tolerate the trailing field.
- **e3-api-client** `packages.ts` — decodes `PackageObjectType` itself (through the
  generic `get()` transport, so it can't reuse a server-side read helper; give the
  client its own tolerant decode).
- **e3-cli** `commands/run.ts` (and the new `call.ts`) via `packageRead`.

Verify with `grep -rn 'PackageObjectType' packages/` in **both** repos (e3 and —
separately — e3-cloud, see the cloud doc §6). New encode sites always write the
append-last shape.

### 4.2 ⚠️ GC reachability (REQUIRED) — function bodies must survive `gc`

"Persists nothing" (§1.1) applies to the *result* of a call. The function **body**
is durable: it is deployed, content-addressed, and must survive garbage
collection. The `PackageObject` is already a GC root, but the new `functions` map
and the `FunctionObject.bodyIr` objects it points at are **not** on the
reachability walk, so today's GC would silently delete every function body and
break all later calls. The implementer MUST extend the local GC mark
(**`packages/e3-core/src/storage/local/gc.ts`**, `extractChildren`):

- In the `PackageObject` branch (alongside `pkg.tasks.values()` and
  `pkg.data.refs`), also iterate **`pkg.functions.values()`**, pushing each
  `FunctionObject` hash as a non-leaf child.
- Add an `isFunctionObjectShape` guard and a `FunctionObject` branch that pushes
  **`value.bodyIr`** as a leaf child.

This single `extractChildren` fix also covers the cloud: the cloud's `gc-mark.ts`
imports and calls **this** `markReachable`/`extractChildren` from
`@elaraai/e3-core`, so it inherits function-body reachability with no separate
cloud change (cloud doc §6). Add a GC survival test (§13, item 13).

## 5. Shared types (e3-types) — runner + execution

```ts
// packages/e3-types/src/runner.ts  (new) — wire image of the SDK Runner union
export const RunnerType = VariantType({
  east_node: StructType({ platforms: ArrayType(StringType) }),
  east_py:   StructType({ platforms: ArrayType(StringType) }),
  east_c:    StructType({ platforms: ArrayType(StringType) }),
  custom:    StructType({ command: ArrayType(StringType) }),  // raw argv
});
export type RunnerValue = ValueTypeOf<typeof RunnerType>;

/** Resolve a RunnerType value to the argv prefix (the wire-value analogue of the
 *  SDK's runnerToCommand). Lives in e3-types so BOTH e3-core (local) and
 *  e3-cloud-core (cloud) import the one resolver. */
export function runnerToArgv(r: RunnerValue): string[] {
  switch (r.type) {
    case 'east_node': return ['east-node', 'run', ...flags(r.value.platforms)];
    case 'east_py':   return ['east-py',   'run', ...flags(r.value.platforms)];
    case 'east_c':    return ['east-c',    'run', ...flags(r.value.platforms)];
    case 'custom':    return [...r.value.command];
  }
}
// flags(ps) = ps.flatMap(p => ['-p', p])
```

The SDK `Runner` union (`packages/e3/src/runner.ts`) maps 1:1 to `RunnerType`;
add a small `runnerToVariant(r: Runner): RunnerValue` in the SDK so
`e3.function`/`export` can store the variant. It must **coalesce
`platforms ?? []`** (the SDK makes `platforms` optional, but `RunnerType` requires
it) and collapse `{custom: name}` platform entries to their string — exactly like
`runnerToCommand` (`runner.ts:79-84`). Variant tags use underscores (`east_node`)
mapped to the binary name (`east-node`) inside `runnerToArgv`.
`platforms` stays `Array<String>` — a platform is just a `-p <name>` flag on the
wire; the SDK's `Platform<Known> | {custom}` distinction is authoring sugar that
collapses to a string.

**Why a variant, not the resolved `Array<String>` prefix:** a resolved-argv field
lets any caller choose the executable and every flag — arbitrary command
execution by construction. The variant pins the executable to a known runtime for
the named tags and isolates the dangerous case behind the single `custom` tag,
which the cloud API rejects (the runner image is fixed; `custom` argv runs with
the container's IAM). It is also 1:1 with the SDK `Runner`, so resolution lives in
one place.

```ts
// packages/e3-types/src/api.ts  — execution request/result types (shared by
// the named-function path AND one-shot)

export const ExecuteLimitsType = StructType({
  timeoutMs:      OptionType(IntegerType),
  maxResultBytes: OptionType(IntegerType),   // inline result cap; over it ⇒ too_large
  maxLogBytes:    OptionType(IntegerType),    // per-stream tail cap
});

export const DiagnosticType = StructType({
  message:  StringType,
  filename: OptionType(StringType),
  line:     OptionType(IntegerType),
  column:   OptionType(IntegerType),
});

/** The terminal result of a function/one-shot call. */
export const ExecuteResultType = StructType({
  outcome: VariantType({
    success:   StructType({ value: BlobType }),            // beast2 result; decode with outputType
    failed:    StructType({ exitCode: IntegerType }),      // process exited non-zero (see stderr)
    invalid:   StructType({ diagnostics: ArrayType(DiagnosticType) }), // signature/IR error; nothing ran
    too_large: StructType({ bytes: IntegerType, limit: IntegerType }), // result over maxResultBytes
    timed_out: StructType({ ms: IntegerType }),            // exceeded timeoutMs / deadline guard
  }),
  stdout: StringType,
  stderr: StringType,
  stdoutTruncated: BooleanType,
  stderrTruncated: BooleanType,
}); // ValueTypeOf → ExecuteResult

/** Named function call. Positional args, one beast2-encoded value per param. */
export const FunctionCallRequestType = StructType({
  args:   ArrayType(BlobType),
  runner: OptionType(RunnerType),       // optional override; `custom` gated server-side
  limits: OptionType(ExecuteLimitsType),
});

/** A function signature, returned by `describe` so dynamic callers can encode args. */
export const FunctionSignatureType = StructType({
  name:       StringType,
  inputTypes: ArrayType(EastTypeType),
  outputType: EastTypeType,
  runner:     RunnerType,
});

/** Async launch → id; poll returns status + the result once terminal. */
export const CallStartResultType = StructType({ callId: StringType });
/** A function-specific status — do NOT reuse AsyncOperationStatusType, which has
 *  only running|succeeded|failed and CANNOT represent a cancelled call (and
 *  mutating it would reorder its sorted variant tags, a breaking change for the
 *  GC/repo-delete consumers that share it). */
export const CallStatusType = VariantType({
  running:   NullType,
  succeeded: NullType,
  failed:    NullType,
  cancelled: NullType,
});
export const CallStatusResultType = StructType({
  status: CallStatusType,
  result: OptionType(ExecuteResultType),    // present once terminal (succeeded/failed)
  error:  OptionType(StringType),
});
```

Register every new type in the **`ApiTypes`** const in BOTH
`packages/e3-api-server/src/types.ts` and `packages/e3-api-client/src/types.ts`
(they must stay mirrored), and export from `packages/e3-types/src/index.ts`.

## 6. Shared execution core (e3-core) — `runDetached`

`LocalTaskRunner.taskExecute` (`packages/e3-core/src/execution/LocalTaskRunner.ts`)
interleaves process mechanics with persistence. Extract the mechanics as
persistence-free helpers shared by the tracked path and `runDetached`:

- **`marshalInputsToDir(storage, repo, scratchDir, inputHashes): Promise<string[]>`**
  — the input-staging loop (`LocalTaskRunner.ts:210-217`). For `runDetached` the
  args are written to scratch directly from request bytes (no object-store round
  trip) — provide an overload `marshalBytesToDir(scratchDir, blobs): string[]`.
- **`spawnAndCapture(args, scratchDir, { timeoutMs, signal, onStdout, onStderr }): Promise<{ exitCode, error, stderrTail }>`**
  — the `runCommand` body (`LocalTaskRunner.ts:402-597`) **minus** the
  `storage.logs.append` writes and the `storage.refs.executionWrite('running')`
  write. Keeps: cross-spawn/nodeSpawn selection, `collectNodeModulesBins` PATH
  augmentation, `detached:true`, stdout/stderr listeners (callbacks + bounded
  tail), process-group kill, timeout + AbortSignal wiring.
- **`readOutputFile(outputPath): Promise<Uint8Array>`** — `fs.readFile`,
  extracted so the graph-free path returns bytes without `storage.objects.write`.
- **`buildRunnerArgv(runner: RunnerValue, argPaths: string[], outputPath: string, bodyIrPath: string): string[]`**
  = `[...runnerToArgv(runner), ...argPaths.flatMap(p => ['-i', p]), '-o', outputPath, bodyIrPath]`.
  This is the function analogue of a task's `commandIr` output — built directly,
  no IR evaluation. (Task mapping: `args` ⇄ the `-i` data inputs, `bodyIr` ⇄ the
  trailing IR positional that was `input-0`.)

`taskExecute` is refactored to compose `marshalInputsToDir` + `evaluateCommandIr`
+ `spawnAndCapture` + (its own `objects.write`/`executionWrite`/`logs.append`) —
**behaviour unchanged** (regression-test the dataflow path).

New persistence-free primitive (**`packages/e3-core/src/execution/runDetached.ts`**):

```ts
export interface DetachedSpec {
  bodyIr: Uint8Array;          // function: from FunctionObject; one-shot: from request
  args: Uint8Array[];          // positional arg values (beast2), already validated for arity
  runner: RunnerValue;
  limits: { timeoutMs: number; maxResultBytes: number; maxLogBytes: number };
}
export type DetachedResult =
  | { kind: 'success';   value: Uint8Array; stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean }
  | { kind: 'failed';    exitCode: number;  stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean }
  | { kind: 'too_large'; bytes: number; limit: number; stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean }
  | { kind: 'timed_out'; ms: number; stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean };

export async function runDetached(spec: DetachedSpec, options: { signal?: AbortSignal; runnerSearchDir?: string }): Promise<DetachedResult>;
// mkScratch → write bodyIr to fn.beast2 → marshalBytesToDir(args) → buildRunnerArgv
// → spawnAndCapture (bounded-tail stdout/stderr) → on exit 0: fs.stat(output) BEFORE read;
//    size > maxResultBytes ⇒ too_large (bytes never loaded); else success(readOutputFile)
// → finally rm scratch.  NEVER objects.write / executionWrite / logs.append.
```

Add **`runDetached`** to the `TaskRunner` interface
(`packages/e3-core/src/execution/interfaces.ts`) so every deployment implements it
the same way it implements `execute`; `LocalTaskRunner.runDetached` is the local
spawn (above). `MockTaskRunner` gains a stub. (The cloud does NOT implement
e3-core's `TaskRunner` — it has its own kernel; see the cloud doc. The interface
addition is for the local server + tests.)

**Arity/type validation** happens before `runDetached`: the caller (handler)
checks `args.length === inputTypes.length`; per-element type errors surface as a
runtime decode failure from the runner (`failed`). `runnerSearchDir` replaces the
task path's "walk up from repo dir" anchor — for the local server pass the
server's cwd / configured runner dir (one-shot has no repo path).

## 7. Invocation surfaces

`e3.function` touches no datasets, so it is callable at the **package** level
(imported in a repo, no workspace) and at the **workspace** level (deployed). Both
mount the same handlers. The workspace scope later enables dataset-bound arguments
(the off-diagonal cell).

### 7.1 e3-api-server — handlers, routes, state

New files:

- **`packages/e3-api-server/src/function-call-state.ts`** — in-memory async
  registry, modelled exactly on `async-operation-state.ts` (the GC pattern):
  `Map<callId, { status; startedAt; abort: AbortController; result?: ExecuteResult; error?: string }>`,
  with **TTL eviction** (e.g. 5 min) on a lazy sweep at each read/write — the GC
  Map's missing eviction is called out as a risk (§13); do not repeat it.
  `createFunctionCall()`, `completeFunctionCall(id, result)`, `failFunctionCall(id, err)`,
  `getFunctionCall(id)`, `cancelFunctionCall(id)`.
- **`packages/e3-api-server/src/handlers/functions.ts`** — handlers, each
  `async (storage, repoPath, …): Promise<Response>` using `sendSuccess`/`sendError`
  (`beast2.ts`):
  - `listPackageFunctions(storage, repoPath, pkg, version)` → `Array<FunctionSignatureType>`
    (decode `PackageObjectType`, read each `FunctionObject`, surface signatures).
  - `describePackageFunction(…, fn)` → `FunctionSignatureType`.
  - `callFunctionSync(storage, repoPath, runner, fnObj, args, limits)` → `ExecuteResultType`.
    Resolves the `FunctionObject`, validates arity, reads `bodyIr` bytes, builds a
    `DetachedSpec`, runs `runner.runDetached(...)` with a **deadline guard** =
    `min(limits.timeoutMs, serverSyncDeadlineMs)`, maps `DetachedResult` → outcome
    variant. (Local: synchronous; bounded result ⇒ safe to hold the connection.)
  - `callFunctionAsync(…)` → 202 `CallStartResultType` via the GC `void`-IIFE
    pattern: `createFunctionCall()`, fire the run detached, return `{callId}`.
  - `getCallStatus(callId)` → `CallStatusResultType`; `cancelCall(callId)` → abort.
  - `callOneShotSync` / `callOneShotAsync` — same, but `bodyIr` comes from the
    request (see §10) and (when binding datasets) inputs resolve from workspace
    paths. **Gate by role** (one-shot = RCE; §11).
  Export all from `handlers/index.ts` (and thus `index.ts`) "for Lambda reuse".
- **`packages/e3-api-server/src/routes/functions.ts`** — two factories
  `createPackageFunctionRoutes(storage, getRepoPath, runner)` and
  `createOneShotRoutes(storage, getRepoPath, runner)` (Hono children), wiring the
  handlers. The `runner: TaskRunner` is **injected** (local passes a
  `LocalTaskRunner`), mirroring the orchestrator runner-injection seam.

Mount in **`packages/e3-api-server/src/server.ts`** after the auth middleware
(`app.use('/api/repos/:repo/*', authMiddleware)`), before any catch-all:

```
# package-scoped (no workspace)
GET    /api/repos/:repo/packages/:pkg/:version/functions            → list
GET    /api/repos/:repo/packages/:pkg/:version/functions/:fn        → describe
POST   /api/repos/:repo/packages/:pkg/:version/functions/:fn        → callFunctionSync   (200 ExecuteResult)
POST   /api/repos/:repo/packages/:pkg/:version/functions/:fn/async  → callFunctionAsync  (202 {callId})
GET    /api/repos/:repo/packages/:pkg/:version/functions/:fn/calls/:callId  → getCallStatus
DELETE /api/repos/:repo/packages/:pkg/:version/functions/:fn/calls/:callId  → cancelCall

# workspace-scoped (package resolved from what's deployed in :ws)
GET    /api/repos/:repo/workspaces/:ws/functions
GET    /api/repos/:repo/workspaces/:ws/functions/:fn
POST   /api/repos/:repo/workspaces/:ws/functions/:fn            (+ /async, /calls/:callId)

# one-shot (workspace-scoped; anonymous IR) — gated by role
POST   /api/repos/:repo/workspaces/:ws/one-shot                 → callOneShotSync
POST   /api/repos/:repo/workspaces/:ws/one-shot/async           → callOneShotAsync
GET    /api/repos/:repo/workspaces/:ws/one-shot/calls/:callId   → getCallStatus
DELETE /api/repos/:repo/workspaces/:ws/one-shot/calls/:callId   → cancelCall
```

Request body = `FunctionCallRequestType` (decoded via `decodeBody`, wrapped in
try/catch → `sendError`). `custom` runner override: the local server MAY allow it
(single-tenant); document that the cloud forbids it. (Route params: the existing
package routes use `:name/:version`; the new function factory is a separate Hono
child, so its `:pkg` param is router-local — match `:name` if you prefer, but
there is no collision.)

### 7.2 e3-api-client — methods + Platform registry

New **`packages/e3-api-client/src/functions.ts`** (patterned on
`executions.ts`'s `dataflowExecute*`, beast2 over the wire via `post`/`get`):

```ts
functionList(url, repo, pkg, version, opts): Promise<FunctionSignature[]>;
functionDescribe(url, repo, pkg, version, fn, opts): Promise<FunctionSignature>;
functionCall(url, repo, pkg, version, fn, req: FunctionCallRequest, opts): Promise<ExecuteResult>;            // sync
functionCallLaunch(url, repo, pkg, version, fn, req, opts): Promise<{ callId: string }>;                      // async
functionCallPoll(url, repo, pkg, version, fn, callId, opts): Promise<CallStatusResult>;
functionCallCancel(url, repo, pkg, version, fn, callId, opts): Promise<void>;
// workspace-scoped overloads take `ws` instead of `(pkg, version)`
oneShotLaunch / oneShotPoll / oneShotCancel (workspace-scoped)
```

Add East async platform functions in **`packages/e3-api-client/src/platform.ts`**
(`East.asyncPlatform` + `.implement`, collected into `Platform` / `Platform.Types`)
so East programs — notably e3-ui tasks — can invoke a function or one-shot from a
"compute/preview" button exactly as they call `Platform.dataflowExecute`:
`platform_function_call` (run-to-completion) and `platform_one_shot_execute`.

### 7.3 e3-cli — `e3 call`

New **`packages/e3-cli/src/commands/call.ts`**, registered in
`packages/e3-cli/src/cli.ts` (commander), parallel to `commands/run.ts`:

```bash
e3 call <repo> <pkg.fn>            [args...] [-o out]   # package-scoped
e3 call <repo> <pkg@1.0.0.fn>      [args...] [-o out]
e3 call <repo> --workspace <ws> <pkg.fn> [args...]      # workspace-scoped
```

The command: parses the `pkg[.|@ver].fn` spec (reuse `run.ts`'s `parseTaskSpec`
shape), fetches the function's signature (local: read package directly; remote:
`functionDescribe`), parses each positional argument — a scalar literal or a
`.beast2`/`.json` file path — into its `inputTypes[i]` (reuse `commands/convert.ts`'s
literal/file→beast2 parsing), beast2-encodes each, calls `functionCall` (local via
a directly-constructed `LocalTaskRunner` + the handler, or remote via the client),
and renders `outcome.success.value` decoded with `outputType` (or writes to `-o`).
Non-`success` outcomes print the diagnostic/exit code/stderr and set a non-zero
exit code.

## 8. Execution semantics

- **Signature validation.** `args.length` is checked against `inputTypes` before
  anything runs; a mismatch ⇒ `invalid` with a diagnostic, nothing executes.
  Element-type errors surface as a runtime decode failure (`failed`) from the
  runner.
- **Result delivery — inline, bounded, fail-closed.** The output file is
  `stat`-ed before being read; `size > maxResultBytes` ⇒ `too_large` (bytes never
  loaded). No spill-to-object, no presigned fallback.
- **stdout / stderr.** Captured in memory via the runner callbacks (never
  persisted), returned inline as bounded tail buffers (`maxLogBytes`);
  `*Truncated` marks dropped bytes. stderr carries runtime errors on `failed`.
- **Deadline + cancel.** `timeoutMs` enforced by process-group kill;
  `maxResultBytes`/`maxLogBytes` bound response memory. The **sync** path also
  enforces a server-owned wall-clock deadline (cloud: < API GW 29 s; see cloud
  doc) and returns `timed_out` *before* the transport cuts the connection, so the
  caller gets a structured "use the async form / a task" instead of a raw 504.
  one-shot exposes launch/poll/cancel.
- **Persistence — none.** No task object, no output object, no execution record,
  no logs, no dataset ref. The repo is byte-for-byte unchanged. The only disk
  write is the runner's transient scratch file, deleted on completion (local) /
  the unrooted S3 object reclaimed by GC (cloud).
- **No workspace lock.** Function/one-shot calls are not dataflow runs and do not
  mutate workspace state — they take no lock and run concurrently with each other
  and with a dataflow run.
- **Caching — opt-in, default off.** A named function has a stable `bodyIr` hash,
  so `(bodyIrHash, sha256(args))` would be a sound cache key — but caching means
  writing a rooted object, which contradicts the "writes nothing durable"
  contract. Default **off**; a future opt-in `cache: true` may route through a
  tracked path. If it ships, the key must hash **server-re-encoded canonical
  BEAST2 bytes** (encoded against the function's declared `inputTypes`), not the
  raw client bytes — otherwise client-encoding drift causes (correctness-safe)
  cache misses. (Open question §14.)

## 9. Result-size budget (why fail-closed is right)

Measured with the same `encodeBeast2For` e3 uses for dataset values, a
`DictType(String, Struct{…})` "table" packs densely: a narrow row ≈ 28 B, a
typical 7-field row ≈ 111 B — results in the low thousands of rows sit well under
1 MB. The binding ceilings are the cloud transport (see cloud doc): **API Gateway
10 MB** (hard), **Lambda sync response 6 MB**, and base64 inflation in the Lambda
proxy → ~4.5 MB raw. **Default `maxResultBytes` = 1 MB**, server-owned and
clamped (a deployment may set it lower). It leaves 3–4× headroom under the
base64-inflated Lambda ceiling and still allows multi-thousand-row tables inline.
A result that doesn't fit is a dataset — deploy a task and read it with
`datasetGet` (which already does the inline-vs-presigned split). Streaming is
rejected: it exists for results that don't fit in memory, the opposite of this
primitive, and the runner writes the whole file before e3 reads a byte.

## 10. one-shot specifics

one-shot is the inline-IR sibling. Request (revised from the old spec to use
`RunnerType`; inputs may be values or dataset paths):

```ts
// packages/e3-types/src/api.ts
export const OneShotRequestType = StructType({
  bodyIr: BlobType,                       // anonymous EastIR, not deployed
  args:   ArrayType(VariantType({         // each arg: an inline value OR a live dataset
    value:   BlobType,
    dataset: TreePathType,                // workspace-scoped; resolved + pinned by content hash at launch
  })),
  runner: RunnerType,
  limits: OptionType(ExecuteLimitsType),
});
// Response: sync → ExecuteResultType; async launch → CallStartResultType, poll → CallStatusResultType
```

Async launch/poll/cancel state uses the same in-memory `function-call-state.ts`
registry. **Snapshot consistency** for `dataset` args: resolve and pin each
dataset's content hash at launch (objects are immutable, so no lock is needed).

**Security (critical).** one-shot evaluates a **caller-supplied** IR → arbitrary
argv → spawn: it is remote code execution with the server's authority. The named
function path is safer (IR is author-published into the content-addressed store).
Therefore: gate one-shot behind an **elevated role** (owner/admin), and in the
cloud **forbid `custom`** and consider disabling one-shot entirely in multi-tenant
deployments. Named-function calls are member-level and safe-by-construction
(no caller IR). The deployed-task trust model already permits author IR to run;
one-shot only differs by *who* supplies the IR and *when* — make that explicit.

## 11. Security summary

- **Named functions** = author-published IR (same trust as a deployed task),
  member-level, safe by construction.
- **one-shot** = caller-supplied IR = RCE → elevated role only; cloud forbids
  `custom` and may disable one-shot in multi-tenant.
- **`custom` runner** = arbitrary argv. The `RunnerType` variant isolates it as a
  single gateable tag. Local single-tenant may allow it (author = operator);
  the cloud handler rejects a `custom` stored runner or `custom` override.
- No sandboxing beyond the process/container boundary (existing posture; the
  doc states it, does not change it).

## 12. Cross-repo dependency & landing order

This feature spans two repos. The shared contract is `@elaraai/e3-types` (wire
types + `runnerToArgv`), the **package format** (`functions` map + `FunctionObject`,
produced by the `e3` SDK), and the **runner CLI contract**. The cloud has its own
execution kernel (`executeTaskCore`) and does **not** import e3-core's
`runDetached`; it reimplements the same pattern.

**Landing order (hard dependency):**

1. **PR-1 (this repo, e3 monorepo)** — everything in §3–§9: e3-types, e3 SDK,
   e3-core `runDetached`, e3-api-server routes/handlers, e3-api-client, e3-cli.
   Self-contained and shippable; the local server + CLI fully support the feature.
   **Publish** `@elaraai/e3-types`, `@elaraai/e3`, `@elaraai/e3-core`,
   `@elaraai/e3-api-server`, `@elaraai/e3-api-client` (beta dist-tag).
2. **PR-2 (e3-cloud repo)** — consumes the published packages; see the companion
   cloud doc. Cannot merge until PR-1's packages are available.

The dual-decode migration (§4.1) must be applied in **both** repos' package-read
paths.

## 13. Test plan (PR-1)

1. **SDK/export round-trip.** `e3.function` → `e3.package` → `e3.export` → read the
   bundle: a `FunctionObject` with correct `bodyIr` hash, `inputTypes`,
   `outputType`, `runner` variant; `PackageObject.functions[name]` points at it;
   `tasks`/`data` unchanged. Old bundle (no `functions`) still decodes (§4.1).
2. **`runDetached` pure compute (east-node).** Two scalar args + a body that
   combines them ⇒ correct inline `success.value`; no object written, no exec
   record, no logs, no dataset ref (assert the repo is byte-identical after).
3. **Refactor regression.** The existing dataflow/task suite passes unchanged
   after the `taskExecute` extraction (behaviour identical).
4. **Arity/type mismatch** ⇒ `invalid` with a diagnostic; nothing runs.
5. **Result over cap** ⇒ `too_large`; output never read into memory; nothing
   persisted.
6. **stdout/stderr + non-zero exit** ⇒ `failed` with `exitCode` + stderr tail;
   `*Truncated` on overflow.
7. **Timeout + cancel** ⇒ `timed_out` at `timeoutMs`; `cancelCall` aborts an
   in-flight async call.
8. **Sync vs async** over the API: sync returns `ExecuteResult` (200); async
   returns `{callId}` (202) then polls to a terminal result; TTL eviction frees
   the registry entry.
9. **Both scopes**: identical result from `…/packages/:pkg/:version/functions/:fn`
   and a deployed `…/workspaces/:ws/functions/:fn`.
10. **CLI** `e3 call` with literal args and `.beast2`/`.json` file args; `-o`
    writes the decoded result; non-success sets a non-zero exit code.
11. **one-shot** sync + async (east-node) returns the right value; one-shot is
    refused without the elevated role.
12. **Runner override**: a `runner` in the request overrides the stored one;
    `custom` override behaves per the deployment policy.
13. **GC survival** (§4.2): deploy a package with a function, run `e3 repo gc`,
    then call the function — the `FunctionObject` and its `bodyIr` object are
    retained and the call succeeds.
14. **Old-package compatibility** (§4.1): a package exported before `functions`
    existed still decodes and runs its tasks through every decode site (dual-decode
    round-trip), and an old client reading a new server's `getPackage` succeeds.

## 14. Open questions

- **Caching default** (§8) — keep off (purity) vs opt-in `cache: true`.
- **Migration strategy** (§4.1) — dual-decode (recommended) vs format bump.
- **one-shot exposure** (§10) — elevated-role-gated everywhere vs disabled in
  multi-tenant cloud.
- **`e3.function` signature** — infer from the East function (recommended) vs an
  explicit `(name, inputTypes, outputType, fn)` overload for non-`East.function`
  bodies.
- **Value|dataset args** (§10) — ship the `dataset` arg variant in v1 (unlocks
  named-fn-over-live-data) or defer.
- **Default `maxResultBytes`/`maxLogBytes`** — 1 MB result proposed; pick a log
  tail (e.g. 64–256 KB/stream).

## 15. Out of scope

- Durable task creation / `packageImport` / `workspaceDeploy` — unchanged.
- Authoring/compiling East source to IR — supplied ready (one-shot) or built at
  package time (`e3.function`).
- Large/streamed results — use a deployed task + `datasetGet`.
- Platform-function sandboxing/allowlist — existing posture; unchanged.
