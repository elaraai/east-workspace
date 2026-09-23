# Task Execution Design

This document specifies the task execution system for e3, covering single task execution, execution history, and dataflow DAG orchestration.

## Overview

Tasks are computations that read input datasets and produce output datasets. The execution system:

1. **Memoizes** results - same inputs produce same outputs, cached by execution hash
2. **Streams logs** - stdout/stderr captured in real-time for debugging
3. **Orchestrates DAGs** - runs tasks in dependency order with parallelism

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
        ├── plan                # Partitioned tasks: hash of the completed partition plan
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

### Status File Format

`status.beast2` holds an `ExecutionStatusType` value (`e3-types/src/execution.ts`), a variant with one case per state. Every case carries the attempt's `executionId` (a UUIDv7), the `inputHashes` and `startedAt`:

| Case | Meaning | Adds |
|---|---|---|
| `running` | the runner has been launched | `pid`, `pidStartTime`, `bootId` (see Crash Detection) |
| `success` | the runner exited 0 and its output was stored | `outputHash`, `completedAt` |
| `failed` | the runner exited non-zero, or could not be spawned | `completedAt`, `exitCode` |
| `error` | e3 stopped the runner, or failed around it | `completedAt`, `message` (see Stopped Executions) |

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
2. **Cache.** Unless `force`, `probeExecutionCache` returns a recorded `success` for `(taskHash, inHash)`. Only `success` is ever served from the cache. A stale `running` record is repaired `interrupted:` on the way (see Stopped Executions).
3. **Attempt.** A new `executionId` (UUIDv7) names this attempt's directory.
4. **Task.** The task object is read from the store. A partitioned task (`kind` `partition`) is run by its step template instead (see Partitioned Tasks).
5. **Scratch.** A scratch directory `e3-exec-<task8>-<in8>-<pid>-<pidStartTime>-<ms>` is created under `E3_SCRATCH_DIR`, or else the system temp directory.
6. **Inputs** (`marshalInputsToDir`). Each input object is staged as `input-<i>.beast2` without passing through e3's heap: linked, reflinked or kernel-copied where the backend's objects are files, streamed a chunk at a time otherwise.
   - A collection stored as a segment manifest is staged as the manifest plus one linked file per segment (`input-<i>.beast2.segments/<hash>.beast2`) for a runner that opens manifests (east-node), and spliced into one file for the others.
   - A `custom` runner is given copies, never links, since its command could modify an input path.
7. **Command.** The task's command IR is evaluated over the staged input paths and the output path, giving the argv. For a stock runner, `-v` (when verbose) and `--exit-with-parent` are spliced in after `[<bin>, <command>]`.
8. **Run.** The spawn takes a slot of the jobs budget (see The Jobs Budget). Once the runner has spawned, the `running` status and the `owner` sidecar are written. stdout and stderr stream to the attempt's log files (see Output Capture).
9. **Outcome.**
   - On exit 0, `adoptOutputFile` takes the output file into the store: it is hashed by streaming and linked, never decoded. The `output` ref and a `success` status are then written.
   - Every other outcome is recorded as Stopped Executions describes.
10. **Cleanup.** The scratch directory is removed.

### stdout and stderr

They are kept separate:

1. **Debugging**: stderr often contains warnings/errors that are useful to filter
2. **Convention**: Unix tools expect this separation
3. **Structured output**: Some runners might emit structured data on stdout
4. **Log levels**: Can display stderr prominently in UI while dimming stdout

### Output Capture

Each stream is decoded as whole UTF-8 characters and appended to its log with at most one append in flight; whatever arrives meanwhile is coalesced into the next append. While more than 1 MiB handed to the log has not been written, e3 pauses the pipe, so a runner that floods its output blocks on the pipe instead of growing e3's heap.

## Stopped Executions

An execution that e3 stops, or whose process dies, is recorded with a status that names the cause. There is no status case for it: `error` carries a message whose prefix is the cause, so the status type — a wire format — is unchanged.

| Outcome | Status | Message |
|---|---|---|
| The runner exits 0 | `success` | — |
| e3 stopped the runner because the run was aborted (Ctrl-C, `SIGTERM`, `SIGHUP`, `LocalOrchestrator.cancel()`, the caller's `AbortSignal`) | `error` | `cancelled: e3 stopped the runner because the run was aborted` |
| The run was aborted while the execution waited for a job slot, so no runner ever started | `error` | `cancelled: e3 did not start the runner because the run was aborted` |
| e3 stopped the runner at the task's timeout | `error` | `timed out: e3 stopped the runner after <ms> ms` |
| A signal from elsewhere ended the runner | `failed`, exit code -1 | `e3: runner killed by <signal>` |
| The runner exits non-zero, or cannot be spawned | `failed` | the exit code (-1 and `Failed to spawn: …` for a spawn failure) |
| The orchestrator died before recording the outcome (found by a later run) | `error` | `interrupted: the orchestrator exited before this execution finished (runner pid <pid>)` |

Every stopped or signalled outcome also appends `e3: <message>` to the execution's `stderr.txt`, so its log says why it ended.

**A cancelled execution is not a failure.** `ExecutionResult.cancelled` (and `TaskResult.cancelled`) is true for the `cancelled:` case. `LocalOrchestrator` gives each run one `AbortController`, following the caller's signal and `cancel()`, and passes it to every execution. A task whose result is cancelled goes back to `pending` without an event (the event type is a frozen wire), `onTaskComplete` receives `state: 'cancelled'` (the CLI prints `[CANCELLED] <task>`), and the run ends through the abort path as `cancelled`. Only `success` is ever served from the cache, so the next run executes the task.

**Runners exit with e3.** On POSIX runners are spawned `detached`, in their own process group, so e3 can stop a whole runner tree — which also means a runner outlives an e3 that dies without warning (a V8 abort, `kill -9`). A stock runner (east-node, east-c, east-py) is therefore given a stdin pipe e3 never writes to and `--exit-with-parent` on its command line (spliced at spawn by `withRunnerLifeline`, after the cache decision, like `-v`): its watcher blocks reading stdin and exits the runner when the read returns end of file, which happens when e3's end of the pipe closes with e3. On Windows the pipe is overlapped (Node's stdio `'overlapped'`): the watcher's read stays pending for the runner's whole life, and a read pending on a synchronous pipe holds the pipe's file-object lock, so any other use of stdin in the runner would wait for e3 to go — east-node opening `process.stdin` when a module first imports `node:process` hung partition units that way. A `custom` runner keeps an ignored stdin and its argv untouched. (On Windows the job below ends the runner with e3; the lifeline covers an install without the job launcher.)

**Stopping a runner tree.** On POSIX a stop signals the runner's process group; a process that leaves the group (`setsid`) escapes it, a known and accepted limitation. Windows has no process group a signal can address, so there e3 runs each runner through its job launcher, `e3-job.exe` (`libs/e3/native/e3-job`, shipped as e3-core's optional dependency `@elaraai/e3-job-win32-x64`): the launcher joins a new Job Object that allows no breakaway and ends every member when its last handle closes, then starts the runner in it, with the command line e3 would have given the runner, and exits with the runner's exit code. A stop ends the launcher, and with it every process the runner started — including a program Git Bash's exec leaves with an exited parent, which no walk of parent pids finds. The job ends the same way when e3 dies (Node ends its direct children with it) and when the runner exits, so on Windows nothing a runner starts outlives it. The `running` record's pid is the launcher's, which lives exactly as long as the runner. An install without the launcher (optional dependencies omitted) warns `E3_NO_JOB_LAUNCHER`, runs runners directly and stops them with `taskkill /T`, which misses such orphans. On every platform a stop finishes even when a process it could not reach holds the runner's output open: once the runner has exited, e3 reads its output for 5 s more and then closes the pipes itself.

**The owner sidecar, and interrupted executions.** Once a runner has spawned, e3 writes the `running` status (the runner's pid, start time and boot id) and an `owner` sidecar naming itself (`{ pid, pidStartTime, bootId }`). A `running` record is stale only when both processes are gone: the cache probe (`probeExecutionCache`) rewrites it `interrupted:` when the runner is dead **and** the owner exists and is dead. A live owner may be between its runner's exit and the record's write — hashing the output — so its record is never touched, and a record without an owner sidecar (written by an older e3) is never repaired.

**Scratch directories.** An execution runs in `e3-exec-<task8>-<in8>-<pid>-<pidStartTime>-<ms>`, named after the execution and the orchestrator that owns it, under `E3_SCRATCH_DIR` or else the system temp directory. A runner writes its whole output there before e3 stores it, and nothing else: no runner spills anywhere (the emit sink and the `merge` command write their output once, in order). A tmpfs `TMPDIR` therefore holds an output in memory; point `E3_SCRATCH_DIR` at a disk for large outputs. The execution removes the directory when it finishes. `sweepScratchDirs` removes the directories whose owner has exited — its pid no longer has the start time in the name, or, where the platform reports no start time for the pid (Windows, a pid `/proc` cannot answer for), the pid no longer exists (signal 0) — and runs before every local `e3 dataflow run` and in `repoGc`.

## Partitioned Tasks

A partition task (`e3.partitionTask`) is one task node with one output dataset — authored, deployed, cached and observed as one task — and under the hood a **template of steps** the orchestrator interprets (`execution/steps.ts`). The value work — the body, `merge`, `combine` — runs on the task's runner as ordinary executions; the byte work — carving slices, splicing blobs, hashing outputs — streams through the storage layer; the orchestrator plans, schedules and records. It holds at most one decoded segment per open blob and never evaluates a `merge` or `combine` function.

### Steps

A step reads hashes from a logical input, an earlier step's result or an object the template wrote, and yields a plan, a list of hashes or one hash. There are four kinds:

- **plan.** The primary partitioned input's segment index gives the boundaries: greedy byte packing up to `targetPartitionBytes`, advanced so rows with equal `by` projections never split. `by` is evaluated by reading key fields — the SDK builds only leading-prefix projections — never by compiling its IR. Each co-partitioned secondary gets a split point at every boundary. The plan is a pure function of the inputs and the task's metadata, and is stored before anything is carved from it.
- **map.** One execution per partition of the task's own command over `[functionIr, ...slices, ...broadcast]`, in a pool as wide as the run's jobs budget (or `partitionConcurrency`, when given). When a worker picks up partition `p` it carves that partition's slices (`carvePartitionSlices`: byte copies of the primary's segments, and of each secondary's range with at most the two edge segments a split falls inside re-encoded) unless a recorded plan supplies them. No input is read whole. The result is one output hash per partition.
- **reduce.** A tree of executions of one task over an earlier step's hashes. The entries are grouped — `all` as one group; or `ranges`, the partials whose key ranges overlap grouped into components and each component cut into key ranges of about `rangeBytes` (the task's `targetPartitionBytes`), every range a group of its own — and every level groups `fanIn` consecutive entries of a group into one unit, whose inputs are the step's leading inputs, the group's key range when it has one, and its entries, in wire order; a group of one passes through, and a level's units, across groups, run in the pool before the next level starts. The result is one hash per group, in key order.
- **splice.** The byte splice of an earlier step's hashes, in order, under the first blob's header (`spliceBlobs`). Set and Dict blobs must ascend disjointly in key order, which is checked from their fences, one blob open at a time. When the step's source yields no hash (every partial empty) the result is the empty collection under the header of the fallback step's first hash.

Three templates, chosen by the task's metadata:

| template | steps | when |
|---|---|---|
| splice | plan, map, splice | neither `merge` nor `combine` |
| combine | plan, map, reduce(the task itself, leading `[combineIr]`, fan-in 2, one group) | `combine` |
| merge | plan, map, reduce(the merge unit task, leading `[mergeIr]` or none, fan-in `MERGE_TREE_FANIN` (32), ranges, `rangeBytes` = `targetPartitionBytes`), splice | `merge`, or a Set output |

A combine step is an execution of the task with the combine IR as its input 0, exactly as `function_ir` is for a body execution, so the unchanged side of the tree cache-hits; a combine folds whole values, so its memory is the runner's to bound. Components group the partials whose key ranges overlap: each partial's range is its first fence and its last key; ordered by first key, a partial joins the current component when its first key is at most the greatest last key the component has seen. Empty partials belong to no component, and a component of one partial is already its own result.

**Ranges.** A component's fan-in is not one pass over its whole output: the component is cut into key ranges, and each range is merged by its own units, in parallel. The number of ranges is the component's bytes over `targetPartitionBytes`, capped by the segments of its largest partial (the pilot), whose fences supply the boundary keys — the pilot's segments pack greedily into runs of about equal bytes, and each run after the first starts a range at its first fence — so a component whose partials are single segments, or smaller than the target, merges whole, over the open range. Nothing is carved for a range: each range is a small object, `Struct{from: Option<K>, to: Option<K>}` over the output's key type (`[from, to)`, a bound `none` when open), that every merge unit of the range takes as an input beside the whole partials, and the runner's `merge --range` seeks every partial to the segment owning `from` through its fences and stops at the first key at or past `to` — a unit reads its range's share of every partial, plus at most one segment. A range of at most 32 partials is one merge unit, and the tree above it takes the same range; the ranges' results, and the components', splice in key order. The orchestrator's planning cost is the pilot's fence probes alone (a bounded prefix of each frame): the ranges are planned from the partials' indexes and the task — never from the pool width, the jobs budget or timing — and recorded in the plan (`merges`), so a re-run with the same partials reuses them and, its units' inputs unchanged, its merge units cache-hit.

**Units.** Every unit — partition, merge unit or combine step — is an ordinary content-addressed execution, `(unitTaskHash, inputsHash(unitInputs))`, spawned like any other (scratch directory, a slot of the jobs budget, stdin lifeline, owner sidecar, its own logs). It is probed in the execution cache first and run through `StepExecutors.executeUnit` only on a miss: the local executor runs the standard execution body, and a remote backend supplies its own. The `carve` and `splice` hooks of `StepExecutors` default to the storage-layer code, so a remote backend can move the bytes where it likes while the orchestration stays in e3-core. Failure attribution is deterministic (the lowest index of a level; a failed carve counts at its partition's index); a cancelled unit is not a failure, and an aborted run records the logical execution `cancelled: e3 stopped the partitioned run because the run was aborted`.

**The logical execution.** With two or more partitions, the task's own execution is recorded `running` under the orchestrator (with its owner sidecar) while its units run, and its `stdout.txt` gets one line per unit once the unit's result is known:
```
partition <p>/<n> <completed|cached|failed|cancelled> task=<hash> inputs=<hash> execution=<id> duration=<ms>
merge level <l>/<levels> unit <i>/<n> <state> task=<hash> inputs=<hash> execution=<id> duration=<ms>
combine level <l>/<levels> unit <i>/<n> <state> task=<hash> inputs=<hash> execution=<id> duration=<ms>
```
The ids are in full, so `e3 task logs <repo> --execution <task>/<inputs>/<id>` opens any unit's own logs. When the last step yields the output, the logical execution records `success`. A plan of one partition instead runs the single unit under the task's own identity: its slice would be byte-identical to the input.

### The Merge Command

Every stock runner has a `merge` command beside `run`: `<runner> merge -p <package>… [--merge <ir> | --union] [--range <blob>] -i <blob>… -o <output>`. It merges sorted Set or Dict blobs of one type: the inputs are read lazily, a segment at a time, through a k-way heap ordered by key and then input index; adjacent equal keys fold in input order — a Dict with the `merge` function, `acc = merge(key, acc, v)`, a Set keeping the first — and the entries are written through the same segment writer as `run`'s emit sink. With `--range` — a blob of `Struct{from: Option<K>, to: Option<K>}` over the inputs' key type, checked against it — only the keys in `[from, to)` merge: every input's fences are checked to ascend and searched for the segment owning `from` (a fence that does not ascend is refused in the reader's own words), the keys before `from` in that segment are skipped, and the input ends at the first key at or past `to`; an absent bound is open. It holds no spill runs and never reads an input whole.

The package carries the command. `partitionTask` with `merge` (or a Set output) writes `mergeCommand` into the task's partition metadata at export — `mergeCommandIr` in e3-types: `[...runnerToArgv(runner, 'merge'), '--merge', inputs[0] | '--union', '--range', the next input, ('-i', path) for each remaining input, '-o', output]` — so no IR is generated at run time. The merge unit task is `{ commandIr: mergeCommand, inputs: [], output: [], kind: merge (TASK_KIND_MERGE), metadata: none, runner, environment }`, a pure function of the package's objects that the template writes idempotently on every run and that is never a gc root; a unit's inputs are `[mergeIr, range, ...partials]` (`[range, ...partials]` for a Set), so its identity, `(unitTaskHash, inputsHash([mergeIr?, range, ...partials]))`, cache-hits on an unchanged part of the tree. The intermediate results of the tree are cached execution outputs, stored like any other. A merge cannot run on the `custom` runtime (`partition merge needs a stock runtime (east-c, east-node, east-py); this task uses the custom runtime`) or for a package exported before merge commands existed (`partition merge: the package was exported before merge commands existed — re-export it with the current SDK`); either is the logical execution's error, raised only when a unit would run.

**Determinism.** `merge` must be associative: a unit may fold part of a key's values before the rest, though never out of partition order. The output is a deterministic function of the inputs and the task: the partitions, the components, the ranges and the tree are planned from the blobs' indexes and the task's metadata, and every unit writes through the sink's own writer, so the same job writes the same bytes — one content hash — on every machine, at every `--jobs`, on every runner, and a forced re-run reuses its recorded slices and ranges. Each unit's output is exactly the bytes the ascending sink writes for its rows; a component of one range is therefore byte-identical to the same job run as a `streamTask` whose body emits ascending, and an output of several ranges or components splices those blobs under one header: the same rows, segmented per range and component.

### The Partition Plan

The plan is an object (`PartitionPlanType`): the partitioned input hashes in wire order, the primary's boundaries (the first segment of each partition), each secondary's split points (segment and element offset, for every partition plus the end), `slices[input][partition]`, empty until carved, and `merges`: per merged component, its partials and the hashes of its range objects in key order (one open range for a component that merges whole). The plan with empty slices is written before anything is carved. When the map step ends — after a failed or cancelled partition too — the plan is written again with whatever was carved, an uncarved slice as `''`, and the `plan` sidecar names it; the reduce step writes it again as it plans each component's ranges.

A later run of the same logical execution (a retry, or `--force`, which re-runs executions but not the carve) reuses the recorded slices when the recorded plan decodes and plans exactly as this run (equal partitions, boundaries and splits), partition by partition: a partition whose slices were all recorded and still exist is not carved again; any other partition is carved when a worker picks it up. A component's ranges are reused when the plan recorded the same partials and every range object still exists; otherwise they are planned again — the same ranges, since they are a function of the partials.

Neither plans nor slices are gc roots, and a unit's output is rooted only once its execution is recorded. gc takes the repository's `#tasks` lock exclusively and every workspace's `#dataflow` lock before marking, and refuses while a run holds one; a dataflow run holds its workspace's `#dataflow` lock, and an ad-hoc `e3 run` holds `#tasks` shared for its execution (and refuses, in turn, while gc holds it). So gc never runs while a partitioned run is using its slices or unit outputs, and a slice gc removes between runs is carved again by the next run that needs it.

## The Jobs Budget

A local run has one budget of parallelism: `jobs`, the runner processes e3 keeps in flight at once. Every runner the local runner spawns — a task of the dataflow, a partition, a merge unit, a combine step — holds one slot of a `JobSlots` semaphore from just before its spawn until it has exited, first come first served, and an execution the run aborts while it waits is recorded `cancelled:` without a runner ever starting. The orchestrator's task loop and the step interpreter's pools decide what is *ready* (the CLI sets the task loop's `concurrency` to the budget, and a partitioned task's pool is as wide as the budget); the budget decides what *runs*, so a partitioned task's units queue beside the other tasks of the run instead of multiplying with them.

The budget is a runtime collaborator of the run, like its abort signal: `OrchestratorStartOptions.jobs` flows to each execution's `ExecuteOptions.jobs`, is never persisted, never enters an execution's identity, and is ignored by a remote runner (e3-cloud's capacity is its own). The CLI's `-j`/`--jobs` sets it, defaulting to `defaultJobs()`: the CPUs available to the process — `os.availableParallelism()` capped by the tightest cgroup v2 `cpu.max` up the process's hierarchy, as east-c's `east_cpu_count` sizes its thread pool — or `E3_JOBS`. The api-server runs each request's `concurrency` as that run's budget. Not yet budgeted: the threads a runner uses inside its own process (east-c's parallel deflate takes every CPU it can see), and memory.

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
- `stepFinalize`;
- `stepYield` and `stepCancel`;
- the reactive steps that detect input changes, invalidate tasks and check version consistency (see e3-reactive-dataflow.md).

Each step is pure or idempotent over the persisted state, so a run can yield and resume. The unit a step schedules is a whole task. The loop keeps up to `concurrency` tasks in progress: the CLI sets it to the jobs budget, and every runner those tasks spawn takes a slot of that budget. A task's successful output is written to the workspace under the dataflow lock. `e3 watch` (e3-watch.md) re-runs a workspace as its sources change.

## Garbage Collection Integration

A recorded execution's `output` ref is a GC root, so its output object is kept. Status files, owner sidecars and logs are files beside it, not objects. Partition plans and slices are not roots (see The Partition Plan).

## Error Handling

### Execution Failures

| Scenario | Behavior |
|----------|----------|
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
