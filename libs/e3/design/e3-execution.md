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

The `status` file is a `.beast2` encoded struct:

```ts
const ExecutionStatusType = VariantType({
  // task has been launched
  running: StructType({
    inputHashes: ArrayType(StringType), // input hashes
    startedAt: DateTimeType,
    pid: IntegerType,                   // process ID
    pidStartTime: IntegerType,          // process start time (jiffies since boot, from /proc/<pid>/stat)
    bootId: StringType,                 // system boot ID (from /proc/sys/kernel/random/boot_id)
  }),
  // task ran and returned exit code 0
  success: StructType({
    inputHashes: ArrayType(StringType), // input hashes
    outputHash: StringType,             // output hash
    startedAt: DateTimeType,
    completedAt: DateTimeType,
  }),
  // task ran and returned exit code other than 0
  failed: StructType({
    inputHashes: ArrayType(StringType), // input hashes
    startedAt: DateTimeType,
    completedAt: DateTimeType,
    exitCode: IntegerType,
  }),
  // e3 execution engine had an internal error
  error: StructType({
    inputHashes: ArrayType(StringType), // input hashes
    startedAt: DateTimeType,
    completedAt: DateTimeType,
    message: StringType,
  }),
});

type ExecutionStatus = ValueTypeOf<typeof ExecutionStatusType>;
```

Note: `taskHash` is not stored in the status file since it is encoded in the directory path (while the input hashes are hashed together into a single hash in the path).

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

## Core Execution APIs

### `inputsHash(inputHashes: string[]): string`

Compute the combined hash of input hashes. Pure function, no I/O.

```ts
function inputsHash(inputHashes: string[]): string {
  const data = inputHashes.join('\0');
  return computeHash(new TextEncoder().encode(data));
}
```

### `executionPath(repo: string, taskHash: string, inputsHash: string): string`

Get filesystem path for an execution directory.

```ts
function executionPath(repo: string, taskHash: string, inputsHash: string): string {
  return path.join(repo, 'executions', taskHash, inputsHash);
}
```

### `executionGet(repo: string, taskHash: string, inputsHash: string): Promise<ExecutionStatus | null>`

Get execution status. Returns null if execution doesn't exist.

### `executionListForTask(repo: string, taskHash: string): Promise<string[]>`

List all inputs hashes that have executions for a given task.

### `executionList(repo: string): Promise<Array<{ taskHash: string, inputsHash: string }>>`

List all executions in the repository.

### `executionGetOutput(repo: string, taskHash: string, inputsHash: string): Promise<string | null>`

Get output hash for a completed execution. Returns null if not complete or failed.

### `executionReadLog(repo: string, taskHash: string, inputsHash: string, stream: 'stdout' | 'stderr', options?: LogReadOptions): Promise<LogChunk>`

Read execution logs with pagination support.

```ts
interface LogReadOptions {
  offset?: number;    // Byte offset to start reading from (default: 0)
  limit?: number;     // Maximum bytes to read (default: 64KB)
}

interface LogChunk {
  data: string;       // Log content (UTF-8)
  offset: number;     // Byte offset of this chunk
  size: number;       // Bytes in this chunk
  totalSize: number;  // Total log file size (for pagination)
  complete: boolean;  // True if this is the end of the file
}
```

## Task Execution

### `taskExecute(repo: string, taskHash: string, inputHashes: string[], options?: ExecuteOptions): Promise<ExecutionResult>`

Execute a single task. This is the core execution primitive.

```ts
interface ExecuteOptions {
  force?: boolean;        // Re-run even if cached (default: false)
  timeout?: number;       // Timeout in ms (default: none)
  onStdout?: (data: string) => void;  // Stream stdout callback
  onStderr?: (data: string) => void;  // Stream stderr callback
}

interface ExecutionResult {
  execId: string;         // Execution hash
  cached: boolean;        // True if result was from cache
  state: 'success' | 'failed';
  outputHash: string | null;  // Output dataset hash (null on failure)
  exitCode: number | null;
  duration: number;       // Execution time in ms (0 if cached)
  error: string | null;   // Error message on failure
}
```

#### Execution Flow

1. **Compute inputs hash**: `inHash = inputsHash(inputHashes)`

2. **Check cache** (unless `force: true`):
   - If `executions/<taskHash>/<inHash>/output` exists, return cached result
   - Read status to get metadata

3. **Read task object**: Decode TaskObject from `taskHash`

4. **Resolve runner**: Get the command template from the task object's `command` field

5. **Create scratch directory**: `e3-exec-<task8>-<in8>-<pid>-<pidStartTime>-<ms>` under `E3_SCRATCH_DIR`, or the system temp directory (see [Stopped Executions](#stopped-executions))

6. **Marshal inputs**:
   - For each input hash, read from object store
   - Write to scratch dir: `input-0.beast2`, `input-1.beast2`, ...

7. **Construct command**: Expand runner command template:
   - `literal` → pass through
   - `input_path` → next input file path
   - `inputs` → repeat pattern for remaining inputs
   - `output_path` → `output.beast2` in scratch dir

8. **Create execution directory**: `executions/<taskHash>/<inHash>/`

9. **Write initial status**: `state: 'running'`, `startedAt: now()`

10. **Execute command**:
    - Spawn process with constructed command
    - Tee stdout to `executions/<taskHash>/<inHash>/stdout.txt` and `onStdout` callback
    - Tee stderr to `executions/<taskHash>/<inHash>/stderr.txt` and `onStderr` callback
    - Wait for completion or timeout

11. **On success** (exit code 0):
    - Read `output.beast2` from scratch dir
    - Store in object store, get output hash
    - Write ref to `executions/<taskHash>/<inHash>/output`
    - Update status: `state: 'success'`, `completedAt: now()`, `exitCode: 0`

12. **On failure** (non-zero exit or timeout):
    - Update status: `state: 'failed'`, `completedAt: now()`, `exitCode`, `error`

13. **Cleanup**: Remove scratch directory

14. **Return result**

### Why Separate stdout/stderr?

Yes, we should separate stdout and stderr:

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

### `execStart(repo: string, ws: string, options?: ExecStartOptions): Promise<ExecResult>`

Execute all tasks in a workspace, respecting dependencies.

```ts
interface ExecStartOptions {
  filter?: string;        // Only run tasks matching this name (exact match for MVP)
  concurrency?: number;   // Tasks the loop may have in progress at once; locally the jobs budget
  force?: boolean;        // Re-run all tasks even if cached
  onTaskStart?: (taskName: string) => void;
  onTaskComplete?: (taskName: string, result: ExecutionResult) => void;
}

interface ExecResult {
  success: boolean;           // All tasks succeeded
  tasksRun: number;           // Number of tasks executed
  tasksCached: number;        // Number of cache hits
  tasksFailed: number;        // Number of failures
  totalDuration: number;      // Wall-clock time
  results: Map<string, ExecutionResult>;  // Per-task results
}
```

#### Execution Flow

1. **Read workspace state**: Get deployed package hash and current root

2. **Read package object**: Get tasks and structure

3. **Build dependency graph**:
   - For each task, collect input paths and output path
   - Task B depends on Task A if any of B's inputs matches A's output
   - Detect cycles (error if found)

4. **Apply filter** (if specified):
   - Keep only matching task and its transitive dependencies

5. **Topological sort**: Order tasks so dependencies run first

6. **Execute with concurrency**:
   ```
   ready = tasks with no pending dependencies
   running = {}
   completed = {}

   while tasks remain:
     # Start tasks up to concurrency limit; each runner they spawn
     # then takes a slot of the jobs budget (see "The Jobs Budget")
     while |running| < concurrency and ready is not empty:
       task = ready.pop()
       start task asynchronously
       running.add(task)

     # Wait for any task to complete
     result = await any(running)
     running.remove(result.task)
     completed.add(result.task)

     # Update workspace if successful
     if result.success:
       workspaceSetDataset(ws, task.output, result.outputHash)

     # Mark dependent tasks as ready
     for task in tasks:
       if all dependencies in completed:
         ready.add(task)
   ```

7. **Return aggregate result**

### `execWatch(repo: string, ws: string, options?: ExecWatchOptions): Promise<void>`

Watch for input changes and re-execute affected tasks. (Future - not MVP)

## Garbage Collection Integration

The GC system already traces from executions. Key points:

1. **Execution outputs are roots**: `executions/<hash>/output` refs are traced
2. **Status files are metadata**: Not objects, just state
3. **Log files are ephemeral**: Can be pruned independently (future)

### Finding Executions for a Task

While executions aren't organized by task hash, we can:

1. **Full scan**: List all executions, read status, filter by `taskHash`
2. **In-memory index**: Build during GC mark phase

For MVP, full scan is acceptable. Future optimization: maintain an index file.

## Error Handling

### Execution Failures

| Scenario | Behavior |
|----------|----------|
| Runner not configured | Error before execution starts |
| Input hash not found | Error before execution starts |
| Command not found | Execution fails, exit code from shell |
| Non-zero exit | Execution fails, logs preserved |
| Timeout | Runner tree stopped (its process group; on Windows its job), `error` recorded as `timed out: …` (see [Stopped Executions](#stopped-executions)) |
| Output file missing | Execution fails, error in status |
| Output decode error | Execution fails, error in status |

### Concurrent Execution Safety

Multiple processes might try to execute the same task:

1. **Optimistic locking**: First to write status "owns" the execution
2. **Check before start**: If status exists and running, wait or skip
3. **Atomic output**: Write output ref atomically (temp file + rename)

For MVP: Single-process execution. Future: Advisory locking.

## Example Session

```bash
# Deploy and run
$ e3 workspace deploy prod forecast-model 1.0.0
$ e3 exec start prod
Running task: preprocess (1/3)
Running task: train (2/3)
Running task: evaluate (3/3)
✓ All tasks completed (2 cached, 1 executed)

# Check execution
$ e3 exec list prod
preprocess  abc123...  success  0.5s (cached)
train       def456...  success  12.3s
evaluate    789abc...  success  2.1s (cached)

# View logs
$ e3 exec logs prod train --stderr
[2024-01-15 10:23:45] Loading model...
[2024-01-15 10:23:47] Training epoch 1/10...
...

# Re-run with force
$ e3 exec start prod --force
Running task: preprocess (1/3)
...
```

## API Summary

### Execution Identity
- `inputsHash(inputHashes)` - Compute combined inputs hash
- `executionPath(repo, taskHash, inputsHash)` - Get execution directory path

### Execution Management
- `executionGet(repo, taskHash, inputsHash)` - Get execution status
- `executionGetOutput(repo, taskHash, inputsHash)` - Get output hash
- `executionListForTask(repo, taskHash)` - List executions for a task
- `executionList(repo)` - List all executions
- `executionReadLog(repo, taskHash, inputsHash, stream, options)` - Read logs with pagination

### Task Execution
- `taskExecute(repo, taskHash, inputHashes, options)` - Run single task

### Dataflow Orchestration
- `execStart(repo, ws, options)` - Run task DAG
- `execWatch(repo, ws, options)` - Watch mode (future)
