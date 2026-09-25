# Task Execution Design

This document specifies the task execution system for e3, covering single task execution, execution history, tasks whose work is split into pieces, and dataflow DAG orchestration.

## Overview

Tasks are computations that read input datasets and produce output datasets. The execution system:

1. **Memoizes** results - same inputs produce same outputs, cached by execution hash
2. **Streams logs** - stdout/stderr captured in real-time for debugging
3. **Splits work** - a task marked to split over an input runs a unit per piece of it, each cached on its own
4. **Orchestrates DAGs** - runs tasks, and the units of split tasks, in dependency order with parallelism

## Execution Identity

An execution is uniquely identified by:

1. **Task hash**: The hash of the TaskObject (defines runner + paths)
2. **Inputs hash**: `SHA256(inputHash1 || inputHash2 || ...)` - combined hash of all inputs

Same task + same inputs = same execution = cache hit.

```ts
function inputsHash(inputHashes: string[]): string {
  const data = inputHashes.join('\0');
  return computeHash(new TextEncoder().encode(data));
}
```

## Execution Storage

Executions are stored in `executions/<taskHash>/<inputsHash>/<executionId>/`, one directory per attempt (`executionId` is a UUIDv7, so the latest sorts last):

```
executions/
└── <taskHash>/
    └── <inputsHash>/
        ├── plan                # A split task's execution: hash of the $plan of the stage it is in
        └── <executionId>/
            ├── status.beast2   # Execution status
            ├── output          # Ref file: hash of output dataset (on success)
            ├── owner           # JSON: the orchestrator process that launched the runner
            ├── stdout.txt      # Captured stdout (streamed during execution)
            └── stderr.txt      # Captured stderr (streamed during execution)
```

This organization provides:
- Easy lookup of all executions for a given task
- Natural grouping for `e3 exec list --task <hash>`
- Simpler GC - can delete all executions when a task is removed

The `plan` sidecar names the `$plan` of the stage a split task's execution is in, from its first stage until the execution ends, when it is cleared (see Split Tasks). A released e3 wrote a partitioned execution's partition plan there.

### Status File Format

`status.beast2` holds an `ExecutionStatusType` value (`e3-types/src/execution.ts`), a variant with one case per state. Every case carries the attempt's `executionId` (a UUIDv7), the `inputHashes` and `startedAt`:

| Case | Meaning | Adds |
|---|---|---|
| `running` | the runner has been launched | `pid`, `pidStartTime`, `bootId` (see Crash Detection) |
| `success` | the runner exited 0 and its output was stored | `outputHash`, `completedAt` |
| `failed` | the runner exited non-zero, a signal ended it, or it could not be spawned | `completedAt`, `exitCode` |
| `error` | e3 failed around the runner, or stopped it at its timeout | `completedAt`, `message` |
| `cancelled` | e3 stopped the execution because the run was aborted, before its runner started or while it ran | `completedAt` |
| `interrupted` | the orchestrator that owned the execution exited before it finished, and its runner is gone too | `completedAt`, `pid` (the runner's) |

The status is stored state, read with `decodeExecutionStatus`: a record written before `cancelled` and `interrupted` were cases is an `error` whose message began `cancelled:` or `interrupted:`, and it reads back as that case.

`taskHash` is not stored in the status file since it is encoded in the directory path (while the input hashes are hashed together into a single hash in the path).

### Crash Detection

The `running` status includes process identification fields to detect crashed executions:

- `pid`: The process ID of the runner
- `pidStartTime`: Process start time in jiffies since boot (field 22 from `/proc/<pid>/stat`)
- `bootId`: System boot ID from `/proc/sys/kernel/random/boot_id`

To check if a running execution is still alive:

```ts
function isProcessAlive(status: RunningStatus): boolean {
  // Different boot? Process is dead.
  const currentBootId = readFile('/proc/sys/kernel/random/boot_id').trim();
  if (currentBootId !== status.bootId) return false;

  // PID doesn't exist? Process is dead.
  const procStat = readProcStat(status.pid);
  if (!procStat) return false;

  // PID exists but different start time? PID was reused, original process is dead.
  if (procStat.startTime !== status.pidStartTime) return false;

  return true;
}
```

This handles: process crashes, machine restarts, and PID wraparound/reuse.

## Reading Executions

`e3-core/src/executions.ts` holds the read side: `inputsHash`, `executionGet` and `executionGetLatest` (one attempt's status), `executionGetOutput`, `executionListIds`, `executionListForTask`, `executionList`, `executionFindCurrent`, and `executionReadLog` (a log read in byte-offset pages). Each takes the storage backend and the repository first; the signatures are in the code.

## Task Execution

`taskExecute(storage, repo, taskHash, inputHashes, options)` (`execution/LocalTaskRunner.ts`) runs one execution:

1. **Inputs hash.** `inHash = inputsHash(inputHashes)`.
2. **Cache.** Unless `force`, `probeExecutionCache` returns a recorded `success` for `(taskHash, inHash)`. Only `success` is ever served from the cache. A stale `running` record is repaired `interrupted` on the way (see Stopped Executions).
3. **Attempt.** A new `executionId` (UUIDv7) names this attempt's directory.
4. **Task.** The task object is read and decoded (`decodeTaskObject`). One an older SDK exported does not decode, and the execution is recorded `error`, saying to re-export the package. A task whose work is split over its inputs runs on the engine instead (see Split Tasks), each of its units through the steps below.
5. **Scratch.** A scratch directory `e3-exec-<task8>-<in8>-<pid>-<pidStartTime>-<ms>` is created under `<repo>/tmp/scratch`, or under `E3_SCRATCH_DIR` when it is set.
6. **Inputs** (`marshalInputsToDir`). Each input object is staged as `input-<i>.beast2` without passing through e3's heap: the backend places it (`ObjectStore.materialize`), by a link, a reflink or one kernel copy where its objects are files.
   - A collection stored as a segment manifest is staged as the manifest plus one linked file per segment (`input-<i>.beast2.segments/<hash>.beast2`) for a stock runner, every one of which opens manifests (`runnerOpensManifests`), and spliced into one file for a `custom` runner.
   - A `custom` runner is given copies, never links, since its command could modify an input path.
   - A merge unit of a split task stages its key range, when it has one, and its parts.
7. **Command.** The runner's argv follows from the task's body (`TaskBodyType`):
   - An `east` body on a stock runner is a unit the runner's `exec` runs (`execution/units.ts`; the protocol's `UnitType` in `@elaraai/east`). `stageRunUnit` links the program, and the files the output kind folds with, into the scratch directory, and writes `unit.beast2` naming them and the staged inputs by relative path. The argv is `<runner> exec --exit-with-parent unit.beast2`, with `-v` when verbose.
   - A `command` body, a `customTask`'s, is its command IR, evaluated over the staged input paths and the output path. The command is the author's, so it gets neither `-v` nor `--exit-with-parent`.
   - An `east` body on the `custom` runtime is the runner's command given `run`'s arguments: `-i` for each input, `-o` and the program's file. It runs only a program that returns its output.
   - A merge unit of a split task is a `merge` unit for `exec` (`stageMergeUnit`).
8. **Environment.** A task that names an execution environment has it materialized (`materializeEnvironment`, a cache hit after first use), and its bin directory leads the runner's PATH.
9. **Run.** The spawn takes a slot of the jobs budget (see The Jobs Budget). Once the runner has spawned, the `running` status and the `owner` sidecar are written. stdout and stderr stream to the attempt's log files (see Output Capture). A unit ends well only when its runner exits 0 and records an `ok` result. A set or dict output its runner left in several sorted runs is merged into one by a second `exec`, of the `merge` unit `stageOutputMerge` writes, under the same slot.
10. **Outcome.**
    - On success the output goes into the store through its door. A unit's output (`storeUnitOutput`) is the manifest or file its runner wrote, taken in with each segment file linked as it stands: a value, an array, a fold, or a set's or a dict's one run — the empty collection when nothing was emitted, typed by the program's `emit` parameter. A `command` body's output goes through `storeDatasetFile`: a collection the command wrote is read a segment at a time and written again, and any other value is hashed by streaming and linked. A `success` status is then written.
    - A runner that exits 0 without recording an `ok` result is recorded `error`. Every other outcome is recorded as Stopped Executions describes.
11. **Cleanup.** The scratch directory is removed.

### stdout and stderr

They are kept separate:

1. **Debugging**: stderr often contains warnings/errors that are useful to filter
2. **Convention**: Unix tools expect this separation
3. **Structured output**: Some runners might emit structured data on stdout
4. **Log levels**: Can display stderr prominently in UI while dimming stdout

### Output Capture

Each stream is decoded as whole UTF-8 characters and appended to its log with at most one append in flight; whatever arrives meanwhile is coalesced into the next append. While more than 1 MiB handed to the log has not been written, e3 pauses the pipe, so a runner that floods its output blocks on the pipe instead of growing e3's heap.

## Stopped Executions

An execution that e3 stops, or whose process dies, is recorded with a status that names the cause: the `cancelled` or `interrupted` case, or a `failed` or `error` that says why.

| Outcome | Status | Last line of `stderr.txt` |
|---|---|---|
| The runner exits 0 | `success` | — |
| e3 stopped the runner because the run was aborted (Ctrl-C, `SIGTERM`, `SIGHUP`, `LocalOrchestrator.cancel()`, the caller's `AbortSignal`) | `cancelled` | `e3: cancelled: e3 stopped the runner because the run was aborted` |
| The run was aborted while the execution waited for a job slot, so no runner ever started | `cancelled` | `e3: cancelled: e3 did not start the runner because the run was aborted` |
| e3 stopped the runner at the task's timeout | `error`, message `timed out: e3 stopped the runner after <ms> ms` | `e3: timed out: e3 stopped the runner after <ms> ms` |
| A signal from elsewhere ended the runner | `failed`, exit code -1 | `e3: runner killed by <signal>` |
| The runner exits non-zero, or cannot be spawned | `failed`, with the exit code (-1 when it could not be spawned) | — |
| The orchestrator died before recording the outcome (found by a later run) | `interrupted`, with the runner's pid | — |

**A cancelled execution is not a failure.** `ExecutionResult.cancelled` (and `TaskResult.cancelled`) is true for the `cancelled` case. `LocalOrchestrator` gives each run one `AbortController`, following the caller's signal and `cancel()`, and passes it to every execution. A task whose result is cancelled goes back to `pending` with no event of its own (the run's `execution_cancelled` event records the abort), `onTaskComplete` receives `state: 'cancelled'` (the CLI prints `[CANCELLED] <task>`), and the run ends through the abort path as `cancelled`. Only `success` is ever served from the cache, so the next run executes the task.

**Runners exit with e3.** On POSIX runners are spawned `detached`, in their own process group, so e3 can stop a whole runner tree — which also means a runner outlives an e3 that dies without warning (a V8 abort, `kill -9`). A stock runner (east-node, east-c, east-py) is therefore given a stdin pipe e3 never writes to and `--exit-with-parent` on its command line (spliced at spawn by `withRunnerLifeline`, after the cache decision, like `-v`): its watcher blocks reading stdin and exits the runner when the read returns end of file, which happens when e3's end of the pipe closes with e3. On Windows the pipe is overlapped (Node's stdio `'overlapped'`): the watcher's read stays pending for the runner's whole life, and a read pending on a synchronous pipe holds the pipe's file-object lock, so any other use of stdin in the runner would wait for e3 to go — east-node opening `process.stdin` when a module first imports `node:process` hung units that way. A `custom` runner keeps an ignored stdin and its argv untouched. (On Windows the job below ends the runner with e3; the lifeline covers an install without the job launcher.)

**Stopping a runner tree.** On POSIX a stop signals the runner's process group; a process that leaves the group (`setsid`) escapes it, a known and accepted limitation. Windows has no process group a signal can address, so there e3 runs each runner through its job launcher, `e3-job.exe` (`libs/e3/native/e3-job`, shipped as e3-core's optional dependency `@elaraai/e3-job-win32-x64`): the launcher joins a new Job Object that allows no breakaway and ends every member when its last handle closes, then starts the runner in it, with the command line e3 would have given the runner, and exits with the runner's exit code. A stop ends the launcher, and with it every process the runner started — including a program Git Bash's exec leaves with an exited parent, which no walk of parent pids finds. The job ends the same way when e3 dies (Node ends its direct children with it) and when the runner exits, so on Windows nothing a runner starts outlives it. The `running` record's pid is the launcher's, which lives exactly as long as the runner. An install without the launcher (optional dependencies omitted) warns `E3_NO_JOB_LAUNCHER`, runs runners directly and stops them with `taskkill /T`, which misses such orphans. On every platform a stop finishes even when a process it could not reach holds the runner's output open: once the runner has exited, e3 reads its output for 5 s more and then closes the pipes itself.

**The owner sidecar, and interrupted executions.** Once a runner has spawned, e3 writes the `running` status (the runner's pid, start time and boot id) and an `owner` sidecar naming itself (`{ pid, pidStartTime, bootId }`). A `running` record is stale only when both processes are gone: the cache probe (`probeExecutionCache`) rewrites it `interrupted` when the runner is dead **and** the owner exists and is dead. A live owner may be between its runner's exit and the record's write — hashing the output — so its record is never touched, and a record without an owner sidecar (written by an older e3) is never repaired. A split task's own execution is recorded `running` with the orchestrator as both its runner and its owner, so it is found interrupted once the orchestrator is gone.

**Scratch directories.** An execution runs in `e3-exec-<task8>-<in8>-<pid>-<pidStartTime>-<ms>`, named after the execution and the orchestrator that owns it, under `<repo>/tmp/scratch`, or under `E3_SCRATCH_DIR` when it is set. A runner writes its whole output there before e3 stores it, and writes nothing anywhere else: a set's or a dict's sorted runs, and the merge of them, are files of the same directory. Inside the repository the directory is on the object store's filesystem, so an output never waits in memory on a tmpfs temp directory, and one that is not a collection is stored by a link, never a copy. The execution removes the directory when it finishes. `sweepScratchDirs` removes the directories whose owner has exited — its pid no longer has the start time in the name, or, where the platform reports no start time for the pid (Windows, a pid `/proc` cannot answer for), the pid no longer exists (signal 0) — and runs before every local `e3 dataflow run` and in `repoGc`.

## Split Tasks

A task whose work is split over its inputs — an `east` body on a stock runner, with an emitted output (`array`, `set`, `dict` or `fold`) and an input `e3.partition` marks (`isSplitTask`, `execution/engine.ts`) — is one task node with one output dataset: authored, deployed, cached and observed as one task. Under it, the engine runs a unit per piece of its inputs and assembles their outputs by the task's output kind. The value work — the program, `merge`, `combine` — runs on the task's runner as ordinary executions. The byte work — cutting pieces, grouping and assembling outputs — streams through the storage layer and the store's door. e3 never decodes a piece or a part whole, and never evaluates a `merge` or `combine` function.

### Pieces

`planPieces` (`execution/pieces.ts`) cuts the pieces. The first input `e3.partition` marks is the primary. It is taken through the store's door first, which leaves a current manifest as it is and re-cuts one stored any other way, so its pieces are runs of the segments the Writer writes.

A piece is a run of whole segments of the primary, closed by a rule over its manifest (`pieceBoundaries`). The segments are walked in order, with `b` the stored bytes of the open piece, the segment in hand included. A segment closes the piece after it when `b` reaches `max`, or when `b` is at least `min` and the first 32 bits of the segment's SHA-256 — the hash the store names it by — fall under `2^32 × s / D`, where `s` is the segment's stored bytes and `D` is `max` until the piece holds `target` and `min` after. The platform's sizes are 16, 64 and 256 MiB (`PIECE_SIZES`), and most pieces hold 64 to 100 MiB; a test sets `E3_TEST_PIECE_BYTES=n` for `n/4`, `n` and `4n` bytes. Whether a segment closes a piece depends on that segment and on `b` alone, so an insertion moves only the pieces around it.

- **`by`.** A boundary moves forward to the end of the `by` group it falls in, so rows whose `by` fields are equal stay in one piece. `by` names leading key fields, or, as its last entry, a path through first fields (`at.day`), and the planner reads them from each key by path. A group usually ends inside a segment, and the boundary splits that segment there; equal fences settle a segment without a read.
- **Co-partitioned inputs.** Every other marked input is split at the same keys: at its first row whose `by` tuple reaches that of the piece's first row. Inputs partitioned together must be Sets or Dicts cut by fields of the same types. An Array is cut by position, so it can have no `by` and no inputs partitioned with it.
- **Unmarked inputs** reach every piece whole.

Each piece of an input is stored through the door as the manifest the Writer writes for its rows: its whole segments are named as they stand, and a segment a boundary splits is re-cut. So a piece copies no more than the segments at its ends, and a piece whose rows did not change has the hash it had. A primary that closes no piece runs the task as one unit, under the task's own identity.

### Units

Each piece is a unit: the task's program over the piece's inputs, an execution `(taskHash, inputsHash(pieceInputs))`. A re-run after an edit runs only the pieces the edit touched, and finds every other piece in the execution cache. A merge is a unit too, `(taskHash, inputsHash(['merge', range?, ...parts]))` — the leading `merge` keeps its identity apart from a piece's — and its runner `exec`s a `merge` unit naming the parts, the key range and the output kind. Every unit is spawned as any execution is (scratch directory, a slot of the jobs budget, stdin lifeline, owner sidecar, its own logs), and is probed in the execution cache first unless the run is forced. A piece whose set or dict output closed several sorted runs merges them in its own execution, so every unit's output is one manifest.

### Assembly by output kind

- **array:** the pieces' outputs are concatenated through the store's door (`storeCollection`), which re-cuts the seams between them.
- **set and dict:** the outputs are grouped where their key ranges overlap (`mergeComponents`, `execution/steps.ts`). An output's range is its first fence and its last key; ordered by first key, an output joins the current group when its first key is at most the greatest last key the group has seen, and an empty output belongs to none. A group of one is its own result. A larger one is merged over key ranges (`planMergeRanges`): as many as the group's stored bytes over the pieces' middle size (`target`, 64 MiB), capped by the segments of its largest part, the pilot, whose fences supply the boundary keys — its segments pack greedily into runs of about equal bytes, and each run after the first starts a range at its first fence. A range is a small object, `Struct{from: Option<K>, to: Option<K>}` over the parts' key type (`[from, to)`, a bound `none` when open), that every merge unit of the range takes beside the whole parts. The runner seeks every part to the segment owning `from` through its fences and stops at the first key at or past `to`, so a unit reads its range's share of every part, plus at most one segment. The groups' results, disjoint and in key order, are concatenated through the door.
- **fold:** the pieces' partials are folded in piece order, as one group over no range.

Each group merges through a tree of units of fan-in 32 (`MERGE_TREE_FANIN`): a level's units each merge a run of up to 32 consecutive entries of a group, a run of one passes through to the next level, and every unit of a level, across groups, settles before the next level starts. A key several parts hold folds with the dict's `merge` in part order, collapses for a set, and is refused, naming the key, for a dict without one.

**Determinism.** The pieces, the groups, the ranges and the tree come from the inputs and platform constants — never from the pool width, the jobs budget or timing — and every unit writes through its runner's own writer. So the same task over the same inputs writes the same bytes, one content hash, on every machine, at every `--jobs`, on every runner. `merge` and `combine` must be associative: a unit may fold part of a key's values before the rest, though never out of piece order. Every output is the manifest the Writer writes for the whole value, however many pieces and ranges it was assembled from.

### Stages and the unit plan

The units run a stage at a time: the pieces, then each level of the merges. Each stage is a `$plan` object (`UnitPlanType`, `e3-types/src/unit-plan.ts`) holding the task's hash, the task's inputs hash and the stage: each piece's inputs, or a merge level — its number, the number of levels, and its groups, each an optional range and its entries in fold order. It is written as the stage starts and named by the execution's `plan` sidecar, which roots it for GC until the execution ends.

While the stages run, the task's own execution, `(taskHash, inputsHash(inputHashes))`, is recorded `running` under the orchestrator, with the orchestrator as its runner and its owner. Its `stdout.txt` gets one line per unit once the unit's result is known (`combine` names a fold's merges):
```
piece <i>/<n> <completed|cached|failed|cancelled> task=<hash> inputs=<hash> execution=<id> duration=<ms> peak=<bytes>
merge level <l>/<levels> unit <i>/<n> <state> task=<hash> inputs=<hash> execution=<id> duration=<ms> peak=<bytes>
combine level <l>/<levels> unit <i>/<n> <state> task=<hash> inputs=<hash> execution=<id> duration=<ms> peak=<bytes>
```
The ids are in full, so `e3 task logs <repo> --execution <task>/<inputs>/<id>` opens any unit's own logs. `peak` is the runner's peak resident memory, as the unit's result reports it: the larger of the run's and, when a set or dict closed several runs, their merge's. A unit served from the cache, or whose runner recorded no result, has none. When the last stage yields the output, the task's execution records `success`, and its sidecar is cleared, as it is at every other end:
- a unit's failure: `failed` with the unit's exit code, or `error`, naming the stage's lowest-index failing unit, so the cause is the same at every pool width;
- a unit whose executor threw: `error`, naming the lowest-index one, whose error is then raised;
- pieces that cannot be planned, or outputs that cannot be grouped or assembled: `error`, naming why;
- an aborted run: `cancelled`, with `e3: cancelled: e3 stopped the task's units because the run was aborted` as the last line of its `stderr.txt`.

A run that yields leaves the task mid-stage instead: its execution is recorded `interrupted`, and the sidecar keeps naming the stage's plan.

**Resuming.** A run of the task takes up the stage a plan names — the task's `plan` in the dataflow's execution state, or, for a task run on its own, the sidecar — when the plan is this task's over these inputs. It probes the stage's units in the execution cache, so the units that finished are not run again. A plan of the task over inputs it no longer has is cleared from its sidecar, and one that cannot be read, or is not a unit plan, is replaced: the pieces are planned again.

**Drivers.** `SplitTask` is the stages: it opens the task, reports each unit as it starts and settles, and, once every unit it started has settled, advances to the next stage or to the task's end. The dataflow runs its units beside every other task's (see Running a Dataflow). `executeSplitTask`, which `taskExecute` calls for a task run on its own (`e3 run`), runs each stage's units in a pool of its own, as wide as the jobs budget (4 without one); the pool takes no unit after one fails or throws, or once the run is aborted, and waits for the units in flight. `TaskRunner.executeUnit` runs one unit wherever the runner runs executions: the local runner through `taskExecuteUnit`, and a remote backend on its own compute.

### Record operations

A record's index builds and its mutations run as tasks e3-core writes from the record's objects (`records.ts`), through the caller's `TaskRunner.execute`, outside the dataflow graph.
- **An index build** is a split task over the record's primary: the index's build program as its `east` body, on the index's runner, the primary as its one input, partitioned with no `by`, into a `dict` output with no merge. The program emits each row's entries as it reads them, and no two pieces emit one entry, since an entry's primary key is in one piece.
- **A mutation** is one unit: its program, or an unkeyed record's reducer, as the body; the record's state and each argument as its inputs; and a `dict` output, the delta, or a `value`, the reducer's new state. The state is staged as its manifest with the segments linked, which the runner opens lazily once it is past the lazy-open threshold. A mutation's `timeoutMs` aborts the unit through the signal a cancellation uses: the execution is recorded `cancelled`, and the mutation reports `timed_out` with the tail of the unit's `stderr.txt`.

Both are ordinary executions, so a rebuild over an unchanged primary, or a mutation over a state and arguments it has run on before, runs no unit. How a mutation's delta is applied is in `e3-records-storage.md`. Nothing in e3 runs the runners' `merge` command any more; it goes with `run`'s mode flags.

### Plans a released e3 recorded

A released e3 recorded a partitioned execution's partition plan (`PartitionPlanType`) in the `plan` sidecar: the partitioned inputs, the boundaries and split points, the carved slices and each merged component's range blobs. e3 no longer writes one. GC still roots it through the sidecar and walks its slices and range blobs as dataset values, and a split task that finds one there plans its pieces again.

## The Jobs Budget

A local run has one budget of parallelism: `jobs`, the runner processes e3 keeps in flight at once. Every runner the local runner spawns for a run — a task of the dataflow, a piece or merge unit of a split task — holds one slot of a `JobSlots` semaphore from just before its spawn until it has exited, first come first served, and an execution the run aborts while it waits is recorded `cancelled` without a runner ever starting. A record operation runs outside any run and holds no slot: an index build's units run in a pool of their own, as a task run on its own without a budget does. What is *ready* is decided above it: by the dataflow's loop, whose `concurrency` the CLI sets to the budget, and by the pool of a task run on its own, as wide as the budget. The budget decides what *runs*, so a split task's units queue beside the other tasks of the run instead of multiplying with them.

The budget is a runtime collaborator of the run, like its abort signal: `OrchestratorStartOptions.jobs` flows to each execution's `ExecuteOptions.jobs`, is never persisted, never enters an execution's identity, and is ignored by a remote runner (e3-cloud's capacity is its own). `-j`/`--jobs` is the one knob a person sets. It defaults to `E3_JOBS`, and else to `defaultJobs()`: the CPUs available to the process — `os.availableParallelism()` capped by the tightest cgroup v2 `cpu.max` up the process's hierarchy, as east-c's `east_cpu_count` sizes its thread pool. The api-server runs each request's `concurrency` as that run's budget. Not yet budgeted: the threads a runner uses inside its own process (a unit's `threads` is the machine's CPUs), and memory.

## Dataflow Execution

### Task Dependency Graph

Tasks form a DAG based on their input/output paths:

```
Task A outputs to: tasks.A.output
Task B reads from: tasks.A.output, inputs.data
Task C reads from: tasks.A.output, tasks.B.output
```

Dependency: A → B → C (and A → C)

### Running a Dataflow

`e3 dataflow run` drives the step functions of `dataflow/steps.ts` through `LocalOrchestrator`, over a persisted `DataflowExecutionState`:
- `stepInitialize`;
- `stepGetReady`;
- `stepPrepareTask`: resolve inputs, probe the cache, check the workspace output;
- `stepTaskStarted`, `stepTaskCompleted`, `stepTaskFailed` and `stepTasksSkipped`;
- `stepTaskSplit`, `stepTaskMergeStarted` and `stepTaskMergeCompleted`: a split task's stages;
- `stepFinalize`;
- `stepYield` and `stepCancel`;
- the reactive steps that detect input changes, invalidate tasks and check version consistency (see e3-reactive-dataflow.md).

Each step is pure or idempotent over the persisted state, so a run can yield and resume. The loop keeps up to `concurrency` things in flight — a task, a split task while its pieces are planned, and each unit of a split task — and the CLI sets `concurrency` to the jobs budget, of which every runner they spawn takes a slot. A split task's units launch first, in the order the tasks started. A split task in progress runs to its end even once another task has failed, as a running task does; nothing starts once the run is aborted.

A split task is planned when it becomes ready and is not cached: its pieces are cut, the task's state names their `$plan`, a `task_split` event records how many there are, and its units join the loop's. When a stage's last unit settles the task advances: `task_merge_completed` records a level's end, and `task_merge_started` a level's start with its units and the number of levels, while the task's state names the level's `$plan`. Once the last stage yields the output, the task completes as any task does and its `plan` is cleared. The state records a split task's stages, never each unit, so it stays small however many pieces a task has; each unit's progress is the `onPartitionProgress` callback (the CLI's `[PART]`, `[MERGE]` and `[COMBINE]` lines). A unit runs through the run's `TaskRunner.executeUnit` when the run has a runner, and through `taskExecuteUnit` otherwise.

A yield stops the loop launching, suspends each split task in progress — its execution recorded `interrupted` — and resets the in-progress tasks to `pending`, keeping a split task's `plan`. The resumed run takes each stage up again from its plan, and finds the units that finished in the execution cache. A run whose host died is resumed the same way. An aborted run ends a split task whose next units never started `cancelled`, as its units in flight end.

The execution state carries its version (`EXECUTION_STATE_VERSION`, 2: a task's `plan`, and a split task's events). `decodeDataflowExecutionState` reads every version up to its own — a version 1 state's tasks have no plan — and refuses a newer one, naming its version (see `docs/conventions/WIRE_MIGRATION.md`). A task's successful output is written to the workspace under the dataflow lock. `e3 watch` (e3-watch.md) re-runs a workspace as its sources change.

## Garbage Collection Integration

A recorded execution's `output` ref is a GC root, so its output object is kept, a unit's among them. Status files, owner sidecars and logs are files beside it, not objects. The `plan` sidecar is a root while it names a plan. GC walks a `$plan`: the task as a node, each piece's inputs and each group's entries as dataset values (a manifest among them names its segments), and each range as a leaf.

GC dispatches a kind-tagged object — a manifest, a record state, a task object, a unit plan — on its tag, through one table that lists the field names of every released version of each kind and the objects a value of it names. An object is walked as a kind when its fields begin with one of the kind's versions and it carries the kind's tag, so a later version, which appends fields, is walked for the fields this build knows. Every other object is recognised by its shape, and each released version of each shape is pinned by a test. So every object a split task's execution can resume from is kept until the execution ends. After that, a piece or range no plan names is swept, and a later run cuts the same pieces again, with the same hashes, and finds its units in the cache.

gc takes the repository's `#tasks` lock exclusively and every workspace's `#dataflow` lock before marking, and refuses while a run holds one; a dataflow run holds its workspace's `#dataflow` lock, and an ad-hoc `e3 run` holds `#tasks` shared for its execution (and refuses, in turn, while gc holds it). So gc never runs while a split task's pieces or its units' outputs are in use.

## Error Handling

### Execution Failures

| Scenario | Behavior |
|----------|----------|
| Task object an older SDK exported | `error`, saying to re-export the package |
| Input object not found | Error before the runner starts |
| Runner cannot be spawned | `failed`, exit code -1, `Failed to spawn: …` |
| Non-zero exit | `failed` with the exit code; logs kept |
| Timeout, abort, signal, orchestrator death | See [Stopped Executions](#stopped-executions) |

### Concurrent Execution Safety

A dataflow run holds its workspace's `#dataflow` lock, and an ad-hoc `e3 run` holds the repository's `#tasks` lock shared. gc takes `#tasks` exclusively and every workspace's `#dataflow` lock, and refuses while a run holds one. Two attempts at one execution identity each record their own `executionId` directory.

## Example Session

```bash
e3 workspace deploy . prod --from-zip forecast.zip   # import, create and deploy
e3 dataflow run . prod                               # run every task that is not cached
e3 task list . prod                                  # each task's latest execution
e3 task logs . prod.train                            # a task's logs
e3 dataflow run . prod --force                       # re-run even the cached tasks
```
