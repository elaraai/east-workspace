# Design: e3 records — system of record with reactive dataflow

> Status: **draft / proposal** · 2026-06-12
> Audience: e3 maintainers. This is the local/shared spec (e3 monorepo); the
> AWS implementation is sketched in §10 and would get a companion doc in
> `e3-cloud/design/e3-records-cloud.md` (same split as `e3-functions.md`).
> Builds directly on `e3-functions.md` (runDetached, FunctionObject patterns)
> and `e3-reactive-dataflow.md` (per-dataset refs, version vectors).

## 1. Summary

Make e3 a **system of record**: durable, ACID, audited, mutable state that is
owned by e3 itself — not periodically copied in from elsewhere — and that
participates in reactive dataflow as a root input.

Three coordinated pieces (one existing, two new):

- **`e3.input`** — unchanged. The existing root dataset with replace-on-write
  semantics; records build alongside it, not on top of a rename. (A rename to
  `e3.value` was considered and rejected — §5.1.)
- **`e3.record`** — a new kind of root dataset whose writes go through named,
  typed, pure East **mutations** executed server-side in a compare-and-swap
  retry loop. Every committed mutation appends a **commit object** (parent,
  state, mutation name, args, actor, timestamp) — git-style history is the
  audit trail. (§5.2, §6)
- **`e3.mutation`** — the write half of the function machinery (`e3.function`
  is the read/query half — CQRS). A mutation is a pure East reducer
  `(State, ...Args) => State` that runs where the data is, via the existing
  `runDetached` kernel. (§5.3, §8)

Nothing about tasks changes. The dataflow orchestrator does not learn a new
node kind: a record's current state is an ordinary root dataset ref, its
commit hash is its version-vector entry, and a committed mutation triggers
reactive re-execution exactly as `e3 set` does today.

ACID falls out of primitives e3 already has:

| Property | Mechanism |
|---|---|
| Atomicity | objects are content-addressed and invisible until referenced; commit = one conditional ref write |
| Consistency | East type system on state; mutation body enforces invariants (throw ⇒ abort, nothing written) |
| Isolation | optimistic concurrency: read → reduce → conditional write → retry on conflict (serializable per record) |
| Durability | fsync + atomic rename locally; DynamoDB/S3 in cloud |

The single new storage primitive is a **conditional dataset-ref write**
(§7) — which independently fixes the known lost-update window in today's
`e3 set` path, and is already named as future work in
`e3-cloud/design/presigned-transfer.md` ("optimistic concurrency via
conditional writes").

## 2. Motivation & use cases

Today e3 computes over data someone else owns: roots are written by `e3 set`
(blind replace, last-writer-wins, no provenance of *why*) or by the e3-ui
`Data.bind(...).write` path (same semantics, from a browser). That is fine
for "copy the latest extract in", but it cannot host operational state:

- **Human-in-the-loop planning** (the flagship). An optimizer task proposes a
  plan; a planner reviews, overrides line items, approves. Overrides and
  approvals are mutations on a `decisions` record — audited (who approved
  what, when, superseding which proposal) — and an approval reactively
  triggers downstream export/execution tasks. Today there is nowhere
  consistent to put the human half of that loop.
- **Operational data entry through e3-ui.** Order capture, inventory
  adjustments, master-data corrections via forms bound to mutations. Multiple
  planners editing the same workspace concurrently is precisely the
  lost-update scenario conditional writes fix.
- **Master data management.** Products, customers, BOMs as governed records
  with typed schemas and full change history, instead of re-imported copies.
- **Scenario / what-if state.** A user's scenario edits as a record layered
  over base data; the commit chain lets them walk back through their own
  exploration.
- **Decision history as a compliance artifact.** "What did we forecast on
  March 3, what did the planner change, what did we commit to" is a join
  between record commit chains and the execution provenance e3 already
  tracks (`e3-execution-history.md`). That is the literal meaning of
  *system of record*.
- **Workflow state machines and counters.** Approval states, integration
  cursors ("last synced order id"), sequence numbers (an order-number
  counter needs an atomic increment — impossible today). Small, hot,
  contended state: the CAS-loop sweet spot.

## 3. How existing concepts absorb this

e3 already divides datasets into **roots** (written from outside the
dataflow) and **derived** (task outputs). Records do not add a third node
kind to the DAG — they upgrade the write protocol of roots.

| Concept | Today | After |
|---|---|---|
| `e3.input` | root, blind replace via `e3 set` / `Data.write` | **unchanged** — root, blind replace (a rename to `e3.value` was considered, then rejected; §5.1) |
| `e3.record` | — | root whose writes go through mutations: CAS, commit chain, audit |
| `e3.task` | pure, cached, reads datasets → writes derived datasets | **unchanged** |
| `e3.function` | read-only RPC (`e3-functions.md`) | unchanged — the *query* half |
| `e3.mutation` | — | the *write* half; only door into a record |

**The directional rule** that keeps the model sound: *dataflow reads records;
tasks never write them.* Tasks are pure, cached by `(taskHash, inputsHash)`,
and executed at-least-once — a task writing a record would double-apply on
retry and break cache idempotency. Writes enter only from outside the DAG:
UI (via the function-call transport), CLI (`e3 mutate`), HTTP API,
integrations.

**Records and task outputs mix freely as task inputs.** The task input
machinery sees only datasets with paths, types and ref hashes — it is
indifferent to whether a hash came from a task execution or a mutation
commit:

```ts
const orders   = e3.record('orders', OrdersType, init);     // operational
const history  = e3.input('history', HistoryType);          // imported extract
const forecast = e3.task('forecast', ..., [history]);       // derived
const plan     = e3.task('plan', optimizer, [forecast, orders, overrides]);
//                                           ^derived   ^record  ^record
```

Invalidation is per-input-ref: a mutation on `orders` invalidates `plan`
without recomputing `forecast`. Version-vector consistency checking
(`packages/e3-core/src/dataset-refs.ts:32` `checkVersionConsistency`) already
guarantees a dataflow run never mixes two commits of the same record across
diamond branches — the record's version entry is its commit hash (§6.3), so
this works at commit granularity (no ABA).

## 4. What exists today (interfaces reviewed)

- **`DatasetRefType`** (`packages/e3-types/src/dataset-ref.ts:76`) —
  `unassigned | null{versions} | value{hash, versions}`. `versions` is
  `DictType(StringType, StringType)` mapping root keypath → content hash.
  Roots are *supposed* to self-reference; `workspaceSetDataset` currently
  writes `versions: new Map()` (`packages/e3-core/src/trees.ts:269`) — the
  design spec's `{self: hash}` is not yet populated. Records fix this for
  their paths (§6.3).
- **`DatasetRefStore`** (`packages/e3-core/src/storage/interfaces.ts:664`) —
  `read/write/list/remove/removeAll`. `write` is atomic (rename locally,
  `PutItem` in cloud) but **unconditional**: concurrent writers to one path
  are last-writer-wins. This is the gap §7 closes.
- **Write path** — `workspaceSetDataset` (`packages/e3-core/src/trees.ts`)
  takes a *shared* workspace lock, checks the structure leaf's `writable`
  flag (`packages/e3-types/src/structure.ts:55`), writes the value object,
  writes the ref. The `writable: false` flag already hard-blocks task
  outputs from `e3 set` — records reuse it as the "mutations are the only
  door" enforcement (§6.2).
- **Reactive loop** — `LocalOrchestrator` (`…/dataflow/orchestrator/LocalOrchestrator.ts:340`)
  re-snapshots root versions after each task completion
  (`snapshotInputVersions` / `detectInputChanges`,
  `packages/e3-core/src/dataset-refs.ts:137,174`), invalidates downstream,
  runs to fixpoint. A record commit is just a root change to this loop.
- **Functions kernel** — `runDetached`
  (`packages/e3-core/src/execution/runDetached.ts`, spec `e3-functions.md`
  §6): persistence-free *marshal bytes → spawn runner → return result bytes*.
  Mutations reuse it verbatim; only the orchestration around it (read state,
  CAS commit) is new. `FunctionObjectType`
  (`packages/e3-types/src/function.ts:27`) is the template for
  `MutationObjectType`.
- **Package format** — `PackageObjectType`
  (`packages/e3-types/src/package.ts:75`) is positional BEAST2; new fields
  must be **appended last** with a dual-decode shim (`decodePackageObject`
  precedent at `package.ts:111`).
- **UI write path** — `Data.bind(...).write` (design `e3-ui.md`) writes
  values through `datasetSet` from the browser, declared via `writes:` on
  `e3.ui()`. It keeps working for `e3.input`; for records the UI calls
  mutations through the function-call transport (the `Func.bind` /
  `func-runtime` work in e3-ui is the natural client). (§9.4)
- **Cloud storage** (e3-cloud repo, surveyed) — dataset refs are DynamoDB
  items (`DREF/{repo}` / `{ws}#{path}`, `dynamo-dataset-ref-store.ts`),
  objects ≤4 KB are inlined in DynamoDB, larger in S3 (`s3-object-store.ts`);
  `TransactWriteItems` already used for execution writes; a TTL'd
  `DynamoLockService` exists. Conditional ref writes are pre-approved future
  work (`design/presigned-transfer.md`). (§10)

## 5. Authoring surface (SDK, `packages/e3/src`)

### 5.1 `e3.input` — unchanged (the `e3.value` rename was rejected)

`e3.input` (`packages/e3/src/input.ts`) stays exactly as today: a root dataset
with replace-on-write semantics, mounted at `.inputs.<name>` under the
`inputsTree` singleton. Records build alongside it — no rename, no deprecation,
no migration.

*Alternative (considered, rejected): rename `e3.input` → `e3.value` (a new
`value()` mounting at `.values.<name>` under a `valuesTree` singleton, with
`e3.input` kept as a deprecated alias). The name reads more honestly — an input
is "literally a value" — but the rename buys no behaviour, splits the root
surface into two near-identical primitives, and makes a user-visible tree
segment (`.values` vs `.inputs`, surfaced in `e3 get/set`, the UI, and version
vectors) churn for no functional gain. Not worth the migration tax; `e3.input`
is kept as the single root primitive.*

### 5.2 `e3.record`

```ts
// packages/e3/src/record.ts (new)
export interface RecordDef<T extends EastType = EastType, Path extends TreePath = TreePath>
  extends DatasetDef<T, Path> {
  readonly recordKind: 'record';          // discriminant for package_()/export_
  readonly mutations: Record<string, MutationDef>;
}

export function record<Name extends string, T extends EastType>(
  name: Name,
  type: T,
  initialValue: ValueTypeOf<T>,           // REQUIRED — a record always has state
): RecordDef<T, [variant<'field', 'records'>, variant<'field', Name>]>;
```

Mounts at `.records.<name>`. Crucially the structure leaf is emitted with
**`writable: false`** — `workspaceSetDataset` (`trees.ts:257`) then rejects
raw `e3 set` / `Data.write` on record paths with zero new enforcement code.
A `RecordDef` *is a* `DatasetDef`, so it is accepted everywhere a dataset is
(task inputs, `e3.ui` reads) with no type-system changes.

`initialValue` is required: deploy writes the genesis commit (§6.4), so a
record is never `unassigned` and mutations always have a state to reduce.

### 5.3 `e3.mutation`

```ts
// packages/e3/src/mutation.ts (new)
export interface MutationDef<
  T extends EastType = EastType,
  Args extends readonly EastType[] = readonly EastType[],
> {
  readonly kind: 'mutation';
  readonly name: string;
  readonly record: RecordDef<T>;
  readonly body: EastIR<any, any> | AsyncEastIR<any, any>;  // fn.toIR(), as function.ts:86
  readonly argTypes: Args;                 // Expr.type(fn).inputs minus the state param
  readonly runner: Runner;                 // same Exclude<…,'custom'> policy as e3.function
}

export function mutation<Name extends string, T extends EastType, Args extends EastType[]>(
  name: Name,
  rec: RecordDef<T>,
  argTypes: [...Args],                     // only the EXTRA params — state type comes from rec
  body: ($: BlockBuilder, state: Expr<T>, ...args: ExprsOf<Args>) => Expr<T>,
  config?: { runner?: FunctionRunner },
): MutationDef<T, Args>;
```

The SDK builds `East.function([rec.type, ...argTypes], rec.type, body)`
internally — the record def is the single source of the state/return type,
following the same principle as task wiring (a `DatasetDef` carries its own
path and type; the author never restates them). An overload accepting a
prebuilt `FunctionExpr<[T, ...Args], T>` remains for reuse of existing East
functions.

> **As built.** `e3.mutation` ships *only* the prebuilt form —
> `mutation(name, rec, East.function([rec.type, ...args], rec.type, body), config?)`
> — matching how `e3.function` and `e3.task` already take a prebuilt
> `East.function`; the bespoke `argTypes` + body builder above would make
> `mutation` the only SDK primitive with its own body builder. A definition-time
> guard rejects a reducer whose first parameter or return type is not the record
> type, so even a dynamic / cast caller cannot register a mismatched reducer.

Usage:

```ts
const orders = e3.record('orders', OrdersType, new Map());

const placeOrder = e3.mutation('place_order', orders, [OrderType],
  ($, state, order) =>
    $.let(state.has(order.id).ifElse(
      $ => $.error(`duplicate order ${order.id}`),   // throw ⇒ abort, nothing committed
      $ => state.insert(order.id, order),
    )));

const pkg = e3.package('planning', '1.0.0', orders, placeOrder, plan, ui);
```

The body is **pure** (no platform IO): determinism is what makes
retry-on-conflict safe — the loop can re-run the reducer against fresher
state without observable side effects. Async platform-IO mutation bodies are
explicitly rejected in v1 (open question §13).

`package_()` (`packages/e3/src/package.ts`) branches on
`item.kind === 'mutation'` exactly as it does for `'function'`
(`e3-functions.md` §3 item 2): collect by name onto the owning record,
don't enter `contents`/`deps`. A mutation whose record is not also in the
package is a definition-time error.

## 6. Representation — refs, commits, versions

### 6.1 Ref shape: unchanged on the wire

A record's dataset ref is an ordinary
`variant('value', { hash: <stateHash>, versions })` — **`hash` points at the
plain state blob**, so task-input marshalling, `e3 get`, `datasetGet`,
`computeRootHash`, the UI `Data.bind` read path, and transfer all work on
records with **zero changes**. No new `DatasetRefType` variant (inserting a
tag would reorder the sorted variant encoding — a breaking wire change, per
the `e3-functions.md` ErrorType precedent).

### 6.2 Commit objects

```ts
// packages/e3-types/src/record.ts (new)
export const RecordCommitType = StructType({
  /** Previous commit hash; none for the genesis commit. */
  parent:   OptionType(StringType),
  /** Hash of the state blob this commit produced (== the ref's value.hash). */
  state:    StringType,
  /** Mutation name; "$init" for genesis, "$compact" for snapshot rewrites. */
  mutation: StringType,
  /** Hash of the beast2-encoded args tuple; none when args are empty. */
  args:     OptionType(StringType),
  /** Caller identity (auth principal / "cli:<user>"); best-effort string. */
  actor:    StringType,
  /** Commit wall-clock time. */
  at:       DateTimeType,
});
```

Commits are ordinary content-addressed objects. A typical commit is well
under 300 bytes — in the cloud that is below the 4 KB DynamoDB-inline
threshold, so the entire hot path of a small record never touches S3 (§10).

### 6.3 The commit hash *is* the version

The record ref's version vector self-entry carries the **commit hash**, not
the state hash:

```
versions = Map { ".records.orders" → <commitHash> }
```

`VersionVector` is `DictType(String, String)` — no wire change. Consequences:

- `snapshotInputVersions` / `detectInputChanges`
  (`dataset-refs.ts:137,174`) must prefer the self-entry over
  `ref.value.hash` when present (small code change, behavior identical for
  values). Change detection becomes commit-granular: a mutation that
  produces an identical state (e.g. a counter incremented and decremented)
  still has a distinct commit hash, so there is no ABA in either the CAS
  loop or the dataflow staleness check.
- Downstream version vectors propagate the commit hash unchanged through
  `mergeVersionVectors` — provenance from any derived dataset back to the
  exact record commit it was computed from, for free.
- This also finally populates the root self-entry the reactive-dataflow spec
  always wanted (`trees.ts:268` TODO); `workspaceSetDataset` should start
  writing `{selfKeypath: stateHash}` for values in the same PR.

### 6.4 Deploy

`workspaceDeploy` (`packages/e3-core/src/workspaces.ts:268`): for each
record path, write the genesis state object (from the package's initial
value ref), a `$init` commit, and the ref
`value{hash: stateHash, versions: {self: genesisCommitHash}}`. Re-deploying
a new package version onto a workspace with existing record state is an
open question (§13) — v1 keeps the existing state if the East type is
unchanged (commit `$deploy` marker), errors if it changed.

> **As built.** A kept (unchanged-type) record on redeploy has its prior head
> ref restored verbatim — state and full history are preserved — but **no
> `$deploy` marker commit is appended**, so a redeploy currently leaves no audit
> trace. The type-change rejection fires before any destructive write (the
> workspace is never left half-wiped).

## 7. Storage primitive: conditional ref write

One addition to `DatasetRefStore`
(`packages/e3-core/src/storage/interfaces.ts:664`), revision-token (etag)
based so it is generic — no record semantics leak into storage, and it also
serves plain values:

```ts
export interface DatasetRefStore {
  // existing read/write/list/remove/removeAll unchanged …

  /** Read a ref together with its opaque revision token. */
  readVersioned(repo: string, ws: string, path: string):
    Promise<{ ref: DatasetRef; revision: string } | null>;

  /**
   * Write a ref iff the stored revision still matches.
   * @param expectedRevision - token from readVersioned; null = "must not exist"
   * @throws {DatasetRefConflictError} on mismatch (new error in e3-core/src/errors.ts)
   */
  writeIf(repo: string, ws: string, path: string, ref: DatasetRef,
          expectedRevision: string | null): Promise<{ revision: string }>;
}
```

Implementations:

- **`LocalDatasetRefStore`** (`storage/local/LocalDatasetRefStore.ts`) —
  ref file format becomes `StructType({ revision: StringType, ref: DatasetRefType })`
  (BEAST2), revision a UUIDv7 minted per write; dual-decode bare old-format
  bytes as `revision: ''`. `writeIf` serializes per-path via the existing
  `LockService` (resource `"<ws>/data/<path>"`, exclusive, held for
  read-compare-rename only) — POSIX rename alone is atomic but not
  conditional. Plain `write` mints a fresh revision (unconditional,
  unchanged semantics).
- **In-memory** (`storage/in-memory`) — trivial map + counter.
- **Cloud** (`dynamo-dataset-ref-store.ts`, e3-cloud PR) — `revision`
  attribute on the `DREF` item; `writeIf` is a single `PutItem` with
  `ConditionExpression: 'revision = :expected'` (or
  `attribute_not_exists(PK)` for null). No lock, no transaction — this is
  DynamoDB's native primitive.

`workspaceSetDataset` migrates to `readVersioned` + `writeIf` with one
internal retry (re-read, re-write) so concurrent `e3 set` calls on the same
value can no longer silently drop a write.

## 8. Mutation execution (e3-core)

New module `packages/e3-core/src/records.ts`:

```ts
export interface MutationOutcome {
  outcome:
    | { kind: 'committed'; commitHash: string; stateHash: string }
    | { kind: 'aborted';  /* reducer threw */ diagnostics: Diagnostic[]; stderr: string }
    | { kind: 'conflict'; attempts: number }      // CAS retries exhausted
    | { kind: 'failed' | 'timed_out' | 'too_large'; … };  // as ExecuteResult
}

export async function recordMutate(
  storage: StorageBackend, runner: TaskRunner,
  repo: string, ws: string, recordPath: string, mutationName: string,
  args: Uint8Array[], opts: { actor: string; limits?: ExecuteLimits },
): Promise<MutationOutcome>;
```

> **As built.** The outcome is a flat union (no nested `outcome` field). A
> reducer that fails is **`failed`** (carrying `stderr`) — there is no separate
> `aborted` kind. A **`invalid`** kind was added for unknown record / unknown
> mutation / wrong arity, all rejected before any run. The full set is
> `committed | failed | invalid | conflict | timed_out | too_large`, named
> consistently end-to-end through `MutationResultType` (wire), the api-server
> switch, and the CLI.

Algorithm (shared workspace lock held throughout, like `workspaceSetDataset`
— deploy/remove are excluded, other mutations and dataflow are not):

```
for attempt in 1..MAX (default 5, jittered backoff):
  { ref, revision } = datasets.readVersioned(recordPath)        // ref.value.hash = state
  stateBytes        = objects.read(ref.value.hash)
  result = runner.runDetached({ bodyIr: mutation.bodyIr,
                                args: [stateBytes, ...argBytes], runner, limits })
  if result != success: return aborted/failed/timed_out/too_large  // nothing written
  newStateHash = objects.write(result.value)                    // invisible until referenced
  commitHash   = objects.write(encode(RecordCommit{ parent: prevCommit(ref),
                   state: newStateHash, mutation, args: argsHash, actor, at }))
  try:
    datasets.writeIf(recordPath,
      value{ hash: newStateHash, versions: { selfKeypath: commitHash } }, revision)
    return committed(commitHash, newStateHash)
  catch DatasetRefConflictError: continue                       // orphan objects → GC
return conflict(MAX)
```

Properties: a crash at any point leaves only unreferenced objects (GC
reclaims them) — never a torn record. A reducer `$.error` aborts cleanly.
Two concurrent mutations on one record serialize via the CAS; mutations on
*different* records never contend. The state travels to the runner as a
scratch file (`marshalBytesToDir`), so large states are not constrained by
the function-call inline-result cap — `maxResultBytes` for mutations bounds
the *new state* size and should default much higher than the 1 MB function
default (deployment-configurable; the state is persisted, not returned
inline — the HTTP response carries only the outcome + commit hash).

**Reactive integration: none needed.** A committed mutation changes a root
ref; `e3 start` / `e3 watch` / an in-flight dataflow run picks it up through
the existing `detectInputChanges` fixpoint loop. A per-record debounce
policy ("recompute at most every N seconds") is a v2 orchestrator option for
hot records (§13).

### 8.1 GC reachability (REQUIRED — same trap as `e3-functions.md` §4.1)

Today's mark would collect every commit older than the head, because commit
hashes live in the `versions` *string map*, which `extractChildren`
(`packages/e3-core/src/storage/local/gc.ts`) does not walk. Required:

- Workspace root scan: for each record ref, root the `versions` self-entry
  (the head commit hash) in addition to `value.hash`.
- `extractChildren`: add an `isRecordCommitShape` branch pushing `parent`
  (non-leaf — walks the chain), `state` (leaf), `args` (leaf).
- `PackageObject` branch: walk the new `records` map → `RecordObject` →
  per-mutation `MutationObject` → `bodyIr`, mirroring the functions fix.

History is therefore retained in full until **compaction**: a
`recordCompact` operation that writes a `$compact` commit with
`parent: none` (optionally embedding a summary of dropped history) and swings
the ref; the old chain becomes garbage. Exposed as `e3 record compact` and a
retention policy later — v1 ships the GC marking plus the compaction
primitive, no automatic policy.

## 9. Wire format, API, CLI, UI

### 9.1 Package format (e3-types)

```ts
// packages/e3-types/src/record.ts
export const MutationObjectType = StructType({   // FunctionObjectType minus outputType,
  bodyIr:   StringType,                          // plus nothing — output type IS the record type
  argTypes: ArrayType(EastTypeType),
  runner:   RunnerType,
});
export const RecordObjectType = StructType({
  /** refPath of the record's dataset, e.g. "records/orders". */
  path:      StringType,
  /** Mutations by name -> MutationObject hash. */
  mutations: DictType(StringType, StringType),
});

// packages/e3-types/src/package.ts — appended LAST (BEAST2 positional):
export const PackageObjectType = StructType({
  tasks:     DictType(StringType, StringType),
  data:      PackageDataType,
  functions: DictType(StringType, StringType),
  records:   DictType(StringType, StringType),   // name -> RecordObject hash (NEW)
});
```

`decodePackageObject` gains a third dual-decode tier (current → functions-era
→ legacy), defaulting `records` to empty. Record initial values ride the
existing `data.refs` mechanism; the genesis commit is minted at deploy
(§6.4).

### 9.2 HTTP API (e3-api-server / e3-api-client)

Mounted beside the function routes (`e3-functions.md` §7.1), workspace-scoped
only (mutations need live state — there is no package-scoped form):

```
GET    /api/repos/:repo/workspaces/:ws/records                          → list (path, type, head commit)
GET    /api/repos/:repo/workspaces/:ws/records/:rec                     → head: {commitHash, stateHash, …meta}
GET    /api/repos/:repo/workspaces/:ws/records/:rec/history?from&limit  → page of commits (walk parents)
POST   /api/repos/:repo/workspaces/:ws/records/:rec/mutations/:mut      → sync mutate  (MutationOutcome)
POST   …/mutations/:mut/async  + /calls/:callId                         → launch/poll/cancel, reusing
                                                                          function-call-state.ts verbatim
POST   /api/repos/:repo/workspaces/:ws/records/:rec/compact             → elevated role
```

Request body reuses `FunctionCallRequestType` (positional beast2 args;
`runner` override subject to the same `custom`-rejection policy). Reads of
record *state* need no new routes — `datasetGet` already serves them.

> **As built.** v1 ships the synchronous routes: `GET /:rec` (the record's
> mutation **signatures**, for argument encoding — not the `{commitHash,
> stateHash}` head), `GET /:rec/history?from&limit`, `POST /:rec/mutations/:mut`
> (sync), and `POST /:rec/compact`. **Deferred:** the `GET /records` *list*
> route, a dedicated head route (the head is reachable via `history?limit=1`),
> and the **async** mutate routes (`/async` + `/calls/:callId`) — the
> `function-call-state.ts` infrastructure they reuse is not yet on this branch,
> so mutations are sync-only for now. Record state remains readable via
> `datasetGet` (`e3 get .records.<rec>`).

### 9.3 CLI

```bash
e3 mutate  <repo> -w <ws> <record>.<mutation> [args...]   # literals/.beast2/.json, as `e3 call`
e3 history <repo> -w <ws> <record> [--limit N]            # commit log: hash, mutation, actor, at
e3 get     <repo> -w <ws> .records.<record>               # works today, unchanged
e3 set     …      .records.<record>                       # REJECTED (writable: false)
```

### 9.4 e3-ui

`Data.bind` **read** works on records unchanged (state is a plain dataset).
`Data.bind(...).write` is rejected server-side for record paths; the UI
write path for records is a mutation call over the function-call transport —
i.e. the `Func.bind` reactive RPC binding being built in
`east-ui/packages/e3-ui-components` right now is the client primitive: bind
`records.orders.place_order`, call it with args, and the data cache
invalidates the record's dataset read on `committed`. A `Record.bind` sugar
(read + mutations + history in one struct) is a follow-on in the e3-ui repo.

**Def-passing bindings (implemented in e3-ui).** The bind surfaces take the
SDK def itself — the single supported form, mirroring task wiring; there is
no path/explicit-signature variant:

```ts
Data.bind(threshold)        // DatasetDef<T> | TaskDef<T> → path + T from the def
Func.bind(forecast)         // FunctionDef<I, O>          → name + I + O from the def
Record.bind(orders)         // RecordDef<T> (this design) → read(T) + per-mutation call handles
//   mutations resolve from orders.mutations: argTypes/name per MutationDef
```

This satisfies the manifest-derivation literal-name constraint
(`e3-ui/src/derive.ts` requires a statically-known name) because `def.name`
is a static JS string at IR-build time, and makes every binding correct by
construction — it cannot drift from the deployed signature.

## 10. e3-cloud mapping

Where records live — and explicitly **not** "in S3" in any database sense:

| Piece | Store | Latency (typical) | Notes |
|---|---|---|---|
| Record ref + revision (the contended truth) | DynamoDB `DREF` item | 5–15 ms consistent read; ~10 ms conditional put | CAS = native `ConditionExpression`; strongly consistent |
| Commit objects (~300 B) | DynamoDB-inlined object (≤4 KB rule, `OBJ` catalogue) | ~10 ms | hot path never touches S3 |
| Small states (≤4 KB) | DynamoDB-inlined object | ~10 ms | counters/workflow records are pure-DynamoDB |
| Large states | S3 (immutable, content-addressed) | 20–80 ms GET/PUT | latency cost only — never a consistency risk: blobs are write-once, visibility is the DynamoDB ref swing |
| Reducer execution | Lambda (the cloud function-call kernel from `e3-functions-cloud.md`) | ms–s, body-dependent | runs where the data is |
| Multi-record commit (v2) | DynamoDB `TransactWriteItems` | ~20 ms | ≤100 items; pattern proven by `executionWrite` |

End-to-end mutation on a small record: **~30–60 ms** plus reducer time. On a
large (multi-MB) state: dominated by one S3 GET + one S3 PUT + reduce, i.e.
hundreds of ms — acceptable for human-driven writes; high-frequency writers
should keep records small (that is also what keeps dataflow invalidation
cheap). Durability/risk: DynamoDB and S3 are both 99.999999999%-durable;
the failure mode of every crash window is orphaned immutable objects, which
GC already handles (and `lastReferencedAt` already protects in-flight
objects from the concurrent GC race, per `gc-concurrent.md`).

Two pre-existing cloud hazards become more important once humans write
continuously and should land with (or before) the cloud PR:

1. **Workspace-lock TTL (300 s) vs 24 h dataflow timeout**
   (`e3-cloud/design/scheduled-execution.md`) — the renewal-heartbeat fix.
2. Mutation Lambdas must use the **shared**-mode workspace lock (as `e3 set`
   does) so they coexist with running dataflows but are excluded by deploys.

## 11. Staging

1. **PR-1 (e3): conditional ref writes.** `readVersioned`/`writeIf` +
   local/in-memory impls + `workspaceSetDataset` retry + root self-entry
   versioning for values. Independently valuable (fixes `e3 set` lost
   updates). Small.
2. ~~**PR-2 (e3): `e3.value` rename.**~~ Dropped — the rename was considered
   and rejected (§5.1); `e3.input` is kept unchanged. No wire change either way.
3. **PR-3 (e3): records + mutations.** e3-types (`RecordCommitType`,
   `RecordObjectType`, `MutationObjectType`, package field + dual-decode),
   SDK (`record`, `mutation`, `package_` branch, export writer), e3-core
   (`recordMutate`, deploy genesis, GC marking, compaction primitive),
   api-server/client routes, `e3 mutate`/`e3 history`, api-tests suites.
   Definition of done: `cd libs/e3 && make build && make lint && make test`.
4. **PR-4 (e3-cloud): DynamoDB CAS + mutation Lambda** consuming the
   published packages; companion design doc; lock-TTL heartbeat.
5. **PR-5 (e3-ui): `Record.bind`** on the Func.bind runtime; record-aware
   cache invalidation.
6. **v2 candidates:** multi-record transactional mutations
   (`TransactWriteItems` / store-level lock), history-as-task-input
   (`.records.orders@history` reserved path), declarative task→record sync
   rules (orchestrator-applied, idempotent by output hash, cycle-checked),
   per-record reactive debounce, retention/auto-compaction, chunked
   (prolly-tree) state for partial read/write of large records.

## 12. Test plan (PR-3 highlights)

1. CAS: two concurrent `writeIf` on one path — exactly one wins; loser gets
   `DatasetRefConflictError`; old-format ref files still read (dual-decode).
2. SDK/export round-trip: record + mutations → bundle → `RecordObject` /
   `MutationObject` correct; pre-records bundle still decodes.
3. Deploy writes genesis `$init` commit; record readable via `e3 get`.
4. Mutation commit: state object + commit object + ref swing; parent chain
   correct; `actor`/`at` populated; version vector self-entry = commit hash.
5. Reducer throw ⇒ `aborted`, repo byte-identical (no objects rooted).
6. N concurrent mutations on one record ⇒ all N commits present in the
   chain, final state = serial application (the counter test: N increments
   ⇒ value N — the test that fails today with `e3 set`).
7. `e3 set` on a record path rejected (`writable: false`).
8. Record as task input: mutation triggers reactive re-execution; derived
   version vector carries the commit hash; diamond-consistency conflict
   detected across two commits.
9. GC survival: full chain + mutation bodies survive `gc`; after compact,
   pre-compact commits are collected, head survives.
10. History pagination over >1 page of commits.
11. Shared-suite (`e3-api-tests`) coverage so e3-cloud inherits the
    compliance tests.

## 13. Open questions

- **Async/platform-IO mutation bodies** — v1 rejects (purity = safe retry).
  Allowing IO would require idempotency keys per attempt. Defer.
- **Redeploy onto live record state** — keep-if-type-unchanged (proposed) vs
  always-reset vs explicit migration mutations (`$migrate`).
- **Mutation return values** — v1: reducers return only the new state.
  A `(state, args) => {state, result}` shape would let a mutation answer the
  caller (e.g. the allocated order number) — probably wanted soon; decide
  before the wire types freeze.
- ~~**`.values` vs `.inputs` path** for `e3.value`~~ — resolved: the
  `e3.value` rename was rejected, `e3.input`/`.inputs` is kept (§5.1).
- **Multi-record mutation argument order / deadlock-freedom** for v2
  (sort record paths before TransactWriteItems; local store-level lock).
- **History exposure to tasks** — reserved `@history` path vs a
  `Platform.recordHistory` function vs nothing.
- **Actor identity** — what string the local CLI writes (`cli:$USER`?) and
  how the cloud principal maps in; needed for the audit story to be real.
