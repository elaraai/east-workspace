# e3 data and execution — architecture

This document describes how e3 stores data and runs work, as the code does it:
- the stored form of a collection, and the one door into the store;
- the runner protocol;
- the engine that runs a task as units;
- scheduling on cores and memory;
- the repository's records;
- the reactive dataflow and its locks;
- the API's data contracts;
- record migrations.

Everything here is built except automatic parallelism (§3.9), which is designed here and built in a PR of its own. A change to what this document says rewrites it in the same PR (§4). The plan that built it — its decisions, its stages and the review behind them — is in git history, in #797 and in #831.

## 1. Principles

- **Bounded memory.** No runner, orchestrator or door holds a large value whole. Every cap is explicit, and independent of the data's size, its key order and how far it expands when decoded.
- **Bytes are a function of content.** A stored collection's bytes do not depend on the runtime, the emission order, the partitioning, buffer sizes or object identity.
- **Nothing is declared or guessed.** Authors state what an output means, never how data is ordered or sized. There are no performance modes.
- **One model.** A small result is returned; a large one is emitted into an output kind, and the platform does the rest.
- **Value work on runners, byte work in storage.** User East runs only in runner units. e3-core plans, schedules, assembles bytes and records.
- **One primitive, one place.** Each collection operation has one TypeScript implementation in `east` and, where C needs it, one in east-c, pinned to each other by the conformance corpus. e3 calls them and never re-implements one.
- **One stored form, one door.** Every collection in the store is a manifest of segment objects, written through `storeCollection`.
- **One engine.** Every multi-unit computation — pieces, merges, folds, index builds, migrations — is a unit graph run by one persisted engine, whose units the dataflow schedules.
- **Typed contracts.** Modes are variants, and outcomes are typed. Every new kind of object that names other objects carries a kind tag. One written rule governs how a wire changes.
- **Docs are rewritten with the code.**

## 2. What is written elsewhere

- The beast2 container, the manifest, the cut rules and the deterministic DEFLATE: `libs/east/src/serialization/beast2/v5/SPEC.md`.
- Which container versions each release reads and writes: `docs/conventions/BEAST2_WIRE_VERSION.md`.
- How a wire changes: `docs/conventions/WIRE_MIGRATION.md`.
- Running a task: `e3-execution.md`. It covers the execution records, a stopped execution and its causes, a split task's stages and logs, and the budget's mechanics.
- How a record's state, its delta and its indexes are stored: `e3-records-storage.md`.
- The terminal UI over a repository: `libs/east-ui/packages/e3-ui-cli/docs/tui/DESIGN_TUI.md`.
- The author's and the user's view: `libs/e3/SKILL.md` and `libs/e3/USAGE.md`.

The other documents in this directory record earlier designs. #956 lists those that name what e3 no longer does.

## 3. The architecture

### 3.1 Who owns what

| Layer | Owns | Never |
|---|---|---|
| **beast2**: `east` (TypeScript) and `east-c` (C, which east-py binds) | the canonical form, the manifest, the collection primitives (§3.4) and the runner protocol's types (§3.5) | knows about tasks |
| **Runners**: east-node-cli, east-c-cli, east-py-cli | evaluating East; executing units; writing outputs through beast2's Writer and RunSorter; reporting a typed result | plans, schedules, merges runs it was not given as a unit, or checks emission order |
| **e3-core** | planning unit graphs, scheduling units, assembling outputs (manifest concatenation and Recut), the store's door, the execution cache, GC | evaluates user East |
| **e3 SDK** | the authoring API and the typed task object; automatic parallelism, once built (§3.9) | makes run-time decisions |

### 3.2 Authoring

```ts
e3.input(name, type, source?)
e3.record(name, type, initial)
e3.task(name, inputs, fn, config?)               // returns; inputs are datasets only; config: { runner?, environment?, role? }
e3.streamTask(name, { inputs, output, runner?, environment? }, ($, ...inputs, emit) => void)
e3.partition(dataset, { by? })                   // a streamTask input the work may be split over
e3.output.array(T)
e3.output.set(T)
e3.output.dict(K, V, { merge? })                 // merge: ($, key, a, b) => V
e3.output.fold(T, { zero, combine })             // combine: ($, a, b) => T
e3.customTask(name, inputs, outputType, command, config?)
e3.function(name, fn, config?)
e3.mutation.reduce(name, record, fn, config?)
e3.mutation.edit(name, record, fn, config?)
e3.mutation.patch(record, name?, config?)
e3.mutation.editType(recordType)
e3.recordIndex(name, record, spec, config?)
e3.migration.value(name, record, fn, config?)    // (Old) => New; config: { after?, runner? }
e3.migration.rows(name, record, fn, config?)     // a Dict's rows (K, V1) => V2, or an Array's elements (T1) => T2
e3.migration.rekey(name, record, fn, config?)    // a Dict's (K1, V1) => { key, value }, or a Set's elements (T1) => T2
e3.package(name, version, ...items), e3.export(pkg, path)
```

**`e3.task`** runs one unit. Its inputs are datasets: an input `e3.partition` marks is refused when the task is defined. A large input opens lazily, and a collection the body returns is written through the Writer segment by segment. Once automatic parallelism is built (§3.9), a body whose shape allows it runs split without the author asking.

**`e3.streamTask`** emits into an output kind. The kind fixes `emit`'s signature and how parts of the output combine:

| Output kind | `emit` | Parts combine by |
|---|---|---|
| `array(T)` | `emit(t)` | concatenation: emission order within a unit, units in input order |
| `set(T)` | `emit(t)` | union |
| `dict(K, V, { merge? })` | `emit(k, v)` | union by key; equal keys fold with `merge(key, a, b)` in input order; without `merge`, a repeated key fails and names it |
| `fold(T, { zero, combine })` | `emit(t)` | every emitted value folded with `combine`, starting from `zero`, in input order |

Emission order is free: the platform sorts sets and dicts. A producer is a `streamTask` with no inputs. A `streamTask` runs on a stock runtime, since the `custom` one runs only a program that returns its output.

**`e3.partition(dataset, { by })`** marks an input the work may be split over:
- The body receives one piece, typed as the whole dataset. Pieces are content-defined ranges: key ranges of a Set or Dict, position ranges of an Array (§3.7).
- `by` names leading key fields — `['account']`, or `['a.b']` for a first-field path. Rows with equal values of those fields are never split across pieces. It is data, validated against the key type at definition.
- Two or more partitioned inputs are cut at the same keys. They must be Sets or Dicts whose keys, or whose `by` fields, have the same types.
- Unmarked inputs reach every piece whole, opened lazily when large. A change to one re-runs every piece.
- With no partitioned input, the task is one unit with exact left-to-right semantics.

**The author's contract**, the only one: `merge` and `combine` are associative, `zero` is an identity of `combine`, and a partitioned body's combined result does not depend on where the input was cut.

**Refused at definition**, naming the task:
- a partitioned input on `e3.task`;
- a `streamTask` whose output is not an output kind, or whose runner is the `custom` runtime;
- `e3.partition` of a value that is not a collection;
- co-partitioned inputs without a common key;
- a `by` that names something other than leading key fields.

`emit`'s types come from the output kind, so a mismatched call is a type error.

### 3.3 The task object

A task object (`TaskObjectType`, `e3-types/src/task.ts`) types every field a mode could otherwise be implied by:

```
TaskObject = {
  kind:   '$task',
  body:   east    { program: <IR object hash> }          // e3.task, e3.streamTask
        | command { commandIr: <IR object hash> },       // customTask
  runner: RunnerType,
  inputs: [ { path: TreePath, partition: Option<{ by: [String] }> } ],
  output: { path: TreePath,
            kind: value | array | set | dict { merge: Option<IR hash> }
                | fold { zero: <value hash>, combine: <IR hash> } },
  role:   data | ui { paths, functions, records, pages },
  environment: Option<String>,
}
```

- Inputs are data only. A body or a merge function is never an input by position, so the unit builder (§3.5) never counts wire indices.
- An `e3.task` on the `custom` runtime has an `east` body too. e3 runs the runner's command with `run`'s arguments — `-i` for each input, `-o`, then the program's file — as it runs an `e3.function` on a custom runner. Only a `customTask` has a `command` body.
- `role.ui` is what a UI task binds as it renders: the datasets it reads or writes, the functions it calls, the records it binds and the datasets it pages through.
- It carries its kind tag, `$task`, for GC (§3.11).
- It is package-borne, so it changes by hard cutover (§3.12): a package an older SDK exported does not decode, and is re-exported.

### 3.4 The collection layer (beast2 v5, format v2)

**Canonical rules**, all written in `v5/SPEC.md`, with rule ids stamped in manifests:
1. **Aliasing is scoped per root element,** so an element's bytes depend on that element alone.
2. **The Set/Dict cut rule** (`cdc/keyed/fnv1a-fmix32/256-1024-4096/64K-1M-8M/2`) is content-defined on a hash of each key's canonical bytes, with a size-aware boundary test.
   - The cut probability rises with the open segment's logical size (normalized chunking), so a segment holds about 1024 narrow elements or about 1 MiB of wide ones.
   - Every segment but the last holds at least 256 elements or 64 KiB.
   - A cut is forced at 4096 elements or 8 MiB.
   - Size is measured on the pre-deflate canonical element encoding, which rule 1 makes identical across runtimes.
3. **The Array cut rule** (`cdc/array/…/2`) is the same test over a hash of each element's canonical bytes, so an edit re-cuts only the segments around it.
4. **One encoding per value:** no encoder option switches the cut rule.
5. **The deterministic DEFLATE encoder** is specified.
6. **The manifest** is specified: `$segments`, the rule id, the header, entries `{hash, fence, count, bytes}`, and `level`, reserved as 0. Every hash it holds is a SHA-256, the name the store gives the object.
7. **Strings order by code point** in every runtime, which is the order of their UTF-8 bytes.
8. **A manifest's recursive types are numbered canonically,** in preorder from 0. So one value's manifest has one hash in every runtime and every process.

**Primitives:**

| Primitive | Contract | TypeScript (`east`, `v5/`) | C (`east-c`) |
|---|---|---|---|
| Writer | ascending elements → canonical segments: to a blob, or segment by segment as standalone segment blobs | `stream.ts` (`Beast2ElementWriter`) | `v5/stream.c` |
| RunSorter | elements in any order → sorted canonical runs. It holds encoded elements up to a cap and sorts them stably by (key, emission order). Equal keys fold with `merge` or are refused; a set unions | `runs.ts` (`Beast2RunSorter`) | `v5/runs.c` |
| Merger | k sorted collections, blobs or manifests → one, optionally over one key range; equal keys fold in input order | `merge.ts` (`mergeBeast2For`) | `merge.c` |
| Recut | pieces in order → the canonical whole, segment by segment. A segment the whole shares with a piece is carried without being read; only seams and elements are re-cut. Async, because its callers read segments from the store | `recut.ts` (`recutBeast2For`) | none: only e3-core re-cuts |
| Splice / carve | segments into one blob, or out of one, streamed | `geometry.ts` (`spliceBeast2Segments`, `carveBeast2Ranged`) | east-c's own |
| Manifests | the `$segments` object, and the manifest directory: a manifest beside `<manifest>.segments/`, each segment file named by its SHA-256 | `manifest.ts`, `manifest-writer.ts`, `sha256.ts` | `v5/manifest.c`, `sha256.c` |
| Lazy readers | paged values over a blob or a manifest | `lazy.ts`, `stream.ts` (`Beast2Pages`) | the pager, over a blob or a manifest |

The Writer is the only segmentation code, and every runner writes through it. The corpus pins the Writer, RunSorter and Merger across TypeScript and C. Recut is pinned by `Recut(pieces) == Writer(whole)` over every corpus value.

### 3.5 The runner protocol

Every stock runner has one command for machines:

```
east-node | east-c | east-py  exec <unit.beast2>
```

The types live in `east` (`src/runner_protocol.ts`), which every runner and e3-core depend on, with a C decoder in east-c that east-py binds:

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
- `peakBytes` is the process's peak resident memory, measured per platform:
  - on Linux, VmHWM, since `ru_maxrss` there inherits the parent's across exec;
  - on Windows, the peak working set;
  - elsewhere, `ru_maxrss`.

  east-py reports east-c's measurement.
- `timings` are milliseconds spent loading the inputs, compiling, executing and writing the output. `locations` are the failure's source locations, innermost first, as the program's source map gives them.
- The exit status is 0 when the outcome is `ok` and 1 when the result records a failure. Anything else, or a missing result, is a crash; e3 reports it with the signal and the stderr tail.
- `--exit-with-parent` is a process flag, taken before anything else is parsed.

`run <program> -i … -o …` is for people, and for the `custom` runtime, on a path of its own beside `exec`'s. It reads the IR and the values in any of the formats, prints the result when there is no `-o`, and writes a collection result as one paged blob, a single file that any decoder reads. Its `-v` names the program, its platforms, its inputs and its output before the Timing and Memory sections `exec -v` prints. The lazy-open threshold is a setting (`EAST_LAZY_INPUT_BYTES`).

Parity between the runners is the conformance corpus: unit files with their expected output bytes and results, run by all three in CI. Results compare by outcome, since `peakBytes` and `timings` are measurements.

### 3.6 The store door

One function in e3-core, `storeCollection` (`store-collection.ts`), is the only way a collection reaches the store. It takes a collection as sources in order, writes the segment objects and the manifest, and returns the manifest's hash, the dataset's content address.

| Source | What the door does |
|---|---|
| a manifest in the store | carries its segments by reference, never reading them, and re-cuts only the seams between sources. One cut under another rule or header, which an older e3 wrote, is refused |
| a stock runner's output: a manifest directory, or a blob | stores its segments as they stand, never decoded: a directory's segment files are linked in under the hashes that name them, 16 at a time, and a blob's segments are carved out of the file. The Writer wrote them, and the corpus pins its bytes in every runtime |
| the runs of a unit graph | assembled by the engine (§3.7), and handed over as the manifests they are |
| foreign bytes: a delivered file, an API `PUT` body, a custom task's output | read a source segment at a time and written again through the Writer, so nothing about the source's layout survives into the store. A segment whose logical size passes the RunSorter's 64 MiB cap is refused before it is read, naming the fix: a whole-value encode, a v4 blob or an oversized batch |
| elements in memory (`datasetWrite`, export defaults) | written through the Writer |

It checks the declared type and never decodes a value whole. Every door routes through it:
- task outputs;
- record commits;
- index builds;
- mutation outputs;
- file adoption;
- the transfer commit;
- API `PUT`;
- export.

**The adoption memo.** A delivery the door has split is remembered by its SHA-256: the backend records the file's hash and the manifest it became. An adoption, or a transfer init, that finds a live entry points the dataset at that manifest without reading the file again, so an unchanged delivery still costs a hash locally and a round trip remotely. An entry is not a GC root, and one whose manifest is gone is a miss.

The backend capabilities every path relies on are required, with no whole-object fallback: ranged reads, adoption by link, `materialize`, plan and owner records, and the adoption memo.

The door frames on the worker frame pool once a value is large enough to be worth it. The pool holds the frames in flight and nothing more. Each worker reuses its slots' shared buffers and its deflate's working buffers, so nothing a frame leaves waits on a worker's GC, which V8 runs only after about 64 MB of buffers per worker. Its memory is bounded by the workers and the largest segment, whatever it frames. A worker that fails abandons the pool, and the process frames inline from then on. e3's own pool is sized by the budget (§3.8).

Scratch defaults to a directory inside the repository, `tmp/scratch/`, on the object store's filesystem. Runner output then links in without a copy and never sits on tmpfs.

### 3.7 The engine

Every task execution is a **unit graph**, built by one engine (`execution/engine.ts`) and persisted in the dataflow's execution state.

1. **Plan.** With no partitioned input, the graph is one `run` unit. Otherwise it is cut into pieces (`execution/pieces.ts`):
   - **The piece rule.** Boundaries fall at segment fences chosen by a content-defined rule over the primary input's manifest.
     - Its segments are walked in order, with `b` the stored bytes of the open piece.
     - A segment closes the piece after it when `b` reaches 256 MiB, or when `b` is at least 16 MiB and the first 32 bits of the segment's SHA-256, the hash the store names it by, fall under `2^32 × s / D`.
     - Here `s` is the segment's stored bytes, and `D` is 256 MiB until the piece holds 64 MiB and 16 MiB after, so most pieces hold 64 to 100 MiB.
     - Where a piece ends depends only on the segments near that point, so an insertion moves only the pieces around it.
     - The sizes are platform constants (§3.10).
   - **Tests.** Tests alone set `E3_TEST_PIECE_BYTES=n`. It makes the three sizes `n/4`, `n` and `4n` bytes and the merge range size (below) `n`, so a small input has many pieces and its merges many ranges. It is never a machine setting.
   - **`by`.** A boundary moves forward to the end of the `by` group it falls in. A group usually ends inside a segment, and the boundary lands there: that segment is split and re-encoded, as a co-partitioned input's are, so a piece keeps its size however large the groups are.
   - **Co-partitioned inputs** are split at the same keys: each at its first row whose key, or `by` fields, reach those of the piece's first row.
   - **Sub-manifests.** Each piece is a sub-manifest naming existing segment objects, so no bytes are copied. A split point inside a segment re-encodes that one segment.
2. **Run.** One `run` unit per piece, each a content-addressed execution. A piece whose set or dict output fills several runs merges them into one, as a one-unit task does, so every piece's output is one manifest.
3. **Assemble,** by output kind:
   - `value`: the one unit's output.
   - `fold`: `merge` units fold the partials, a fixed fan-in at a time, in input order.
   - `array`: e3 concatenates the pieces' manifests and re-cuts the seams; no unit is needed.
   - `set`/`dict`:
     - e3 groups the pieces' outputs whose key ranges overlap, reading fences plus one segment decode for an output's last key.
     - Each overlapping group becomes ranged `merge` units. `planMergeRanges` chooses the range boundaries from fences, each range covering about 64 MiB of the group's parts, the pieces' middle size.
     - The disjoint results are concatenated and re-cut at the seams.

   The result goes through the door as one manifest.

**Persistence and scheduling.**
- The dataflow's ready set is units, from every task. A task that splits is planned when it becomes ready, and its units join the ready set a stage at a time: its pieces, then each merge level.
- Each stage's units are a `$plan` object (`UnitPlanType`), written once and named by the task's entry in the execution state, which records the stage rather than each unit. So a state write grows with the tasks, not the units: a 10 TB input is some 160,000 pieces. A plan names the plan of the stage before it, and the largest peak those stages reached (§3.8).
- A yield or a crash resumes per unit. The stage's `$plan` is read back and each of its units probed in the execution cache, so the units that finished are found without being recorded one by one, and only the rest run.
- The run's timeline records a split task's stages: its pieces planned, and each merge level started and finished. Each unit's progress is a callback, which the CLI prints. The API's events are a task's, and a requeued unit's (§3.8).
- The execution state and its events carry a version. A reader reads its own version and refuses any other, naming it.
- Every unit, a piece with the merge of its own runs or a merge or fold over pieces, is cached on its own identity: kind, program or merge function, input hashes and output kind. A re-run after an append re-runs only the pieces it touched and the merges they reach. Because pieces are content-defined, the same holds for an insertion in the middle.

**Drivers.** `SplitTask` is a split task's stages:
- It opens the task: it plans the pieces, or takes up the stage a `$plan` names.
- It is told as each unit starts and settles.
- Once every unit it started has settled, it advances: to the next stage, or to the task's end.

A driver may stop between any two calls and open the task again from its plan, which replays the settled units from the execution cache. The drivers are:
- the dataflow's loop, which runs the units beside every other task's;
- `executeSplitTask`, which runs them in a pool of its caller's width through a `UnitExecutor`, for a task run on its own (`e3 run`) and for any backend that drives the engine itself.

A driver passes the owner the task's own execution is recorded under. `taskExecute` passes its process, and the loop the owner its caller gives, its own process unless told. A driver that passes none leaves the execution for no probe to repair. `probeExecutionCache` is the cache contract every runner keeps.

**Records run on the engine:**
- **Index builds** are split tasks over the record's primary.
  - e3-core writes an index's build task from its index object: the build program as the body, on the index's runner, over one input, the primary, partitioned with no `by`, into a `dict` output with no merge.
  - It runs as any task does, so a rebuild over an unchanged primary is served from the execution cache. A larger one runs as pieces and merges with the engine's plan, logs, budget and cancellation.
  - The build program emits each row's entries as it reads them. An index object carries no merge function: two pieces never emit one entry, since an entry's `k` is in one piece.
- **Mutations** run as one unit through the same executor as tasks, with its execution records, logs, cancellation and a timeout.
  - e3-core writes a mutation's task from its mutation object: the mutation's program, or an unkeyed record's reducer, as the body; the state and each argument as its inputs; and a `dict` output, the delta, or a `value`, the reducer's new state.
  - The mutation API runs it outside the dataflow graph, and one that ran over the same state and arguments before is served from the execution cache.
  - The state reaches the runner as the primary's manifest, its segments linked, and the program reads it lazily. It emits the delta's entries as it computes them, in any order.
  - A stale write is a `$conflict` entry in the delta, keyed by what went stale, which sorts before every target.
  - The delta is applied over the touched segments inside the compare-and-swap loop, one target segment at a time: the apply holds that segment and its changes, and re-cuts through Recut. The Merger does not apply a delta, since a change can delete a row.
  - A mutation's output is stored as segments and never read whole, so it has no result-size cap.
- **Migrations** run on the engine too (§3.18): a `value` step as one unit, and a `rows` or `rekey` step as a task split over the state.

### 3.8 Scheduling: cores and memory

One budget of cores and memory is the one setting a person makes (`execution/budget.ts`).

- **Capacity.**
  - Cores: `-j` or `E3_JOBS`, defaulting to the CPUs available (affinity and the cgroup's `cpu.max`).
  - Memory: `--memory` or `E3_MEMORY`, defaulting to the cgroup's `memory.max` found the same way, else physical memory, less a reserve for e3 and the OS.
  - e3's own framing: the door frames on a worker pool in e3's process (§3.6), whose workers take cores too. The CLI and the API server cap the pool from the budget, at two workers by default: the door's writing thread is the bottleneck, and two give it all the speed-up measured on narrow rows.
  - One budget per e3 process. A server's is shared by every run and every unit it spawns — dataflow units, function calls, mutations and index builds — since the memory is the machine's; each CLI command that runs units holds its own.
  - Every command that runs units takes `-j` and `--memory` for a local repository: `e3 dataflow run`, `watch`, `run`, `call`, `mutate`, `reindex` and `workspace deploy`, `e3-api-server`, and `e3-ui` for its embedded server. Against a server they are refused, since the server's budget runs the work.
- **Layering.** The budget is the local runner's, never a shared layer's.
  - The dataflow's loop, its step functions, its state, the `TaskRunner` interface and the API's types know no budget. The loop keeps `width` tasks and units in flight, four unless its caller sets it: the CLI and the API server set it to their budget's cores, and a remote backend sets its own.
  - `LocalTaskRunner` holds the budget, so admission, the thread grant, the guard and cgroups all happen inside it. A remote backend's runners hold whatever capacity is theirs.
  - Peaks are data. Execution records store them, and each unit of a split task goes to its runner with the largest peak its stage has reached in the run (`expectedPeakBytes`): a local runner reserves it, and a remote one may size the unit's compute from it. Running one unit before fanning out is the drivers' job — the loop's, and the pool of a task run on its own — and serves both.
- **Admission.** A unit takes one core plus a memory reservation, and starts when both fit.
  - Its `threads` grant is up to four, on that one core: a runner frames a large output on that many workers, in bursts, and every runner's writers frame a manifest output on their pool. Measured on a lone unit, one thread wrote a large output up to 2.6× slower than four, and past four nothing gained; each thread costs about 25 MiB, which the unit's measured peak includes.
  - A unit larger than the whole budget runs alone.
  - A unit that does not fit lets smaller ones pass for a bounded time, then waits for the room it needs.
- **Reservations are measured in the run, not guessed.**
  - Each execution record stores its runner's `peakBytes` with its `success` or `failed` outcome, and a split task's own record the largest of its units'.
  - A unit of a split task reserves the largest peak a unit of its stage — the task's pieces, or one level of their merges — has reached in the run. A unit the execution cache serves counts, since its record holds its peak. Nothing is looked up from earlier runs, so a peak that a changed program or input no longer reaches never sizes a unit.
  - A stage runs its first unit alone, then fans out, while other work runs. A unit with no peak measured before it reserves nothing: a stage's first, a unit of a stage whose runners report no peak, a task run as one unit, a mutation, a function call.
- **Guard,** on Linux and macOS; Windows keeps reservations alone.
  - Every runner the local runner starts is watched while it runs. e3 measures its resident memory every quarter second:
    - its cgroup's working set (`memory.current` less its inactive file cache), where it has one;
    - else, on Linux, the resident memory of its process tree, walked through `/proc` from the runner down;
    - and on macOS, its process group's, from one `ps` of every process.
  - Admission counts a running unit at the larger of its reservation and what it uses, so nothing more starts near the budget.
  - Past the budget, the guard stops the most recently started engine unit — a piece, or a merge or fold, of a split task — that is not running alone, one at a time.
    - The stopped unit waits for the budget again, reserving the most it reached, and reruns under the same execution id from a clean output directory; its log says why.
    - Units are pure and content-addressed, so a stopped unit leaves nothing behind and reruns to the same bytes.
  - A user task — a task that runs as one unit, a mutation, a function call — may touch outside systems. So the guard stops one only when the machine would otherwise run out: when no engine unit is left to stop and the machine's available memory is under 5% of it. It fails, naming the memory, and so does a unit running alone.
  - Walking one runner's tree costs about 0.3 ms, where reading every process in `/proc` cost tens of milliseconds of CPU on a busy host.
  - In a container, `MemAvailable` is the host's, so the machine the guard protects is the tightest cgroup limit up e3's hierarchy, less that cgroup's working set, where that leaves less than the host has.
- **cgroups,** on Linux, where e3's own cgroup is delegated to it and `E3_CGROUPS` is not `0`. `systemd-run --user --scope -p Delegate=yes` delegates one.
  - e3 first moves itself into a child cgroup of its own, since the kernel requires that before its cgroup's children can take the memory controller.
  - Each unit then runs in a cgroup of its own beside it, which its runner enters before it starts.
  - A unit with a reservation is capped (`memory.max`) at the reservation plus half, and at least 64 MiB more, so a runaway unit dies alone. Its cgroup has no swap (`memory.swap.max` 0), where swap would let it crawl on instead of dying and running again under a larger cap.
  - A unit its cap kills is requeued reserving its cap, so each requeue raises the cap by half, and one that needs more than the budget runs alone. A unit with nothing measured yet is not capped: the guard alone watches it.
  - The peak a unit records stays its runner's own. `memory.peak` counts the page cache the unit's reads and writes fill, so a unit writing 1 GiB would record about 1 GiB more than it used, and every later unit of its stage would reserve that.
- **Visibility.** The API serves what the budget is doing with a run's state, where the server has one; a backend without one serves none. That is the cores and memory in use against its capacity, a unit waiting for room and how much it needs, and a unit the guard or its cap stopped and requeued, with the peak it reached. A task's runs carry each execution's `peakBytes`. e3-ui's TUI shows them: the budget, the waits and the requeues in the execution panel, the peaks in the tasks table and the Runs tab, and the budget a run gets in `/run`'s confirmation.
  - The local runner reports a unit waiting for room, and a unit it requeued, through two callbacks of the execution options, which any runner may call; the loop names each by its task and unit.
  - A requeue is an event of the run, which the execution state stores. A wait matters only while it lasts, so the loop keeps it in memory, and the API serves it, with the budget in use, beside the run's state.
  - So does a split task's progress: its stage, and how many of the stage's units have finished, which the TUI's start line names (`forecast · 3 of 8 pieces`).

`e3-execution.md` (The Budget) has the mechanics: the admission queue's timing, the reserve, the cgroup names and what each stop writes to a unit's log.

### 3.9 Automatic parallelism

Not built: it lands in a PR of its own. Until then `e3.streamTask` with `e3.partition` is how work splits. It adds no field to the task object, so it is no second cutover: a task it rewrites re-runs once, when its package is re-exported.

At export, after `East.importFunction` references are linked, the SDK examines each `e3.task` body's IR. When the body's result is built from one input through collection operations whose algebra is known, the task compiles to the explicit form:
- that input is partitioned;
- the output gets an output kind;
- each piece's body emits instead of building the collection.

Whatever the body does after the recognised operations runs once, as a second task the SDK writes over the assembled output, so the task object (§3.3) gains no field.

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

The recognizer lives in the e3 SDK (`libs/e3/packages/e3/src/parallel.ts`) as one TypeScript implementation. It runs at export, never at run time. Its acceptance:
- `sales.toDict(key, value, add)` over an input larger than one piece runs partitioned, emits, and stays within the §5 bound;
- every shape the recognizer cannot prove runs as one unit, and export names the reason;
- an equivalence suite runs every recognised shape as one unit and as many small pieces (through `E3_TEST_PIECE_BYTES`). Exact types must be byte-equal, and floats must agree within rounding.

### 3.10 Platform constants and machine settings

| Platform constants (in rule ids and code; not configurable) | Machine settings (never in a package) |
|---|---|
| the segment cut rules' parameters, for Set/Dict and for Array (§3.4) | `-j` cores |
| the piece rule's sizes: 16, 64 and 256 MiB of stored bytes (§3.7) | `--memory` |
| the RunSorter's caps, 131,072 elements or 64 MiB, the second also the door's cap on a foreign segment | the scratch directory (`E3_SCRATCH_DIR`) |
| merge and fold fan-in, 32; the merge range size, 64 MiB | the lazy-open threshold (`EAST_LAZY_INPUT_BYTES`) |
| | cgroup use (`E3_CGROUPS`); verbosity |

The left column decides how work, and so floating-point folds, are grouped, which decides output bytes. The right column decides only when work runs.

### 3.11 Object kinds and GC

Every object introduced for this layer that names other objects carries a `kind` tag: manifests (`$segments`), record states (`$record`), task objects (`$task`) and unit plans (`$plan`). A piece merges its own runs (§3.7), so no object names a unit's runs.
- **Dispatch.** GC's `markReachable` (`storage/local/gc.ts`) dispatches on the tag through one table. The table gives, for each tag, the field names of its kind and the objects a value of it names.
- **Versions.** An object is walked as a kind when its fields begin with the kind's and its `kind` is the kind's tag, so a later version, which appends fields, is walked for the fields this build knows.
- **Untagged objects** are recognised by their current shape exactly: packages, functions, records, index objects, mutations, migrations, environment specs, commits and trees. An object of an earlier shape, which only an older e3's repository holds, is a leaf.
- **Header-first marking.** The mark reads an object's type from its head, and reads it whole only when it is a shape that names other objects, so a dataset is never read whole.

Every new kind lands with its GC test in the same PR.

### 3.12 Migration

`docs/conventions/WIRE_MIGRATION.md` states one rule, a hard cutover:
- **Package-borne wires** — task objects, package objects, function, record, mutation, migration and index objects, IR bundles, environment specs — change and packages are re-exported. A package an older SDK exported fails, saying so.
- **Stored state** — datasets, manifests, record states and commits, execution records and state, and the repository's other records (§3.13) — changes and a repository an older e3 wrote is re-created: deployed again, and its data imported again. Readers read the current form only, as writers write it, and refuse any other, naming the fix. No reader keeps a decoder for an earlier form.
- **Frozen wires** — the beast2 container, its type registry and the segment manifest — change only by a new version of the thing. The container keeps its own promise to read every released version (`docs/conventions/BEAST2_WIRE_VERSION.md`).

### 3.13 The repository

A local repository is a directory of records and objects:

| Path | What it holds | East type |
|---|---|---|
| `repository.beast2` | the repository: the layout's version, and its name, status and times | `RepositoryRecordType`, `{ layout, metadata }` |
| `objects/<ab>/<rest>.beast2` | content-addressed objects, an environment's files among them as Blobs | any |
| `packages/<name>/<version>.beast2` | a package ref: the package object's hash | String |
| `workspaces/<ws>.beast2` | a workspace: `none` until a package is deployed, then its state | `WorkspaceRecordType`, an `Option` of `WorkspaceStateType` |
| `workspaces/<ws>/data/<path>.beast2` | a dataset ref and its revision | `{ revision, ref }` |
| `workspaces/<ws>/execution.beast2` | the workspace's latest dataflow execution | `DataflowExecutionStateType` |
| `dataflows/<ws>/<runId>.beast2` | a run's record | `DataflowRunType` |
| `executions/<task>/<inputs>/<id>/status.beast2` | an execution attempt | `ExecutionStatusType` |
| `executions/<task>/<inputs>/<id>/owner.beast2` | the orchestrator that launched it | `ExecutionOwnerType` |
| `executions/<task>/<inputs>/<id>/stdout.txt`, `stderr.txt` | its logs, the runner's own text | — |
| `executions/<task>/<inputs>/plan.beast2` | the `$plan` of the stage a split task is in | String |
| `adoptions/<ab>/<rest>.beast2` | the manifest a delivery became | String |
| `locks/<resource>/` | a lock and its holders (§3.16) | `LockStateType` |
| `envs/<hash>/` | a built environment, a cache | — |
| `tmp/scratch/`, `tmp/transfers/` | working space: executions, staged uploads and package zips | — |

- **Every record is an East value in beast2**, except the logs, which stay the runners' own text: they are appended as output arrives and read by byte offset. A record is read as the type its header names or refused, since every runtime's typed decode checks the header against the type it is asked for. A header's type reads as the asked type when East's subtyping makes it that type or a subtype whose variant tags line up, so `none` reads as any `Option`.
- **A package zip holds the repository's own forms:** the objects, the package ref at `packages/<name>/<version>.beast2`, and from a workspace the executions the run its current state came from used, so the importing repository's cache serves the outputs they made. It carries no run's record, which names a workspace of the repository the run ran in: a run's history stays there, and an import files none. It holds nothing an import does not read, and an import refuses a zip an older e3 wrote, naming the export.
- **The layout is checked.** The repository record carries the layout's version, and opening a repository refuses any other version, or none, naming the fix: re-create it.
- **Names are checked** before they become paths: a repository's name where a server keeps several, workspace names, package names and versions, and lock resources. A path separator, a character a Windows file name refuses, or `.` or `..` as a whole segment, is refused. A hash — an object's, which a client names too, or an execution's task and inputs hashes — and an attempt's or a run's id, which an imported package names, must be of the form e3 writes.
- **One record for one fact.** The `success` status holds the output hash, and a dataflow run has one id, its UUIDv7 `runId`.
- **What goes with what it describes:** a workspace's execution state and runs go with the workspace, and so do the locks its dataflows and dataset writes left when they exited; a lock a live process holds is left for it to release. A built environment goes when gc no longer reaches its spec.
- **Staging files are `.partial`s**, which gc sweeps, and they sit inside the repository, never in the machine's temp directory.
- **History is bounded.** gc keeps:
  - the last 10 runs of each workspace, every run from the last 7 days, and the run its current state came from;
  - every execution those runs used, and every execution each workspace's current state is served from: a task's own, and a split task's units, which its `success` record names through the `$plan` of its last stage, each plan naming the one before it;
  - every execution from the last 7 days, and whatever is running.

  A task over given inputs that keeps any execution keeps its latest attempt and its latest success, which are what the cache serves from, so gc never changes what it serves. gc deletes every other execution record — status, owner and logs — and run record, and the outputs only they kept go in the same sweep. It decides everything before it deletes anything, and deletes nothing while a deployed workspace's graph cannot be built. `e3 repo gc --keep-runs <n> --keep-days <d>` override the defaults.

The cloud keeps the same records, as the same East types, in its own stores, so everything here but the paths applies there.

### 3.14 Executions and runs

An execution is one run of a task over given inputs: `(taskHash, inputsHash)` is its identity, where `inputsHash` hashes the input hashes in order. Each attempt at it has an id of its own, a UUIDv7, so a repository keeps every attempt and the latest sorts last.
- **The status record.** An attempt's record is its status (`ExecutionStatusType`), one of six typed cases: `running`, `success`, `failed`, `error`, `cancelled` or `interrupted`. Each case says whether the attempt is a unit of a split task, which is recorded under its task's hash but is not a run of the task: a task's history and the workspace status skip units.
- **What the cache serves.** Only a `success` is ever served from the cache. The dataflow is served a task's latest success, and a task run on its own its latest attempt when that succeeded.
- **Repair.** A `running` record whose runner and recorded owner are both gone is rewritten `interrupted` by the next probe, and kept, so what happened stays readable.

A dataflow run is recorded as well (`DataflowRunType`). Its id, a UUIDv7, is also its execution state's. The record names the execution each task completed with — the attempt that ran, or the one the cache served — so what produced a workspace's state is known after any later run. A workspace's `currentRunId` names the run its current state came from, once that run succeeds. gc bounds both histories (§3.13).

`e3-execution.md` has the rest: the status record's fields, crash detection, a stopped execution's causes, the owner record, the logs and a split task's stages.

### 3.15 The reactive dataflow

A workspace holds one ref per dataset (`DatasetRefType`, at `workspaces/<ws>/data/<path>.beast2`): `unassigned`, `null`, or a value's hash. Beside it is a **version vector**, which maps each root input — a dataset no task writes — to the version of it the value derives from:
- a root input's vector names itself: its content hash, or, for a record, the hash of its head commit, so a mutation that leaves the state byte-identical is still a change;
- a task output's vector is the union of its inputs' vectors, so every derived dataset names exactly which root input versions produced it.

Versions are content and commit hashes, not counters. A value that changes and changes back has its old version again, and the execution cache serves it. Tasks are pure functions of their inputs, so the root inputs are the only sources of change; an impure task would need an entry of its own.

**Consistency.** Before the loop launches a task, it checks that the task's inputs agree on every root input they share (`checkVersionConsistency`). Two inputs derived from different versions of one root input would mix old and new data, as the two arms of a diamond can while one of them is recomputed. A task whose inputs disagree is **deferred** (`task_deferred`), and launched once its upstream has caught up. A task is never given inconsistent inputs.

**Reacting to changes.** A dataflow run holds its workspace lock shared (§3.16), so dataset writes and record mutations go on while it runs. After each task completes, run or served from the cache, the loop reads the root inputs' refs again and compares them with its snapshot (`stepDetectInputChanges`). For each change:
- it records `input_changed`;
- every completed task downstream of the change goes back to pending (`task_invalidated`), to run again;
- a deferred task is evaluated again.

A task that was running when its input changed runs to its end. Its result is then discarded when the inputs it was launched with are no longer current, and it runs again with the new ones.

**Fixpoint.** The run ends when no task is ready, running or deferred: every output is then consistent with the root inputs as they stand. Datasets may disagree with each other while a run is in flight, and their version vectors say so. A run that stops with a task still pending or deferred and nothing running reports the dataflow stuck, naming them.

**Records** are root inputs like any other. A committed mutation changes a record's ref, and a running dataflow picks the change up as it would any write. Tasks read records and never write them. A record ref's vector also holds `$`-prefixed slots, the commit protocol's bookkeeping (§3.18), which change detection never reads.

**What a run records.** The run record keeps:
- the root inputs' versions (`inputVersions`);
- each task's output hash (`outputVersions`);
- the execution each task completed with;
- how many tasks ran again (`reexecuted`).

The events `input_changed`, `task_invalidated` and `task_deferred` are stored in the execution state with the rest (§3.7).

### 3.16 Locks

A lock is shared or exclusive, on a resource. It records what took it and who holds it (`LockStateType`): a local process, by its pid, start time and boot id, or a cloud function, whose lease bounds it.
- **Local.** A local repository keeps a resource's locks in `locks/<resource>/`. The exclusive lock is `exclusive.beast2`, created atomically with its content, and each shared holder has a file of its own.
- **Stale locks.** A lock whose holder is gone is stale, and the next acquirer removes it.
- **The cloud** takes a lock by a conditional write.

| Resource | Shared by | Exclusive by |
|---|---|---|
| `<ws>`, the workspace | a dataflow run; a dataset write; a record write — a mutation, a reindex, a compaction or a system commit | a deploy, a removal, an export |
| `<ws>#dataflow` | — | a dataflow run, so one runs at a time; gc |
| `#tasks`, the repository's work | every write that stores objects before a ref names them: an ad-hoc `e3 run`, a dataset write through the door, a record write, a deploy | gc |
| one dataset's ref | — | its conditional write, for the instant of its read, compare and rename |

- **Writes during a run.** A dataflow and dataset writes go on together: a write changes a root input, and the running dataflow reacts to it (§3.15). Two dataflows of one workspace do not.
- **Structural changes.** A deploy, a removal or an export is refused while a dataflow or a write holds the workspace. A deploy's caller may take the lock itself and hand it to the deploy, which then releases nothing. That is how a deploy run in rounds keeps the workspace across them (§3.18).
- **gc** takes `#tasks` and every workspace's `#dataflow` exclusively. So it never overlaps a write whose objects no ref names yet, nor a run, and none of those objects needs rooting.
- **A dataset ref's own lock** makes its conditional write (`writeIf`) a compare-and-swap across processes. A revision is minted per write, never taken from the content, so an equal value written twice is two revisions and no write is lost to ABA.

### 3.17 The API's data contracts

e3-api-server exposes e3-core over HTTP with BEAST2 bodies, and e3-api-client is its client; the routes are in the server's README. Three of its contracts belong to this layer: how a large value goes up, how a collection comes down, and whose budget a run gets.

#### Dataset transfer

A value too large for an inline `PUT` (the client's threshold is 1 MB) is staged and committed. The bytes never pass through the API itself. They go to upload URLs the server hands out: capability URLs on the local server, and presigned object-store URLs in a cloud deployment. That is why those `PUT`s carry no `Authorization` header. Every path below is under `/api/repos/:repo/workspaces/:ws/datasets/<path>`.

| Step | Method | Path | Request | Response |
|---|---|---|---|---|
| Init | POST | `…/upload?protocol=2` | `TransferUploadRequestType` `{hash, size}` | `TransferUploadResponseType` |
| Part target | GET | `…/upload/<id>/parts/<n>` | - | `TransferPartResponseType` `{url, headers}` |
| Send bytes | PUT | each part's URL | raw bytes (+ the part's `headers`) | HTTP status only |
| Commit | POST | `…/upload/<id>?protocol=2` | - | `TransferDoneResponseType` |
| Poll | GET | `…/upload/<id>` | - | `TransferDoneResponseType` |

```typescript
const TransferUploadResponseType = VariantType({
  completed: NullType,                                        // already stored: the ref is set
  upload_parts: StructType({ id: StringType, partBytes: IntegerType }),
});
const TransferPartResponseType = StructType({ url: StringType, headers: DictType(StringType, StringType) });
const TransferDoneResponseType = VariantType({
  completed: NullType,
  error: StructType({ message: StringType }),
  processing: NullType,                                       // poll
});
```

**The version.** A client names the protocol it speaks with `?protocol=N` on the init and the commit (`TRANSFER_PROTOCOL_VERSION`, 2). A server speaks one version. It refuses a request that names another, or none, with an `internal` error naming the fix: upgrade the client, or the server.

**Parts.**
- The server plans the upload. Part `n` (from 1) is the byte range `[(n-1)·partBytes, min(size, n·partBytes))`, and an upload no larger than `partBytes` is one part (`transferPartCount` / `transferPartRange`).
- The client asks for each part's URL and headers just before sending it, so a presigned URL never expires while earlier parts upload. It `PUT`s the range with exactly those headers.
- Parts may be sent in any order and concurrently; the client sends four at a time.
- Re-sending a part replaces it, and the client retries a transient failure from a fresh read of the range.
- The client commits once every part has been sent.

**Commit.**
- The server checks that the staged bytes are `size` bytes hashing to `hash`, and checks the header against the dataset's declared type.
- It takes the bytes into the store: a collection through the door, split a segment at a time into the store's own segments (§3.6), and any other value as the object the bytes are.
- It then points the dataset at what it stored, with the version vector's self entry.
- A refusal is an `error` answer, or the `dataset_type_mismatch` API error.
- A commit may answer `processing` instead. The client then polls `GET …/upload/<id>` (100 ms, doubling to 1 s) until it answers `completed` or `error`.
- A finished commit's answer stays pollable for a while, so a client whose response was lost asks again and hears the same thing.

**Dedup.** An init whose hash the store already knows answers `completed`. The store knows the bytes as the manifest a delivery of them was split into (the adoption memo, §3.6), or as an object. Either is checked against the dataset's declared type first, and a collection object goes through the store's door. It is the one door that skips the commit.

**The local server.**
- Parts stream to their own offsets in one staged file under `<repo>/tmp/transfers`, so the commit takes the file in with nothing to assemble.
- It refuses a part longer or shorter than its range, since a longer one would overwrite its neighbour; a part never sent leaves a hole the hash check refuses.
- `transferPartBytes` (default 64 MiB) sets the plan.
- The commit runs in the background: the request waits `transferCommitWaitMs` (default 5 s) for it before answering `processing`, so verifying a many-gigabyte delivery never holds one request open for as long as its SHA-256 takes.

**An object store.** The protocol maps onto S3, and the parts and the polled commit exist for it:
- A single `PUT` tops out at 5 GB.
- S3 cannot checksum a multipart object with SHA-256.

So an upload that fits one `PUT` is one part whose headers carry the SHA-256 as a signed checksum, and the store verifies the bytes. A larger one is a multipart upload whose part size keeps the part count bounded, verified by a background job while the commit answers `processing`.

#### Dataset download

`GET /api/repos/:repo/workspaces/:ws/datasets/<path>` answers the value's BEAST2 bytes.
- A collection is held as a segment manifest, many objects, so the route streams their splice a segment at a time.
- Any other value over 1 MB is answered, when the server has a transfer backend, with JSON `{ url }` (and `X-Content-Length`, `X-Content-SHA256`). The client fetches it without its `Authorization` header.

A host that buffers its responses cannot stream a collection, and caps a response's size. So a client asks for the segments instead, with `?segments=true`, which e3-api-client's `datasetGet` always sends:
- A collection is then answered with JSON `{ manifest }`, the manifest's hash — the primary's, for an indexed record — with the dataset's own hash in `X-Content-SHA256`. Any other value is answered as before.
- The client reads the manifest, the header it names and each segment through `GET /api/repos/:repo/objects/<hash>`, a few at a time, and checks each against its hash.
- It splices them in order (east's `spliceBeast2Segments`) into the bytes the route would have streamed. `datasetGetStream` hands them over a few segments at a time, and `datasetGet` is built on it.

The objects route answers an object over 1 MB as the dataset route does, with JSON `{ url }`, so a segment's bytes go from object storage to the client. An element larger than the cut rule's target is a segment of its own, so a segment can exceed a response cap.

Pages (`?page=true`) are decoded on the server from the segments they touch, and capped by `pageByteBudget` (default 4 MiB).

#### The budget

A request carries no parallelism. The server runs every dataflow, function call, mutation and index build it serves under one budget of cores and memory (§3.8), set by `e3-api-server -j` and `--memory`. `GET …/dataflow/budget` answers it. `GET …/dataflow/execution` answers the budget in use beside a run's state and a window of its events, and, while the run is in flight in that server, the units waiting for room and each split task's progress.

### 3.18 Record migrations

A record's type can change across deploys. A package declares the migrations that carry a workspace's state from the type it holds to the type the package declares, and a deploy runs the ones the workspace has not applied.

**Authoring.** The migration forms are a closed family, as the mutation forms are:

```ts
const m1 = e3.migration.value('add_shift', roster,
  East.function([RosterV1Type], RosterV2Type, ($, old) => …));
const m2 = e3.migration.rows('widen_row', plans,
  East.function([PlanKeyType, RowV1Type], RowV2Type, ($, key, row) => …), { after: m1 });
const m3 = e3.migration.rekey('by_site', plans,
  East.function([PlanKeyType, RowV2Type], StructType({ key: SiteKeyType, value: RowV2Type }), ($, key, row) => …),
  { after: m2 });
const pkg = e3.package('planning', '3.0.0', roster, plans, m1, m2, m3, …);
```

- `value`: `(Old) => New`, any record. It runs as one unit, whose runner opens the state lazily, so it costs what the body reads.
- `rows`: a Dict record's rows, `(K, V1) => V2` with the keys unchanged, or an Array record's elements, `(T1) => T2` in order. It runs as a task split over the stored state, into a `dict` or `array` output, so a record of any size migrates a piece at a time, in parallel, each piece cached.
- `rekey`: a Dict record's keys and rows, `(K1, V1) => { key: K2, value: V2 }`, or a Set record's elements, `(T1) => T2`. It is the same split task into a `dict` or `set` output, whose pieces' outputs merge by key range. Two old rows landing on one new key fail the deploy, naming it, since their values may differ and neither can be chosen. Two old elements landing on one new element are one element, as in any Set: nothing is lost.
- **The guards** are those of a mutation: the function is synchronous and calls no platform function, since a step runs again in every workspace that has not applied it, a piece at a time. The types are read off the function.
- **Names.** A step's name is an identifier, unique on its record, and identifies the step once it is applied.
- **The chain.**
  - `after` links the chain: exactly one migration of a record has none, each `after` names a migration of the same record, and no two name the same one.
  - `e3.package` takes a step's predecessors from its `after`, so passing the last step passes the chain.
  - Each step's input type is its predecessor's output type, and the last step's output type is the record's declared type.
  - Each is an error at definition, naming the two steps or the two types that conflict.

**Wire.** `MigrationObjectType` has the fields `form`, `from` and `to` (the record's type before and after the step), `bodyIr`, `programIr` and `runner`. `form` is a variant, `value | rows | rekey`, as a mutation object's is, `reduce | edit | patch`: a form e3 does not know does not decode, where a String read as any string and ran as whichever form its checks fell through to. `programIr` is the generated program a `rows` or `rekey` step runs, and is empty for `value`. `RecordObjectType` has `migrations`, the declared chain in order: each step's name and object hash. Both are package-borne (§3.12).

**What a workspace has applied.** The record ref's reserved `$schema` slot holds the names of the steps applied, in order, separated by commas.
- **By name, not by hash.** A step is identified by its name, not by its object's hash. An object's hash covers its IR, which carries its source locations and changes with the SDK that exported it and with any function it imports. So a step moved in its file, or re-exported by a newer e3, would read as edited, and every later deploy would be refused.
- **Edits are not detected.** An edit to an applied step's body is not detected, as a Rails, Django or Alembic migration's is not. The stored state's type is still checked against the step that runs next.
- **None applied** is the slot's absence.
- **Only deploy writes it.**

**Deploy plans before it writes** (`record-deploy.ts`). For each record, it compares the stored `$schema` and the stored state's type with the package's chain:

| Prior | `$schema` against the package's chain | Plan |
|---|---|---|
| none | — | `mint`: `$init` from the package's initial value, the whole chain applied |
| present | the whole chain, the type unchanged | `keep`, with a `$deploy` commit when the package changed |
| present | the whole chain, the type changed | refused: the type changed with no migration. The message renders the type diff and names the fixes, a migration after the last or `--schema=reset` |
| present | a proper prefix | `migrate`: the remaining steps, in order |
| present | no prefix, or longer than the chain | refused: an applied migration was renamed, reordered or removed, or the package is older than the workspace. The message names the steps applied and the steps the package declares |
| present, not in the package | — | `drop`: refused unless `--allow-drop-records` |

- **The chain must start where the workspace is.** The stored state's type must be the first remaining step's input type, so a chain that does not start there fails before anything runs.
- **Type comparison.** Types compare up to how recursive wrappers are named (`isTypeValueEqual`), as the store's door compares them, since a wrapper's id is the exporting process's.
- **Every refusal at once.** A deploy names every record it refuses, each with its fix.
- **A prior deployment that does not read** is refused, naming the fix: remove the workspace and deploy again.

**Policies.**
- `--schema=migrate`, the default, runs the migrations.
- `--schema=fail` refuses to run any migration, for a workspace whose migrations go through their own change control.
- `--schema=reset` resets a record that cannot be kept or migrated to the package's initial value, with a `$reset` root commit, so the reset is in its history.
- `--plan` answers the plan, each index's build, drop or keep among it, and writes nothing. The CLI's `--plan` fails when the deploy would be refused.
- `e3 watch` takes `--schema`, and on a type change fails, naming `e3 watch --schema=reset`.

**Running.** The steps run before the deploy writes a ref, as index builds do, through the deploy's task runner: a `value` step as one unit, and a `rows` or `rekey` step as a split task over the state before it. They write objects and no ref, so a failure leaves the workspace as it was, with nothing to restore. A deploy run again after a failure is served its finished steps from the execution cache when their code, and the code that exports them, have not moved. A migrated record's indexes are then built over its new state: a changed type rebuilds every one. An export's IR carries the source locations of the code that built it, so a `$deploy` commit follows any change to a package's code.

**Deploy as a job.** A deploy that migrates or builds over a large record outlasts a request, and a cloud gateway ends one at 30 s. So `POST …/deploy` answers a job id, and the client polls it until the job answers what the deploy did, or why it failed, as package export's job does.
- **What the job answers.** It answers the deploy's decision for each record and index, as the wire's `RecordPlanType` and `RecordIndexPlanType`, and the inputs it left unassigned, with why. e3-core's `onRecordPlan` and `onRecordIndex` take the same types, so a deploy reports one shape whether it runs locally or as a job.
- **The request** names the package, `schema`, `allowDropRecords` and `plan`.
- **Refusals.** The route resolves the package before it starts the job, so a package the repository does not hold is refused at once, as `package_not_found`. Anything else that stops a deploy, a refusal among them, is the job's `failed`, whose message names every record refused.
- **The job store** is the transfer backend's `workspaceDeploy`, a seam the server is given. A local server's is `InMemoryTransferBackend`, which runs the job in process on its runner. A cloud's compute runs it through `handleProcessDeploy`.
- **Rounds.** A cloud's compute may run one job in rounds, each on a function with a time limit. Each round runs `workspaceDeploy` from the top and is served what earlier rounds finished from the execution cache. The migrations and index builds run before the deploy's first ref write, so a round that stops during them has written no ref. `handleProcessDeploy` takes two optional fields for it:
  - `lock`, the workspace lock the caller holds across rounds, which the deploy uses and never releases;
  - `signal`: a deploy that throws once its signal has aborted leaves the job `processing` and rethrows, so the caller tells a hand-over from a failure.

**Commits and the reserved slots.** A `$migrate:<name>` commit is written per step, by `system:deploy`, and the last one writes `$schema`. Then come the `$reindex` commits of the index builds. A kept record gets one `$deploy` commit when the package's hash differs from the one deployed before. What each commit does to the idempotency slots decides whether a keyed retry is answered or applied again:

| Commit | `$idem` and `$idem.commit` | `$schema` |
|---|---|---|
| a mutation | written when keyed, dropped when not | carried |
| `$reindex`, `$deploy`, and a system commit (a rollback or a restore) | carried | carried |
| `$compact`, `$migrate:<name>` | `$idem.commit` points at this commit, whose state holds the keyed write | carried; written by the last `$migrate` |
| `$reset` | dropped: the keyed write is gone with the state | written, the whole chain |
| `$init` | none | written, the whole chain |

**System commits** (`recordSystemCommit`) commit a given state as a named system commit, such as a cloud's `$rollback` and `$restore`, so that what the commit does to the slots is the commit protocol's.
- **Names.** A system commit is named `$` and an identifier, never one of e3's own commits' names (`$init`, `$deploy`, `$reset`, `$reindex`, `$compact`). A mutation's name is an identifier, refused otherwise where it is declared, so no user commit takes a name beginning with `$`.
- **A rollback** names the commit it goes back to. Migrations run forward only, so one past a `$migrate` or `$reset` commit is refused, walking back from the head. A `rekey` or `rows` step can keep the record's type, so the type alone cannot say a rollback passed one. A rollback to a commit a compaction has cut from the chain is refused too, since what that commit had applied is unknown.
- **A restore** of a state from outside the history, such as a backup's, names the migrations that state had applied, which must be the record's.
- **Type.** Either is refused a state whose type is not the record's, as a backstop.
- **Indexes.** It rebuilds the indexes whose declarations differ from those the state was built under, and drops those the package does not declare.
- **Slots.** It carries every reserved slot, as the table says, so a keyed retry after a rollback is answered by the keyed commit, which stays in the chain under it.
- **Arguments and head.** It records the caller's arguments as a mutation's are, and refuses a head the caller did not expect.

**GC.** A record object's migrations are walked, and a migration object's `bodyIr` and `programIr` are leaves.

## 4. Rules that keep it from drifting

- A PR that adds or changes a wire field states which migration rule it follows.
- A new object kind that names other objects carries a kind tag and lands with its GC test.
- A collection reaches the store only through `storeCollection`, enforced by module structure and a lint rule.
- A PR that changes documented behaviour rewrites the doc in the same PR.
- Before adding a primitive, search for an existing one.
- A new runner capability is a field of the unit, never a flag on one runner.

## 5. Benchmarks and bounds

A benchmark harness in `libs/e3/test/integration/src/`, alongside `partition-scale.spec.ts`, runs at a small scale in CI and at full scale by hand:

- **Re-key:** a long collection of wide rows (a nested struct per row), re-keyed to a key unrelated to its order, with a `merge` that folds equal keys. The bound: peak memory at most `jobs × (the RunSorter's cap + a runner's baseline) + e3's baseline`, plus whatever the body itself holds, independent of the input's size. `rekey-bound.spec.ts` runs it on every runner installed, at two input sizes, and checks every unit's peak, e3's fixed heap, and that the output is the Writer's manifest for the value at `--jobs` 1 and the default.
- **Wide rows:** a `Dict<String, Blob>` of 300 × 1 MiB, stored in segments near the size target, not in one segment.
- **Narrow rows and edits:** a long collection of narrow rows, and one-row edits to it and to the wide rows: segment sizes, page-read time, compression, and bytes rewritten per edit (`segmentation-bench.spec.ts`). These fixed the cut rule's parameters.
- **Deliveries:** two deliveries differing in one row share all but O(1) segments, and an unchanged delivery, adopted again locally or over the transfer, costs its hash and is not split again.
- **Door memory:** no door's memory grows with the value (`door-memory.spec.ts`).
- **Automatic:** the re-key written as `toDict` in an `e3.task` (§3.9, in its own PR).
