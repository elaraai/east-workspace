/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The task execution interface: what runs one task, however it runs it.
 *
 * The dataflow's orchestration lives in `dataflow/` (the step functions and
 * `LocalOrchestrator`); a `TaskRunner` is what those steps call to execute a
 * task — locally by spawning a runner, or remotely.
 */

import type { EastTypeValue } from '@elaraai/east';
import type { ExecutionStatus, PartitionProgress, RunnerValue } from '@elaraai/e3-types';
import type { StorageBackend } from '../storage/interfaces.js';

// =============================================================================
// Task Execution
// =============================================================================

/**
 * Options for task execution.
 */
export interface TaskExecuteOptions {
  /** Force execution even if cached */
  force?: boolean;
  /** Pass `-v` to the runner (known runtimes only) so it prints timing/perf
   *  to stderr. Runtime-only: never affects the task hash or caching. */
  verbose?: boolean;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Callback for stdout data */
  onStdout?: (data: string) => void;
  /** Callback for stderr data */
  onStderr?: (data: string) => void;
  /** The memory, in bytes, the execution is expected to need: for a unit of a
   *  split task, the largest peak a unit of its stage has reached in the run.
   *  A local runner reserves it from its budget; a remote one may size the
   *  unit's function by it. Absent while nothing has been measured. */
  expectedPeakBytes?: number;
  /** Called as each unit of a split task (a piece, or a merge of their
   *  outputs) starts, and as it succeeds. Runtime-only progress reporting. */
  onPartitionProgress?: (progress: PartitionProgress) => void;
  /** Called when the execution waits for room to run, with the memory in
   *  bytes it waits to reserve (0 when it waits for a core alone), and with
   *  `null` once it has room or stops waiting. A runner that holds no budget
   *  never calls it. Runtime-only. */
  onWaiting?: (needs: number | null) => void;
  /** Called when a unit of a split task was stopped — by the budget's guard,
   *  or its cgroup's cap — and runs again under the same execution. The
   *  dataflow's loop records it as an event of the run. Runtime-only. */
  onRequeued?: (requeue: UnitRequeue) => void;
  /** Variables every runner process of the execution gets in its environment,
   *  after the orchestrator's own: the secrets a platform function reads, say,
   *  which the caller holds for this execution alone. Runtime-only: never
   *  hashed, so the execution's identity does not depend on them, and never
   *  logged. A local runner refuses one that sets a variable e3 sets itself
   *  (`PATH`, `E3_RUNNER_SEARCH_DIRS`, `E3_FETCH_SEGMENTS`, which only a unit
   *  turns on). */
  extraEnv?: Readonly<Record<string, string>>;
}

/** A unit stopped and run again (see {@link TaskExecuteOptions.onRequeued}). */
export interface UnitRequeue {
  /** Why its runner was stopped: past the budget, with the machine nearly out
   *  of memory, or by its cgroup's cap. */
  readonly reason: 'budget' | 'machine' | 'cap';
  /** The most its runner was measured using, in bytes: for a cap, the cap. */
  readonly peak: number;
  /** The memory, in bytes, it reserves when it runs again. */
  readonly reserves: number;
}

/**
 * Result of a single task execution.
 */
export interface TaskResult {
  /** Final state */
  state: 'success' | 'failed' | 'error';
  /** Whether the result was served from cache */
  cached: boolean;
  /** Execution ID (UUIDv7): the attempt that ran, or the one the cache served,
   *  which the run's record names */
  executionId: string;
  /** Output hash (if state is 'success') */
  outputHash?: string;
  /** Exit code (if state is 'failed') */
  exitCode?: number;
  /** What went wrong, when state is 'failed' or 'error': a failed runner's
   *  exit and the tail of its stderr, or why e3 could not run it */
  error?: string;
  /** True when e3 stopped the task because the run was aborted (state
   *  'error', message `cancelled: …`) — not the task's own failure */
  cancelled?: boolean;
  /** The highest peak resident memory, in bytes, a runner process of the
   *  execution reached, as its execution records it — for a result served
   *  from the cache too. Absent when no runner reported one. */
  peakBytes?: number;
}

/** An execution's record while it runs: the `running` case of its status. */
export type RunningExecution = Extract<ExecutionStatus, { type: 'running' }>['value'];

/**
 * Whether an execution recorded `running` can still finish, as the runner
 * that started it judges it: what {@link TaskRunner.executionAlive} answers.
 *
 * @remarks
 * What a driver or a runner hands the execution cache's probe, so that the
 * probe rewrites a `running` record as interrupted only when the execution's
 * own runner says it cannot finish. A unit running on another host is then
 * left running — its runner's compute says so — whatever the host that probes
 * can see of its processes.
 */
export type ExecutionLiveness = (
  storage: StorageBackend,
  taskHash: string,
  inputsHash: string,
  running: RunningExecution,
) => Promise<boolean>;

/** What a `merge` unit of a split task assembles: outputs its pieces wrote. */
export interface MergeParts {
  /** The parts' hashes, in piece order. */
  readonly parts: readonly string[];
  /** The hash of the key range the merge is limited to — `{from, to}` over
   *  the parts' key type, as `planMergeRanges` writes it — or `null` to
   *  merge them whole. */
  readonly range: string | null;
}

/**
 * One unit of a task split into pieces: a piece, which runs the task's program
 * over the piece's inputs, or a merge of what the pieces wrote.
 */
export interface SplitUnit {
  /** The unit's inputs as its execution records them — a piece's inputs, or a
   *  merge's `merge` tag, its range and its parts — which, with the task, are
   *  its identity in the execution cache. */
  readonly inputs: string[];
  /** What a merge unit merges, or `null` for a piece. */
  readonly merge: MergeParts | null;
  /** Whether the unit is the task's own execution: the one unit of a task
   *  whose input closes no piece, which runs under the task's own identity.
   *  Every other unit's execution record says it is a unit, and a task's
   *  history leaves it out. */
  readonly own: boolean;
}

/**
 * A delivery an intake reads: a file the runner opens, or an object in the
 * store, the delivery stored whole.
 */
export type IntakeSource =
  /** A file on a filesystem the runner reads: a local runner's own. */
  | { readonly file: string }
  /** An object in the store, by its hash. */
  | { readonly object: string };

/**
 * One intake: a delivered collection, or a run of its segments, taken in as
 * its declared type (see {@link TaskRunner.intake}).
 */
export interface IntakeSpec {
  /** The delivery. */
  readonly source: IntakeSource;
  /** The collection type the delivery's header must name: an Array, Set or
   *  Dict. */
  readonly type: EastTypeValue;
  /** The delivery's segments `[from, to)`, by its index: a piece of a large
   *  delivery. Absent, the whole delivery. */
  readonly segments?: { readonly from: number; readonly to: number };
}

/**
 * Options for {@link TaskRunner.intake}.
 */
export interface IntakeOptions {
  /** Aborting it stops the intake, and a runner waiting for room never
   *  starts. */
  signal?: AbortSignal;
}

/**
 * What an intake stored.
 */
export interface IntakeResult {
  /** The manifest the delivery's rows were stored as, through the store's
   *  door. */
  readonly hash: string;
  /** The runner that took it in, as its command is named: `east-c` or
   *  `east-node` for a local runner. */
  readonly runner: string;
  /** Why the runner is not the one the backend prefers, when it is not: a
   *  local runner's east-c could not run the unit. */
  readonly fallback?: string;
  /** The runner's peak resident memory, in bytes, when it reported one. */
  readonly peakBytes?: number;
}

// =============================================================================
// Detached Execution
// =============================================================================

/**
 * An argument of a detached run: a value's beast2 bytes, or a stored dataset,
 * by the hash of the object its ref names.
 */
export type DetachedArg = Uint8Array | { readonly dataset: string };

/**
 * Specification of a detached run.
 */
export interface DetachedSpec {
  /** function: from FunctionObject; one-shot: from request */
  bodyIr: Uint8Array;
  /** Positional arguments, already validated for arity. A stored dataset is
   *  staged as a task input is — a collection as its manifest with the
   *  segments linked, which a stock runner opens lazily, or spliced into one
   *  file for a custom command — so a large one never passes through this
   *  process. */
  args: DetachedArg[];
  /** wire runner variant: a stock runner runs the call as a unit, a custom
   *  one its command */
  runner: RunnerValue;
  /** execution limits (all required — the caller applies defaults/clamps) */
  limits: { timeoutMs: number; maxResultBytes: number; maxLogBytes: number };
  /** environment spec object hash (FunctionObject.environment); the runner
   *  materializes it and prepends its bin dir to the child PATH */
  environment?: string;
}

/**
 * Result of a detached run.
 *
 * - `success`: the value's beast2 bytes, under the size cap — the runner's
 *   output file, or a collection's segments spliced into one blob
 * - `failed`: the process exited non-zero (or failed to spawn)
 * - `too_large`: the output over `maxResultBytes` — its file's size, or a
 *   collection's segments' — and the value never loaded
 * - `timed_out`: the process group was killed at `timeoutMs`
 */
export type DetachedResult =
  | { kind: 'success';   value: Uint8Array; stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean }
  | { kind: 'failed';    exitCode: number;  stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean }
  | { kind: 'too_large'; bytes: number; limit: number; stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean }
  | { kind: 'timed_out'; ms: number; stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean };

/**
 * Options for a detached run ({@link TaskRunner.runDetached}).
 */
export interface DetachedRunOptions {
  /** AbortSignal for cancellation (kills the process group). */
  signal?: AbortSignal;
  /** Anchor directory for the runner-binary PATH walk (replaces the task
   *  path's "walk up from repo dir" — one-shot has no repo path). The
   *  process cwd is always searched as well. */
  runnerSearchDir?: string;
  /** Executable dirs prepended to the child PATH (a materialized
   *  environment's bin dir). */
  extraBins?: string[];
  /** Storage backend for materializing `spec.environment` and staging a
   *  stored dataset argument (local runner); required when the spec declares
   *  an environment or has a dataset argument. */
  storage?: StorageBackend;
  /** The repository a local runner runs the call for. The call runs in a
   *  scratch directory under its scratch root, as an execution does, so a
   *  dataset argument's segments are linked rather than copied; required,
   *  with `storage`, when the spec has a dataset argument. Without it the
   *  call runs in the OS temp directory. */
  repo?: string;
  /** Pass `-v` to a stock runner's `exec`, so it prints where the time went
   *  and its peak memory to stderr. */
  verbose?: boolean;
  /** Variables the runner gets in its environment, after this process's own:
   *  the secrets a platform function reads, say. Runtime-only: never logged.
   *  One that sets a variable e3 sets itself (`PATH`,
   *  `E3_RUNNER_SEARCH_DIRS`, `E3_FETCH_SEGMENTS`, which only a unit turns
   *  on) is refused. */
  extraEnv?: Readonly<Record<string, string>>;
}

/**
 * Task execution abstraction.
 *
 * Implementations:
 * - LocalTaskRunner: Spawns east-node/east-py/julia processes locally
 * - LambdaTaskRunner: Dispatches to AWS Lambda
 * - FargateTaskRunner: Dispatches to AWS Fargate
 */
export interface TaskRunner {
  /**
   * Execute a task.
   *
   * @param storage - Storage backend
   * @param taskHash - Hash of the TaskObject
   * @param inputHashes - Hashes of input datasets
   * @param options - Execution options
   * @returns Task result
   */
  execute(
    storage: StorageBackend,
    taskHash: string,
    inputHashes: string[],
    options?: TaskExecuteOptions
  ): Promise<TaskResult>;

  /**
   * Execute one unit of a task split into pieces, which the caller planned: a
   * piece, or a merge of what the pieces wrote. Served from the execution
   * cache when the unit ran before, unless forced.
   *
   * @remarks
   * The unit's execution is recorded under the task and the unit's inputs, as
   * a task's is under its own. The dataflow runs a split task's units through
   * this, beside every other task's.
   *
   * @param storage - Storage backend
   * @param taskHash - Hash of the TaskObject
   * @param unit - The unit
   * @param options - Execution options
   * @returns The unit's result
   */
  executeUnit(
    storage: StorageBackend,
    taskHash: string,
    unit: SplitUnit,
    options?: TaskExecuteOptions
  ): Promise<TaskResult>;

  /**
   * Whether an execution recorded `running` can still finish, which the runner
   * that started it knows: a local runner by its runner process and the
   * orchestrator recorded as its owner, a remote one by its own compute. The
   * workspace status reports a task in progress while its execution can, and
   * stale once it cannot.
   *
   * @param storage - Storage backend
   * @param taskHash - Hash of the TaskObject
   * @param inputsHash - The execution's combined inputs hash
   * @param running - Its `running` record
   * @returns Whether it can still finish
   */
  executionAlive(
    storage: StorageBackend,
    taskHash: string,
    inputsHash: string,
    running: RunningExecution
  ): Promise<boolean>;

  /**
   * Run a body IR detached from the dataflow graph (function / one-shot
   * call): marshal the args, run on the spec's runner, return the result
   * inline. Writes nothing durable — no output object, no execution record,
   * no logs.
   *
   * @param spec - Body IR, args, runner, and limits
   * @param options - Cancellation + runner search anchor
   */
  runDetached(spec: DetachedSpec, options?: DetachedRunOptions): Promise<DetachedResult>;

  /**
   * The largest delivery, in bytes, this runner takes in whole, by one intake
   * unit; `null` when it takes in any.
   *
   * @remarks
   * A delivery with an index is cut into pieces, runs of its segments, and one
   * that cannot be cut — it has no index, or its segments alias one another —
   * is taken in whole. A runner whose units run on compute of a bounded size,
   * such as a function with a small disk, cannot take a large one in, so an
   * intake refuses such a delivery above this before any unit runs, naming the
   * fix: write it again with a current Writer. A local runner takes in what its
   * machine holds, and states none.
   */
  readonly wholeIntakeLimit: number | null;

  /**
   * Take a delivered collection in, or a run of its segments, through an
   * `intake` unit, and store what it wrote through the store's door.
   *
   * @remarks
   * The runner walks each row of the delivery by its type and hands the
   * Writer's own bytes on as they stand, writing any other row again, so what
   * it stores is the manifest the Writer writes for those rows. Writes the
   * segments and the manifest, and nothing else: no execution record, no log,
   * no ref. Nothing names what it stored until its caller does, so the caller
   * holds off a sweep until then.
   *
   * A run of segments checks only its own rows: a caller that assembles a
   * delivery's pieces checks that a Set's or a Dict's keys ascend where they
   * meet.
   *
   * Where placing an object is a download (`ObjectStore.placement`), a run of
   * the segments of a delivery the store holds is staged as what the unit
   * reads of it — its header, the run and its index — so the unit downloads
   * its piece, not the delivery (`runIntake` stages it so). A refusal names the
   * run's segments as the delivery numbers them.
   *
   * @param storage - Storage backend
   * @param spec - The delivery, its declared type, and the run of its segments
   * @param options - Cancellation
   * @returns The stored manifest, and the runner that took it in
   * @throws {DeliveryRefusedError} When the runner refuses the delivery: not a
   *   beast2 collection of the declared type, a malformed or oversized segment,
   *   a row that does not decode, or keys that do not ascend.
   * @throws {Error} When no runner can run the unit, or the runner fails
   *   without saying why the delivery is refused.
   */
  intake(storage: StorageBackend, spec: IntakeSpec, options?: IntakeOptions): Promise<IntakeResult>;
}
