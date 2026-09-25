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
 * - Events stored inline as array (single file, not separate JSONL)
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
  ValueTypeOf,
  decodeBeast2,
  decodeBeast2For,
  isTypeValueEqual,
  readBeast2Type,
  toEastTypeValue,
} from '@elaraai/east';

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
 * Execution events (VariantType for discriminated union).
 *
 * Events track the progress of a dataflow execution and are stored
 * inline in the execution state (not as a separate JSONL file).
 *
 * @remarks
 * Part of the execution state's wire, which changes only by version (see
 * {@link EXECUTION_STATE_VERSION}): a reader decodes a state against the whole
 * type it was written with, so a new event is a new version of the state.
 * Each unit's progress is a callback, {@link PartitionProgress}, and is not
 * persisted.
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
// Main Execution State
// =============================================================================

/**
 * The version of the execution state this e3 writes.
 *
 * @remarks
 * A reader decodes a stored state against the whole type it was written with,
 * so the type changes only by version, and
 * {@link decodeDataflowExecutionState} reads this version alone, refusing any
 * other and naming it.
 *
 * - 1: as first released, without a `version`.
 * - 2: a task's `plan`, and the events of a split task's stages.
 */
export const EXECUTION_STATE_VERSION = 2n;

/**
 * Persistent state for a dataflow execution.
 *
 * Stored in workspaces/<ws>/execution.beast2
 *
 * @remarks
 * - Tasks are stored as a Dict (serializes as object, not array of tuples)
 * - Events are stored inline (not as separate JSONL file)
 * - Dates are Date objects (via DateTimeType)
 * - Read it back with {@link decodeDataflowExecutionState}, which reads
 *   {@link EXECUTION_STATE_VERSION} alone
 */
export const DataflowExecutionStateType = StructType({
  /** The state's version: {@link EXECUTION_STATE_VERSION} */
  version: IntegerType,

  // Identity
  /** Unique execution ID (local: auto-increment, cloud: UUID) */
  id: StringType,
  /** Repository identifier */
  repo: StringType,
  /** Workspace name */
  workspace: StringType,
  /** When the execution started */
  startedAt: DateTimeType,

  // Config (immutable after initialization)
  /** Maximum concurrent task executions */
  concurrency: IntegerType,
  /** Force re-execution even if cached */
  force: BooleanType,
  /** Filter to run only specific task(s) by exact name */
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

  // Events (inline array)
  /** All events for this execution */
  events: ArrayType(ExecutionEventType),
  /** Sequence number for next event (auto-increment) */
  eventSeq: IntegerType,
});
export type DataflowExecutionState = ValueTypeOf<typeof DataflowExecutionStateType>;

const STATE_TYPE = toEastTypeValue(DataflowExecutionStateType);
const decodeState = decodeBeast2For(DataflowExecutionStateType);

/**
 * Decodes a stored execution state.
 *
 * The version is told by the type the state's header declares, since a
 * decoder built for another version's type would misread it rather than fail.
 * Stored state changes by hard cutover, so a state of another version is
 * refused, naming its version: an older e3's, whose repository is re-created,
 * or a newer one's.
 *
 * @param data - the stored state
 * @returns the state
 * @throws {Error} When an older or a newer e3 wrote the state, naming its
 *   version, or the data is not an execution state.
 */
export function decodeDataflowExecutionState(data: Uint8Array): DataflowExecutionState {
  const type = readBeast2Type(data);
  if (isTypeValueEqual(type, STATE_TYPE)) return decodeState(data);
  const { value } = decodeBeast2(data);
  const state = typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
  const version = state?.version;
  if (typeof version === 'bigint' && version > EXECUTION_STATE_VERSION) {
    throw new Error(
      `the execution state was written by a newer e3: it is version ${version}, and this e3 reads version ${EXECUTION_STATE_VERSION}`,
    );
  }
  if (state !== null && 'workspace' in state && 'tasks' in state && 'events' in state) {
    throw new Error(
      `the execution state was written by an older e3: it is version ${typeof version === 'bigint' ? version : 1n}, and this e3 reads version ${EXECUTION_STATE_VERSION} — ` +
      're-create the repository: deploy again and import its data again',
    );
  }
  throw new Error('the data is not an execution state: its type is not the execution state\'s');
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
 * Record of a task execution within a dataflow run.
 */
export const TaskExecutionRecordType = StructType({
  /** Execution ID (UUIDv7) */
  executionId: StringType,
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
