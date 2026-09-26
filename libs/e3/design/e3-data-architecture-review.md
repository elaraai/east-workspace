# e3 data and execution — architecture review

Status: reading pass complete, 2026-09-23. The notes below were written as
each file was read; the patterns, the re-assessment of #790, the strategy and
the decisions at the end are drawn only from what the notes record. The
decisions were taken the same day. They, the target architecture and the plan
are in [`e3-data-architecture.md`](./e3-data-architecture.md), for which this
review is the evidence.

Base: branch `elaraai/feat/records-segment-layout` at `e82f6d10` (PR #786),
plus the #790 design commit `89477b77` (PR #796, since closed). The per-element
aliasing change written for #791 was uncommitted at the time; it is noted where
it matters and is otherwise out of scope.

## Summary

The e3 data and execution layer grew through a run of epics. Each was correct
on its own terms, and each added a mode, a contract or a copy rather than
changing the shape underneath. The code is careful: failure attribution,
crash repair, determinism and cross-runtime byte identity are all handled
rigorously. But no single place holds the rules, so every rule has to be
re-established at every door into the store, in every runtime, and in every
consumer. The 42 findings below reduce to five structural problems.

1. **Collections have no single stored form and no single door.** Nine
   paths write collection values into the store, each with different rules
   (F20). Readers therefore handle both manifests and blobs (F16), and the
   fallbacks for the non-canonical cases decode the whole value (F21).
   Canonical bytes are guaranteed only for some keyed values, written
   through some doors (F3, F6, F12).
2. **The task model ties bounded output to a single sequential
   execution.** A body either returns its result (parallel, unbounded) or
   emits it (bounded, sequential, keys in order) (F15, F31). The rule that
   emitted keys must ascend pushed sorting into every producer (F38). That
   is the direct cause of the 150 GB report. Pool width, count-bounded
   segments and tmpfs scratch multiply it (F2, F28, F33).
3. **Fan-out has two interpreters, and neither is visible to the scheduler
   or the cloud.** A partitioned task runs a private template interpreter
   inside one task execution. Record operations re-implement that
   interpreter by hand (F1, F2, F26). The cloud runs neither (F2, F4).
4. **Every primitive exists several times, held together only by tests.**
   This covers cut rules, emit sinks, merges, splice and carve, CLI surfaces
   and argv builders (F5, F10, F22, F29, F32). The re-cut #791 set out to
   build already exists privately in e3-core (F24). The wire spec specifies
   none of the collection-layer rules (F7, F27).
5. **Contracts and docs are not typed or maintained as sources of truth.**
   - Modes are encoded as optional fields and strings, and outcomes as
     message prefixes (F8).
   - GC recognises objects by the names of their fields (F36).
   - Each migration is chosen case by case (F9, F35).
   - Docs accrete superseded text, contradicting each other and the code
     (F18, F39, F40, F41, F42).

The timeline shows what this costs. Sorting in the emit sink was added
(#519, 2026-08-08), then removed (#770, 2026-09-21), and was about to come
back in another form (#790, 2026-09-23).

The recommendation:
- **Stop adding.** Consolidate first: one stored form, one door, one fan-out
  interpreter, one specification.
- **Then build bounded outputs on top**, as a smaller change than #790 as
  written.

## Why this review

A run of epics has each added machinery to the same few paths — partitioned
tasks and their templates (#770), stream tasks and emit sinks (#512, #519),
fold flags and the blob merge, records and their secondary indexes (#779),
segment manifests, the content-defined cut, path-initialised inputs (#768),
lazy paged inputs (#657), frozen inputs (#539), the jobs budget and the stdin
lifeline — and a further epic (#790) was about to add more. The concern is
drift: the same concept implemented several times and diverging, contracts
stated in one place and contradicted in another, and features whose places
in the whole were never decided. This review reads the code as it stands and
asks what the architecture actually is, where it has drifted, and what a
deliberate strategy for it would be.

## Method

- Every file named in the reading log was read in full.
- Findings carry an id (`F<n>`), a kind, and evidence as `path:line`.
  Kinds: **dup** (one concept implemented more than once), **drift** (copies
  that disagree), **contract** (a stated invariant the code does not hold, or
  two statements that disagree), **gap** (a capability the design assumes and
  the code lacks), **dead** (code or options nothing needs), **doc** (docs or
  comments that misdescribe the code), **risk** (works today, fragile by
  construction), **bug** (wrong behaviour).
- Paths are relative to the repo root unless they start with `e3-cloud/`
  (the separate closed-source repo, read at `0219937`).

## Reading log

| Layer | File | Lines |
|---|---|---|
| execution | `libs/e3/packages/e3-core/src/execution/steps.ts` | 1070 |
| execution | `libs/e3/packages/e3-core/src/execution/recordSteps.ts` | 316 |
| execution | `libs/e3/packages/e3-core/src/execution/LocalTaskRunner.ts` | 811 |
| dataflow | `libs/e3/packages/e3-core/src/dataflow/steps.ts` | 1004 |
| runners | `libs/east-node/packages/east-node-cli/src/merge.ts` | 387 |
| runners | `libs/east-node/packages/east-node-cli/src/emit-writer.ts` | 187 |
| runners | `libs/east-c/packages/east-c/src/merge.c`, `include/east/merge.h` | 764 |
| beast2 | `libs/east/src/serialization/beast2/v5/stream.ts` | 1373 |
| beast2 | `libs/east/src/serialization/beast2/v5/SPEC.md` | 344 |
| cloud | `e3-cloud/packages/e3-cloud-core/src/steps/execute-task.ts` | 442 |
| cloud | `e3-cloud/packages/e3-cloud-core/src/steps/orchestrate-dataflow.ts` | 211 |
| contracts | `libs/e3/packages/e3-types/src/task.ts` | 571 |
| contracts | `libs/e3/packages/e3-types/src/stream.ts` | 170 |
| contracts | `libs/e3/packages/e3-types/src/runner.ts` | 143 |
| contracts | `libs/e3/packages/e3-types/src/dataset-blob.ts` | 189 |
| contracts | `libs/e3/packages/e3-types/src/collection-manifest.ts` | 53 |
| contracts | `libs/e3/packages/e3-types/src/execution.ts` | 117 |
| contracts | `libs/e3/packages/e3-types/src/dataset-ref.ts` | 91 |
| contracts | `libs/e3/packages/e3-types/src/record.ts` | 509 |
| contracts | `libs/e3/packages/e3-types/src/dataset.ts` | 126 |
| contracts | `libs/e3/packages/e3-types/src/dataset-type.ts` | 134 |
| sdk | `libs/e3/packages/e3/src/task.ts` | 1007 |
| execution | `libs/e3/packages/e3-core/src/execution/partitionExec.ts` | 752 |
| execution | `libs/e3/packages/e3-core/src/execution/partitionIo.ts` | 567 |
| storage | `libs/e3/packages/e3-core/src/dataset-open.ts` | 599 |
| storage | `libs/e3/packages/e3-core/src/dataset-adopt.ts` | 292 |
| execution | `libs/e3/packages/e3-core/src/execution/processExec.ts` | 877 |
| storage | `libs/e3/packages/e3-core/src/trees.ts` | 983 |
| storage | `libs/e3/packages/e3-core/src/dataset-refs.ts` | 405 |
| records | `libs/e3/packages/e3-core/src/records.ts` | 1149 |
| records | `libs/e3/packages/e3-core/src/record-apply.ts` | 375 |
| beast2 | `libs/east/src/serialization/beast2/v5/boundary.ts` | 347 |
| beast2 | `libs/east/src/serialization/beast2/v5/manifest.ts` | 283 |
| beast2 | `libs/east/src/serialization/beast2/v5/geometry.ts` | 368 |
| beast2 | `libs/east/src/serialization/beast2/v5/frames.ts` | 370 |
| beast2 | `libs/east/src/serialization/beast2/v5/deflate.ts` | 268 |
| beast2 | `libs/east/src/serialization/beast2/v5/range.ts` | 400 |
| beast2 | `libs/east/src/serialization/beast2/v5/lazy.ts` | 642 |
| beast2 | `libs/east/src/serialization/beast2/v5/codec.ts` | 1208 |
| runners | `libs/east-node/packages/east-node-cli/src/runner.ts` | 512 |
| runners | `libs/east-node/packages/east-node-cli/src/loader.ts` | 633 |
| runners | `libs/east-c/packages/east-c/src/emit_sink.c`, `emit_writer.c`, `emit_writer.h` | 517 |
| runners | `libs/east-c/packages/east-c-cli/src/main.c` | 1882 |
| runners | `libs/east-py/packages/east-py-cli/east_py_cli/runner.py` | 437 |
| execution | `libs/e3/packages/e3-core/src/execution/jobs.ts` | 209 |
| execution | `libs/e3/packages/e3-core/src/execution/scratch.ts` | 141 |
| execution | `libs/e3/packages/e3-core/src/execution/interfaces.ts` | 335 |
| dataflow | `libs/e3/packages/e3-core/src/dataflow/orchestrator/LocalOrchestrator.ts` | 1252 |
| storage | `libs/e3/packages/e3-core/src/storage/interfaces.ts` | 912 |
| storage | `libs/e3/packages/e3-core/src/storage/local/gc.ts` | 1100 |
| sdk | `libs/e3/packages/e3/src/export.ts` | 527 |
| sdk | `libs/e3/packages/e3/src/record-programs.ts` | 514 |
| design | `libs/e3/design/e3-execution.md` | 524 |
| design | `libs/e3/design/e3-records-storage.md` | 261 |
| design | `libs/e3/design/e3-emitted-outputs.md` (#790, mine) | 193 |

Not read (noted so the gaps are visible): `e3-records-schema.md` (126 KB, the
#779 spec — its behaviour was read in the code instead), `dataflow.ts`,
`workspaces.ts`, `packages.ts`, the local object/ref store implementations,
east-c's `stream.c`/`container.c`/`merge.c` beyond the parts already read,
east-py's `beast2.py`, and e3-cloud beyond its execution, orchestration and GC
entry points.

## Architecture as built

### Two step machines

There are two unrelated things called "steps".

**Dataflow steps** (`e3-core/src/dataflow/steps.ts`) are the run-level state
machine: `stepInitialize` → `stepGetReady` → `stepPrepareTask` (resolve
inputs, probe the cache, check the workspace output matches) →
`stepTaskStarted` / `stepTaskCompleted` / `stepTaskFailed` /
`stepTasksSkipped` → `stepFinalize`, plus `stepYield`, `stepCancel` and the
reactive trio (`stepDetectInputChanges`, `stepInvalidateTasks`,
`stepCheckVersionConsistency`). They are pure or idempotent functions over a
persisted `DataflowExecutionState`, written so that each can be a Lambda
invocation (file header, `:6-21`). The unit they schedule is always a whole
task. Local: `LocalOrchestrator` loops over them. Cloud: the `waves` engine
calls them from separate Lambdas, and the `loop` engine runs
`LocalOrchestrator` itself inside a Lambda that yields before its lifetime
cap and is re-invoked by a Step Functions shell
(`e3-cloud/.../orchestrate-dataflow.ts:1-37`).

**Task template steps** (`e3-core/src/execution/steps.ts`) are what a
partitioned task is below the dataflow: `plan` → `map` → `reduce` → `splice`,
interpreted by `executeTemplate` inside ONE task execution. `taskExecute`
dispatches to it when `task.kind` is `partition` (`LocalTaskRunner.ts:233`).
Three templates are hard-coded and chosen from the task's metadata
(`steps.ts:444-485`): splice `[plan, map, splice]`, combine `[plan, map,
reduce(fanIn 2, all)]`, merge `[plan, map, reduce(fanIn 32, ranges),
splice]`. Every unit is an ordinary content-addressed execution, probed in
the execution cache and run on a miss (`:681-687`); a previous run's plan is
read back from a `plan` sidecar so its carved slices are reused (`:769-780`).
The pool that runs units is the interpreter's own: as wide as
`partitionConcurrency ?? jobs.capacity ?? 4` (`:692`).

### What a task execution does with its output

`taskExecuteBody` adopts the runner's output file verbatim —
`adoptOutputFile` hashes it by streaming and links it into the store
(`LocalTaskRunner.ts:572`). Whatever segmentation the runner chose is the
stored form. A partitioned task's output is the splice of its partials
(`steps.ts:986-1016`), also stored as spliced.

### The task object and its kinds (e3-types)

A `TaskObject` is `{commandIr, inputs, output, kind, metadata, runner,
environment}` (`task.ts:58-85`). `kind` is an optional string and `metadata`
an opaque blob "interpreted by the kind-specific consumer" (`:65-68`). Kinds
in use: `partition`, `stream`, `merge` (a synthesized merge unit), plus `ui`
and the default data task. The command IR is the whole execution contract:
`(input_paths, output_path) -> argv`.

- **Partition metadata** (`task.ts:168-206`): `partitions` (count of
  partitioned inputs after the function IR), `by` (a projection IR bundle),
  `combine` (a fold IR), `targetPartitionBytes`, `merge` (a per-key fold IR),
  `mergeSets` (bool), `mergeCommand` (a command IR bundle). The ASSEMBLY MODE
  is not a field: it is implied by which options are set, with precedence
  applied in `steps.ts:444-485` (merge/mergeSets, then combine, then splice).
- **Stream metadata** (`task.ts:279-295`): `stream` (bool), `emit`
  (`"array" | "set" | "dict"` as a string), `merge`
  (`"none" | "function" | "union"` as a string).
- **Commands** (`e3-types/src/stream.ts`): `streamCommandIr` builds
  `<runner> run --emit K [--merge P | --union] [--stream 0] -i… -o O <body>`;
  `mergeCommandIr` builds `<runner> merge [--merge P | --union] --range R -i…
  -o O`. These flags ARE the runner CLI contract, implemented three times.
- **Runner capabilities** (`runner.ts:95-97`): only `east_node` opens a staged
  manifest; `east_c` and `east_py` inputs are spliced into one blob when
  staged.

### How a collection dataset is stored (e3-types)

`encodeDatasetBlob` (`dataset-blob.ts:103-116`) is "the ONE encoder": a
collection root is encoded with `encodeBeast2PagedFor` (default options →
the content-defined cut for Set/Dict) and, given a sink, cut into segment
objects plus a manifest by `cutDatasetBlob`. `cutDatasetBlob`
(`:141-189`) takes a WHOLE blob in memory; for a keyed root it checks
`isContentCut` over the fences and counts and, if the blob was cut any other
way, DECODES THE WHOLE VALUE AND RE-ENCODES IT (`:157-165`). An Array root
is adopted as its writer cut it (`:132-133`, `:150-152`). The manifest
(`{kind, level: 0, type, rule, header, entries[{hash, fence, count,
bytes}]}`) is defined in `east` and re-exported (`collection-manifest.ts`).

### Records (e3-types)

A record commit is `{parent, state, mutation, args, actor, at, delta}`
(`record.ts:36-58`). A record with secondary indexes stores a `$record`
state object naming the primary's manifest and each index's
(`:317-331`); one without keeps a plain manifest, and "the door that
resolves a record's state accepts either" (`:311-315`). Mutations come in
three forms, `reduce | edit | patch`, as a string (`:159`). An index object
carries a `mergeIr` that "never runs — but the runner's merge command takes
one whatever the data" (`:231-235`).

### What an author can declare (SDK)

Four constructors (`e3/src/task.ts`):

- `task` (`:175-262`) — `fn` RETURNS the output value; the runner encodes it
  whole at exit.
- `customTask` (`:264-308`) — a bash command; e3 knows nothing of its I/O.
- `partitionTask` (`:516-770`) — `fn` runs once per partition and RETURNS the
  partition's shard (splice), partial (combine), or keyed partial (merge).
  Assembly by splice (keyed shards must ascend disjointly — "enforced at
  SPLICE TIME", `:474-483`), by `combine: (Out, Out) -> Out`, or by `merge:
  (K, V, V) -> V | 'union'`. `targetPartitionBytes` (default 256 MiB,
  `:451-452`) sizes the INPUT slices; nothing sizes a unit's output.
  Implemented by calling `task` with `kind: partition` and the metadata
  (`:759-769`).
- `streamTask` (`:902-1007`) — one execution; `fn` EMITS through a runner
  capability; an optional `stream` input is fed lazily. A Set/Dict output
  MUST be emitted in ascending key order, and `merge` folds only ADJACENT
  equal keys (`:797-823`). The doc sends the unsorted case elsewhere: "A
  re-key whose output keys do not arrive in order is a `partitionTask` with
  `merge`" (`:859-860`) — i.e. to the mode whose units return whole partials.
  Builds its own `TaskDef` rather than going through `task` (`:965-1006`).

The two big-data constructors split the problem along the wrong axis: emit
(bounded output) comes only with one execution and sorted keys; parallelism
and unsorted keys come only with returned (unbounded) outputs.

### Partition planning, carving and splicing

- `planPartitions` (`partitionExec.ts:123-342`) packs the primary's segments
  greedily by byte size into partitions (`:186-199`), so partition
  boundaries fall on the input's own segment boundaries; `by` alignment
  decodes boundary segments (`:201-234`); co-partitioned secondaries get
  split points by fence search (`:247-329`).
- `carvePartitionSlices` (`:515-543`) writes each partition's slice as a NEW
  stored blob: the primary's segments by byte copy, a secondary's two edge
  segments re-encoded (`:667-710`). A partitioned input is therefore stored
  twice — once as itself, once as its slices.
- `spliceBlobs` (`:614-631`) checks keyed shards ascend disjointly
  (`:723-752`), then streams their frames under the first header with a
  rebuilt index.
- `PartitionBlob.open` (`partitionIo.ts:159-174`) presents a manifest-stored
  input as the blob its segments would splice to — a virtual layout built by
  reading every segment object's tail (`:364-457`) — so that "a slice carved
  here is the slice carved from the spliced value, hash for hash"
  (`:147-151`). The carve over a manifest therefore COPIES segment objects
  into a slice blob; nothing in the partition path is manifest-native.

### Reading and adopting stored collections (e3-core)

- **`openDatasetObject`** (`dataset-open.ts:427-461`) reads a 64 KiB head,
  recognises a manifest or a `$record` state by the exact field set of its
  root type, and follows a `$record` state to its primary.
- **`DatasetSegments`** (`:79-341`) is the reader over BOTH backings — a
  manifest naming segment objects, or a bare segmented blob through ranged
  reads — with `fence`, `segmentFor`, `segment`, `span` and a streaming
  `splice`.
- **`cutDatasetObject(hash)`** (`:502-537`) is the door for a blob already
  in the store (a unit's output, a spliced merge). A keyed blob cut by the
  content rule is carved by ranged reads into a manifest; one cut any other
  way goes through `readDatasetWhole` (`:582-599`, which concatenates the
  whole value in memory) and `cutDatasetIntoStore` → `cutDatasetBlob`, which
  decodes the whole value and re-encodes it.
- **`adoptDatasetBlob(bytes)`** (`:556-567`) — "a mutation reducer's
  output, a migrated state" — cuts an indexed collection and stores anything
  else as it is, INCLUDING a collection blob with no index (`:548-550`).
- **`datasetAdoptFile` / `objectAdoptFile`** (`dataset-adopt.ts:99-199`, the
  path-initialised input of #765/#768) stream-hash an external file and link
  it into the store as it is: the dataset's content address is the delivered
  bytes, in whatever segmentation and codec the supplier wrote. Type is
  checked at the door (`:175-185`); nothing is cut.
- **`marshalInputsToDir`** (`processExec.ts:141-221`) stages a manifest as
  the manifest plus linked segment files for east-node, and splices it into
  one file (streamed, O(value) disk) for east-c and east-py.
- **`adoptOutputFile`** (`processExec.ts:237-245`) links or streams a
  runner's output into the store, uninspected.

### Workspace datasets (e3-core `trees.ts`, `dataset-refs.ts`)

- A workspace holds one ref file per dataset (`DatasetRef`); packages and
  the root-hash computation still use TREE objects (`DataRef` structs,
  `trees.ts:92-124`). `computeRootHash` rebuilds tree objects from the refs
  "for compatibility with existing code that expects a root hash (e.g.
  DataflowRun snapshots, workspace export)" (`dataset-refs.ts:206-226`), and
  deploy has two paths — `writeRefsFromTree` for tree packages and
  `writeRefsFromPackage` for inline refs (`:299-405`).
- `workspaceSetDataset` (`trees.ts:289-366`): type check, `datasetWrite`
  (manifest), CAS ref write with retries.
- `workspaceSetDatasetByHash` (`:571-587`) — what task outputs go through —
  takes no lock, checks no type, and writes the ref blindly (`write`, not
  `writeIf`); the caller "must hold a lock".
- `datasetRead` (`:140-148`), behind `e3 get`, reads and decodes the whole
  value (`readDatasetWhole`).

### Records (e3-core)

Records are a second execution world beside tasks:

- **Mutations** run through `runDetached` — the graph-free kernel, outside
  the execution cache — in a CAS loop with jittered backoff, an idempotency
  key in a reserved `$idem` version-vector slot, and a hard budget
  (`records.ts:327-437`).
- **Two write protocols**: `writeWholeState` (run the reducer, adopt its whole
  output, then REBUILD EVERY INDEX with a full record operation —
  `:506-529`) and `writeDelta` (run the program, which emits a delta; apply it
  — `:546-607`). A `patch` on an unindexed record skips the run entirely
  (`:558-560`, `:625-656`).
- **The state reaches the program by copy**: `stateArg` streams a manifest
  primary's whole splice into the runner's argument file (`:312-316`), so
  every delta mutation writes the whole record to scratch — the code says so:
  "Writing that file still streams every segment through this process …
  until a runner opens a record's segments itself" (`:562-566`).
- **The delta is applied in e3-core's own process**: `applyDelta`
  (`record-apply.ts:91-108`) decodes each touched run of segments, applies
  the ops with `applyFor`, re-encodes, and grows the run until the re-cut
  agrees with the old cut at both ends (`:215-292`, `endsClean` at
  `:329-338`).
- **Index builds** go through `executeRecordOperation` (F1); deploy
  reconciles indexes against the package and appends `$reindex` commits
  (`records.ts:852-932`).
- A program's "stale write" is recognised by scanning its stderr for
  `STALE_WRITE_PREFIX` (`:582-587`).

### The beast2 v5 collection layer (east)

The primitives everything above is built from, all in `libs/east/src/
serialization/beast2/v5/`:

- **Container** (`codec.ts`, `SPEC.md`): header · tag frame · segment frames
  · terminator · index · footer. Set/Dict content must be strictly ascending
  across the whole stream; decoders validate and refuse (`codec.ts:521-587`).
  The index has one flag bit, `self_contained`, and readers REFUSE unknown
  flag bits (`codec.ts:950-953`, `range.ts:247-250`), so no flag can be added
  without breaking every shipped reader.
- **Encoders**: the whole-value encoder (`encodeBeast2V5For`) writes ONE
  segment for an indexed collection, however large (`codec.ts:806-826`); the
  paged encoder (`encodeBeast2PagedFor`) cuts by the content rule or
  positionally (F6); the streaming `Beast2Writer` writes one segment per
  `write` (`stream.ts:275-315`).
- **Compression** (`frames.ts`, `deflate.ts`): an in-house deterministic
  DEFLATE (fixed Huffman, pinned match finder) implemented identically in TS
  and east-c; inflate uses zlib or a pure-TS fallback.
- **Cut rules** (`boundary.ts`): content-defined for Set/Dict (FNV-1a of the
  canonical bare key bytes, 256/1024/4096 element bounds, rule id stamped in
  manifests); positional for Array (`pos/1000-2MiB/1`). `isContentCut` checks
  a blob's fences and counts — necessary, not sufficient (`:315-347`).
- **Manifest** (`manifest.ts`): `{kind: "$segments", level, type, rule,
  header, entries[{hash, fence, count, bytes}]}`, recognised by its exact
  field set; `level` reserves nesting that nothing implements.
- **Geometry** (`geometry.ts`, `range.ts`): carve and splice by byte copy,
  `rebuildBeast2` (re-encode batches under an existing header), ranged extents
  from two reads (tail, head), sync and async reader shapes.
- **Readers** (`stream.ts`, `lazy.ts`): `Beast2Pages` over a blob, a range
  reader or a manifest; lazy `SortedMap`/`SortedSet`/array values that serve
  size, keyed reads and iteration from the pager and HYDRATE (whole decode)
  on any other operation (`lazy.ts:21-30`).

### The runners' two output paths

All three runners have the same two ways to produce an output file:

- **Return** (`task`, and every `partitionTask` unit): the body's result
  value is held decoded, then encoded WHOLE into one buffer and written —
  east-node `writeOutput` (`runner.ts:482-512`: `encodeBeast2PagedFor(type)
  (value)` → `writeFileSync`), east-c `save_value` (`main.c:378-434`:
  `east_beast2_encode_paged` → `write_file_binary`), east-py `save_value`
  (`runner.py:340-341`). Peak memory is the decoded value plus the whole
  encoded output (east-node's paged encoder also holds its chunk list beside
  the concatenated result, `stream.ts:598-618`, `:683-689`).
- **Emit** (`streamTask`, record index and delta programs): a sink streams
  segments to the file with one open batch — east-node `createEmitSink` over
  `EmitFileWriter` (`runner.ts:363-432`), east-c `emit_sink.c` over
  `emit_writer.c`, east-py binding east-c's sink (`runner.py:96-167`). Set/Dict
  emissions must ascend; the sink folds ADJACENT equal keys only.

Inputs: a lazy paged value at or above 64 MiB or when `--stream`ed, else read
whole and decoded (east-node `runner.ts:202-214`, east-c `main.c:331-376`,
east-py `runner.py:285-311`); only east-node reads a staged manifest
(`loader.ts:463-487`).

### Scheduling (local)

`LocalOrchestrator.runExecutionLoop` (`LocalOrchestrator.ts:493-1031`)
launches ready tasks up to `state.concurrency` (default 4 locally,
`dataflow/steps.ts:100`; 16 in the cloud `loop` engine,
`orchestrate-dataflow.ts:84`), probes the cache, runs the task through
`options.runner` or `taskExecute`, and applies the output with a blind ref
write under the dataflow lock. Three knobs bound concurrency, at three
levels, and none of them bounds memory:

- `state.concurrency` — dataflow tasks in flight;
- `partitionConcurrency` — a partitioned task's own pool (default: the jobs
  capacity, `steps.ts:692`);
- `jobs` — runner processes in flight across everything (default: the CPU
  count, capped by the cgroup quota, `jobs.ts:199-209`), local only.

Scratch directories live under `E3_SCRATCH_DIR` or the OS temp directory,
and "a temp directory on tmpfs holds an output in memory until it is stored"
(`scratch.ts:17-20`).

### Cloud execution

`executeTaskCore` (`e3-cloud/.../execute-task.ts:182`) reads every input
whole from the object store into memory and writes it to a scratch file
(`:236-242`), evaluates the command IR, spawns it, then reads the output
file whole and writes it to the object store (`:411-412`). It never looks at
`task.kind`.

## Timeline

The epics behind this layer (dates are issue opened → closed, 2026):

| When | Epic | What it added |
|---|---|---|
| 07-24 → 07-26 | #416 | beast2 v5: segment-terminated container, streaming writer, index |
| 08-04 → 08-09 | #481 | keyed paged reads and column projection (east-c, east-py) |
| 08-04 → 09-08 | #484 | shard-parallel writes: splice + fork (east-py) |
| 08-06 → 08-07 | #505, #506, #507, #512, #516 | lazy paged inputs; bounded carve and splice; `partitionTask` + `streamTask` on every runner — one PR, one day |
| 08-07 → 08-08 | #518 → #519 | the ascending-emit contract found to make re-keying unbounded; fixed by sorting in the sink (spill + merge) |
| 08-11 → 08-13 | #539 | frozen task inputs; the lazy shape gate collapsed |
| 08-14 | #560 | east-py lazy values and a native emit sink |
| 08-16 → 08-27 | #584 | the export door found encoding collections unsegmented |
| 09-03 → 09-04 | #657 | lazy paged collections inside expressions |
| 09-16 | #763 | frame-parallel deflate |
| 09-16 | #765, #768 | path-initialised inputs: a file adopted by hash |
| 09-17 → 09-21 | #770 | partition assembly in the runner (merge command, ranges, tree); the ascending contract restored and the sink's spill removed |
| 09-22 → open | #779 (PR #786) | records: manifests, the content-defined cut, secondary indexes, deltas, record operations |
| 09-23 → open | #788 | a size-aware cut rule (deferred) |
| 09-23 → open | #790 | emitted outputs: a run former (sorting again), run sets, seam repair, `aggregateTask`, manifest outputs |

Two months. The same problem — a large keyed collection produced out of key
order — was addressed three times, in two opposite directions.

## Findings

### F1 — dup/drift: record operations re-implement the template interpreter

`executeRecordOperation` (`recordSteps.ts:106-248`) is plan → map pool →
merge tree → splice written out again rather than a `Step[]` run by
`executeTemplate`. The copies have already diverged:

- A unit that THROWS in `recordSteps` (`runner.execute` rejecting, `:136-137`
  called at `:166` and `:219`) rejects the `Promise.all` at once while the
  other workers keep taking partitions (`failed.any` is only set by results,
  `:153-173`). `steps.ts` drains the pool before rethrowing, precisely so no
  unit writes its record after the logical execution has ended
  (`steps.ts:787-791`, `:838`).
- No `plan` sidecar: a retried index build re-carves every slice
  (`steps.ts` reuses them, `:769-783`).
- No logical execution record, no per-unit log lines, no progress events
  (`steps.ts:561-575`, `:812-818`).
- Its own default pool width constant (`recordSteps.ts:84`) beside
  `steps.ts:104`, both `4`.

It shares the primitives (`planPartitions`, `carvePartitionSlices`,
`mergeComponents`, `planMergeRanges`, `spliceBlobs`) but not the
interpretation, which is where the failure and cancellation semantics live.

### F2 — gap: the template is invisible to the dataflow and absent from the cloud

The dataflow sees a partitioned task as one task `in_progress` for its whole
fan-out; its units run in the interpreter's own pool with their own failure
attribution, cancellation and progress (`steps.ts:795-828`, `:926-955`). So:

- There are two schedulers. The jobs budget bounds runner PROCESSES across
  both (`LocalTaskRunner.ts:525-540`), nothing bounds memory, and the pool is
  as wide as the budget — the CPU count by default. Pool width times an
  unbounded per-unit footprint is the 150 GB report.
- A yield or crash resets the whole partitioned task to `pending`
  (`dataflow/steps.ts:952-961`); the resumed run re-plans and re-probes every
  unit. The cache and the plan sidecar make that cheap, but the resumable
  unit is the task, not the partition.
- e3-cloud never calls `executeTemplate`: `executeTaskCore` spawns a task's
  command as one process (F4). `partitionTask` and `streamTask` are
  undeployable there (e3-cloud#178, open), and `steps.ts`'s claim that "a
  remote backend (e3-cloud) supplies its kernel's" byte hooks
  (`steps.ts:37-39`) describes a backend that does not exist (e3-cloud#185
  plans it).

### F3 — contract: outputs are stored as the runner wrote them, not canonically

`adoptOutputFile` stores runner bytes verbatim (`LocalTaskRunner.ts:572`), and
a partitioned output is a byte splice of its partials (`steps.ts:986-1016`).
Neither re-cuts a keyed collection by the content-defined rule, so the same
value's bytes depend on who produced it: returned by one task, emitted by
another, spliced from partitions. The template's own claim is weaker and
true — "every output is a deterministic function of the inputs and the task"
(`steps.ts:44-49`) — but the storage layer elsewhere relies on the stronger
one: the cutting door re-cuts such a blob by decoding it whole (F20, F21).

### F4 — gap: cloud execution holds every input and the output whole in memory

`executeTaskCore` reads each input with `objects.read` into a buffer and
writes it out (`execute-task.ts:236-242`), and reads the output with
`readFileSync` before `objects.write` (`:411-412`). No manifest staging, no
lazy inputs, no streaming upload — the bounded-memory work of #657, #768 and
#770 does not reach the cloud. (e3-cloud is also pinned to an older east —
e3-cloud#177.)

### F5 — risk: three implementations of "where segments fall"

The segmentation of a collection blob is decided in:
`encodeBeast2PagedFor` (`stream.ts:561-691`), the east-node emit writer
(`emit-writer.ts:87-186`), and east-c's emit writer (`emit_writer.c:127-190`,
restating the paged encoder's three constants, `emit_writer.h:31-36`) and
paged encoder, with east-py binding east-c. They agree only because tests pin
them against each other ("the emit writer segments a value exactly as the
paged encoder does", `runner.spec.ts:710-743`). The byte-adaptive Array path
is the fragile one: it depends on measured bytes of deflate output and on a
probe count shared by constant (`stream.ts:487-493`).

### F7 — doc: the manifest is not in the wire spec

`v5/SPEC.md` specifies the header, frames, logical encoding, index and
footer, but not segment manifests (`manifest.ts`: the `$segments` struct,
its exact-field-set recognition, `level` nesting, the header object), which
every runtime must read — "This type lives here, beside the container it
describes, because every runtime must read it" (`manifest.ts:17-23`) — and
which the same paging reader opens (`Beast2Pages` accepts a
`Beast2ManifestSource`, `stream.ts:914-935`).

### F6 — contract: "the canonical form" is option-dependent

`usesContentBoundary` (`stream.ts:537-541`): passing `batchSize` or
`targetSegmentBytes` silently switches a Set/Dict from the content-defined
cut to positional batching. The same value then has two encodings under two
option sets, both flagged self-contained and indexed. Test fixtures build
keyed inputs with `batchSize` throughout (e.g. `runner.spec.ts:487`,
`generate_fixtures.mjs` `mergeInput`), so much of the suite exercises the
non-canonical geometry.

### F8 — contract: modes are implied by optional fields and strings, not typed

- The partition assembly mode is whichever of `merge` / `mergeSets` /
  `combine` is set, resolved by precedence in `templateFor`
  (`steps.ts:444-485`); nothing stops a task carrying both `combine` and
  `merge` (`task.ts:168-206`). A variant `assembly: splice | combine(ir) |
  merge(ir, command) | union(command)` would make the illegal states
  unrepresentable.
- Stream `emit` and `merge`, and a mutation's `form`, are strings with
  closed value sets (`task.ts:286`, `:294`; `record.ts:117`, `:159`).
- Outcomes travel as string prefixes: a cancelled execution is an `error`
  whose message starts `cancelled:` (`LocalTaskRunner.ts:88-91`,
  `steps.ts:623-626`); a repaired one starts `interrupted:`
  (`LocalTaskRunner.ts:325`); a stale record write is recognised by
  `stale write: ` read back out of a runner's STDERR (`record.ts:127-142`).
  Three runtimes must spell each prefix identically, and nothing types it.

### F9 — contract: no single migration policy

Some fields were added as hard cutovers — the task's `runner` ("packages
exported by older SDKs must be re-exported", `task.ts:74-76`) — and others
with dual or triple decoders: `environment` (`task.ts:90-126`), partition
metadata (three shapes, `:211-268`), stream metadata (`:300-335`), the
partition plan (`:401-437`), record commits, mutations and record objects
(`record.ts:62-99`, `:161-197`, `:258-298`). Each decoder is a
try/catch cascade that every reader, local and cloud, must use. #790
declared a hard cutover for its own changes; there is no stated rule for
which kind a change gets.

### F10 — dup: the runner CLI contract is implemented three times

The `run --emit/--merge/--union/--stream` and `merge --range` flags, the
emit kinds, the fold modes, the range blob shape, `--exit-with-parent` and
`-v` are specified by the command builders in `e3-types` (`stream.ts`,
`runner.ts`) and implemented separately in east-node, east-c and east-py.
Parity is held by shared fixtures and by pinning every message string in
three test suites. That is a large surface, and every change to it (as #790
proposes) is three implementations plus three suites.

### F11 — drift: the runners differ in what they can read

Only east-node opens a staged manifest (`runner.ts:95-97`). An east-c or
east-py task's collection input is spliced into ONE blob in its scratch
directory before the runner starts — the value's bytes copied on every
execution — so the I/O and memory profile of a task depends on its runner
choice. (#794 plans lazy manifest inputs for both.)

### F12 — contract: canonical storage holds for keyed collections only

`cutDatasetBlob` re-cuts a Set/Dict to the content-defined rule but adopts an
Array "as its writer cut it" (`dataset-blob.ts:132-133`, `:150-152`), and an
Array's cut is byte-adaptive over MEASURED COMPRESSED bytes
(`stream.ts:621-690`). Compression itself is NOT the problem: beast2 pins its
own deterministic DEFLATE encoder, implemented identically in TS and east-c
(`v5/deflate.ts:6-42`), so compressed bytes agree across runtimes. The
problem is locality: a positional cut is a function of everything BEFORE a
position, so one edit shifts every later Array segment, and an Array written
by the emit sink matches the paged encoder only because both implement the
same probe-and-refine constants (F5). `boundary.ts:23-24` and `:89-95` still
say Array cuts are "not a pure function of the value across runtimes" —
probably stale since the deflate was pinned; the real limit is that they are
not LOCAL.

### F13 — risk: the store's doors are many, and rules are bolted on one at a time

`dataset-blob.ts` and `dataset-type.ts` both open by explaining that a rule
did not hold at every door into the store — the package export encoded flat
while `datasetWrite` segmented (`dataset-blob.ts:21-31`); no door compared
types (`dataset-type.ts:9-23`) — and was made into one shared function. The
doors: `datasetWrite`, the package export, deploy (copies package refs
verbatim), the API `PUT`, the transfer commit, task output adoption
(`adoptOutputFile`, verbatim), record commits, index builds (`recordSteps` →
`cutDatasetObject`), file adoption, and the cloud's task output. F20 tabulates
what each one stores.

### F14 — design: an index carries a merge function that never runs

`RecordIndexObject.mergeIr` exists because "the runner's merge command takes
one whatever the data" (`record.ts:231-235`): the merge CLI requires `--merge`
for a Dict, and an index build is a Dict merge with no equal keys. The
interface shapes the stored object.

### F15 — design: the task model forces a choice between bounded output and parallelism

`streamTask` has bounded output (emit) but one execution and sorted keys;
`partitionTask` has parallelism and tolerates unsorted keys (merge), but
every unit returns its whole output value (`task.ts:524-527`), which the
runner holds decoded and encodes at exit. The SDK's own guidance routes an
unsorted keyed re-key to `partitionTask` + `merge` (`task.ts:859-860`). The
150 GB report is this: a long and wide output from partition units, each
holding its partial whole, as many units at once as the pool is wide (F2).

### F16 — dup/risk: two storage representations, kept byte-identical by construction

A collection dataset may be a manifest (records, `datasetWrite` with a sink)
or a whole segmented blob (task outputs adopted verbatim, F3). Every reader
handles both: `Beast2Pages` takes either (`stream.ts:914-954`),
`PartitionBlob` builds a virtual spliced layout over a manifest
(`partitionIo.ts:364-457`) specifically so that carving from either form
yields the same slice hashes, and the manifest's layout must stay
byte-identical to "the same bytes `DatasetSegments.splice` streams"
(`partitionIo.ts:356-358`). Each new consumer of a collection pays for both
forms.

### F17 — gap: partitioned execution copies its inputs into slices

Slices are new stored objects (`partitionExec.ts:528-541`): a partitioned
input is written once as itself and again as its slices (deduplicated only
against an earlier run's identical slices). With manifest-stored inputs a
slice could be a sub-manifest naming existing segment objects — zero bytes
copied — but the partition path predates manifests and treats them as blobs
(F16).

### F18 — doc: comments describe a component that no longer exists

`SplicePart.kind` says "the segment merge's whole claim is how FEW parts are
rebuilt" (`partitionIo.ts:465-469`), and `spliceChunks` describes "a LAZY
source — the segment merge, which produces its rebuilt parts as it walks"
(`:544-549`). No segment merge exists in e3 any more (`grep` finds no
producer of lazy parts): the fan-in moved to the runners' `merge` command.

### F19 — risk: test hooks live in production modules

`partitionAssemblyStats` monkeypatches `EastIR.prototype.compile` for the
duration of a run (`steps.ts:163-178`); module-global counters
(`steps.ts:120`, `partitionIo.ts:42-46`) exist for specs. Process-wide
state in the orchestrator, "so nothing else may run meanwhile"
(`steps.ts:155-157`).

### F20 — contract: "one uniform encoding per logical value" does not hold

`dataset-blob.ts:9-12` states collection values are "ALWAYS stored
segmented with a trailing index, at every size: one uniform encoding per
logical value". What the store actually holds for a collection, by door:

| Door | Stored as | Canonical cut? |
|---|---|---|
| `encodeDatasetBlob` + sink (`datasetWrite`) | manifest | keyed: yes; Array: writer's |
| task output (`adoptOutputFile`) | bare blob, as the runner wrote it | no check |
| partitioned output (`spliceBlobs`) | bare blob, seams at partition edges | no |
| record operation (`cutDatasetObject`) | manifest | keyed: yes, via whole decode if needed |
| mutation output (`adoptDatasetBlob`) | manifest if indexed, else bare — even unindexed | if indexed |
| external file (`datasetAdoptFile`) | bare blob, supplier's bytes | no |
| transfer dedup (`datasetAdoptObject`) | pointer to an existing object | whatever it is |
| API `PUT` (`e3-api-server` `setDataset`) | whole body decoded, then `datasetWrite` → manifest (`handlers/datasets.ts:986-1004`) | keyed: yes, at O(value) memory in the server |
| cloud task output (`executeTaskCore`) | bare blob, read whole then written | no check |

Consequences: equal values stored through different doors have different
hashes (execution-cache misses downstream); every reader handles several
shapes (F16); `cutDatasetObject` silently becomes O(value) memory for any
blob not cut by the rule — the "encoder door" whole-decode found in #786.

### F21 — risk: the whole-value fallbacks are the memory cliffs

Three functions materialise a whole value in e3's own process:
`readDatasetWhole` (`dataset-open.ts:582-599`), `cutDatasetBlob`'s re-encode
(`dataset-blob.ts:157-165`), and the no-`readRange` paths that read an object
whole (`dataset-open.ts:158`, `:439`; `partitionIo.ts:171-173`;
`processExec.ts:175`, `:216`). Each is documented as a rare fallback, and
each is reached by ordinary inputs: a spliced partition output, an Array, a
supplier file cut positionally, or any backend without ranged reads.

### F22 — dup: runner argv is built in four places

`streamCommandIr` and `mergeCommandIr` (`e3-types/src/stream.ts`), the task
command in the SDK (`e3/src/task.ts:219-242`), and `buildRunnerArgv` with its
own `--emit`/`--stream` flags for generated programs and functions
(`processExec.ts:287-319`). The CLI contract they target is itself
implemented three times (F10).

### F23 — dup: two data-tree representations, converted both ways

Tree objects (packages, root hashes) and per-dataset ref files (workspaces)
coexist; `computeRootHash` writes tree objects from refs on demand
(`dataset-refs.ts:219-273`) and deploy converts either packaging into refs
(`:310-405`). A migration left half done: every consumer of "the data tree"
must know which one it has.

### F24 — dup: the local re-cut already exists, in `record-apply.ts`

`applyArm` re-cuts a run of segments and grows it until the content-defined
cut agrees with the old one at both ends (`record-apply.ts:215-292`). That is
the "seam repair" primitive #791 set out to build in `east`'s v5 layer. A
spliced partition output, an emitted-run assembly and a record delta all need
the same operation: re-cut a region of a canonical collection so the whole is
canonical again. It exists once, privately, in e3-core, over decoded values.

### F25 — contract: records' O(touched) claim holds for storage, not for I/O

The segment store makes a one-row commit cost one segment of NEW storage. But
every mutation that runs a program — all of them except a `patch` on a record
with no index (`records.ts:558-560`) — streams the whole primary into the
runner's argument file (`:312-316`, `:562-576`), and every whole-state
mutation rebuilds every index in full (`:525-527`). The per-write cost is
O(record) I/O plus, for whole-state writes, O(record × indexes) compute.

### F26 — design: records run outside the execution model

Mutations run in `runDetached` (no execution records, no cache, their own
limits and outcomes, `records.ts:87-100`); index builds run through their own
interpreter (F1); deltas apply in e3-core's process (`record-apply.ts`); the
cloud must reproduce all three (e3-cloud#186). None of it is a task, so none
of it gets the dataflow's scheduling, cancellation, progress, logs or cloud
execution for free.

### F27 — doc: the wire spec does not specify its own encoder or cut rule

`deflate.ts` says the deterministic DEFLATE algorithm "is specified in
v5/SPEC.md" (`deflate.ts:19-21`); SPEC.md specifies none of it, and still
says deflate is "zlib in C, stdlib `zlib` in Python, `node:zlib` in Node"
(`SPEC.md:134-140`) — no longer true for encoding. The content-defined cut
rule (`boundary.ts`: FNV-1a over the canonical bare key encoding, bounds
256/1024/4096, the `cdc/fnv1a64/256-1024-4096/1` id) and the positional rule
(`pos/1000-2MiB/1`) are not in SPEC.md either. Three runtimes implement all of
them; the only specification is the TypeScript source and the tests that pin
the other runtimes to it.

### F28 — risk: segments are bounded by count, not bytes

The content rule bounds a segment at 256…4096 ELEMENTS (`boundary.ts:52-75`),
deliberately never bytes ("deflate output is not byte-identical across zlib
builds" — a rationale the pinned encoder has since removed). A collection of
wide rows gets segments of up to 4096 wide rows: every random read decodes
one, the emit sink holds one open, a merge unit holds one per input, a one-row
edit rewrites one. For a "long and wide" output this is a second memory
multiplier beside F15. (#788 defers a size-aware rule.)

### F29 — dup: splice and carve are implemented four ways

In-memory `carveBeast2`/`spliceBeast2` (`geometry.ts:158-234`), streamed
`spliceChunks` in e3-core ("byte-identical to `spliceBeast2`",
`partitionIo.ts:520-567`), `DatasetSegments.span`/`splice`
(`dataset-open.ts:257-340`), the manifest's virtual spliced layout
(`partitionIo.ts:364-457`) — plus east-c's `east_beast2_splice_tail` and its
own carve. Each is held byte-identical to the others by tests.

### F30 — risk: the index cannot grow

Readers refuse any index flag bit other than `self_contained`
(`codec.ts:950-953`, `range.ts:247-250`). Every change a future design might
want to declare in the index — per-element aliasing, a byte-bounded cut, a
different rule — needs a new container version instead. Worth knowing before
choosing between a flag and a structural check (as #791 did for aliasing).

### F31 — contract: the emit path and the return path disagree on what they can hold

Return = unbounded (decoded value + whole encoded buffer); emit = one batch
(which F28 bounds by count, not bytes). The e3 API decides which one a body
gets: `task` and every `partitionTask` unit return; only `streamTask` and the
generated record programs emit. So the memory profile of a computation is
fixed by which constructor its author picked, not by what it computes.

### F32 — dup: the emit sink exists twice, the merge twice, the CLI three times

The emit sink and segment writer are implemented in TypeScript
(`runner.ts:363-432`, `emit-writer.ts`) and in C (`emit_sink.c`,
`emit_writer.c`, east-py binding it); the blob merge in TypeScript
(`merge.ts`) and in C (`merge.c`, east-py binding it); the CLI surface three
times (`cli.ts`, `main.c:1587-1861`, `cli.py`). Byte identity between the TS
and C writers is maintained by fixtures and message pins (F10). One small
symptom: east-py's `merge_blobs` docstring says east-c and east-node "write
the blob wherever `-o` points" (`runner.py:417-419`), while both CLIs refuse a
non-`.beast2` output (`main.c:1788-1793`, pinned in `runner.spec.ts:792-793`).

### F33 — risk: three concurrency knobs, and memory is none of them

Dataflow concurrency, partition pool width and the jobs budget
(Scheduling, above) interact: N ready partitioned tasks each run a pool as
wide as the jobs budget, all waiting on one budget of process slots. Nothing
accounts for memory, and the scratch default can silently put staged inputs
and outputs in RAM (`scratch.ts:17-20` — every spliced east-c/east-py input
and every output, on a tmpfs `/tmp`). Both are multipliers on F15.

### F34 — dead: an execution API nobody implements

`execution/interfaces.ts` exports `DataflowExecutor`, `TaskGraph` and four
`Dataflow*Fn` signature types, documented as the contract of a
`LocalDataflowExecutor` and a `StepFunctionsDataflowExecutor`
(`interfaces.ts:6-17`, `:188-335`). Neither exists, nothing in e3 or e3-cloud
implements or consumes these types (grep), and the real design — step
functions driven by `LocalOrchestrator` — superseded them.

### F35 — risk: frozen wires, and nothing that says which wires are frozen

Beyond the index flags (F30), `ExecutionEventType` "is a frozen beast2 wire
(appending cases breaks released readers)" (`LocalOrchestrator.ts:1133-1137`),
which is why partition progress is never persisted. Some wires take appended
fields with dual decoders (F9); some cannot grow at all; nothing lists which
is which.

### F36 — risk: garbage collection recognises objects by the names of their fields

`markReachable` decides which objects name other objects by matching field
names (`gc.ts:276-514`): a package is any struct with `tasks` and `data`, a
task any struct with `commandIr`, `inputs` and `output`, a tree any struct
whose fields are all DataRef-shaped variants; commits, plans, mutations and
record and index objects match by field-name PREFIX so that objects written
by older and newer e3 versions are both recognised; manifests and record
states match exactly and then check a `kind` tag. Consequences:

- Every new object kind that names other objects must be added here, or the
  first sweep deletes everything it names — the file is a register of every
  structural shape, maintained by hand. (e3-cloud's GC reuses this
  `markReachable`, but without `readHead`, so every reachable object —
  every dataset included — is read whole during a cloud sweep,
  `e3-cloud/packages/e3-cloud-core/src/gc/gc-mark.ts:66`.)
- A user dataset shaped like one of these is walked as if it were one (the
  loose matches can only over-retain objects, since unreadable children are
  skipped).
- There is no typed object envelope: three object kinds carry a `kind` tag
  (`$segments`, `$record`, and #790's planned `$runs`); the rest are
  recognised by shape.

### F37 — risk: optional storage capabilities double every path

`readRange`, `adoptFile`, `materialize`, `executionOwnerWrite/Read` and
`executionPlanWrite/Read` are optional (`storage/interfaces.ts:161-205`,
`:420-454`); every consumer carries a fallback, and the fallbacks for the
first three are whole-object reads (F21). The interface header still names an
`EfsBackend` and a future `S3DynamoBackend` (`:9-12`); the cloud's actual
backend is DynamoDB + S3.

### F38 — design: the ascending-emit contract pushes sorting into every producer

Because a sink refuses out-of-order keys, every program that produces a keyed
collection in any other order sorts it in memory first. The generated index
build collects its whole slice's entries into a local Dict before emitting
(`record-programs.ts:84-101`) — O(slice) decoded memory per unit, with slices
sized at 256 MiB of wire (`recordSteps.ts:53`); the mutation program collects
its ops per arm the same way (`:286`, `:305-307`). User code has the same
choice: sort in the body, or return a whole partial from `partitionTask`
(F15). The contract moved the sort from the sink, where #519 had it, to
every producer.

### F39 — doc: a comment describes the sink before #770

`indexBuildProgram` says "the TypeScript emit sink refuses out-of-order keys
(only the C sink spills and merges)" (`record-programs.ts:63-67`). Since #770
no sink spills or merges; every sink refuses.

### F40 — doc: the execution design is two documents, one of them from the MVP

`e3-execution.md` appends current, precise sections (stopped executions,
partitioned tasks, the jobs budget, `:265-346`) to an MVP-era specification
that was never revised: a status type without `executionId`
(`:55-86`, vs `execution.ts:42-97`); `ExecuteOptions`/`ExecutionResult` shapes
that no longer exist (`:186-203`); a "command template" of `literal` /
`input_path` / `inputs` parts where the code evaluates a command IR
(`:215-227`); inputs read from the store and written to scratch, and outputs
read back and stored (`:219-221`, `:239-243`), where the code links;
`execStart`/`execWatch` APIs and "for MVP, single-process execution"
(`:362-475`). The current sections do say what the code does — including
that memory, and a runner's own threads, are not budgeted (`:346`), and that
an output of several ranges is "segmented per range and component"
(`:332`).

### F41 — doc: design records accrete "superseded" banners over stale bodies

`e3-records-storage.md` is a 2026-06 decision record with two update boxes
(2026-09-09, 2026-09-22) listing which of its statements no longer hold
(`:9-48`); the body below still states them ("A record's state is a single
content-addressed BEAST2 blob", `:77`; the `layout: blob | tree` roadmap,
`:219-248`). The 2026-09-09 box also claims segments are "standalone,
byte-stable" because aliasing is scoped per segment (`:21-24`) — the
identity-dependence #791 then had to fix.

### F42 — contract: two documents disagree on partition memoization

`e3-records-storage.md` says a `partitionTask` over a record "re-runs only
the partitions whose slices changed, which content-defined segments make
exact" (`:44-47`). `partitionExec.ts` says the opposite of "exact": boundaries
pack segments greedily by BYTES, so "a mid-key-space insertion shifts
subsequent segment packing, so partitions after the insertion point re-run —
append-friendly, not general" (`partitionExec.ts:25-32`, packing at
`:186-199`). Content-defined segments stabilise segment boundaries; the
partition boundaries built on them are still positional.

## Patterns behind the drift

Eight mechanisms produced the findings. Naming them matters more than any
single fix, because each will recur unless it is stopped deliberately.

1. **A rule per door, added when a door is caught out.** The store is written
   through nine doors (F20). Each rule — segment it, check its type, cut it
   canonically, make it a manifest — was added as one shared function after
   a door was found not to apply it (F13; #584 for the export door). Doors
   added since (file adoption, mutation outputs) apply a subset.
2. **A second copy instead of a shared primitive.** The fan-out interpreter
   (F1), the cut rules (F5), the CLI (F10), the argv builders (F22), the
   re-cut (F24), splice and carve (F29), the sink and the merge (F32). Each
   copy is pinned to the others by fixtures and message strings, and those
   tests are the only specification (F27).
3. **Keep both forms, forever.** Manifest and blob (F16), tree objects and
   refs (F23), old and new decoders (F9). Every consumer pays for each pair,
   and "byte-identical to the other form" becomes a constraint on each new
   reader (`partitionIo.ts:147-151`, `:356-358`).
4. **Fallbacks that decode whole.** Optional storage capabilities, the
   cutting door's re-encode, lazy hydration (F21, F37, `lazy.ts:21-30`).
   Each is correct and described as rare; the common case reaches it.
5. **Contracts as conventions.** Modes as optional fields, outcomes as
   string prefixes, object kinds as field-name shapes, migrations case by
   case (F8, F9, F35, F36). Nothing typed enforces them, so every runtime
   and every reader re-derives them.
6. **Contracts that move a cost instead of removing it.** The ascending
   contract bought determinism by moving sorting into every producer (F38).
   Returning bodies bought simplicity by moving memory into the units
   (F15). Count-bounded cuts bought cross-runtime agreement by moving size
   into the segments (F28).
7. **Docs appended, not rewritten.** MVP text under current text (F40),
   superseded banners over stale bodies (F41), comments naming removed
   components (F18, F39), and two documents that disagree (F42).
8. **Local first; the cloud later, then not at all.** No templates, whole
   objects in memory, whole-object GC reads, and an older east (F2, F4,
   F36). Every local capability widens the gap.

## #790 re-assessed

**What it fixes.**
- Emit everywhere, with the platform sorting — not producers (F15, F31,
  F38).
- The output door never decodes whole (F21 for task outputs).
- Manifest inputs for east-c and east-py (F11).
- Scratch off tmpfs (F33).
- Task outputs stored as manifests (F3, part of F20).

**What it adds — the same pattern again.**
- A run former in TypeScript and in C: one more primitive, twice
  (pattern 2).
- Run sets. That is a new object kind for GC (F36), a new on-disk
  convention (`<output>.runs/<n>.beast2`), and a third output shape (one
  run, a run set, a returned value).
- Seam repair as a new east primitive, while the same re-cut already exists
  in `record-apply.ts` (F24).
- A changed CLI contract in three runners (F10), plus new environment caps.

**What it leaves.**
- **Fan-out:** two interpreters (F1). Fan-out still invisible to the
  dataflow and absent from the cloud (F2, F4, F26). Its line "on e3-cloud
  the merges are separate short units" assumes a cloud template runner
  that does not exist.
- **Segment size:** segments bounded by count, not bytes (F28). A byte cap
  on a run does not bound the segments the run is cut into.
- **Doors:** every door but task outputs — file adoption, mutation outputs,
  the API `PUT` (F20).

**Verdict.** The direction is right: emit everywhere, sort in the
platform, store canonical outputs. As written, though, #790 is the next layer
of the same pattern. Re-sequenced after consolidation, several of its parts
shrink to little or nothing:
- Seam repair becomes the one generalised re-cut.
- Run assembly becomes the reduce and splice steps of the one interpreter.
- Manifest outputs become the one door.

## Strategy

The plan in [`e3-data-architecture.md`](./e3-data-architecture.md) §4
supersedes this section in detail and re-sequences its stages.

### Principles

#790's P1–P5 stand (bounded memory; bytes a function of content; nothing
declared or guessed; one model; value work on runners, byte work in storage).
Add:

- **P6 One primitive, one place.** Each collection operation — cut, write,
  merge, re-cut, splice, carve — has one TypeScript implementation in `east`
  and one in east-c, pinned by a conformance corpus generated from a written
  specification. e3 calls them; it never re-implements one.
- **P7 One stored form, one door.** Every collection value in the store is a
  manifest. Every write goes through one door, which canonicalises by
  streaming re-cut and never decodes whole. Readers keep reading old blobs;
  writers never produce them.
- **P8 One fan-out machine.** Every multi-unit computation — partition map,
  merge tree, run assembly, index build — is a template run by one
  interpreter. Its state is persisted and its units are scheduled by the
  dataflow, which is also what gives the cloud a path.
- **P9 Typed contracts.**
  - Modes are variants.
  - Outcomes are typed fields, not message prefixes.
  - Every object that names other objects carries a kind tag, which GC reads.
  - One written migration rule.
- **P10 Docs are rewritten with the code.** A design doc describes current
  behaviour; history lives in git.

### Sequence

Each stage ships on its own, and each deletes more than it adds.

0. **Stop and tidy** (days).
   - Pause #790's implementation.
   - Delete the dead execution API (F34). Fix the stale comments (F18,
     F39). Rewrite `e3-execution.md` and `e3-records-storage.md` to current
     behaviour, and resolve F42.
   - Complete `v5/SPEC.md`: the manifest, the deterministic deflate, both
     cut rules, the aliasing scope (F7, F27).
   - Write the migration rule, and the list of frozen wires (F9, F30, F35).
1. **The collection layer** (east + east-c).
   - One re-cut primitive: canonicalise a region of a collection given the
     cut geometry around it — `applyArm`'s algorithm, generalised and moved
     into `east` (F24).
   - Per-element aliasing (the uncommitted phase-1 change).
   - Decide the size-aware cut (#788) now: it changes the canonical form
     too, so both belong in one cutover (F28, F30).
   - One streamed splice/carve in TypeScript that e3 uses, with east-c's
     pinned to it (F29).
2. **One door.**
   - A single `storeCollection(stream) → manifest` that is canonical, bounded
     and never decodes whole. Every write uses it: task outputs, splices,
     file adoption, API `PUT`, mutation outputs, export.
   - Delete `cutDatasetBlob`'s whole decode and the blob branches of every
     writer (F3, F16, F20, F21).
   - Slices become sub-manifests (F17).
3. **One fan-out machine.**
   - The template interpreter as a persisted state machine, with a recut
     step.
   - Delete `recordSteps.ts`; record operations become templates (F1).
   - Units are scheduled by the dataflow; e3-cloud#185 builds on this, not
     on the in-process loop (F2, F26).
   - Typed assembly modes (F8).
4. **Bounded outputs** — #790's core, now small.
   - Emit everywhere; runs are sorted and bounded by bytes.
   - Assembly is the machine's reduce and recut steps over runs; storage
     goes through the door.
   - The ascending contract and returning partition bodies go.
5. **The runner surface.** Decide how much stays duplicated across
   TypeScript and C (decision 3 below), and write the CLI contract as a
   spec (F10, F22, F32).
6. **Cloud parity**, on the stages above (F4, F36 cloud GC).

### Rules that keep it from drifting again

- A PR that adds or changes a wire field states which migration rule it
  follows, per the written policy.
- A new object kind that names other objects carries a kind tag and a GC
  test in the same PR.
- A collection reaches the store only through the one door. Enforced by
  code structure and a lint rule, not by review alone.
- A PR that changes documented behaviour rewrites the doc in the same PR.
  The east-contribute skill already says so; the review found it not
  followed (F40, F41).
- Before an epic adds a primitive, it searches for an existing one. F24 is
  the failure this prevents.

## Decisions

Taken 2026-09-23 and recorded, with the rest, in
[`e3-data-architecture.md`](./e3-data-architecture.md) §1.

1. **Pause #790?** Yes. The plan replaces it; the per-element aliasing change
   moves into the plan's Stage 1.
2. **#786.** Merge it as is, with its gaps tracked in the plan's store-door
   stage.
3. **How much stays duplicated across TypeScript and C.** Both stay, because
   TypeScript runs in the browser. The written spec and a generated
   conformance corpus are the source of truth.
4. **The size-aware cut (#788).** Folded into the cutover of the canonical
   form (the plan's Stage 1).
5. **Cloud priority.** Designed for throughout, built after east-workspace.
