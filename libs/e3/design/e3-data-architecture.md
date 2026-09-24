# e3 data and execution — target architecture and plan

> Status: **plan**, 2026-09-23.
> Evidence: [`e3-data-architecture-review.md`](./e3-data-architecture-review.md); its findings are cited here as F1–F42.
> Replaces: the #790 design (PR #796, closed unmerged).
> This document states the target and the steps to reach it. As each stage lands, its part of §3 is rewritten to describe the code and its part of §4 is deleted. When §4 is empty, this is the design document for the layer and the review is deleted; git keeps both.

## 1. Decisions

| | Decision |
|---|---|
| D1 | **Hard cutover.** Packages are re-exported and caches invalidate once. Readers keep reading every stored form ever released; writers write only the current one. |
| D2 | **#786 is folded into this PR.** The epic branch was started from #786's head and carries every one of its commits unchanged, and #779–#785 close with this PR. Its known gaps — the cutting door's whole decode (F20, F21) and task outputs stored as the runner wrote them (F3) — were Stage 2, and its guarantees are a gate every stage keeps (§7). |
| D3 | **#790 is replaced by this plan.** Its per-element aliasing change is kept (Stage 1). |
| D4 | **TypeScript and C both implement every primitive both runtimes need.** TypeScript runs in the browser. A written spec plus a generated conformance corpus is the source of truth for both. |
| D5 | **One stored form.** Every collection value in the store is a manifest of segment objects, written through one door. |
| D6 | **Runners write segment files and a manifest;** e3 links them into the store without copying. |
| D7 | **Cut rule v2:** content-defined for Arrays too, and size-aware for every collection (#788), provided every indexed and paged read keeps working. |
| D8 | **Partition boundaries are content-defined.** |
| D9 | **Authoring:** `e3.task` returns; `e3.streamTask` emits into an output kind; `e3.partition` marks an input the work may be split over. `partitionTask` is removed and `aggregateTask` is not built. |
| D10 | **Automatic parallelism is part of the cutover.** |
| D11 | **Runner protocol:** one machine-facing command, `exec <unit>`, with a typed result. |
| D12 | **Scheduling:** one budget of cores and memory. |
| D13 | **SDK namespaces for closed families only:** `e3.output.*` and `e3.mutation.*`. |
| D14 | **External deliveries are split into segment objects when adopted.** It costs one streaming pass and a copy; in exchange, successive deliveries share their unchanged segments and their unchanged pieces stay cached. |
| D15 | **Every parameter that decides how work is grouped is a platform constant.** Only settings that decide when work runs belong to the machine (§3.10). |
| D16 | **The cloud is designed for throughout and built after east-workspace** (Stage 8). |

## 2. Principles

- **P1 Bounded memory.** No runner, orchestrator or door holds a large value whole. Caps are explicit and independent of data size, key order and decode expansion.
- **P2 Bytes are a function of content.** A stored collection's bytes do not depend on the runtime, emission order, partitioning, buffer sizes or object identity.
- **P3 Nothing is declared or guessed.** Authors state what an output means, never how data is ordered or sized. There are no performance modes.
- **P4 One model.** Small results are returned; large ones are emitted into an output kind, and the platform does the rest.
- **P5 Value work on runners, byte work in storage.** User East runs only in runner units. e3-core plans, schedules, assembles bytes and records.
- **P6 One primitive, one place.** Each collection operation has one TypeScript implementation in `east` and, where C needs it, one in east-c, pinned by the conformance corpus. e3 calls them and never re-implements one.
- **P7 One stored form, one door.**
- **P8 One engine.** Every multi-unit computation — pieces, merges, folds, index builds — is a unit graph run by one persisted engine whose units the dataflow schedules.
- **P9 Typed contracts.** Modes are variants, outcomes are typed, every object that names other objects carries a kind tag, and one written rule governs migrations.
- **P10 Docs are rewritten with the code.**

## 3. Target architecture

### 3.1 Who owns what

| Layer | Owns | Never |
|---|---|---|
| **beast2**: `east` (TypeScript) and `east-c` (C, which east-py binds) | the canonical form, the manifest, the collection primitives (§3.4) and the runner protocol types (§3.5) | knows about tasks |
| **Runners**: east-node-cli, east-c-cli, east-py-cli | evaluating East; executing units; writing outputs through beast2's Writer and RunSorter; reporting a typed result | plans, schedules, merges its own runs, or checks emission order |
| **e3-core** | planning unit graphs, scheduling units, assembling outputs (manifest concatenation and Recut), the store door, the execution cache, GC | evaluates user East |
| **e3 SDK** | the authoring API, the typed task object, automatic parallelism (§3.9) | makes run-time decisions |

### 3.2 Authoring

```ts
e3.input(name, type, source?)                    // unchanged
e3.record(name, type, initial)                   // unchanged
e3.task(name, inputs, fn, config?)               // returns; inputs are datasets only
e3.streamTask(name, { inputs, output, runner?, environment? }, ($, ...inputs, emit) => void)
e3.partition(dataset, { by? })                   // a streamTask input the work may be split over
e3.output.array(T)
e3.output.set(T)
e3.output.dict(K, V, { merge? })                 // merge: ($, key, a, b) => V
e3.output.fold(T, { zero, combine })             // combine: ($, a, b) => T
e3.customTask(...), e3.function(...)             // unchanged
e3.mutation.reduce(name, record, fn)             // was e3.mutation
e3.mutation.edit(name, record, fn)               // was e3.editMutation
e3.mutation.patch(record, name?)                 // was e3.patchMutation
e3.mutation.editType(recordType)                 // was e3.editTypeOf
e3.recordIndex(name, record, spec)               // unchanged
e3.package(...), e3.export(...)                  // unchanged
```

**`e3.task`** runs one unit. Its inputs are datasets: passing `e3.partition(...)` is a type error, and is refused at definition. A large input opens lazily, and the returned value is written through the Writer segment by segment. When the body's shape allows, §3.9 runs it partitioned without the author asking.

**`e3.streamTask`** emits into an output kind. The kind fixes `emit`'s signature and how parts of the output combine:

| Output kind | `emit` | Parts combine by |
|---|---|---|
| `array(T)` | `emit(t)` | concatenation: emission order within a unit, units in input order |
| `set(T)` | `emit(t)` | union |
| `dict(K, V, { merge? })` | `emit(k, v)` | union by key; equal keys fold with `merge(key, a, b)` in input order; without `merge`, a repeated key fails and names it |
| `fold(T, { zero, combine })` | `emit(t)` | every emitted value folded with `combine`, starting from `zero`, in input order |

Emission order is free: the platform sorts sets and dicts. A producer is a `streamTask` with no inputs.

**`e3.partition(dataset, { by })`** marks an input the work may be split over:
- The body receives one piece, typed as the whole dataset. Pieces are content-defined ranges: key ranges of a Set or Dict, position ranges of an Array (§3.7).
- `by` names leading key fields — `['account']`, or `['a.b']` for a first-field path. Rows with equal values of those fields are never split across pieces. It is data, validated against the key type at definition.
- Two or more partitioned inputs are cut at the same keys. They must be Sets or Dicts whose keys, or whose `by` fields, have the same types.
- Unmarked inputs reach every piece whole, opened lazily when large. A change to one re-runs every piece.
- With no partitioned input, the task is one unit with exact left-to-right semantics.

**The author's contract**, the only one: `merge` and `combine` are associative, `zero` is an identity of `combine`, and a partitioned body's combined result does not depend on where the input was cut.

**Refused at definition**, naming the task: a partitioned input on `e3.task`; `e3.partition` of a value that is not a collection; co-partitioned inputs without a common key; a `by` that names something other than a leading key field. `emit`'s types come from the output kind, so a mismatched call is a type error.

**Removed:**
- `partitionTask` and `PartitionTaskSpec`, with their splice, combine and merge modes, `targetPartitionBytes` and the projection-function `by`.
- `streamTask`'s `stream:` slot, its ascending-emission rule and its adjacent-only `merge`.
- The `'union'` literal.
- `kind` and `metadata` in `e3.task`'s config.
- The old mutation names.

### 3.3 The task object

`kind: Option<String>` with an opaque `metadata` blob (F8), and IR passed as wire input 0 (and 1), become typed fields:

```
TaskObject = {
  body:   east    { program: <IR object hash> }          // stock runners
        | command { commandIr: <IR object hash> },       // customTask, the custom runtime
  runner: RunnerType,
  inputs: [ { path: TreePath, partition: Option<{ by: [String] }> } ],
  output: { path: TreePath,
            kind: value | array | set | dict { merge: Option<IR hash> }
                | fold { zero: <value hash>, combine: <IR hash> } },
  role:   data | ui { … },                               // what UI tasks put in kind/metadata today, typed
  environment: Option<String>,
}
```

- Inputs are data only. A body or merge function is no longer an input by position, and the unit builder (§3.5) never counts wire indices.
- `role.ui` carries what UI tasks put in `metadata` today, as a typed struct. Read the e3-ui consumer of `kind` and `metadata` before writing it.
- It carries a kind tag for GC (§3.11).

### 3.4 The collection layer (beast2 v5, format v2)

**Canonical rules**, all written in `v5/SPEC.md`, with rule ids stamped in manifests:
1. **Aliasing is scoped per root element,** so an element's bytes depend on that element alone.
2. **Set/Dict cut rule v2:** content-defined on the key hash (FNV-1a over the canonical bare key encoding, as `/1`), with a size-aware boundary test (#788). The cut probability rises with the open segment's logical size (normalized chunking), there is a minimum counted in elements or bytes (whichever comes first), and a forced cut far out. Size is measured on the pre-deflate canonical element encoding, which rule 1 makes identical across runtimes.
3. **Array cut rule v2:** the same test over a hash of each element's canonical bytes, so an edit re-cuts only the segments around it.
4. **One encoding per value:** no encoder option switches the cut rule (F6).
5. **The deterministic DEFLATE encoder** is specified (F27).
6. **The manifest** is specified (F7): `$segments`, the rule id, the header, entries `{hash, fence, count, bytes}`, and `level` reserved as 0.
7. **Strings order by code point** in every runtime, which is the order of their UTF-8 bytes (#836).

**Primitives:**

| Primitive | Contract | TypeScript (`east`) | C (`east-c`) |
|---|---|---|---|
| Writer | ascending elements → canonical segments: to a blob, or segment by segment as standalone segment blobs (what a manifest directory and Recut are written from) | `v5/stream.ts` | `v5/stream.c` |
| RunSorter | elements in any order → sorted canonical runs. A byte-capped buffer of encoded elements, sorted stably by (key, emission order); equal keys folded with `merge` or refused; a set unions | new `v5/runs.ts` | new `v5/runs.c` |
| Merger | k sorted collections (manifests or blobs) → one; optionally over one key range; equal keys fold in input order | moved from east-node-cli `merge.ts` | `src/merge.c` (exists) |
| Recut | pieces in order → the canonical whole, segment by segment. A piece is a run of segments the Writer wrote, given by reference, or elements. A segment the whole shares with its piece is copied without being read; only seams and elements are re-cut. Async, because its callers read segments from the store | new `v5/recut.ts`, replacing e3-core `record-apply.ts`'s private re-cut (F24) | not needed: only e3-core re-cuts |
| Splice / carve | streamed, over manifests and blobs | `v5/geometry.ts` | existing |
| Manifest read/write | the `$segments` object and the sibling-segment directory convention, each segment file named by its SHA-256, the hash the store names it by | `v5/manifest.ts`, with a SHA-256 of its own | new, with east-c-std's SHA-256 moved into east-c |
| Lazy readers | paged values over a blob or a manifest | `v5/lazy.ts`, `v5/stream.ts` | existing, plus a manifest source |

The Writer is the only segmentation code: the runners' emit writers (east-node-cli `emit-writer.ts`, east-c `emit_writer.c`) fold into it (F5, F32). The corpus pins the Writer, RunSorter and Merger across TypeScript and C. Recut is pinned by `Recut(pieces) == Writer(whole)` over every corpus value.

### 3.5 The runner protocol

Every stock runner has one command for machines:

```
east-node | east-c | east-py  exec <unit.beast2>
```

The types live in `east`, which every runner and e3-core depend on, with a C decoder in east-c that east-py binds:

```
Unit   = { work: run   { program: path, inputs: [path], output: Output }
               | merge { parts: [path], range: Option<path>, output: Output },
           platforms: [String], threads: Integer, result: path }
Output = value(path) | array(dir) | set(dir) | dict(dir, merge: Option<path>)
       | fold(path, zero: path, combine: path)
Result = { outcome: ok | failed { message, locations: [Location] },
           peakBytes: Integer, timings: { load, compile, execute, output } }
```

- `run` evaluates a body. With a `value` output the body returns its result; with any other kind its trailing parameter is `emit`, whose signature the kind fixes (§3.2). The output is written by kind:
  - `value`: a collection as a manifest directory at the path, anything else as one blob;
  - `array`: through the Writer, as the manifest directory `<dir>/0.beast2`;
  - `set` and `dict`: through the RunSorter, as a directory of runs, each the manifest directory `<dir>/<n>.beast2`, numbered from 0 in the order the runs close. A set's equal elements collapse; a dict's equal keys fold with `merge`, and without it are refused;
  - `fold`: every emitted value folded into an accumulator that starts at `zero`, written as a `value` is.
- `merge` assembles parts of one output kind: a k-way merge of sorted set or dict parts, optionally over one key range, written as one run, `<dir>/0.beast2`; or a fold of partials in order, starting at `zero`. Array parts never need a runner, and a `value` has no parts.
- Paths in a unit may be relative to the unit file, so a unit file and the files it names are a complete, replayable snapshot of any unit: `exec` replays it wherever they are moved together.
- A runner sizes its own thread pools to `threads`; one thread frames inline.
- `peakBytes` is the process's peak resident memory: VmHWM on Linux, where `ru_maxrss` inherits the parent's across exec, and `ru_maxrss` elsewhere.
- `timings` are milliseconds spent loading the inputs, compiling, executing and writing the output. `locations` are the failure's source locations, innermost first, as the program's source map gives them.
- The exit status is 0 when the outcome is `ok` and 1 when the result records a failure. Anything else, or a missing result, is a crash; e3 reports it with the signal and the stderr tail.
- `--exit-with-parent` stays a process flag, taken before anything else is parsed.

For people, `run <program> -i … -o …` stays and builds the same unit in memory, except that a collection result is written as one paged blob: a single file that any decoder reads. `-v` prints from the result.

Removed: `run`'s `--emit`, `--merge`, `--union`, `--stream`, `--lazy-inputs`, `--snapshot` and `--from-snapshot`, and the `merge` command. The lazy-open threshold stays a setting (`EAST_LAZY_INPUT_BYTES`). Nothing in the platform wrote or read a snapshot, and a unit file already is one.

Parity between the runners is the conformance corpus — unit files with their expected output bytes and results, run by all three in CI — rather than pinned flag messages (F10). Results compare by outcome: `peakBytes` and `timings` are measurements.

### 3.6 The store door

One function in e3-core, `storeCollection`, is the only way a collection reaches the store (F13, F20).

| Source | What the door does |
|---|---|
| a stock runner's output directory (manifest and segments) | links the segments and writes the manifest; the runner's Writer is corpus-pinned, so its cuts are the rule's |
| the runs of a unit graph | assembled by the engine (§3.7), re-cut at the seams, written as one manifest |
| a beast2 byte stream: an external file, an API `PUT` body, a custom task's output, a pre-cutover blob | re-encoded through Recut in one streaming pass, a source segment at a time, never decoded whole. Each foreign segment is decoded under an explicit cap on its logical size, the RunSorter's; a larger one — a whole-value encode, a v4 blob or an oversized batch — is refused, naming the fix. Nothing from outside is byte-copied: checking a foreign segment costs a re-encode, since its cuts, aliasing, codec and compressor all enter its bytes, and a canonical one re-encodes to the same bytes |
| a small value in memory (`datasetWrite`, export defaults) | Writer → manifest |

It checks the declared type, as `dataset-type.ts` does today, and never decodes a value whole (F21). Every door routes through it:
- task outputs;
- record commits;
- index builds;
- mutation outputs;
- file adoption (#768; D14);
- the transfer commit;
- API `PUT`;
- export.

**The adoption memo.** A delivery the door has split is remembered by its SHA-256: the backend records the file's hash and the manifest it became. An adoption, or a transfer init, that finds a live entry points the dataset at that manifest without reading the file again, so an unchanged delivery still costs a hash locally and a round trip remotely. An entry is not a GC root, and one whose manifest is gone is a miss.

The backend capabilities every path relies on — ranged reads, adoption by link, `materialize`, plan and owner records, and the adoption memo — become required (F37), and their whole-object fallbacks are deleted (F21).

The door frames inline, on the calling thread. The worker frame pool keeps each finished frame's buffers until that worker's GC runs, which V8 triggers only after about 64 MB of them per worker (#841), so a door that framed on it would hold memory in proportion to the value. Stage 5 bounds the pool, and the door frames on it again.

Scratch defaults to a directory inside the repository, on the object store's filesystem. Runner output then links in without a copy and never sits on tmpfs (F33).

### 3.7 The engine

Every task execution is a **unit graph**, built by one engine and persisted in the dataflow's execution state.

1. **Plan.** With no partitioned input, the graph is one `run` unit. Otherwise it is cut into pieces:
   - Boundaries fall at segment fences chosen by a content-defined rule over the primary input (platform constants, §3.10).
   - A boundary moves forward to the end of a `by` group.
   - Co-partitioned inputs are split at the same keys, as `partitionExec.ts` does today.
   - Each piece is a **sub-manifest** naming existing segment objects, so no bytes are copied (F17). A split point inside a segment re-encodes that one segment.
2. **Run.** One `run` unit per piece, each a content-addressed execution.
3. **Assemble,** by output kind:
   - `value`: the one unit's output.
   - `fold`: `merge` units fold the partials, a fixed fan-in at a time, in input order.
   - `array`: e3 concatenates the pieces' manifests and re-cuts the seams; no unit is needed.
   - `set`/`dict`: e3 groups the runs whose key ranges overlap, reading fences plus one segment decode for a run's last key. Each overlapping group becomes ranged `merge` units, with range boundaries taken from fences as `planMergeRanges` chooses them today. The disjoint results are concatenated and re-cut at the seams.

   The result goes through the door as one manifest.

**Persistence and scheduling.**
- The dataflow's ready set is units, from every task (P8).
- A yield or a crash resumes per unit (F2).
- Progress is a typed event wire that can grow (F35).
- Every unit is cached on its own identity: kind, program or merge function, input hashes and output kind. A re-run after an append re-runs only the pieces it touched and the merges they reach. Because pieces are content-defined, the same holds for an insertion in the middle (F42).

**Records run on the engine** (F1, F26):
- **Index builds** are a partitioned unit graph over the record's primary, with a `dict` output and no merge. The generated build program emits in any order, with no per-slice sort (F38), and the never-called index merge function goes (F14).
- **Mutations** run the generated program as one `run` unit through the same executor as tasks: execution records, logs, the budget and cancellation. The mutation API invokes it outside the dataflow graph.
  - The program reads the record's manifest lazily (F25) and emits the delta as a `dict`.
  - A stale write is a `$conflict` entry in the delta, which sorts first, instead of an error-message prefix read from stderr (F8).
  - The delta is applied with the Merger and Recut over the touched segments, inside the existing compare-and-swap loop. Applies run through Recut from stage 1, which deletes `record-apply.ts`'s private re-cut (F24).

### 3.8 Scheduling: cores and memory

One budget replaces the dataflow's `concurrency`, the partition pool's width and `jobs` (F33).

- **Capacity.**
  - Cores: `-j`, defaulting to the CPUs available (affinity and the cgroup's `cpu.max`, as today).
  - Memory: `--memory` or `E3_MEMORY`, defaulting to the cgroup's `memory.max` found the same way, else physical memory, less a reserve for e3 and the OS.
- **Admission.** A unit takes one core, which is its `threads` grant, plus a memory reservation, and starts when both fit.
  - A unit larger than the whole budget runs alone.
  - A unit that does not fit lets smaller ones pass for a bounded time, then waits for the room it needs.
- **Reservations are measured, not guessed.**
  - Each execution record stores its unit's `peakBytes`.
  - A unit reserves the recent peak of its task's units of the same kind.
  - A task with no history runs one unit first, then fans out at the measured size.
- **Guard.**
  - e3 samples usage and admits nothing more near the budget.
  - Past the budget, it kills the most recently started engine unit (a piece, merge or fold) and requeues it with its observed peak. Units are pure and content-addressed, so a killed unit leaves nothing behind and reruns to the same bytes.
  - A user task, which may touch outside systems, is killed only when the machine would otherwise run out.
- **cgroups.** Where delegation is available, each unit runs in its own cgroup with `memory.max` a margin above its reservation, so a runaway unit dies alone and `memory.peak` is exact.

### 3.9 Automatic parallelism

At export, after `East.importFunction` references are linked, the SDK examines each `e3.task` body's IR. When the body's result is built from one input through collection operations whose algebra is known, the task compiles to the explicit form:
- that input is partitioned;
- the output gets an output kind;
- each piece's body emits instead of building the collection.

Whatever the body does after the recognised operations runs once, in a final unit over the assembled output.

Recognised `east` builtins:
- **Element-wise**, over Array, Set and Dict: `Map`, `Filter`, `FilterMap`, `ToArray`, `ToSet`, `ToDict`, `FlattenToArray`, `FlattenToSet`, `FlattenToDict` and `DictKeys`, and chains of them.
- **Output kind from the result:**
  - an Array result gives `array`;
  - a Set result gives `set`;
  - a Dict from `ToDict` or `FlattenToDict` gives `dict` with that operation's merge function;
  - a key-preserving Dict (`DictMap`, `DictFilter`, …) gives `dict` with no merge.
- **Reductions:** `MapReduce` gives `fold` with its combine; `Size` gives `fold` by integer addition.
- **`GroupFold`**, when its group key is a leading prefix of the input's key: partitioned `by` those fields, with a `dict` output.
- **Later:** `Sort` (sorted pieces, then the Merger), and loops whose only carried state is updated by `insertOrUpdate`, `insert`, `pushLast` or `+=`.

Conditions, all proved from the IR. If any fails, the task runs as one unit and export names the condition.
- The partitioned input is used only through the recognised chain.
- Per-element functions call no platform function outside a known-pure set, and assign no captured variable or reference.
- Every merge or combine is associative by construction. It is built from associative primitives — integer and float addition, min, max, and, or, concatenation, union, first, last, max-by, min-by — field by field over structs.
- The one-unit semantics are kept exactly, including for an empty input.

Export reports each task's plan. Nothing here rests on an author's contract, because every condition is proved. Float sums regroup deterministically, because grouping is fixed by platform constants, but can differ from a one-unit run in the last bits.

The recognizer lives in the e3 SDK (`libs/e3/packages/e3/src/parallel.ts`) as one TypeScript implementation. It runs at export, never at run time.

### 3.10 Platform constants and machine settings

| Platform constants (in rule ids and code; not configurable) | Machine settings (never in a package) |
|---|---|
| the segment cut rule parameters (Set/Dict and Array) | `-j` cores |
| the partition boundary rule parameters | `--memory` |
| the RunSorter's buffer cap, which is also the door's cap on a foreign segment | the scratch directory |
| merge and fold fan-in; merge range size | the lazy-open threshold |
| | cgroup use; verbosity |

The left column decides how work, and so floating-point folds, are grouped, which decides output bytes. The right column decides only when work runs (D15).

### 3.11 Object kinds and GC

Every object this plan introduces or rewrites that names other objects carries a `kind` tag: task objects, unit graphs (`$plan`) and a unit's runs (`$runs`), alongside the existing `$segments` and `$record`. GC's `markReachable` dispatches on the tag. Pre-cutover shapes keep their shape recognition, each pinned by a test (F36). Every new kind lands with its GC test in the same PR.

### 3.12 Migration

`docs/conventions/WIRE_MIGRATION.md` (Stage 0) states one rule:
- **Package-borne wires** (task objects, package objects, IR bundles): hard cutover. Packages are re-exported, with no dual decoders.
- **Stored state** (datasets, manifests, record states and commits, execution history): readers accept every released form, through one read-compat decoder per type and a test per form. Writers write the current form only.
- **Frozen wires** are listed with the reason each is frozen: the beast2 container, whose index readers refuse unknown flags (F30), and the execution event wire (F35).

For this cutover, stored datasets written under the `/1` rules or as blobs stay readable. The first write to a manifest cut under an older rule re-cuts it whole, once (#788).

## 4. The plan

Stages land in order on one branch, delivered as one PR against main, so CI runs over each stage as it lands; a stacked PR, based on another branch, runs none. Each stage leaves the branch green and carries its own docs (P10). Stage 8 is a separate repository and PR.

```
0 Specify ─► 1 Collection layer ─┬─► 2 Door ────────────┐
                                 └─► 3 Runner protocol ─┴─► 4 Task model and engine ─┬─► 5 Scheduler
                                                                                     └─► 6 Automatic parallelism
                                                                     then 7 Docs sweep, 8 Cloud
```

Every stage's gates:
- `make build`, `make test` and `make lint` in each lib it touches and in the libs downstream of them;
- the conformance corpus once it exists;
- `REBUILD=1 make leak-check-all` for east-c changes;
- after east-c changes, an east-py rebuild (`make reinstall-east-py`) before its tests;
- #786's guarantees (§7).

### Stage 0 — Specify what exists

No behaviour change.
- **`libs/east/src/serialization/beast2/v5/SPEC.md`:**
  - specify the manifest (F7);
  - specify the deterministic DEFLATE encoder, and correct the encoder sentence at `SPEC.md:134-140` (F27);
  - specify the cut rules `cdc/fnv1a64/256-1024-4096/1` and `pos/1000-2MiB/1` (F27).
- **`libs/e3/design/e3-execution.md`:** rewrite to the current code, dropping the MVP sections (`:55-86`, `:186-203`, `:215-227`, `:362-475`) (F40).
- **`libs/e3/design/e3-records-storage.md`:** rewrite without its superseded banners (F41), stating partition memoization as it is today (F42).
- **New `docs/conventions/WIRE_MIGRATION.md`** (§3.12), listed in `CLAUDE.md`.
- **Delete** `execution/interfaces.ts`'s `DataflowExecutor`, `TaskGraph` and `Dataflow*Fn` types and their re-exports, after confirming e3 and e3-cloud use none of them (F34).
- **The rules in §5** go into the east-contribute skill. It is a plugin skill, so coordinate the change.

Stale comments in files that later stages rewrite are fixed by those stages, not here: F18, F39, the `boundary.ts` note in F12, and the east-py `merge_blobs` docstring in F32.

### Stage 1 — The collection layer (east, east-c, east-py)

Read first:
- `v5/stream.ts`, `codec.ts`, `boundary.ts`, `manifest.ts`, `geometry.ts`, `lazy.ts` and `SPEC.md`;
- east-c's `v5/` and `merge.c`;
- e3-core `record-apply.ts`;
- #788;
- the #770 spill at `refs/pull/772/head` (`c4ef375a` east-c, `4016415a` east-node).

1. **Per-element aliasing.** The change written for #791, already green:
   - TypeScript `stream.ts` and `codec.ts`;
   - C `codec.c`, `stream.c`, `container.c` and `internal_v5.h`;
   - the SPEC section;
   - `aliasing.spec.ts` and `test_beast2_aliasing.c`;
   - the regenerated fixtures.
2. **Cut rule v2** (#788), in `boundary.ts`'s `SegmentCutter` and east-c's `B2V5Cutter` (east-py binds the latter):
   - the size-aware keyed rule and the content-defined Array rule, with new rule ids and parity digests (`boundary.spec.ts`, `test_beast2_boundary.c`);
   - parameters fixed by measurement on the benchmark set (§6) and recorded in SPEC with the rule id;
   - measured on §6's segmentation benchmarks, built in this stage for it: the starting values stand, and the test is normalized — a quarter of the threshold until the open segment reaches its target, four times it after — which keeps segments near the target (a 95th percentile about 1.5× the median, where the unnormalized test's was 3–4×) at the same stored size and the same one-segment edits;
   - starting values: segments of about 1 MiB logical, a minimum of 256 elements or 64 KiB, and a forced cut at 4096 elements or 8 MiB.
3. **One encoding.**
   - Remove `batchSize` and `targetSegmentBytes` from the public encoder options (`stream.ts:537-541`).
   - Remove the byte-adaptive Array path (`stream.ts:621-690`) and its probe constants (`:487-493`).
   - Regenerate fixtures in canonical geometry (`runner.spec.ts`, `generate_fixtures.mjs`) (F5, F6, F12).
4. **One Writer:** east-node-cli's `emit-writer.ts` and east-c's `emit_writer.c`/`.h` fold into the library Writer (F5, F32).
5. **RunSorter** (new), in TypeScript and C, with east-py bound to C (§3.4).
   - Its buffer cap is a platform constant, counting encoded key and value bytes.
   - Revive the #770 spill's sort; its raw run format becomes canonical segments.
6. **The Merger in the libraries:** east-node-cli's `merge.ts` moves to `east`; its inputs may be manifests. Its manifest-directory output comes with item 8.
7. **Recut** (new, TypeScript), generalising `applyArm` (F24):
   - its interface is async: pieces in order, each a run of the Writer's segments given by reference (count, fence, a read) or elements; the whole comes out segment by segment, each one either carried from a piece or newly written;
   - the Writer gains the per-segment output Recut writes through, the in-memory half of item 8's manifest directories;
   - e3-core's record apply moves onto Recut here, brought forward from stage 4b, and `record-apply.ts`'s private re-cut is deleted.
8. **Manifests in every runtime.**
   - east-c opens a manifest as a lazy paged value, using the `.segments/` sibling convention (`processExec.ts:181-190`), and east-py opens one through it.
   - east-c-cli and east-py-cli read manifest inputs, lazily and eagerly, and every stock runner's `merge` command reads them too (east-node's opens them as the library Merger's manifest sources), so `runnerOpensManifests` holds for every stock runner and every command, and their inputs are staged by linking (F11).
   - Every runtime writes manifest directories, and so does the Merger (item 6).
   - A directory names each segment file by its SHA-256, the hash the store names it by, so each library carries one: `east` a pure-TypeScript SHA-256, east-c the one east-c-std has (moved into east-c, which east-c-std then uses), and east-py C's. The store can then adopt a directory's segments under their names (`adoptFile` takes a known hash).
9. **The conformance corpus.**
   - A generator in `libs/east` writes cases with their expected bytes: values, emission sequences and their runs, and merges. `make test-export` writes the corpus beside the compliance IR; it is never checked in.
   - east-c's and east-py's tests consume it, in those libs' CI workflows, which download it as they download the IR.
   - Re-cuts are checked in TypeScript, the one runtime with a Recut: `Recut(pieces) == Writer(whole)` over every corpus value.
   - `generate_fixtures.mjs` and its checked-in runner fixtures stay until stage 3's protocol cases replace them; stage 4 deletes the rest with the flags they test.
10. **String order** (#836). TypeScript's `compareFor` ordered strings by UTF-16 code unit, while east-c and east-py order them by code point. So a Set or Dict that held a character above U+FFFF beside one in U+E000–U+FFFF was written in two orders, and each runtime refused the other's blob.
    - TypeScript moves to code points, keeping `x < y` unless both strings hold a code unit at or above U+D800.
    - SPEC states the rule (§3.4, rule 7), and the corpus pins it.
11. **Negative zero in paged reads** (#838). TypeScript's pager decoded each Set or Dict segment into a plain JS `Set` or `Map`, whose keys compare by SameValueZero. So a `-0` element read back as `0`, and a Dict keyed by both read back one entry, through every lazy, keyed, paged and merged read.
    - The segment decoder builds `SortedSet` and `SortedMap` under the East comparator, as the whole-value decoder does.
    - A pager test pins it, and the corpus pins the merge.
12. **Canonical recursive ids in manifests** (#839). A manifest's `type` recorded recursive type wrappers under the ids its writer's process allocated, so the manifest of one recursive-typed value had different bytes, and so a different store hash, per runtime and even per process.
    - The manifest writers (TypeScript's, and east-c's, which east-py binds) number recursive wrappers in preorder from 0 before encoding. Readers compare types up to renaming, so they are unchanged.
    - SPEC states the rule, and the corpus's recursive value pins it.
13. **SPEC** updated to v2.

Built in five parts, in this order:
1. per-element aliasing, cut rule v2 (normalized, with the segmentation benchmarks that fixed it), one encoding and one Writer;
2. the RunSorter and the Merger;
3. Recut, the Writer's per-segment output, and record applies on Recut;
4. manifests in every runtime;
5. the corpus, string order, negative zero in paged reads, canonical recursive ids in manifests, SPEC v2, and the acceptance tests not yet written.

Acceptance:
- A `Dict<String, Blob>` of 300 × 1 MiB is stored in segments near the size target, not in one segment.
- A one-row change to a wide-row record re-cuts O(1) segments; so does an edit to an Array.
- TypeScript, C and east-py cut, sort and merge the same values to the same bytes (the corpus).
- Every indexed and paged read works on v2 geometry, each covered by a test on v2 data:
  - key lookup by fence bisect (`findDatasetKey`);
  - positional reads by segment counts;
  - range reads;
  - record index pages;
  - lazy iteration;
  - e3-ui ValueTree and Sheet paging.
- Every pre-cutover form still reads: `/1` cuts, blobs, and segment-scoped aliasing.

### Stage 2 — One door (e3-core)

Read first:
- `dataset-open.ts`, `dataset-adopt.ts`, `trees.ts`, `processExec.ts` and `storage/interfaces.ts`;
- e3-types `dataset-blob.ts`;
- e3-api-server `handlers/datasets.ts`;
- the transfer commit;
- e3 `export.ts`.

Changes:
- **`storeCollection`** (§3.6) in e3-core, with every door routed through it:
  - the callers of `adoptOutputFile`;
  - the partitioned template's splice steps, whose seams it re-cuts;
  - `datasetWrite` and `adoptDatasetBlob`;
  - `datasetAdoptFile` and `objectAdoptFile`, which now split deliveries (D14);
  - the transfer commit, and `datasetAdoptObject`, its dedup door;
  - API `PUT`, now streamed instead of decoded whole in the server, with `e3 dataset set` against a server sending the paged encoding;
  - export.
- **The adoption memo** (§3.6): a `RefStore` pair, in the local and in-memory backends (e3-cloud's comes with stage 8). `datasetAdoptFile`, `objectAdoptFile` and the transfer init consult it.
- **Delete:**
  - `cutDatasetBlob`'s whole decode;
  - `cutDatasetObject`'s `readDatasetWhole` fallback;
  - every writer's blob branch (F3, F16, F20, F21);
  - `isContentCut` and its callers — the door re-cuts instead.
- **Required backend capabilities** (§3.6).
  - Delete their fallbacks: `dataset-open.ts:158` and `:439`, `partitionIo.ts:171-173`, `processExec.ts:175` and `:216`.
  - The header of `storage/interfaces.ts` names the backends that exist (F37).
- **Scratch inside the repository** by default (`scratch.ts`) (F33).
- **The door frames inline** (`writeCollectionManifest`): the frame pool is not memory-bound (#841).

Acceptance:
- Every collection stored after this stage is a manifest cut by the v2 rule, whatever door it came through, with a test per door.
- No door's memory grows with the value: a test per door on an input larger than a memory cap set for the test.
- A re-delivered file with one changed row shares all but O(1) segments with the previous delivery.
- An unchanged delivery, adopted again locally or over the transfer, costs its hash and is not split again.

### Stage 3 — The runner protocol (east, east-node-cli, east-c-cli, east-py-cli)

Read first:
- each CLI: `cli.ts`, `runner.ts` and `loader.ts`; `main.c`; `cli.py` and `runner.py`;
- `emit_sink.c`;
- e3-types `runner.ts` and `stream.ts`.

Changes:
- **`Unit`, `Output` and `Result`** (§3.5) in `east`, with a C decoder in east-c and the east-py binding.
- **`exec`** in all three runners:
  - outputs written through the Writer and RunSorter as manifest directories (§3.5), so the RunSorter writes each run as one, in TypeScript and C;
  - `threads` honoured — east-c's own pool and `east`'s frame pool are sized to the grant, not the machine;
  - the result written.
- **`run --snapshot`, `--from-snapshot` and the `.east-snapshot` tar format are deleted** (§3.5): nothing in the platform uses them, and `exec` replays any unit.
- **Corpus cases for the protocol:** unit files, their expected outputs and their expected results, exported as stage 1's corpus is. They replace the runner fixtures `generate_fixtures.mjs` checks in for everything the protocol covers: outputs, merges and paged inputs. The fixtures that only the old `run` mode flags and the `merge` command use stay with them.
- **`compile.ts` is split by concern, as a move with no logic change.** One file held the TypeScript runtime's pieces, its IR compiler and every builtin, and the lazy-read fix below edits it. Under `libs/east/src/compile/`, the split gives the runtime pieces, the IR compiler dispatching to a module per node family, and the builtins in a module per domain. `compile.ts` re-exports the same names, so no import changes.
- **A failing lazy read is an East error in every runtime.** Moving the paged-input errors into the corpus found one that diverged: a keyed read of a corrupt blob. TypeScript threw a plain JS error with no East location, and east-c and east-py raised an East error at the call, in a message without the segment numbers TypeScript gives. TypeScript now raises it as an East error at the call's location, and east-c names the segments as TypeScript does.
- **Additive for now:** the old `run` mode flags and the `merge` command stay until Stage 4 removes their last caller. `run -o` keeps writing what it writes today, which e3 reads until stage 4.

Acceptance:
- Every corpus unit gives byte-identical outputs and equal results on all three runners.
- A set or dict emitted in random order is written as sorted runs whose merge equals the Writer's output for the sorted value.
- A unit replays wherever it is moved with the files it names: every corpus case runs from a copy.

### Stage 4 — The task model and the engine (e3-types, e3 SDK, e3-core)

Read first:
- e3 SDK: `task.ts`, `export.ts`, `record-programs.ts`, `mutation.ts`, `record-index.ts` and `index.ts`;
- e3-types: `task.ts`, `execution.ts` and `record.ts`;
- e3-core: `execution/steps.ts`, `recordSteps.ts`, `LocalTaskRunner.ts`, `partitionExec.ts`, `partitionIo.ts`, `processExec.ts`, `jobs.ts`, `dataflow/steps.ts`, `dataflow/orchestrator/LocalOrchestrator.ts`, `records.ts`, `record-apply.ts` and `storage/local/gc.ts`;
- the e3-ui consumer of the task's `kind` and `metadata`.

In three parts:

- **4a — tasks.**
  - The typed task object (§3.3).
  - The SDK (§3.2), with `e3.output.*` and `e3.mutation.*` in `index.ts`.
  - The engine (§3.7):
    - unit graphs persisted in the dataflow's execution state;
    - units in the ready set;
    - content-defined pieces as sub-manifests;
    - assembly by output kind;
    - units spawned with `exec` through one unit builder (`execution/units.ts`).
  - Typed execution outcomes replace the `cancelled:` and `interrupted:` message prefixes (F8).
  - Kind tags and GC tests for the new objects (§3.11).
- **4b — records.**
  - Index builds and mutations on the engine (§3.7).
  - `$conflict` in the delta.
  - The Merger for applies. Recut already applies them, from stage 1.
- **4c — deletions.**
  - SDK:
    - `partitionTask` and its types;
    - the command IR for stock runners (`task.ts:217-242`);
    - `kind` and `metadata` in the config.
  - e3-types:
    - the partition and stream metadata and their decoders;
    - `TASK_KIND_*` and `stream.ts`;
    - `runnerOpensManifests` and `withRunnerVerbose`;
    - the partition plan's legacy decoder;
    - `partitionProjectionShape` and `projectKey`, since `by` is now data.
  - e3-core:
    - `templateFor` and `executeTemplate`;
    - `recordSteps.ts`;
    - `partitionIo.ts`'s virtual layout and `spliceChunks`;
    - `spliceBlobs`, `findSpliceViolation` and `SpliceOrderError`;
    - `buildRunnerArgv` and the splice branch of staging;
    - the test hooks in production modules (F19);
    - `STALE_WRITE_PREFIX`.
  - Runners: the `run` mode flags and the `merge` command, with `generate_fixtures.mjs` and the fixtures their tests use.
  - Package trees: the `function_ir` and `merge_ir` datasets. If 4a finds a consumer that needs them, it reads them through the task object instead.

Acceptance:
- A re-key of a long, wide collection through `streamTask`, `e3.partition` and a `dict` with `merge`, with keys emitted in random order:
  - runs within the §6 memory bound on every runner;
  - its output bytes equal the same value written by the Writer;
  - it produces the same bytes on east-node, east-c and east-py, and at every `-j`.
- A yield or crash mid-task resumes at the unit where it stopped.
- An insertion in the middle of a partitioned input re-runs only the pieces around it.
- An index build over a large record holds no slice in memory.
- A mutation reads O(touched) of the record.
- A stale write reports a typed conflict.
- GC keeps every object a unit graph names.
- Every guarantee in §7 still holds, now that records run on the engine.

### Stage 5 — Scheduling on cores and memory (e3-core, e3-cli, e3-api-server)

Read first: `jobs.ts`, `LocalOrchestrator.ts`, `dataflow/steps.ts`, `processExec.ts`, e3-cli `start.ts` and `watch.ts`, and e3-api-server `handlers/dataflow.ts`.

Changes:
- `jobs.ts` becomes the budget (§3.8), with `--memory` / `E3_MEMORY` and a walk of the cgroup's `memory.max` beside `cgroupCpuQuota`.
- Reservations come from `peakBytes` history, with probe-then-fan-out, the guard, and per-unit cgroups where delegation exists.
- Remove `state.concurrency`, `partitionConcurrency` and the deprecated `--concurrency` and `--partition-concurrency` aliases (F33).
- **The frame pool** (#841):
  - its memory becomes O(workers × segment): shared buffers reused per slot, and nothing allocated per frame that waits on a worker's GC;
  - then the store door frames on it again.

Acceptance:
- With `--memory` set below the sum of the units' peaks, a run completes without the kernel's OOM killer firing, and stays under the budget plus one unit's margin.
- The frame pool's peak is the same at two output sizes, in a runner's emit sink and in the door.
- A unit killed by the guard reruns to identical bytes.
- With no memory pressure, throughput at the default `-j` is no worse than before.

### Stage 6 — Automatic parallelism (e3 SDK)

Read first: `east`'s `builtins.ts`, `ir.ts`, `analyze.ts` and `walker.ts`; e3 `export.ts`; and how `East.importFunction` is linked.

Changes:
- **`parallel.ts`** (§3.9): the recognizer, the associativity proof, the compile to the explicit form, and the plan report from export.
- **An equivalence suite:** every recognised shape run as one unit and as many small pieces (through a test-only override of the piece size). Exact types must be byte-equal; floats must agree within rounding.
- **Follow-ups**, once single operations and chains are in: `Sort`, then reduction loops.

Acceptance:
- `sales.toDict(key, value, add)` over an input larger than one piece runs partitioned, emits, and stays within the §6 bound.
- Every shape the recognizer cannot prove runs as one unit, and export names the reason.

### Stage 7 — Docs, skills and examples

- **`libs/e3/SKILL.md`:**
  - the decision tree becomes two questions: does the output fit in memory, and can the work be split over an input?
  - the `partitionTask` and `streamTask` sections, and the "Which task kind?" table, are rewritten;
  - the runner docs follow the protocol;
  - it is a plugin skill: coordinate the change and regenerate the example index (plugin-artifacts).
- **Other docs:** `libs/e3/USAGE.md`, the Codex plugin's copy of the e3 skill, and the runner READMEs.
- **`libs/e3/design/`:** this document is rewritten to describe the code, and the review is deleted.

### Stage 8 — e3-cloud

In `elaraai/e3-cloud`, on the stages above:
- execution runs units with `exec` and streams segment objects instead of whole objects (F4);
- the loop engine runs the persisted engine, so partitioned and streaming tasks deploy (e3-cloud#178, #185);
- records run on the engine (e3-cloud#186);
- GC reads heads (F36);
- Lambda sizes are chosen from measured peaks.

## 5. Rules that keep it from drifting

- A PR that adds or changes a wire field states which migration rule it follows.
- A new object kind that names other objects carries a kind tag and lands with its GC test.
- A collection reaches the store only through `storeCollection`, enforced by module structure and a lint rule.
- A PR that changes documented behaviour rewrites the doc in the same PR.
- Before adding a primitive, search for an existing one.
- A new runner capability is a field of the unit, never a flag on one runner.

## 6. Benchmarks and bounds

A benchmark harness in `libs/e3/test/`, alongside `partition-scale.spec.ts`, runs at a small scale in CI and at full scale by hand:

- **Re-key:** a long collection of wide rows (a nested struct per row), re-keyed to a key unrelated to its order, with a `merge` that folds equal keys. The bound: peak memory at most `jobs × (the RunSorter's cap + a runner's baseline) + e3's baseline`, plus whatever the body itself holds, independent of the input's size.
- **Wide rows:** the 300 × 1 MiB Dict from #788.
- **Narrow rows and edits:** a long collection of narrow rows, and one-row edits to it and to the wide rows: segment sizes, page-read time, compression, and bytes rewritten per edit. Built in stage 1 with the wide rows, where the two fix the cut rule's parameters.
- **Deliveries:** two deliveries differing in one row (Stage 2 acceptance).
- **Automatic:** the re-key written as `toDict` in an `e3.task` (Stage 6 acceptance).

The PR records each stage's numbers.

## 7. #786's guarantees

#786 is epic #779's delivery: the segment-object layout, secondary indexes, the mutation delta and record steps. It is folded into this PR (D2). Stages 1 and 2 changed some of its code by plan items: the cut rule, record applies on Recut and the one door. Its records and mutation code, API, CLI and UI paging are otherwise as it wrote them. Stage 4 moves index builds and mutations onto the engine.

What #786 guarantees holds through every stage. Each guarantee is pinned by a test, which a stage may rename along with an API it renames, but never weaken:

| Guarantee | Pinned by |
|---|---|
| An applied delta writes the manifest the encoder door writes for the resulting value. This covers one-row edits, inserts that split a segment, deletes that merge two, a segment's first key deleted, a record emptied and refilled, randomised edits at the boundaries, a Set target, and a delta with several arms | e3-core `record-apply.spec.ts` |
| A one-row edit reads and writes the same objects and bytes at 100,000 rows as at 10,000 | `record-apply.spec.ts` |
| A maintained index equals the index a reindex writes, hash for hash | e3-core `records.spec.ts` |
| A fanned-out index build writes what the one-unit build writes and never reads the record whole. A rebuild over an unchanged record re-runs no unit | `records.spec.ts` |
| east-node, east-c and east-py write the same state and index manifests, skip a no-op write, and refuse a stale one in the same words | `records.spec.ts`, cross-runtime parity. It runs where CI builds east-c (Linux, macOS) |
| Two patches on different keys both commit. A stale patch, update or whole-state replace is a conflict naming the key, and writes nothing | `records.spec.ts`; e3-api-tests `records-keyed` |
| A patch on a record with no index runs no process | `records.spec.ts` |
| The runner is handed the record as a stream, never whole | `records.spec.ts` |
| An indexed record reads as its rows through every ordinary door | `records.spec.ts`; `records-keyed` |
| A reserved `$` slot survives a mutation and a compaction | `records.spec.ts` |
| gc keeps every object a commit, its delta and an index name | `records.spec.ts`; `gc.spec.ts` |
| The generated programs: targets in canonical order; the reduce, edit and patch forms; index maintenance inside the delta; the index build | e3 `mutation-programs.spec.ts`, `record-index.spec.ts` |
| Keyed records through the API at 10,000 rows (`E3_RECORD_ROWS` raises it) | e3-api-tests `records-keyed`, run by `api-compliance.spec.ts` |

Two of #786's fixes are not pinned by a test yet. One stops a reindex dropping reserved `$` slots. The other makes a record write hold the tasks lock shared, so a gc sweep cannot run under it.

Each of #786's deferrals has a place:
- the large-write apply and migrations by template run on the engine (stage 4);
- runners open manifests (stage 1), and task outputs are stored through the door (stage 2);
- partition slices become sub-manifests (stage 4a);
- the cloud half is stage 8 (e3-cloud#186, #175).

The Plan and Sheet arms for index-ordered windows stay outside this epic, as #786 left them.
