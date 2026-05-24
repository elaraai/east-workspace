# Change request: one-shot task execution

> Status: **proposed** · 2026-05-22
> Audience: e3 maintainers. This is a **generic e3 capability** — it has no
> dependency on, and makes no reference to, any particular consumer. It is
> motivated by interactive/exploratory execution in general.

## 1. Summary

Add a way to execute a **single, not-yet-deployed task** — an East function
bound to **existing datasets** in a workspace — and return its result, **without
deploying the task** into the workspace's task graph and **without persisting
anything**. Execution reuses the normal managed runner (so it supports runtime
targeting and resource limits), but the run is **one-shot**: it adds no task to
any package or dataflow graph, writes no execution record, persists no output
object, triggers no downstream recomputation, and leaves the repository
unchanged.

The result is returned **inline** and is **memory-bounded**: a one-shot is for
computing an in-memory value over current data. If the result is too large to
return inline, the run **fails** — that is the signal to deploy a task and read
its output dataset instead (see §6).

Think of it as the read-only, throwaway sibling of "deploy a package and run
it": *run this function over these existing datasets, give me the value, change
nothing.*

## 2. Motivation

e3 today can only run a function by **deploying** it as a task into a workspace.
That is the right model for durable, graph-integrated computation, but it is
heavyweight for the many cases where you want to compute something **once,
against current data, without changing the graph**:

- **Interactive exploration / REPL / notebook UX** — run a transform over
  existing datasets and see the result immediately; iterate on the function
  without polluting the graph with throwaway tasks.
- **Dry-run / preview before deploy** — execute a candidate task against real
  inputs to validate its output (and types) *before* committing it.
- **What-if / scenario analysis** — run a variant of a computation over the
  current datasets to compare outcomes, persisting nothing.
- **Debugging** — execute a single function in isolation against its current
  inputs and inspect the output + stdout/stderr, decoupled from the dataflow.
- **External tools / scripts / services** — compute a one-off derived value from
  a repo's datasets over the API, without owning a deployed task.

All of these want the same primitive, and all of them want a **small, in-memory
result** — none of them want to materialise a dataset.

## 3. Current state & the gap

A function becomes runnable only as a **task** inside a **package** that is
**exported** and **deployed** to a workspace; the dataflow then executes graph
tasks and outputs are read via `datasetGet`. There is **no** way to run a
function that is *not* part of the deployed graph. To compute something one-off
you must deploy a task you immediately want to discard — which mutates the
graph, adds a task object + output dataset, writes execution history, and may
trigger downstream recomputation.

The gap is a **one-shot, read-only execution path** that reuses the runner but
skips deployment, graph registration, and all persistence.

## 4. How it relates to the existing execution path

A deployed task today (`LocalTaskRunner.taskExecute`) does, in order: (1) check
the execution cache, (2) read the `TaskObject`, (3) marshal input objects to a
scratch dir, (4) evaluate the task's `commandIr` to get an argv, (5) spawn the
runner process, which **reads the input `.beast2` files and writes the output
`.beast2` file**, (6) read that output file, write it to the object store, and
write an execution status record + persist stdout/stderr logs.

One-shot reuses only the **compute core** — steps 3, 4, 5, and reading the
output file — and skips every persistence touchpoint:

| Step | Deployed task | One-shot |
|---|---|---|
| Cache check (`executionGetLatestOutput`) | yes | **no** |
| `TaskObject` read by hash | yes | uses a synthesized task value (§5) |
| Marshal inputs to scratch | yes | yes |
| Evaluate launcher → argv | yes | yes |
| Spawn runner process | yes | yes |
| Runner writes output file to scratch | yes | yes (always — see below) |
| Read output file | yes | yes |
| `objects.write(output)` (durable) | yes | **no** — returned inline |
| `executionWrite` status record | yes | **no** |
| `logs.append` (durable stdout/stderr) | yes | **no** — returned inline |

**The result is always written to disk by the runner**, regardless of runtime
(`east-c` / `east-py` / `east-node`): the cross-runtime contract is `-o
<output_path>`, and the runner process produces a complete `.beast2` file then
exits. e3 cannot avoid that transient scratch write. What one-shot avoids is
*promoting* it — the file is read back, returned inline, and the scratch
directory is deleted (as `taskExecute` already does in its `finally`). Nothing
durable is written.

It runs on the **`TaskRunner`** (so runtime targeting + resource limits +
cancellation hold) but **not** the `DataflowOrchestrator` — there is no DAG to
drive. Async launch/poll/cancel state lives in **in-memory server state**, the
same way GC operations are tracked today (`async-operation-state.ts`: keyed by a
random UUID, never written to the repo).

Because it sits behind the `TaskRunner` interface, an alternative deployment
implements it the same way it implements task execution — with no special
casing. A hosted deployment maps a one-shot to a **single managed runner
invocation** (e.g. one Lambda/Fargate run), with no Step Functions / dataflow
state machine, since there is no graph to orchestrate.

## 5. Proposed API

Touches `e3-types` (request/result types), `e3-core` (compute-core extraction +
one-shot path), `e3-api-server` (handler), `e3-api-client` (methods), and
optionally the CLI.

```ts
// e3-types — wire types are East types (StructType/VariantType + ValueTypeOf),
// beast2-encoded over the API, exactly like LogChunkType / TaskObjectType.

export const DiagnosticType = StructType({
    message: StringType,
    filename: OptionType(StringType),
    line: OptionType(IntegerType),
    column: OptionType(IntegerType),
});
export type Diagnostic = ValueTypeOf<typeof DiagnosticType>;

export const OneShotExecuteRequestType = StructType({
    /** beast2-encoded EastIR bundle of the function to run (NOT deployed). Its
     *  params correspond positionally to `inputs`; its return value is the
     *  result. e3 synthesizes the launcher argv from this + `runner`. */
    functionIr: BlobType,
    /** Existing dataset paths, bound positionally to the function's params.
     *  Read-only; arity + element types validated against the IR (§6). */
    inputs: ArrayType(TreePathType),
    /** Runtime selection; defaults to the server/workspace default. e.g.
     *  ['east-c','run'] | ['east-py','run', ...] | ['east-node','run']. The IR
     *  must use only platform functions available on the chosen runner (§6). */
    runner: OptionType(ArrayType(StringType)),
    /** Execution caps; server clamps each to its maxima. */
    limits: OptionType(StructType({
        timeoutMs: OptionType(IntegerType),
        /** Per-process memory cap; honoured only where the runner supports it
         *  (cloud). The local runner has no sandbox and ignores it (§10). */
        memoryMb: OptionType(IntegerType),
        /** Hard cap on inline result size (encoded beast2 bytes); over it the
         *  run fails (§6). Client may request lower, never higher. */
        maxResultBytes: OptionType(IntegerType),
        /** Hard cap on captured stdout+stderr; over it streams are
         *  tail-truncated with a marker (§6). */
        maxLogBytes: OptionType(IntegerType),
    })),
});
export type OneShotExecuteRequest = ValueTypeOf<typeof OneShotExecuteRequestType>;

export const OneShotExecuteResultType = StructType({
    /** The run's outcome. stdout/stderr below are always present regardless. */
    outcome: VariantType({
        /** Process exited 0 and the result fit within maxResultBytes. */
        success: StructType({
            /** beast2 result value; decode with the function's return type. */
            value: BlobType,
        }),
        /** Process ran but exited non-zero — see stderr for the runtime error. */
        failed: StructType({ exitCode: IntegerType }),
        /** No usable result: signature/type mismatch, IR decode, or a result
         *  over maxResultBytes (with a size diagnostic). Source locations where
         *  available. Distinct from raw stderr. */
        invalid: StructType({ diagnostics: ArrayType(DiagnosticType) }),
    }),
    /** Captured process output, inline (never persisted). Each is a bounded tail
     *  buffer; the `*Truncated` flag marks dropped earlier bytes. */
    stdout: StringType,
    stderr: StringType,
    stdoutTruncated: BooleanType,
    stderrTruncated: BooleanType,
    /** In-memory execution id (server-scoped; not a repo execution record). */
    executionId: StringType,
});
export type OneShotExecuteResult = ValueTypeOf<typeof OneShotExecuteResultType>;

// Launch's wire response is StructType({ executionId: StringType }); cancel's is
// NullType. e3-api-client wraps encode/decode and exposes TS methods:
export function oneShotExecuteLaunch(repo: string, workspace: string, req: OneShotExecuteRequest): Promise<{ executionId: string }>;
export function oneShotExecutePoll(repo: string, workspace: string, executionId: string): Promise<OneShotExecuteResult>;
export function oneShotExecuteCancel(repo: string, workspace: string, executionId: string): Promise<void>;
```

`DiagnosticType` is new — `e3-types` has no diagnostic type today. The numeric
limits/offsets are `IntegerType` (i.e. `bigint` on the TS side), consistent with
the rest of `e3-types`.

**`functionIr` is the computation, not the launcher.** In e3, a deployed task's
`commandIr` is an argv generator with signature `(inputs: Array<String>, output:
String) -> Array<String>`, and the actual function IR is stored as a dataset
passed as `input[0]` (see `e3/src/task.ts`). One-shot mirrors this: the request
carries the typed `functionIr`; the server marshals it as `input[0]` and
synthesizes the launcher argv for the chosen `runner` exactly as the SDK does.
The caller never constructs the launcher.

**IR delivery.** `functionIr` is carried inline (v1). A later optimisation is an
upload-then-reference form (`putFunctionIr(bytes) → hash`) to avoid re-sending a
large IR across iterations; recommended but not required for v1.

## 6. Semantics

- **Signature validation.** Before running, validate that `inputs` arity and the
  resolved dataset element types match `functionIr`'s parameter signature. Input
  types are resolved from the **workspace structure** at the given paths
  (datasets store a content hash + version vector, not a type). Mismatch ⇒ an
  `invalid` outcome with a `diagnostics` entry; nothing runs.
- **Snapshot consistency.** Resolve and **pin each input's content hash at
  launch**. Because objects are content-addressed and immutable, concurrent
  writers cannot tear the read — no lock is required, and a one-shot can run
  concurrently with a dataflow run or another one-shot. (This pins *physical*
  values; it does not perform the reactive engine's cross-input version-vector
  agreement check, which one-shot does not need.)
- **Runtime targeting.** `runner` selects the engine. The function IR is portable
  across runtimes, but **platform-function availability is not**: a function
  using `east-py-datascience` will not run under `east-c` or `east-node`. The
  caller must choose a runner that provides the platform functions its IR uses.
- **Result delivery — inline only, memory-bounded, fail-closed.** The result is
  returned inline as beast2 bytes. The output file is `stat`-ed **before** it is
  read into memory; if `size > maxResultBytes` the run yields an `invalid`
  outcome with a size `diagnostics` entry and the bytes are never loaded —
  bounding server memory.
  There is **no** spill to a scratch dataset and **no** download-URL fallback.
  The failure message points at the alternative: *a result this large is a
  dataset — deploy a task and read it with `datasetGet`* (which already does the
  inline-vs-presigned-download split for large datasets).
- **stdout / stderr.** Captured in memory via the runner's `onStdout`/`onStderr`
  callbacks (never written to the logs store) and returned inline as separate
  `stdout` / `stderr` strings. Each is a **bounded tail buffer**
  (`maxLogBytes`): once full it keeps the most recent bytes and sets
  `*Truncated`. stderr is returned on failure too — it is where a runtime error
  or stack trace appears.
- **Resource management.** `timeoutMs` is enforced by the runner (process-group
  kill) and `maxResultBytes` / `maxLogBytes` (the response memory bounds) are
  enforced on any runner. `memoryMb` is a per-process cap honoured only where the
  runner supports it (a cloud runner); the local runner has no sandbox and
  ignores it (§10). Cancellation is via `oneShotExecuteCancel`.
- **No persistence.** No task object, function-IR object, or output object is
  written to the store; no execution status record; no logs. The repository is
  byte-for-byte unchanged afterward. The only disk write is the runner's
  transient scratch file, deleted on completion.
- **Authorization.** Runs under the **caller's existing token/scope** and honours
  the same dataset-read permissions as other workspace operations. It grants no
  authority beyond what the caller already has.
- **No caching (by default).** A one-shot recomputes every call — that is the
  cost of writing nothing. See §9 for the opt-in caching escape hatch.

## 7. Result size budget (why the inline cap is the right boundary)

Measured with the same `encodeBeast2For` e3 uses for dataset values
(`DictType(String, Struct{…})`, the "table" case):

| Row shape | bytes/row | rows under 1 MB | under 6 MB |
|---|--:|--:|--:|
| narrow (`id`, int, float) | ~28 | ~37,000 | ~223,000 |
| typical (7 fields + 2 small arrays) | ~111 | ~9,400 | ~56,000 |
| wide (11 fields, larger arrays) | ~169 | ~6,200 | ~37,000 |

BEAST2 encodes the schema once and packs rows densely, so a result table in the
low thousands of rows fits comfortably under **1 MB**.

The cap also has to satisfy the transport in hosted deployments:

- API Gateway (REST and HTTP API): **10 MB** request/response, hard, not
  increasable, in the default buffered mode.
- Lambda synchronous response: **6 MB** buffered — the binding limit behind a
  Lambda proxy integration. A Lambda proxy returns binary as base64, and the
  6 MB applies to the *encoded* envelope, so raw beast2 effectively caps near
  **~4.5 MB** there.

**Recommended default `maxResultBytes` = 1 MB**, reusing the existing
`SIZE_THRESHOLD` in `datasets.ts` (the line above which `datasetGet` switches to
a presigned download). It is e3's established "inline is fine" line, leaves
3–4× headroom under even the base64-inflated Lambda ceiling, and still permits
~6k–37k-row tables inline. Server-owned and clamped; a cloud deployment may set
it lower to match its transport.

### Rejected alternative: response streaming

Streaming would lift the transport ceiling — API Gateway REST APIs now support a
`STREAM` response transfer mode (exceeds 10 MB, first 10 MB unthrottled then
2 MB/s, `HTTP_PROXY`/`AWS_PROXY` only, REST only, disables endpoint caching /
content-encoding / VTL, 15-min and idle timeouts), and Lambda response streaming
raises responses to a 20 MB soft limit via Function URLs. It is **rejected for
one-shot** because:

1. It breaks the in-memory-value contract — streaming exists for results that do
   not fit in memory, which is the opposite primitive.
2. The result is **atomic**: the runner writes the whole file and exits before
   e3 reads a byte, so there is no incremental production to stream and no
   time-to-first-byte benefit.
3. It adds cost and wiring (Function URL / STREAM mode, lost caching, throttling,
   timeouts) to defeat a limit that only bites at tens of thousands of rows —
   exactly where the answer is "deploy a task."

Large or streamed results are a **dataset** concern, served by the existing
deploy → `datasetGet` (+ transfer backend) path.

## 8. Implementation

Per package: what is reused, what is new, and the one interface change.

### 8.1 e3-core — extract the compute core, add the one-shot path

In `LocalTaskRunner.ts` the process mechanics and the persistence are
interleaved. Extract the mechanics as persistence-free primitives that both the
tracked path and one-shot share:

- `marshalInputs(storage, repo, inputHashes, scratchDir): Promise<string[]>` —
  write each input object to `input-i.beast2` (today inline in `taskExecute`).
- `runProcess(argv, { timeoutMs, signal, onStdout, onStderr }): Promise<{ exitCode: number | null; error: string | null }>`
  — the detached spawn + process-group kill + timeout + abort + stdout/stderr
  capture from `runCommand`, **without** the `executionWrite('running')` and
  `logs.append` calls.

`taskExecute` is refactored to compose these plus its existing cache check,
status writes, log persistence, and `objects.write` — behaviour unchanged.

New `oneShotExecute` (e3-core), persistence-free:

```ts
async function oneShotExecute(
  storage: StorageBackend, repo: string, spec: OneShotSpec, options: { signal?: AbortSignal },
): Promise<OneShotRunResult> {
  // inputs already resolved + pinned to content hashes by the caller (server)
  const scratch = await mkScratch();
  try {
    const fnPath = await writeScratch(scratch, 'fn.beast2', spec.functionIr);
    const inputPaths = await marshalInputs(storage, repo, spec.inputHashes, scratch);
    const outPath = join(scratch, 'output.beast2');
    const argv = buildRunnerArgv(spec.runner, inputPaths, outPath, fnPath); // shared CLI contract
    const out = boundedTail(spec.limits.maxLogBytes), err = boundedTail(spec.limits.maxLogBytes);
    const { exitCode } = await runProcess(argv, {
      timeoutMs: spec.limits.timeoutMs, signal: options.signal,
      onStdout: out.append, onStderr: err.append,
    });
    if (exitCode !== 0) return failed(exitCode ?? -1, out, err);
    const { size } = await fs.stat(outPath);                       // stat BEFORE read
    if (size > spec.limits.maxResultBytes) return invalid([oversize(size, spec.limits.maxResultBytes)], out, err);
    return success(await fs.readFile(outPath), out, err);          // inline, bounded
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });        // no objects.write / executionWrite / logs.append
  }
}
```

`buildRunnerArgv` emits `[...runner, '-i', in1, …, '-o', out, fnPath]` — the same
CLI contract the SDK's `commandIr` builds (`e3/src/task.ts`). Factor it into one
helper so the deployed and one-shot paths never drift.

### 8.2 Abstraction interface — `TaskRunner.runOneShot`

One-shot is a runner capability (the §4 portability claim), so it goes on the
`TaskRunner` interface — every deployment implements it the same way:

```ts
interface TaskRunner {
  execute(storage, taskHash, inputHashes, options): Promise<TaskResult>;   // existing
  runOneShot(storage, repo, spec, options): Promise<OneShotRunResult>;     // new
}

interface OneShotSpec {
  functionIr: Uint8Array;
  inputHashes: string[];                 // resolved + pinned by the caller, not paths
  runner: string[];
  limits: { timeoutMs?: number; memoryMb?: number; maxResultBytes: number; maxLogBytes: number };
}

// TS-native; the server maps it to the OneShotExecuteResultType wire variant.
type OneShotRunResult =
  | { kind: 'success'; value: Uint8Array; stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean }
  | { kind: 'failed';  exitCode: number;  stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean }
  | { kind: 'invalid'; diagnostics: Diagnostic[]; stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean };
```

- `LocalTaskRunner.runOneShot` = `oneShotExecute` above (local spawn).
- Cloud runners (`LambdaTaskRunner` / `FargateTaskRunner`) implement it as a
  **single managed invocation** — no Step Functions, no `ExecutionStateStore`,
  since there is no DAG or resumable state. Input resolution/pinning happens in
  the caller, so the spec carries hashes and the runner stays
  deployment-agnostic.

### 8.3 e3-api-server — registry, handler, routes

In-memory op registry, mirroring `async-operation-state.ts` (never written to
the repo):

```ts
interface OneShotOp { status: 'running' | 'done'; startedAt: Date; result?: OneShotRunResult; abort: AbortController; }
const ops = new Map<string, OneShotOp>();   // key: executionId (randomUUID)
// createOneShotOp() → id ; completeOneShotOp(id, result) ; getOneShotOp(id) ; cancelOneShotOp(id) → abort.abort()
```

Routes under `/repos/:repo/workspaces/:ws` (Hono, like the dataflow + GC routes):

- `POST /one-shot` — decode `OneShotExecuteRequestType`; authz (caller token +
  dataset-read perms on `inputs`); resolve+pin each input via
  `workspaceGetDatasetHash` (a non-`value` ref ⇒ an `invalid` result, no run);
  `createOneShotOp()`; fire `runner.runOneShot(storage, repo, spec, { signal:
  op.abort.signal })` in the background, settling into `completeOneShotOp`;
  return `{ executionId }` (`StructType({ executionId: StringType })`) at once.
- `GET /one-shot/:executionId` — `getOneShotOp`; running ⇒ a running marker, done
  ⇒ `OneShotExecuteResultType` (map `OneShotRunResult` →
  `variant('success' | 'failed' | 'invalid', …)`); unknown/evicted ⇒ 404.
- `POST /one-shot/:executionId/cancel` — `cancelOneShotOp`; the abort signal is
  the one threaded into `runProcess`, so it kills the process group. Returns
  `NullType`.

No workspace lock is taken — inputs are pinned by content hash, so one-shots run
concurrently with each other and with a dataflow run (§6). A per-server cap on
concurrent one-shots is the only resource guard, independent of the dataflow
single-active-execution rule.

### 8.4 e3-api-client — methods

Mirror `dataflowExecute*` (`executions.ts`), beast2 over the wire:

```ts
oneShotExecuteLaunch(url, repo, ws, req: OneShotExecuteRequest, options): Promise<{ executionId: string }>;
oneShotExecutePoll (url, repo, ws, executionId: string, options): Promise<OneShotExecuteResult>;
oneShotExecuteCancel(url, repo, ws, executionId: string, options): Promise<void>;
```

Optionally a `oneShotExecute(...)` convenience that launches then polls to
completion with backoff, like `dataflowExecute`.

### 8.5 Reuse vs new

| Reused as-is | New |
|---|---|
| spawn/capture/timeout/abort mechanics (`runCommand` → `runProcess`) | compute-core extraction (`marshalInputs`, `runProcess`, `oneShotExecute`) |
| `workspaceGetDatasetHash` (path → pinned hash) | `buildRunnerArgv` shared CLI-contract helper |
| `ObjectStore.read` (inputs; never `write`) | `TaskRunner.runOneShot` + cloud implementations |
| async-op registry pattern (`async-operation-state.ts`) | `OneShotExecuteRequest/Result`, `Diagnostic` East types (§5) |
| Hono routes + `post`/`get` client helpers | 3 routes + in-memory one-shot registry; 3 client methods |
| beast2 encode/decode (`encodeBeast2For`) | TTL/eviction for finished ops (§13) |

## 9. Caching escape hatch (future, opt-in)

One-shot is untracked **by default** so it changes nothing. This does not
foreclose memoisation: e3's execution store is already a content-addressed,
GC-rooted cache keyed by `(taskHash, inputsHash)` — a deployed task that re-runs
identical work is served from cache automatically. A future opt-in flag (e.g.
`cache: true`) can route a one-shot through the **tracked** `taskExecute` path:
it would then synthesize a *deterministic* `TaskObject` (canonical paths so the
hash is stable across calls), write an execution record + output object, and
benefit from the existing cache on the next identical call — at the cost of the
persistence one-shot otherwise avoids. Default off; opt in when re-running is
expensive enough to justify the durable footprint.

## 10. Security

Read-only inputs (pinned by content hash); caller's existing authz, no
escalation; no graph mutation; nothing persisted. Result and logs are
memory-bounded.

**Not** in scope for v1: a platform-function allowlist / "authority-free"
sandbox. `LocalTaskRunner` spawns the runtime with the full OS authority of the
server and has no sandbox (its own comments note process-group kill is escapable
and that cgroups / Firecracker are future hosted-runtime work). A one-shot
therefore runs with the **same authority as any deployed task** — it is not a
safe way to run untrusted IR. Enforcing an allowlist would require per-runtime
support in `east-c` / `east-py` / `east-node` and is a separate, cross-cutting
change.

## 11. Acceptance criteria / test plan

1. **Pure compute, east-c.** Two existing datasets and a `functionIr` that
   sums/joins them ⇒ correct inline beast2 `value`; the workspace task list,
   dataflow graph, object store, and execution history are **unchanged**.
2. **Runtime targeting.** A `functionIr` using only commonly-available platform
   functions returns equal results under `['east-py','run', …]` and
   `['east-node','run']`. A function using a runner-specific platform function
   fails clearly when run under a runner that lacks it.
3. **Signature mismatch.** Wrong input arity/types ⇒ an `invalid` outcome with a
   `diagnostics` entry; nothing executes.
4. **Result bound, fail-closed.** A function whose result exceeds
   `maxResultBytes` ⇒ an `invalid` outcome with a size `diagnostics` entry; the
   output file is never read into memory; nothing is persisted.
5. **stdout/stderr inline.** A function that writes to both streams returns them
   in `stdout` / `stderr`; a non-zero exit yields a `failed` outcome carrying
   `exitCode`, with the runtime error in `stderr`. Output beyond `maxLogBytes` is
   tail-truncated with `*Truncated` set.
6. **Limits + cancel.** A long-running function is terminated at `timeoutMs`;
   `oneShotExecuteCancel` stops an in-flight execution.
7. **No persistence.** After any one-shot (success, failure, or cancel): no new
   object in the store, no execution record, no log files, no task in any
   package/graph; a byte-for-byte comparison of the repo is unchanged (modulo
   unrelated activity).
8. **Snapshot consistency.** Concurrent writes to an input during execution do
   not change the values the run observed (reads pinned at launch).
9. **Authorization.** A caller lacking read permission on an input is refused.

## 12. Out of scope

- Durable task creation / `packageImport` / `workspaceDeploy` — unchanged.
- Branch/promotion/merge semantics — unchanged.
- Authoring / compiling East source to IR — the caller supplies a ready
  `functionIr`; producing it is the caller's concern.
- Large/streamed results — use a deployed task + `datasetGet` (§7).
- Platform-function sandboxing / allowlist (§10).
- Live log streaming during a run — the launch/poll shape leaves room to add it
  later; v1 returns final bounded stdout/stderr.

## 13. Open questions

- **`functionIr` delivery:** inline bytes (v1) vs upload-then-reference (§5).
- **Default `maxResultBytes` / `maxLogBytes`:** 1 MB result proposed (§7); pick a
  log default (e.g. 64–256 KB tail per stream).
- **In-memory state retention:** how long the server keeps a finished one-shot's
  result available for `poll` before evicting it (it is never on disk).
