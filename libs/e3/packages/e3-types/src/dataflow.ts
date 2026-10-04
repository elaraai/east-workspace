/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Dataflow execution state type definitions.
 *
 * These types define the persistent state for dataflow execution,
 * stored in workspaces/<ws>/execution.beast2
 *
 * Key design decisions:
 * - Dates are Date objects (via DateTimeType), not strings
 * - A run's events are kept apart from its state, so a write of the state
 *   costs what the run holds, not what it has done
 * - Tasks stored as Dict (not Map) for beast2 compatibility
 */

import {
  StructType,
  VariantType,
  ArrayType,
  DictType,
  StringType,
  IntegerType,
  BooleanType,
  DateTimeType,
  OptionType,
  NullType,
  ValueTypeOf,
  decodeBeast2,
  decodeBeast2For,
  isTypeValueEqual,
  lessFor,
  readBeast2Type,
  toEastTypeValue,
  variant,
  type EastTypeValue,
} from '@elaraai/east';
import { E3_RELEASE, compareReleases } from './release.js';

// =============================================================================
// Status Literals (TypeScript only - East uses StringType)
// =============================================================================

/**
 * Status of a dataflow execution.
 */
export type DataflowExecutionStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Status of an individual task within an execution.
 */
export type TaskStatus = 'pending' | 'ready' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'deferred';

// =============================================================================
// Task State
// =============================================================================

/**
 * Information about a task's execution state.
 *
 * Stored in the tasks Dict of DataflowExecutionStateType.
 */
export const TaskStateType = StructType({
  /** Task name */
  name: StringType,
  /** Current status (TaskStatus as string) */
  status: StringType,
  /** Whether the result was served from cache */
  cached: OptionType(BooleanType),
  /** Output hash if completed successfully */
  outputHash: OptionType(StringType),
  /** Error message if failed */
  error: OptionType(StringType),
  /** Exit code if task process failed */
  exitCode: OptionType(IntegerType),
  /** When the task started */
  startedAt: OptionType(DateTimeType),
  /** When the task completed */
  completedAt: OptionType(DateTimeType),
  /** Duration in milliseconds */
  duration: OptionType(IntegerType),
  /** The `$plan` object of the stage a task split into pieces is in, while
   *  it runs, and across a yield, so a resumed run takes the stage up where
   *  it stopped. */
  plan: OptionType(StringType),
  /** The execution the task completed with — run, or served from the cache —
   *  by its inputs hash and id, which the run's record names. */
  execution: OptionType(StructType({
    /** The combined hash of the task's inputs */
    inputsHash: StringType,
    /** The execution's id (UUIDv7) */
    executionId: StringType,
  })),
});
export type TaskState = ValueTypeOf<typeof TaskStateType>;

// =============================================================================
// Graph Types
// =============================================================================

/**
 * A task within the dataflow graph.
 */
export const DataflowGraphTaskType = StructType({
  /** Task name */
  name: StringType,
  /** Task object hash */
  hash: StringType,
  /** Input dataset paths */
  inputs: ArrayType(StringType),
  /** Output dataset path */
  output: StringType,
  /** Names of tasks this depends on */
  dependsOn: ArrayType(StringType),
});
export type DataflowGraphTask = ValueTypeOf<typeof DataflowGraphTaskType>;

/**
 * The complete dataflow dependency graph.
 */
export const DataflowGraphType = StructType({
  /** All tasks in the graph */
  tasks: ArrayType(DataflowGraphTaskType),
});
export type DataflowGraph = ValueTypeOf<typeof DataflowGraphType>;

// =============================================================================
// Event Types
// =============================================================================

/**
 * A unit of a split task, by its place in the task: its stage — the pieces,
 * or a level of the merges that assemble their outputs — and its index among
 * the stage's units.
 */
export const StageUnitType = StructType({
  /** The merge level, from 1, and the levels the merges take; `none` for a
   *  piece */
  merge: OptionType(StructType({ level: IntegerType, levels: IntegerType })),
  /** The unit's index in its stage, from 0 */
  index: IntegerType,
  /** The units of its stage */
  units: IntegerType,
});
export type StageUnit = ValueTypeOf<typeof StageUnitType>;

/**
 * Why a unit's runner was stopped and the unit requeued: `budget`, the guard
 * stopped it with the runners past the budget; `machine`, the guard stopped it
 * with the machine nearly out of memory; `cap`, its cgroup's cap killed it.
 */
export const RequeueReasonType = VariantType({
  budget: NullType,
  machine: NullType,
  cap: NullType,
});
export type RequeueReason = ValueTypeOf<typeof RequeueReasonType>;

/**
 * Execution events (VariantType for discriminated union).
 *
 * Events track the progress of a dataflow execution. A store keeps a run's
 * events apart from its state, each numbered by its `seq`, and a poll reads
 * those past its cursor.
 *
 * @remarks
 * A stored form, as the state is: a reader decodes events against the whole
 * type they were written with, so a new event is a new form of a run's events,
 * which the release that makes it carries repositories into with an upgrade
 * step. Each unit's progress is a callback, {@link PartitionProgress}, and is
 * not persisted.
 */
export const ExecutionEventType = VariantType({
  /** Execution started */
  execution_started: StructType({
    /** Event sequence number */
    seq: IntegerType,
    /** When the event occurred */
    timestamp: DateTimeType,
    /** Execution ID */
    executionId: StringType,
    /** Total number of tasks in the graph */
    totalTasks: IntegerType,
  }),
  /** Task became ready to execute */
  task_ready: StructType({
    /** Event sequence number */
    seq: IntegerType,
    /** When the event occurred */
    timestamp: DateTimeType,
    /** Task name */
    task: StringType,
  }),
  /** Task execution started */
  task_started: StructType({
    /** Event sequence number */
    seq: IntegerType,
    /** When the event occurred */
    timestamp: DateTimeType,
    /** Task name */
    task: StringType,
  }),
  /** Task completed successfully */
  task_completed: StructType({
    /** Event sequence number */
    seq: IntegerType,
    /** When the event occurred */
    timestamp: DateTimeType,
    /** Task name */
    task: StringType,
    /** Whether the result was served from cache */
    cached: BooleanType,
    /** Output hash */
    outputHash: StringType,
    /** Duration in milliseconds */
    duration: IntegerType,
    /** The highest peak resident memory, in bytes, a runner of the task's
     *  execution reached; `none` when none reported one, or the cache served
     *  the task */
    peakBytes: OptionType(IntegerType),
  }),
  /** Task failed */
  task_failed: StructType({
    /** Event sequence number */
    seq: IntegerType,
    /** When the event occurred */
    timestamp: DateTimeType,
    /** Task name */
    task: StringType,
    /** Error message */
    error: OptionType(StringType),
    /** Exit code if task process failed */
    exitCode: OptionType(IntegerType),
    /** Duration in milliseconds */
    duration: IntegerType,
  }),
  /** Task was skipped due to upstream failure */
  task_skipped: StructType({
    /** Event sequence number */
    seq: IntegerType,
    /** When the event occurred */
    timestamp: DateTimeType,
    /** Task name */
    task: StringType,
    /** Name of the upstream task that caused the skip */
    cause: StringType,
  }),
  /** Execution completed */
  execution_completed: StructType({
    /** Event sequence number */
    seq: IntegerType,
    /** When the event occurred */
    timestamp: DateTimeType,
    /** Whether all tasks succeeded */
    success: BooleanType,
    /** Number of tasks executed (not from cache) */
    executed: IntegerType,
    /** Number of tasks served from cache */
    cached: IntegerType,
    /** Number of tasks that failed */
    failed: IntegerType,
    /** Number of tasks skipped */
    skipped: IntegerType,
    /** Total duration in milliseconds */
    duration: IntegerType,
  }),
  /** Execution was cancelled */
  execution_cancelled: StructType({
    /** Event sequence number */
    seq: IntegerType,
    /** When the event occurred */
    timestamp: DateTimeType,
    /** Reason for cancellation */
    reason: OptionType(StringType),
  }),
  /** An input dataset changed during execution (reactive dataflow) */
  input_changed: StructType({
    /** Event sequence number */
    seq: IntegerType,
    /** When the event occurred */
    timestamp: DateTimeType,
    /** Path of the changed input dataset */
    path: StringType,
    /** Previous hash (empty string if was unassigned) */
    previousHash: StringType,
    /** New hash */
    newHash: StringType,
  }),
  /** A task was invalidated due to upstream input change */
  task_invalidated: StructType({
    /** Event sequence number */
    seq: IntegerType,
    /** When the event occurred */
    timestamp: DateTimeType,
    /** Task name */
    task: StringType,
    /** Reason for invalidation */
    reason: StringType,
  }),
  /** A task was deferred due to inconsistent input versions */
  task_deferred: StructType({
    /** Event sequence number */
    seq: IntegerType,
    /** When the event occurred */
    timestamp: DateTimeType,
    /** Task name */
    task: StringType,
    /** Path where version conflict was detected */
    conflictPath: StringType,
  }),
  /** A task was split into pieces: its units start as the pieces, and its
   *  `$plan` names them. */
  task_split: StructType({
    /** Event sequence number */
    seq: IntegerType,
    /** When the event occurred */
    timestamp: DateTimeType,
    /** Task name */
    task: StringType,
    /** The pieces the task was split into */
    pieces: IntegerType,
  }),
  /** A level of the merges assembling a split task's pieces started. */
  task_merge_started: StructType({
    /** Event sequence number */
    seq: IntegerType,
    /** When the event occurred */
    timestamp: DateTimeType,
    /** Task name */
    task: StringType,
    /** The level, from 1 */
    level: IntegerType,
    /** The number of levels the merges take */
    levels: IntegerType,
    /** The merge units of the level */
    units: IntegerType,
  }),
  /** A level of the merges assembling a split task's pieces finished. */
  task_merge_completed: StructType({
    /** Event sequence number */
    seq: IntegerType,
    /** When the event occurred */
    timestamp: DateTimeType,
    /** Task name */
    task: StringType,
    /** The level, from 1 */
    level: IntegerType,
    /** The number of levels the merges take */
    levels: IntegerType,
  }),
  /** A unit of a split task was stopped and requeued: it runs again, under
   *  the same execution, once the memory it reserves fits. */
  unit_requeued: StructType({
    /** Event sequence number */
    seq: IntegerType,
    /** When the event occurred */
    timestamp: DateTimeType,
    /** Task name */
    task: StringType,
    /** The unit */
    unit: StageUnitType,
    /** Why its runner was stopped */
    reason: RequeueReasonType,
    /** The most its runner was measured using, in bytes: for a cap, the cap */
    peak: IntegerType,
    /** The memory, in bytes, it reserves when it runs again */
    reserves: IntegerType,
  }),
});
export type ExecutionEvent = ValueTypeOf<typeof ExecutionEventType>;

/**
 * Progress notification for one unit of a task split into pieces — a piece,
 * or a unit merging or folding their outputs. Delivered through runner-layer
 * callbacks while the task runs, and not persisted: the execution state records
 * a split task's stages, not each unit, so it stays small however many pieces
 * a task has. The local `[PART]`/`[MERGE]`/`[COMBINE]` lines come straight
 * from this callback.
 */
export interface PartitionProgress {
  /** Which phase the unit belongs to: a piece (`partition`), a merge of a set
   *  or dict output, or a fold of a fold output (`combine`). */
  phase: 'partition' | 'combine' | 'merge';
  /** Zero-based index of the unit within its phase. */
  index: number;
  /** Total units in the phase (the pieces, or the units of a merge level). */
  total: number;
  /** Units of the phase that succeeded so far, including this one when
   *  `state` is `completed`. */
  completed: number;
  /** Whether the unit started, or succeeded. */
  state: 'started' | 'completed';
  /** Whether the unit was served from the execution cache (completed only). */
  cached?: boolean;
  /** Unit duration in milliseconds (completed only). */
  duration?: number;
}

// =============================================================================
// Forced Tasks
// =============================================================================

/**
 * The tasks a dataflow run forces: re-executes even where the execution cache
 * holds their results.
 *
 * - `none`: no task; each is served from the cache when it can be
 * - `all`: every task the run launches — under a filter, the filter's task
 * - `tasks`: the tasks named, and no other
 *
 * @remarks
 * A forced task is forced each time the run launches it, so one invalidated
 * mid-run and launched again is forced again. Its dependents are not forced:
 * they re-run when its output changes. A run that names a task the graph does
 * not have, or one its filter's run set leaves out, is refused before anything
 * runs.
 */
export const DataflowForceType = VariantType({
  none: NullType,
  all: NullType,
  tasks: ArrayType(StringType),
});
export type DataflowForce = ValueTypeOf<typeof DataflowForceType>;

/**
 * The tasks a run forces, from the option a caller passes it.
 *
 * @param force - `true` for every task, the names of the tasks, or `false` or
 *   nothing for none
 * @returns What the run forces
 */
export function dataflowForce(force: boolean | readonly string[] | undefined): DataflowForce {
  if (force === undefined || force === false) return variant('none', null);
  if (force === true) return variant('all', null);
  return variant('tasks', [...force]);
}

/**
 * The option a run's forced tasks are passed to an orchestrator as.
 *
 * @param force - What the run forces
 * @returns `true` for every task, the names of the tasks, or `false` for none
 */
export function dataflowForceOption(force: DataflowForce): boolean | string[] {
  switch (force.type) {
    case 'none': return false;
    case 'all': return true;
    case 'tasks': return [...force.value];
  }
}

// =============================================================================
// Main Execution State
// =============================================================================

/**
 * Persistent state for a dataflow execution.
 *
 * Stored in workspaces/<ws>/execution.beast2
 *
 * @remarks
 * - Tasks are stored as a Dict (serializes as object, not array of tuples)
 * - A run's events are kept apart from it: `events` holds those the run has
 *   added since its state was last written, which the write hands its store,
 *   so a state a store holds, or reads back, holds none
 * - Dates are Date objects (via DateTimeType)
 * - Read it back with {@link decodeDataflowExecutionState}, which reads this
 *   form alone. A release that changes it ships a repository upgrade step,
 *   which carries a repository's states into the new form when that release
 *   first opens it.
 */
export const DataflowExecutionStateType = StructType({
  /** The release of e3 that wrote the state */
  release: StringType,

  // Identity
  /** The run's id, a UUIDv7, which its `DataflowRun` record carries as `runId` */
  id: StringType,
  /** Repository identifier */
  repo: StringType,
  /** Workspace name */
  workspace: StringType,
  /** When the execution started */
  startedAt: DateTimeType,

  // Config (immutable after initialization)
  /** The tasks the run re-executes even where the cache holds their results
   *  ({@link DataflowForceType}) */
  force: DataflowForceType,
  /** One task's exact name: the run runs it and its dependency closure */
  filter: OptionType(StringType),

  // Graph (inline or by reference)
  /** The dependency graph (for local execution) */
  graph: OptionType(DataflowGraphType),
  /** Hash/key referencing a separately stored graph (for cloud) */
  graphHash: OptionType(StringType),

  // Task tracking
  /** Map of task name -> task state */
  tasks: DictType(StringType, TaskStateType),

  // Summary counters
  /** Number of tasks executed (not from cache) */
  executed: IntegerType,
  /** Number of tasks served from cache */
  cached: IntegerType,
  /** Number of tasks that failed */
  failed: IntegerType,
  /** Number of tasks skipped due to upstream failure */
  skipped: IntegerType,

  // Status
  /** Current execution status */
  status: StringType, // DataflowExecutionStatus
  /** When the execution completed */
  completedAt: OptionType(DateTimeType),
  /** Error message if status is 'failed' */
  error: OptionType(StringType),

  // Reactive dataflow tracking
  /** Version vectors: dataset keypath -> VersionVector (root input path -> hash) */
  versionVectors: DictType(StringType, DictType(StringType, StringType)),
  /** Input snapshot: root input keypath -> hash at time of last check */
  inputSnapshot: DictType(StringType, StringType),
  /** Set of dataset keypaths that are task outputs */
  taskOutputPaths: ArrayType(StringType),
  /** Number of tasks re-executed due to input changes */
  reexecuted: IntegerType,

  // Events, kept apart
  /** The events the run has added since its state was last written, in
   *  order: a write of the state hands them to its store, which keeps a run's
   *  events apart from its state, so a stored state holds none */
  events: ArrayType(ExecutionEventType),
  /** The sequence number of the run's last event, which the next event's
   *  follows: 0 while it has none */
  eventSeq: IntegerType,
});
export type DataflowExecutionState = ValueTypeOf<typeof DataflowExecutionStateType>;

const STATE_TYPE = toEastTypeValue(DataflowExecutionStateType);
const decodeState = decodeBeast2For(DataflowExecutionStateType);

/**
 * Decodes a stored execution state.
 *
 * The form is told by the type the state's header declares, since a decoder
 * built for another form's type would misread it rather than fail. A
 * repository's upgrade steps carry its states into this form when this
 * release first opens it, so a state of another form is refused, naming the
 * release that wrote it: a newer one, whose e3 reads it, or an older one that
 * no step carries forward, whose repository is re-created.
 *
 * @param data - the stored state
 * @returns the state
 * @throws {Error} When the state is of another form, naming the release that
 *   wrote it, or the data is not an execution state — of another type, or not
 *   beast2 at all.
 */
export function decodeDataflowExecutionState(data: Uint8Array): DataflowExecutionState {
  let type: EastTypeValue;
  try {
    type = readBeast2Type(data);
  } catch (err) {
    throw new Error(`the data is not an execution state: it is not beast2 (${err instanceof Error ? err.message : `${err as string}`})`, { cause: err });
  }
  if (isTypeValueEqual(type, STATE_TYPE)) return decodeState(data);
  const { value } = decodeBeast2(data);
  const state = typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
  const release = typeof state?.release === 'string' ? state.release : null;
  if (release !== null && compareReleases(release, E3_RELEASE) > 0) {
    throw new Error(
      `the execution state was written by e3 ${release}, in a form this e3, ${E3_RELEASE}, does not read — use e3 ${release} or a newer one`,
    );
  }
  if (state !== null && 'workspace' in state && 'tasks' in state && 'events' in state) {
    throw new Error(
      `the execution state was written by ${release === null ? 'an older e3' : `e3 ${release}`}, in a form this e3, ${E3_RELEASE}, does not read — ` +
      're-create the repository: deploy again and import its data again',
    );
  }
  throw new Error('the data is not an execution state: its type is not the execution state\'s');
}

/**
 * A dataflow run's state but its graph, its tasks, its reactive tracking and
 * its events: what a poll of the run serves but the events, and the sequence
 * number of its last event, past which a poll reads the events it has not
 * served.
 *
 * @remarks
 * An execution state store answers it for a workspace's latest run
 * (`ExecutionStateStore.readLatestSummary`), so a poll reads it rather than
 * the whole state, which grows with the dataflow and with every event of the
 * run. A store may keep it beside the state, written with each change of the
 * state; one that reads the whole state anyway derives it
 * ({@link executionStateSummary}).
 */
export const ExecutionStateSummaryType = StructType({
  /** The run's id, a UUIDv7 */
  id: StringType,
  /** When the run started */
  startedAt: DateTimeType,
  /** Number of tasks executed (not from cache) */
  executed: IntegerType,
  /** Number of tasks served from cache */
  cached: IntegerType,
  /** Number of tasks that failed */
  failed: IntegerType,
  /** Number of tasks skipped due to upstream failure */
  skipped: IntegerType,
  /** The run's status ({@link DataflowExecutionStatus}) */
  status: StringType,
  /** When the run ended */
  completedAt: OptionType(DateTimeType),
  /** Why the run failed, when it did */
  error: OptionType(StringType),
  /** The sequence number of the run's last event: 0 while it has none */
  lastSeq: IntegerType,
});
export type ExecutionStateSummary = ValueTypeOf<typeof ExecutionStateSummaryType>;

/** Whether one event sequence number comes before another. */
const seqBefore = lessFor(IntegerType);

/**
 * The sequence number of a run's last event, as its state counts it: the
 * state's own count, or the last event it holds, which a write has not yet
 * handed its store, when that is later.
 *
 * @param state - The run's state
 * @returns The sequence number: 0 while the run has no event
 */
export function lastEventSeq(state: Pick<DataflowExecutionState, 'events' | 'eventSeq'>): bigint {
  const held = state.events.at(-1)?.value.seq;
  return held !== undefined && seqBefore(state.eventSeq, held) ? held : state.eventSeq;
}

/**
 * The summary of a run's state ({@link ExecutionStateSummaryType}).
 *
 * @param state - The run's state
 * @returns Its summary: its last event's sequence number is the last event's
 *   own ({@link lastEventSeq}), however the event was recorded
 */
export function executionStateSummary(state: DataflowExecutionState): ExecutionStateSummary {
  return {
    id: state.id,
    startedAt: state.startedAt,
    executed: state.executed,
    cached: state.cached,
    failed: state.failed,
    skipped: state.skipped,
    status: state.status,
    completedAt: state.completedAt,
    error: state.error,
    lastSeq: lastEventSeq(state),
  };
}

// =============================================================================
// Dataflow Run History
// =============================================================================

/**
 * Status of a dataflow run.
 */
export const DataflowRunStatusType = VariantType({
  /** Run is currently executing */
  running: StructType({}),
  /** Run completed successfully */
  completed: StructType({}),
  /** Run failed with a task error */
  failed: StructType({
    /** Name of the task that failed */
    failedTask: StringType,
    /** Error message */
    error: StringType,
  }),
  /** Run was cancelled */
  cancelled: StructType({}),
});
export type DataflowRunStatus = ValueTypeOf<typeof DataflowRunStatusType>;

/**
 * Record of a task execution within a dataflow run: the execution the run
 * used, which a local repository keeps at
 * executions/<taskHash>/<inputsHash>/<executionId>/, whatever the workspace
 * has held since.
 */
export const TaskExecutionRecordType = StructType({
  /** Execution ID (UUIDv7): the attempt that ran, or the one the cache served */
  executionId: StringType,
  /** Hash of the task object */
  taskHash: StringType,
  /** Combined hash of the task's inputs */
  inputsHash: StringType,
  /** Whether this was a cache hit */
  cached: BooleanType,
  /** Output version vector (which root input versions produced this output) */
  outputVersions: DictType(StringType, StringType),
  /** Number of times this task was executed (including re-executions due to input changes) */
  executionCount: IntegerType,
});
export type TaskExecutionRecord = ValueTypeOf<typeof TaskExecutionRecordType>;

/**
 * Summary statistics for a dataflow run.
 */
export const DataflowRunSummaryType = StructType({
  /** Total number of tasks */
  total: IntegerType,
  /** Number of completed tasks */
  completed: IntegerType,
  /** Number of cached tasks */
  cached: IntegerType,
  /** Number of failed tasks */
  failed: IntegerType,
  /** Number of skipped tasks */
  skipped: IntegerType,
  /** Number of tasks re-executed due to input changes */
  reexecuted: IntegerType,
});
export type DataflowRunSummary = ValueTypeOf<typeof DataflowRunSummaryType>;

/**
 * A dataflow run record, tracking one execution of a workspace's dataflow.
 *
 * Stored in: dataflows/<workspace>/<runId>.beast2
 *
 * This provides execution history and provenance tracking:
 * - Which tasks ran and which were cached
 * - Input/output snapshots for reproducibility
 * - Timing information for performance analysis
 */
export const DataflowRunType = StructType({
  /** Run ID (UUIDv7) */
  runId: StringType,
  /** Workspace name */
  workspaceName: StringType,
  /** Package reference at run time (name@version) */
  packageRef: StringType,

  /** When the run started */
  startedAt: DateTimeType,
  /** When the run completed (null if still running) */
  completedAt: OptionType(DateTimeType),

  /** Current status of the run */
  status: DataflowRunStatusType,

  /** Input version snapshot at start (root input path -> hash) */
  inputVersions: DictType(StringType, StringType),
  /** Output version snapshot at end (null if still running) */
  outputVersions: OptionType(DictType(StringType, StringType)),

  /** Map of task name -> execution record */
  taskExecutions: DictType(StringType, TaskExecutionRecordType),

  /** Summary statistics */
  summary: DataflowRunSummaryType,
});
export type DataflowRun = ValueTypeOf<typeof DataflowRunType>;
