/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * API wire types for e3.
 *
 * These East types define the request/response schemas used by the e3 REST API.
 * They are shared between e3-api-client and e3-api-server.
 *
 * Types that also serve as domain types (PackageImportResultType, DataflowGraphType,
 * DataflowGraphTaskType) are defined in their respective modules and re-exported here.
 *
 * Two types are prefixed with "Api" to avoid name conflicts with domain types
 * that have the same name but different structure:
 * - ApiExecutionStatusType (vs ExecutionStatusType in execution.ts — on-disk task status)
 * - ApiDataflowExecutionStateType (vs DataflowExecutionStateType in dataflow.ts — persistent state)
 */

import {
  VariantType,
  StructType,
  ArrayType,
  OptionType,
  StringType,
  IntegerType,
  FloatType,
  BooleanType,
  BlobType,
  NullType,
  DateTimeType,
  EastTypeType,
  type EastType,
  type ValueTypeOf,
} from '@elaraai/east';

import { StructureType, TreePathType } from './structure.js';
import { StopReasonType } from './execution.js';
import { IntakeFileType } from './intake.js';
import { RunnerType } from './runner.js';
import { TaskBodyType, TaskInputType, TaskOutputType, TaskPartitionType, TaskRoleType } from './task.js';
import { DataflowForceType, RequeueReasonType, StageUnitType } from './dataflow.js';

// =============================================================================
// Error Types
// =============================================================================

export const WorkspaceNotFoundErrorType = StructType({ workspace: StringType });
export const WorkspaceNotDeployedErrorType = StructType({ workspace: StringType });
export const WorkspaceExistsErrorType = StructType({ workspace: StringType });
export const LockHolderType = StructType({
  pid: IntegerType,
  acquiredAt: StringType,
  bootId: OptionType(StringType),
  command: OptionType(StringType),
});
export const WorkspaceLockedErrorType = StructType({
  workspace: StringType,
  holder: VariantType({ unknown: NullType, known: LockHolderType }),
});
export const PackageNotFoundErrorType = StructType({
  packageName: StringType,
  version: OptionType(StringType),
});
export const PackageExistsErrorType = StructType({ packageName: StringType, version: StringType });
export const PackageInvalidErrorType = StructType({ reason: StringType });
export const DatasetNotFoundErrorType = StructType({ workspace: StringType, path: StringType });
export const TaskNotFoundErrorType = StructType({ task: StringType });
export const ExecutionNotFoundErrorType = StructType({ task: StringType });
export const ObjectNotFoundErrorType = StructType({ hash: StringType });
export const DataflowErrorType = StructType({ message: StringType });
export const PermissionDeniedErrorType = StructType({ path: StringType });
export const InternalErrorType = StructType({ message: StringType });
export const RepositoryNotFoundErrorType = StructType({ repo: StringType });
/** A write refused at the door because the bytes' wire type is not the type the
 *  dataset declares. `message` is the shared one-line rendering (declared type,
 *  given type, first differing field) so a remote `e3 dataset set` prints the
 *  line a local one does. */
export const DatasetTypeMismatchErrorType = StructType({
  workspace: StringType,
  path: StringType,
  message: StringType,
});
/** A name e3 would make a path of that cannot be one path segment: a
 *  repository's, a workspace's, or a package's name or version. */
export const InvalidNameErrorType = StructType({
  kind: StringType,
  name: StringType,
  message: StringType,
});

export const ErrorType = VariantType({
  repository_not_found: RepositoryNotFoundErrorType,
  workspace_not_found: WorkspaceNotFoundErrorType,
  workspace_not_deployed: WorkspaceNotDeployedErrorType,
  workspace_exists: WorkspaceExistsErrorType,
  workspace_locked: WorkspaceLockedErrorType,
  package_not_found: PackageNotFoundErrorType,
  package_exists: PackageExistsErrorType,
  package_invalid: PackageInvalidErrorType,
  dataset_not_found: DatasetNotFoundErrorType,
  task_not_found: TaskNotFoundErrorType,
  execution_not_found: ExecutionNotFoundErrorType,
  object_not_found: ObjectNotFoundErrorType,
  dataflow_error: DataflowErrorType,
  dataflow_aborted: NullType,
  permission_denied: PermissionDeniedErrorType,
  internal: InternalErrorType,
  dataset_type_mismatch: DatasetTypeMismatchErrorType,
  invalid_name: InvalidNameErrorType,
});

// =============================================================================
// Response Wrapper
// =============================================================================

export const ResponseType = <T extends EastType>(successType: T) => VariantType({
  success: successType,
  error: ErrorType,
});

// =============================================================================
// Repository Types
// =============================================================================

/**
 * Repository status information.
 *
 * @property path - Absolute path to the e3 repository directory
 * @property objectCount - Number of content-addressed objects stored
 * @property packageCount - Number of imported packages
 * @property workspaceCount - Number of workspaces
 */
export const RepositoryStatusType = StructType({
  path: StringType,
  objectCount: IntegerType,
  packageCount: IntegerType,
  workspaceCount: IntegerType,
});

/**
 * Garbage collection request options.
 *
 * @property dryRun - If true, report what would be deleted without deleting
 * @property minAge - Minimum age in milliseconds for objects to be considered for deletion
 * @property keepRuns - The runs of each workspace kept however old, the latest
 *   first; the server's default when `none`
 * @property keepDays - The days of runs and executions kept however many; the
 *   server's default when `none`
 */
export const GcRequestType = StructType({
  dryRun: BooleanType,
  minAge: OptionType(IntegerType),
  keepRuns: OptionType(IntegerType),
  keepDays: OptionType(IntegerType),
});

/**
 * Garbage collection result.
 *
 * @property deletedObjects - Number of unreferenced objects deleted
 * @property deletedPartials - Number of incomplete uploads deleted
 * @property retainedObjects - Number of objects still referenced
 * @property skippedYoung - Number of objects skipped due to minAge
 * @property bytesFreed - Total bytes freed by deletion
 * @property deletedRuns - Number of dataflow run records deleted
 * @property deletedExecutions - Number of execution attempts deleted, each with
 *   its owner record and logs
 */
export const GcResultType = StructType({
  deletedObjects: IntegerType,
  deletedPartials: IntegerType,
  retainedObjects: IntegerType,
  skippedYoung: IntegerType,
  bytesFreed: IntegerType,
  deletedRuns: IntegerType,
  deletedExecutions: IntegerType,
});

// =============================================================================
// Async Operation Types
// =============================================================================

/**
 * Status of an async operation.
 *
 * - `running`: Operation is in progress
 * - `succeeded`: Operation completed successfully
 * - `failed`: Operation failed with an error
 */
export const AsyncOperationStatusType = VariantType({
  running: NullType,
  succeeded: NullType,
  failed: NullType,
});

/**
 * Result of starting an async GC operation.
 *
 * @property executionId - Unique identifier for this GC execution (UUID locally, Step Function ARN in cloud)
 */
export const GcStartResultType = StructType({
  executionId: StringType,
});

/**
 * Status of an async GC operation.
 *
 * @property status - Current execution status
 * @property stats - GC statistics (available when succeeded)
 * @property error - Error message (available when failed)
 */
export const GcStatusResultType = StructType({
  status: AsyncOperationStatusType,
  stats: OptionType(GcResultType),
  error: OptionType(StringType),
});

// =============================================================================
// Package Types
// =============================================================================

/**
 * Package list item (summary info).
 *
 * @property name - Package name
 * @property version - Semantic version string
 */
export const PackageListItemType = StructType({
  name: StringType,
  version: StringType,
});

/**
 * Basic package info.
 *
 * @property name - Package name
 * @property version - Semantic version string
 * @property hash - SHA256 content hash
 */
export const PackageInfoType = StructType({
  name: StringType,
  version: StringType,
  hash: StringType,
});

/**
 * Detailed package information including structure.
 *
 * @property name - Package name
 * @property version - Semantic version string
 * @property hash - SHA256 content hash
 * @property tasks - List of task names defined in the package
 * @property dataStructure - East structure type describing the package's data schema
 */
export const PackageDetailsType = StructType({
  name: StringType,
  version: StringType,
  hash: StringType,
  tasks: ArrayType(StringType),
  dataStructure: StructureType,
});

// =============================================================================
// Workspace Types
// =============================================================================

/**
 * Request to create a new workspace.
 *
 * @property name - Unique workspace name
 */
export const WorkspaceCreateRequestType = StructType({
  name: StringType,
});

/**
 * Workspace summary information.
 *
 * @property name - Workspace name
 * @property deployed - Whether a package is deployed to this workspace
 * @property packageName - Name of deployed package (if deployed)
 * @property packageVersion - Version of deployed package (if deployed)
 */
export const WorkspaceInfoType = StructType({
  name: StringType,
  deployed: BooleanType,
  packageName: OptionType(StringType),
  packageVersion: OptionType(StringType),
});

/**
 * What a deploy does with a record it cannot keep as it is.
 *
 * - `migrate`: run the migrations the workspace has not applied, and refuse a
 *   record no migration carries to the package's type
 * - `fail`: run none, and refuse a record with migrations to run, for a
 *   workspace whose migrations go through their own change control
 * - `reset`: reset a record it can neither keep nor migrate to the package's
 *   initial value, under a `$reset` commit, so the reset is in its history
 */
export const SchemaPolicyType = VariantType({
  migrate: NullType,
  fail: NullType,
  reset: NullType,
});

/**
 * Request to deploy a package to a workspace.
 *
 * @property packageRef - Package reference in format "name" or "name@version"
 * @property schema - What the deploy does with a record it cannot keep as it is
 * @property allowDropRecords - Whether a record the package no longer declares
 *   may be dropped, with its state and history
 * @property plan - Say what the deploy would do, and write nothing
 */
export const WorkspaceDeployRequestType = StructType({
  packageRef: StringType,
  schema: SchemaPolicyType,
  allowDropRecords: BooleanType,
  plan: BooleanType,
});

/**
 * What a deploy decided for one record.
 *
 * @property record - The record's dataset ref path
 * @property action - What the deploy does to it:
 *   - `mint`: the workspace does not hold it, so it is minted from the
 *     package's initial value
 *   - `keep`: kept as the workspace holds it; `deploy` when the package under
 *     it changed, which a `$deploy` commit records in its history
 *   - `migrate`: migrated by the steps the workspace has not applied, in order
 *   - `reset`: reset to the package's initial value under the `reset` policy,
 *     and why it could not be kept or migrated
 *   - `drop`: the package does not declare it, so it is dropped, with its
 *     state and history
 *   - `refused`: refused, and why, with the fix: the deploy writes nothing
 */
export const RecordPlanType = StructType({
  record: StringType,
  action: VariantType({
    mint: NullType,
    keep: StructType({ deploy: BooleanType }),
    migrate: StructType({ steps: ArrayType(StringType) }),
    reset: StructType({ reason: StringType }),
    drop: NullType,
    refused: StructType({ reason: StringType }),
  }),
});

/**
 * What a deploy decided for one of a record's indexes.
 *
 * @property record - The record's dataset ref path
 * @property index - The index's name
 * @property action - `build` when the state names no index under the
 *   package's declaration, `drop` when it names one the package does not
 *   declare, and `keep` when the two agree and nothing runs
 */
export const RecordIndexPlanType = StructType({
  record: StringType,
  index: StringType,
  action: VariantType({
    build: NullType,
    drop: NullType,
    keep: NullType,
  }),
});

/**
 * The step a deploy is at with one record.
 *
 * - `waiting`: its turn has not come, or it needs nothing but the deploy's
 *   commit
 * - `migrating`: running migration step `step` of the `steps` it owes, `name`
 * - `indexing`: building `index`, the `build`th of the `builds` it owes
 * - `done`: its migrations and index builds have run
 */
export const RecordDeployStepType = VariantType({
  waiting: NullType,
  migrating: StructType({ name: StringType, step: IntegerType, steps: IntegerType }),
  indexing: StructType({ index: StringType, build: IntegerType, builds: IntegerType }),
  done: NullType,
});

/**
 * One record a deploy is deploying.
 *
 * @property plan - What the deploy decided for it
 * @property indexes - The indexes the package declares for it
 * @property step - How far the deploy has got with it
 */
export const RecordDeployStateType = StructType({
  plan: RecordPlanType,
  indexes: ArrayType(StringType),
  step: RecordDeployStepType,
});

/**
 * How far a deploy has got, for a client to show while it runs.
 *
 * @property package - The package it deploys
 * @property startedAt - When it began taking its files in
 * @property files - Each file source it takes in, in the package's order
 * @property records - Each record it deploys, in the package's order, and
 *   each it drops
 */
export const DeployProgressType = StructType({
  package: StructType({ name: StringType, version: StringType }),
  startedAt: DateTimeType,
  files: ArrayType(IntakeFileType),
  records: ArrayType(RecordDeployStateType),
});

/**
 * What a deploy did, or under `plan` would do.
 *
 * @property records - What it decided for each record
 * @property indexes - What it decided for each index of the records it keeps
 * @property warnings - The inputs it left unassigned, and why: a server never
 *   reads a `file` source, whose path is on the client's machine
 */
export const WorkspaceDeployResultType = StructType({
  records: ArrayType(RecordPlanType),
  indexes: ArrayType(RecordIndexPlanType),
  warnings: ArrayType(StringType),
});

/**
 * A deploy job's progress: `pending` until it starts, then `deploying`, with
 * how far it has got once it has said.
 */
export const WorkspaceDeployProgressType = VariantType({
  pending: NullType,
  deploying: OptionType(DeployProgressType),
});

/**
 * A deploy job's status.
 *
 * - `processing`: still running, and how far it has got
 * - `completed`: what the deploy did
 * - `failed`: why it did not
 */
export const WorkspaceDeployStatusType = VariantType({
  processing: WorkspaceDeployProgressType,
  completed: WorkspaceDeployResultType,
  failed: StructType({ message: StringType }),
});

/**
 * Workspace export request body.
 *
 * @property name - Optional custom package name
 * @property version - Optional custom version
 */
export const WorkspaceExportRequestType = StructType({
  name: OptionType(StringType),
  version: OptionType(StringType),
});

// =============================================================================
// Workspace Status Types
// =============================================================================

/**
 * Dataset status variant.
 *
 * - `unset`: No value assigned to this dataset
 * - `stale`: Value exists but is outdated (upstream changed)
 * - `up-to-date`: Value is current
 */
export const DatasetStatusType = VariantType({
  unset: NullType,
  stale: NullType,
  'up-to-date': NullType,
});

/** Task completed successfully. @property cached - True if result was from cache */
export const TaskStatusUpToDateType = StructType({ cached: BooleanType });

/** Task waiting on dependencies. @property reason - Human-readable wait reason */
export const TaskStatusWaitingType = StructType({ reason: StringType });

/** Task currently executing. */
export const TaskStatusInProgressType = StructType({
  /** Process ID of the running task */
  pid: OptionType(IntegerType),
  /** ISO timestamp when execution started */
  startedAt: OptionType(StringType),
});

/** Task exited with non-zero code. */
export const TaskStatusFailedType = StructType({
  /** Process exit code */
  exitCode: IntegerType,
  /** ISO timestamp when task completed */
  completedAt: OptionType(StringType),
});

/** Task encountered an internal error. */
export const TaskStatusErrorType = StructType({
  /** Error message */
  message: StringType,
  /** ISO timestamp when error occurred */
  completedAt: OptionType(StringType),
});

/** Task was running but process is no longer alive. */
export const TaskStatusStaleRunningType = StructType({
  /** Last known process ID */
  pid: OptionType(IntegerType),
  /** ISO timestamp when execution started */
  startedAt: OptionType(StringType),
});

/**
 * Task execution status variant.
 *
 * - `up-to-date`: Task completed successfully (cached indicates if from cache)
 * - `ready`: Task is ready to run (all inputs available)
 * - `waiting`: Task waiting on upstream dependencies
 * - `in-progress`: Task currently executing
 * - `failed`: Task exited with non-zero exit code
 * - `error`: Internal error during task execution
 * - `stale-running`: Task was marked running but process died
 */
export const TaskStatusType = VariantType({
  'up-to-date': TaskStatusUpToDateType,
  ready: NullType,
  waiting: TaskStatusWaitingType,
  'in-progress': TaskStatusInProgressType,
  failed: TaskStatusFailedType,
  error: TaskStatusErrorType,
  'stale-running': TaskStatusStaleRunningType,
});

/**
 * Status information for a single dataset.
 *
 * @property path - Dataset path (e.g., ".inputs.config" or ".tasks.foo.output")
 * @property status - Current status (unset, stale, or up-to-date)
 * @property hash - SHA256 hash of current value (if set)
 * @property isTaskOutput - True if this dataset is produced by a task
 * @property producedBy - Name of task that produces this dataset (if isTaskOutput)
 */
export const DatasetStatusInfoType = StructType({
  path: StringType,
  status: DatasetStatusType,
  hash: OptionType(StringType),
  isTaskOutput: BooleanType,
  producedBy: OptionType(StringType),
});

/**
 * Status information for a single task.
 *
 * @property name - Task name
 * @property hash - Task definition hash (changes when task code changes)
 * @property status - Current execution status
 * @property inputs - Dataset paths this task reads from
 * @property output - Dataset path this task writes to
 * @property dependsOn - Names of tasks that must complete before this one
 * @property peakBytes - The highest peak resident memory, in bytes, a runner
 *   of the execution the status comes from reached: the one the output came
 *   from, or the failure; `none` when it recorded none, or while it runs
 * @property stopped - Why the latest attempt over the task's current inputs
 *   stopped, when it was cancelled or interrupted and the task therefore reads
 *   `ready`; `none` otherwise
 */
export const TaskStatusInfoType = StructType({
  name: StringType,
  hash: StringType,
  status: TaskStatusType,
  inputs: ArrayType(StringType),
  output: StringType,
  dependsOn: ArrayType(StringType),
  peakBytes: OptionType(IntegerType),
  stopped: OptionType(StopReasonType),
});

/**
 * Summary counts for workspace status.
 */
export const WorkspaceStatusSummaryType = StructType({
  /** Dataset status counts */
  datasets: StructType({
    total: IntegerType,
    unset: IntegerType,
    stale: IntegerType,
    upToDate: IntegerType,
  }),
  /** Task status counts */
  tasks: StructType({
    total: IntegerType,
    upToDate: IntegerType,
    ready: IntegerType,
    waiting: IntegerType,
    inProgress: IntegerType,
    failed: IntegerType,
    error: IntegerType,
    staleRunning: IntegerType,
  }),
});

/**
 * Complete workspace status including all datasets, tasks, and summary.
 *
 * @property workspace - Workspace name
 * @property lock - Information about current lock holder (if locked)
 * @property datasets - Status of all datasets in the workspace
 * @property tasks - Status of all tasks in the workspace
 * @property summary - Aggregated counts by status
 */
export const WorkspaceStatusResultType = StructType({
  workspace: StringType,
  lock: OptionType(LockHolderType),
  datasets: ArrayType(DatasetStatusInfoType),
  tasks: ArrayType(TaskStatusInfoType),
  summary: WorkspaceStatusSummaryType,
});

// =============================================================================
// Task Types
// =============================================================================

/**
 * Task list item (summary info).
 *
 * @property name - Task name
 * @property hash - Task definition hash
 * @property role - What the task's output is for: data, or a ui with what it
 *   binds
 */
export const TaskListItemType = StructType({
  name: StringType,
  hash: StringType,
  role: TaskRoleType,
});

/**
 * Detailed task information: the task object's fields.
 *
 * @property name - Task name
 * @property hash - Task definition hash
 * @property body - What the task runs: an East program, or a command
 * @property runner - The runtime it runs on
 * @property inputs - The datasets it reads, each with its partition
 * @property output - Where its output goes, and how it is made
 * @property role - What its output is for: data, or a ui with what it binds
 */
export const TaskDetailsType = StructType({
  name: StringType,
  hash: StringType,
  body: TaskBodyType,
  runner: RunnerType,
  inputs: ArrayType(TaskInputType),
  output: TaskOutputType,
  role: TaskRoleType,
});

// =============================================================================
// Execution Types
// =============================================================================

/**
 * Request to start dataflow execution. The run takes the server's budget of
 * cores and memory, which it shares with everything else the server runs.
 *
 * @property force - The tasks the run re-executes even where the cache holds
 *   their results: none, all, or the tasks named ({@link DataflowForceType}).
 *   A start naming a task the graph does not have, or one the filter's run set
 *   leaves out, is refused before anything runs.
 * @property filter - One task's exact name: the run runs that task and its
 *   dependency closure, and no other task
 */
export const DataflowRequestType = StructType({
  force: DataflowForceType,
  filter: OptionType(StringType),
});

/**
 * Chunk of log data from task execution.
 *
 * @property data - Log content (UTF-8 text)
 * @property offset - Byte offset from start of log
 * @property size - Size of this chunk in bytes
 * @property totalSize - Total size of the log file
 * @property complete - True if this chunk reaches end of file
 */
export const LogChunkType = StructType({
  data: StringType,
  offset: IntegerType,
  size: IntegerType,
  totalSize: IntegerType,
  complete: BooleanType,
});

/**
 * Chunk of a task's log, as the logs route serves it: a {@link LogChunkType}'s
 * fields, and the execution it was read from. A client polling the log reads
 * on from its offset, starts over when the execution changes, and stops
 * reading once the execution has ended and its log is read.
 *
 * @property inputsHash - The execution's inputs hash, which a request names,
 *   with its id, to read on from the same execution
 * @property executionId - The execution's id
 * @property ended - True once the execution is recorded as anything but
 *   running: its log grows no more
 */
export const TaskLogChunkType = StructType({
  data: StringType,
  offset: IntegerType,
  size: IntegerType,
  totalSize: IntegerType,
  complete: BooleanType,
  inputsHash: StringType,
  executionId: StringType,
  ended: BooleanType,
});

/**
 * Result of executing a single task.
 *
 * @property name - Task name
 * @property cached - True if result was retrieved from cache
 * @property state - Execution outcome (success, failed, error, skipped)
 * @property duration - Execution time in seconds
 */
export const TaskExecutionResultType = StructType({
  name: StringType,
  cached: BooleanType,
  state: VariantType({
    success: NullType,
    failed: StructType({ exitCode: IntegerType }),
    error: StructType({ message: StringType }),
    skipped: NullType,
  }),
  duration: FloatType,
});

/**
 * Result of dataflow execution.
 *
 * @property success - True if all tasks completed successfully
 * @property executed - Number of tasks that were executed
 * @property cached - Number of tasks that used cached results
 * @property failed - Number of tasks that failed
 * @property skipped - Number of tasks that were skipped
 * @property tasks - Per-task execution results
 * @property duration - Total execution time in seconds
 */
export const DataflowResultType = StructType({
  success: BooleanType,
  executed: IntegerType,
  cached: IntegerType,
  failed: IntegerType,
  skipped: IntegerType,
  tasks: ArrayType(TaskExecutionResultType),
  duration: FloatType,
});

// =============================================================================
// Dataflow Execution State Types (for API polling)
// =============================================================================

/**
 * Dataflow event types for API polling.
 *
 * - `start`: Task started executing
 * - `complete`: Task executed and succeeded, with the highest peak memory its
 *   runners reached when they reported one
 * - `cached`: Task result retrieved from cache (no execution)
 * - `failed`: Task exited with non-zero code
 * - `error`: Internal error during task execution
 * - `input_unavailable`: Task couldn't run because inputs not available
 * - `requeued`: A unit of a split task was stopped — by the budget's guard, or
 *   its cgroup's cap — and runs again once the memory it reserves fits: the
 *   unit, why, the most it was measured using and what it reserves, in bytes
 */
export const DataflowEventType = VariantType({
  start: StructType({
    task: StringType,
    timestamp: StringType,
  }),
  complete: StructType({
    task: StringType,
    timestamp: StringType,
    duration: FloatType,
    peakBytes: OptionType(IntegerType),
  }),
  cached: StructType({
    task: StringType,
    timestamp: StringType,
  }),
  failed: StructType({
    task: StringType,
    timestamp: StringType,
    duration: FloatType,
    exitCode: IntegerType,
  }),
  error: StructType({
    task: StringType,
    timestamp: StringType,
    message: StringType,
  }),
  input_unavailable: StructType({
    task: StringType,
    timestamp: StringType,
    reason: StringType,
  }),
  requeued: StructType({
    task: StringType,
    timestamp: StringType,
    unit: StageUnitType,
    reason: RequeueReasonType,
    peak: IntegerType,
    reserves: IntegerType,
  }),
});

/**
 * Execution status for API polling responses.
 *
 * - `running`: Execution is in progress
 * - `completed`: Execution finished successfully
 * - `failed`: Execution finished with failures
 * - `aborted`: Execution was cancelled
 *
 * Note: Named "Api*" to distinguish from the on-disk ExecutionStatusType
 * in execution.ts which tracks individual task execution states.
 */
export const ApiExecutionStatusType = VariantType({
  running: NullType,
  completed: NullType,
  failed: NullType,
  aborted: NullType,
});

/**
 * Summary of dataflow execution results.
 */
export const DataflowExecutionSummaryType = StructType({
  executed: IntegerType,
  cached: IntegerType,
  failed: IntegerType,
  skipped: IntegerType,
  duration: FloatType,
});

/**
 * A server's budget of cores and memory, which every runner it spawns takes
 * from, and what its runners hold of it now.
 *
 * @property cores - Runner processes at once
 * @property memory - Bytes of memory the runners may hold between them
 * @property coresInUse - Runner processes holding the budget now
 * @property memoryInUse - Bytes the runners hold now, each at the larger of
 *   its reservation and what it was last measured using
 */
export const DataflowBudgetType = StructType({
  cores: IntegerType,
  memory: IntegerType,
  coresInUse: IntegerType,
  memoryInUse: IntegerType,
});

/**
 * A task, or a unit of a split task, waiting for room in the server's budget.
 *
 * @property task - The task
 * @property unit - The unit, for a split task's; `none` for a task run as one
 * @property needs - The memory, in bytes, it waits to reserve; 0 when it
 *   waits for a core alone
 * @property since - ISO timestamp when it began waiting
 */
export const UnitWaitType = StructType({
  task: StringType,
  unit: OptionType(StageUnitType),
  needs: IntegerType,
  since: StringType,
});

/**
 * A split task's progress through the stage it is in.
 *
 * @property task - The task
 * @property merge - The merge level, from 1, and the levels the merges take;
 *   `none` while its pieces run
 * @property done - The stage's units that have finished
 * @property units - The stage's units
 */
export const SplitProgressType = StructType({
  task: StringType,
  merge: OptionType(StructType({ level: IntegerType, levels: IntegerType })),
  done: IntegerType,
  units: IntegerType,
});

/**
 * Dataflow execution state returned by API polling.
 *
 * A lightweight view of the execution state for client polling.
 *
 * Note: Named "Api*" to distinguish from the persistent
 * DataflowExecutionStateType in dataflow.ts which stores the full
 * execution state on disk.
 *
 * A poll names a cursor (`since`), the sequence number of the last event it
 * has, and is served the run's events past it, at most its `limit`, and never
 * more than {@link DATAFLOW_POLL_EVENTS_MAX}; the response's `nextSeq` is the
 * cursor of the poll after it. A poll that has every event reads no event of
 * the run, so a client polls on a timer for the whole run at the cost of what
 * is new.
 *
 * The response names the run (`runId`) and where its events end (`lastSeq`).
 * A cursor counts a run's own events, so a client that sees another run starts
 * from 0. A poll whose `nextSeq` is before `lastSeq` left events for the next,
 * which a client reads before it takes a run's end as its last word; and a
 * client opens a running run's feed near its tail from `lastSeq`, or follows
 * its progress with polls that ask for no events (`limit` 0).
 *
 * @property runId - The run's id, a UUIDv7
 * @property status - Current execution status
 * @property startedAt - ISO timestamp when execution started
 * @property completedAt - ISO timestamp when execution finished (if done)
 * @property summary - Execution summary (available when complete)
 * @property events - The run's task events past the poll's cursor, at most
 *   its limit, in the order they happened
 * @property nextSeq - The cursor past the events served, which the next poll
 *   passes as `since`: the poll's own when it served none
 * @property lastSeq - The sequence number of the run's last event when the
 *   poll read it, 0 while it has none: the cursor of a poll that has every
 *   event
 * @property budget - The server's budget now, where it has one: a server whose
 *   runners hold none, as a remote backend's, serves `none`
 * @property waiting - The tasks and units of the run waiting for room, while it
 *   runs; nothing stores them
 * @property splits - Each split task's progress, while the run runs; nothing
 *   stores it
 */
export const ApiDataflowExecutionStateType = StructType({
  runId: StringType,
  status: ApiExecutionStatusType,
  startedAt: StringType,
  completedAt: OptionType(StringType),
  summary: OptionType(DataflowExecutionSummaryType),
  events: ArrayType(DataflowEventType),
  nextSeq: IntegerType,
  lastSeq: IntegerType,
  budget: OptionType(DataflowBudgetType),
  waiting: ArrayType(UnitWaitType),
  splits: ArrayType(SplitProgressType),
});

/**
 * The most events a poll of a run is served ({@link ApiDataflowExecutionStateType}):
 * a poll that names no `limit`, or a larger one, is served this many, so an
 * answer stays within what a host's response may hold however long the run. A
 * client reads on from the answer's `nextSeq`.
 */
export const DATAFLOW_POLL_EVENTS_MAX = 1_000;

// =============================================================================
// Task Execution History Types
// =============================================================================

/**
 * Execution status for history listing: `cancelled` when e3 stopped the
 * execution because the signal it ran under was aborted, `interrupted` when
 * it can no longer finish — its runner and its owner are gone, its host says
 * so, or its run yielded mid-stage. Each says why in its item's `reason`.
 */
export const ExecutionHistoryStatusType = VariantType({
  running: NullType,
  success: NullType,
  failed: NullType,
  error: NullType,
  cancelled: NullType,
  interrupted: NullType,
});

/**
 * A single execution in task history: a run of the task, never a split task's
 * unit. The history lists them the latest first, a page at a time.
 *
 * @property inputsHash - Hash of concatenated inputs (execution identifier)
 * @property executionId - The run's id, a UUIDv7: the next page is the runs
 *   before the last one's
 * @property inputHashes - Individual input object hashes
 * @property status - Execution outcome
 * @property startedAt - ISO timestamp when execution started
 * @property completedAt - ISO timestamp when execution finished (if done)
 * @property duration - Execution duration in milliseconds (if done)
 * @property exitCode - Process exit code (if failed)
 * @property peakBytes - The highest peak resident memory, in bytes, a runner
 *   of the execution reached, when it succeeded or failed and one reported it
 * @property reason - Why it stopped, when it was cancelled or interrupted
 */
export const ExecutionListItemType = StructType({
  inputsHash: StringType,
  executionId: StringType,
  inputHashes: ArrayType(StringType),
  status: ExecutionHistoryStatusType,
  startedAt: StringType,
  completedAt: OptionType(StringType),
  duration: OptionType(IntegerType),
  exitCode: OptionType(IntegerType),
  peakBytes: OptionType(IntegerType),
  reason: OptionType(StopReasonType),
});

/**
 * The runs a page of a task's history holds when its request names no
 * `limit`.
 */
export const TASK_EXECUTIONS_PAGE_DEFAULT = 100;

/**
 * The most runs a page of a task's history holds ({@link ExecutionListItemType}):
 * a request naming a larger `limit` is served this many, so a page stays
 * within what a host's response may hold. A client reads on with the last
 * run's id as `before`.
 */
export const TASK_EXECUTIONS_PAGE_MAX = 1_000;

// =============================================================================
// Dataset List Types (recursive)
// =============================================================================

/**
 * Tree branch kind variant.
 *
 * Currently only `struct` branches exist. Future: `dict`, `array`, `variant`.
 */
export const TreeKindType = VariantType({ struct: NullType });

/**
 * A list entry -- either a dataset leaf or a tree branch.
 *
 * Used by the `?list=true&status=true` endpoints to return both
 * tree structure entries and dataset leaves in a single flat list. A dataset's
 * `size` is what its value weighs in the store, as its status reports it: for
 * a collection, its segments and its manifest.
 */
export const ListEntryType = VariantType({
  dataset: StructType({
    path: StringType,
    type: EastTypeType,
    hash: OptionType(StringType),
    size: OptionType(IntegerType),
  }),
  tree: StructType({
    path: StringType,
    kind: TreeKindType,
  }),
});

// =============================================================================
// Dataset Status Detail Types (single dataset query)
// =============================================================================

/**
 * Detailed status of a single dataset.
 *
 * @property path - Dataset path (e.g., ".inputs.config")
 * @property type - East type of the dataset
 * @property refType - Ref type: "unassigned", "null", or "value"
 * @property hash - Object hash (None if unassigned/null)
 * @property size - Bytes the value weighs in the store: for a collection, its
 *   segments and its manifest (None if unassigned)
 */
export const DatasetStatusDetailType = StructType({
  path: StringType,
  type: EastTypeType,
  refType: StringType,
  hash: OptionType(StringType),
  size: OptionType(IntegerType),
  /** Segment and element counts of a stored collection, read from its
   *  manifest — so a re-pointed input is inspectable without decoding it.
   *  `none` for a non-collection or an unset dataset. */
  segments: OptionType(IntegerType),
  rows: OptionType(IntegerType),
});

// =============================================================================
// Function / one-shot execution types
// =============================================================================
// Shared by the named-function path AND one-shot execution. The result of a
// call is an in-memory, bounded value returned inline — never promoted to a
// durable artifact.

/**
 * Execution limits for a function/one-shot call.
 *
 * @property timeoutMs - Wall-clock limit; over it the call is killed and returns `timed_out`
 * @property maxResultBytes - Inline result cap; over it the call returns `too_large`
 * @property maxLogBytes - Per-stream stdout/stderr tail cap
 */
export const ExecuteLimitsType = StructType({
  timeoutMs:      OptionType(IntegerType),
  maxResultBytes: OptionType(IntegerType),
  maxLogBytes:    OptionType(IntegerType),
});

/**
 * A diagnostic attached to an `invalid` call outcome.
 */
export const DiagnosticType = StructType({
  message:  StringType,
  filename: OptionType(StringType),
  line:     OptionType(IntegerType),
  column:   OptionType(IntegerType),
});

/**
 * The terminal result of a function/one-shot call.
 *
 * - `success`: beast2-encoded result value; decode with the function's `outputType`
 * - `failed`: process exited non-zero (see stderr)
 * - `invalid`: signature/IR error; nothing ran
 * - `too_large`: result over `maxResultBytes`; deploy a task and read it with `datasetGet`
 * - `timed_out`: exceeded `timeoutMs` / the server's sync deadline guard
 *
 * `inputs` names what the call read: each dataset argument's path and the hash
 * it was pinned at, in argument order, so an answer can be reproduced and a
 * stale one noticed. It is empty for a call with value arguments only, and for
 * an `invalid` result.
 */
export const ExecuteResultType = StructType({
  outcome: VariantType({
    success:   StructType({ value: BlobType }),
    failed:    StructType({ exitCode: IntegerType }),
    invalid:   StructType({ diagnostics: ArrayType(DiagnosticType) }),
    too_large: StructType({ bytes: IntegerType, limit: IntegerType }),
    timed_out: StructType({ ms: IntegerType }),
  }),
  stdout: StringType,
  stderr: StringType,
  stdoutTruncated: BooleanType,
  stderrTruncated: BooleanType,
  inputs: ArrayType(StructType({ path: TreePathType, hash: StringType })),
});

/**
 * A call's argument: a beast2-encoded value, or a dataset of the workspace the
 * call runs in, resolved and pinned by its content hash at launch and named in
 * the result's `inputs`. A named function call and a one-shot take it alike.
 */
export const CallArgType = VariantType({
  value:   BlobType,
  dataset: TreePathType,
});

/**
 * Named function call. Positional args, one per param: a value, or a dataset
 * of the workspace ({@link CallArgType}). The package-scoped route has no
 * workspace to read a dataset from, and answers a dataset argument `invalid`;
 * the workspace-scoped route pins it, as a one-shot's is.
 */
export const FunctionCallRequestType = StructType({
  args:   ArrayType(CallArgType),
  runner: OptionType(RunnerType),       // optional override; only the known runtimes
  limits: OptionType(ExecuteLimitsType),
});

/** A function signature, returned by `describe` so dynamic callers can encode args. */
export const FunctionSignatureType = StructType({
  name:       StringType,
  inputTypes: ArrayType(EastTypeType),
  outputType: EastTypeType,
  runner:     RunnerType,
});

/**
 * One-shot execution request: run an anonymous function whose IR is supplied
 * at call time, optionally bound to existing workspace datasets, returning
 * the result inline and persisting nothing.
 *
 * SECURITY: one-shot evaluates a caller-supplied IR. One that is platform-free
 * — a stock runtime given no platform package, and a body that calls no
 * platform function — only computes over its arguments, and a caller who may
 * read the workspace may run it. Any other is code with the server's
 * authority, which only an elevated grant runs (e3-core `oneShotExecute`).
 */
export const OneShotRequestType = StructType({
  bodyIr: BlobType,                       // anonymous EastIR, not deployed
  args:   ArrayType(CallArgType),         // each arg: an inline value OR a live dataset, pinned at launch
  runner: RunnerType,
  limits: OptionType(ExecuteLimitsType),
});

/**
 * A split call's argument: a workspace dataset, pinned by its hash at launch;
 * a stored object by its hash, such as an earlier split call's output, which
 * chains a plan's stages; or a value.
 */
export const SplitCallArgType = VariantType({
  dataset: TreePathType,
  object:  StringType,
  value:   BlobType,
});

/**
 * A split call: a caller's program run over a dataset's pieces as a job, as e3
 * runs an index build, and the pieces' outputs assembled by an output kind.
 *
 * `bodyIr` is the program each piece runs, which emits into its trailing
 * parameter. At least one argument is partitioned, as a task input's
 * `e3.partition` is: the pieces are cut over the partitioned argument that
 * weighs the most, the others partitioned are cut at the same keys, and one
 * not partitioned reaches every piece whole. `output` is how the pieces'
 * outputs combine, as a task's output kinds do, with its programs and its zero
 * inline. `then`, when given, runs once over the assembled output and then the
 * arguments, and its value is the call's.
 *
 * SECURITY: a caller whose one-shot grant is `platform_free` may launch one
 * only when it is platform-free: a stock runtime given no platform package,
 * and none of `bodyIr`, `then`, `merge` or `combine` calling a platform
 * function (e3-core `splitCallPlatformUse`).
 */
export const SplitCallRequestType = StructType({
  bodyIr: BlobType,
  args:   ArrayType(StructType({
    arg:       SplitCallArgType,
    partition: OptionType(TaskPartitionType),
  })),
  output: VariantType({
    array: NullType,
    dict:  StructType({ merge: OptionType(BlobType) }),
    fold:  StructType({ combine: BlobType, zero: BlobType }),
    set:   NullType,
  }),
  then:   OptionType(BlobType),
  runner: RunnerType,
  limits: OptionType(ExecuteLimitsType),
});

/**
 * How far a split call's job has got: the stage its units are in — the pieces
 * (`partition`), a merge of a set's or a dict's outputs, or a fold's partials
 * combined — and how many of the stage's units have finished.
 */
export const SplitCallProgressType = StructType({
  phase: VariantType({ combine: NullType, merge: NullType, partition: NullType }),
  done:  IntegerType,
  units: IntegerType,
});

/**
 * What a split call's pieces would be, which an explain's job plans and runs
 * nothing for: the piece count, the argument they are cut over, by its
 * position, and what that argument weighs in the store, in bytes.
 */
export const SplitCallPlanType = StructType({
  pieces: IntegerType,
  over:   IntegerType,
  bytes:  IntegerType,
});

/**
 * A split call's status, as its poll answers it.
 *
 * - `processing`: the job runs, and how far it has got once it has said
 * - `completed`: the call's result, and the assembled output's hash once the
 *   pieces ran — what a caller reads through the object route when the result
 *   is `too_large`, or passes on as the next call's `object` argument; an
 *   explain found wrong ends here too, `invalid`
 * - `planned`: an explain's answer, the pieces the call's run would cut, which
 *   its job stored for the run to take up, and ran no unit for
 * - `failed`: why e3 could not run it
 */
export const SplitCallStatusType = VariantType({
  processing: OptionType(SplitCallProgressType),
  completed:  StructType({ result: ExecuteResultType, output: OptionType(StringType) }),
  planned:    SplitCallPlanType,
  failed:     StructType({ message: StringType }),
});

/**
 * A record mutation call. Positional args (after the implicit current state),
 * one beast2-encoded value per declared parameter.
 *
 * Of the limits, `timeoutMs` bounds each run of the mutation's program and
 * `maxLogBytes` the stderr a failure returns. `maxResultBytes` does not apply:
 * a mutation's output is stored as segments and never read whole.
 */
export const MutationCallRequestType = StructType({
  args:   ArrayType(BlobType),
  actor:  OptionType(StringType),       // caller identity; the server may override from auth
  limits: OptionType(ExecuteLimitsType),
});

/**
 * The terminal result of a mutation call. Only `committed` wrote anything.
 *
 * - `committed`: the new commit + state hashes
 * - `invalid`: record/mutation lookup or arity error; nothing ran
 * - `failed`: the mutation's program failed (incl. a body's `$.error`; see stderr)
 * - `timed_out`: the program exceeded its time budget
 * - `conflict`: the compare-and-swap lost the race `attempts` times, or the
 *   write disagreed with the state it landed on — then `detail` names the key,
 *   and resubmitting the same write cannot help
 */
export const MutationResultType = StructType({
  outcome: VariantType({
    committed: StructType({ commitHash: StringType, stateHash: StringType }),
    invalid:   StructType({ message: StringType }),
    failed:    StructType({ exitCode: IntegerType, stderr: StringType }),
    timed_out: StructType({ ms: IntegerType, stderr: StringType }),
    conflict:  StructType({ attempts: IntegerType, detail: OptionType(StringType) }),
  }),
});

/**
 * When a record applied one step of its migration chain.
 *
 * @property at - When the step was applied: the time of the deploy that
 *   applied it; `none` for a step a record applied before e3 kept the time
 * @property commit - The commit that applied it: its `$migrate:<name>` commit,
 *   or the `$init` or `$reset` commit that counted the chain applied; `none`
 *   once a compaction has cut it from the chain, or for a step a record applied
 *   before e3 kept it
 */
export const RecordMigrationAppliedType = StructType({
  at:     OptionType(DateTimeType),
  commit: OptionType(StringType),
});

/**
 * A record's callable surface, returned by `describe` so dynamic callers can
 * encode mutation arguments and read through its indexes, and a console can
 * show the record whole without reading its history. The mutation `argTypes`
 * are the EXTRA parameters after the implicit current state.
 */
export const RecordSignatureType = StructType({
  name: StringType,
  mutations: ArrayType(StructType({
    name:     StringType,
    argTypes: ArrayType(EastTypeType),
    /** The write form — `reduce`, `edit` or `patch` — which says what the
     *  arguments MEAN: a `patch` mutation's one argument is a
     *  `PatchType(State)`, not a value of the record's own type. */
    form:     StringType,
  })),
  /** The indexes the record declares. A page read through one is decoded by
   *  `indexWindowType(K, keyType, valueType, V)` over the record's
   *  `Dict<K, V>`, and a key search through one takes a `keyType` key. */
  indexes: ArrayType(StructType({
    name:      StringType,
    /** The index key's type. */
    keyType:   EastTypeType,
    /** The covering projection's type: `Null` when the index projects
     *  nothing, and a read joins the rows instead. */
    valueType: EastTypeType,
    /** Whether a row may hold several index keys. */
    multi:     BooleanType,
    /** Whether the record's head state holds the index, built under the
     *  declaration the deployed package carries. A deploy, a reindex and a
     *  system commit build what the state lacks; a read through an index the
     *  state holds no build of answers `index_not_found`. */
    built:     BooleanType,
  })),
  /** The migration chain the record declares, in order. A deployed record
   *  has applied every step, since a deploy migrates it or is refused. */
  migrations: ArrayType(StructType({
    name:    StringType,
    /** The step's form — `value`, `rows` or `rekey` — which says what it
     *  runs over: the whole state, its rows, or its rows under new keys. */
    form:    StringType,
    /** The record's type before the step. */
    from:    EastTypeType,
    /** The record's type after it. */
    to:      EastTypeType,
    /** When the record applied the step, and the commit that did; `none`
     *  when it has not applied it. */
    applied: OptionType(RecordMigrationAppliedType),
  })),
});

/** One commit in a record's history (its hash plus the commit fields). */
export const RecordCommitInfoType = StructType({
  hash:     StringType,
  parent:   OptionType(StringType),
  state:    StringType,
  mutation: StringType,
  actor:    StringType,
  at:       DateTimeType,
  /** The delta this commit applied, when it wrote one — so history shows WHAT
   *  changed without diffing two states. */
  delta:    OptionType(StringType),
});

/**
 * One argument of a record's commit, as the history previews it.
 *
 * @property type - The argument's own East type, as its encoding carries it
 * @property bytes - Its encoded size
 * @property text - Its value printed as East text, cut at
 *   {@link RECORD_ARG_TEXT_CHARS} characters; empty for an argument over
 *   {@link RECORD_ARG_TEXT_BYTES}, which is not printed, and for one that
 *   cannot be
 * @property truncated - Whether `text` holds less than the whole value
 */
export const RecordArgPreviewType = StructType({
  type:      EastTypeType,
  bytes:     IntegerType,
  text:      StringType,
  truncated: BooleanType,
});

/**
 * A record commit's arguments, as the history previews them.
 *
 * @property hash - The arguments' object, which the objects route serves
 *   whole: a beast2 `Array<Blob>` of the encoded arguments, in order
 * @property bytes - The object's size
 * @property values - Each argument's preview, in order; empty when the object
 *   is over {@link RECORD_ARGS_READ_BYTES}, which the history does not read,
 *   or holds arguments that are not East values, as a system commit may
 *   record its caller's
 */
export const RecordCommitArgsType = StructType({
  hash:   StringType,
  bytes:  IntegerType,
  values: ArrayType(RecordArgPreviewType),
});

/**
 * One commit in a record's history, as the history route answers it: a
 * {@link RecordCommitInfoType}'s fields, and a preview of its arguments, so a
 * history says what a commit set as well as which mutation ran.
 * `RecordCommitInfoType` stays without them: e3-ui's record binding and the
 * pages built on it carry it in their East types.
 */
export const RecordHistoryCommitType = StructType({
  hash:     StringType,
  parent:   OptionType(StringType),
  state:    StringType,
  mutation: StringType,
  actor:    StringType,
  at:       DateTimeType,
  /** The delta this commit applied, when it wrote one. */
  delta:    OptionType(StringType),
  /** The commit's arguments, previewed; `none` for a commit with none. */
  args:     OptionType(RecordCommitArgsType),
});

/** A page of a record's commit history, newest first. */
export const RecordHistoryResultType = StructType({
  commits: ArrayType(RecordHistoryCommitType),
});

/** The characters of an argument's East text a history preview keeps. */
export const RECORD_ARG_TEXT_CHARS = 256;

/** The encoded size, in bytes, past which a history preview prints no text
 *  of an argument, only its type and size. */
export const RECORD_ARG_TEXT_BYTES = 64 * 1024;

/** The size, in bytes, past which a history reads no commit's arguments'
 *  object, and previews none of them: a page reads at most this much of
 *  arguments per commit, however large a patch is. */
export const RECORD_ARGS_READ_BYTES = 1024 * 1024;

// =============================================================================
// Value type aliases
// =============================================================================

export type Error = ValueTypeOf<typeof ErrorType>;
export type RepositoryStatus = ValueTypeOf<typeof RepositoryStatusType>;
export type GcRequest = ValueTypeOf<typeof GcRequestType>;
export type GcResult = ValueTypeOf<typeof GcResultType>;
export type AsyncOperationStatus = ValueTypeOf<typeof AsyncOperationStatusType>;
export type GcStartResult = ValueTypeOf<typeof GcStartResultType>;
export type GcStatusResult = ValueTypeOf<typeof GcStatusResultType>;
export type PackageListItem = ValueTypeOf<typeof PackageListItemType>;
export type PackageInfo = ValueTypeOf<typeof PackageInfoType>;
export type PackageDetails = ValueTypeOf<typeof PackageDetailsType>;
export type WorkspaceInfo = ValueTypeOf<typeof WorkspaceInfoType>;
export type WorkspaceCreateRequest = ValueTypeOf<typeof WorkspaceCreateRequestType>;
export type WorkspaceDeployRequest = ValueTypeOf<typeof WorkspaceDeployRequestType>;
/** A {@link SchemaPolicyType} by its name, as a deploy's options take it. */
export type SchemaPolicy = ValueTypeOf<typeof SchemaPolicyType>['type'];
export type RecordPlan = ValueTypeOf<typeof RecordPlanType>;
export type RecordIndexPlan = ValueTypeOf<typeof RecordIndexPlanType>;
export type RecordDeployStep = ValueTypeOf<typeof RecordDeployStepType>;
export type RecordDeployState = ValueTypeOf<typeof RecordDeployStateType>;
export type DeployProgress = ValueTypeOf<typeof DeployProgressType>;
export type WorkspaceDeployResult = ValueTypeOf<typeof WorkspaceDeployResultType>;
export type WorkspaceDeployProgress = ValueTypeOf<typeof WorkspaceDeployProgressType>;
export type WorkspaceDeployStatus = ValueTypeOf<typeof WorkspaceDeployStatusType>;
export type DatasetStatus = ValueTypeOf<typeof DatasetStatusType>;
export type TaskStatus = ValueTypeOf<typeof TaskStatusType>;
export type DatasetStatusInfo = ValueTypeOf<typeof DatasetStatusInfoType>;
export type TaskStatusInfo = ValueTypeOf<typeof TaskStatusInfoType>;
export type WorkspaceStatusSummary = ValueTypeOf<typeof WorkspaceStatusSummaryType>;
export type WorkspaceStatusResult = ValueTypeOf<typeof WorkspaceStatusResultType>;
export type TaskListItem = ValueTypeOf<typeof TaskListItemType>;
export type TaskDetails = ValueTypeOf<typeof TaskDetailsType>;
export type DataflowRequest = ValueTypeOf<typeof DataflowRequestType>;
export type LogChunk = ValueTypeOf<typeof LogChunkType>;
export type TaskLogChunk = ValueTypeOf<typeof TaskLogChunkType>;
export type TaskExecutionResult = ValueTypeOf<typeof TaskExecutionResultType>;
export type DataflowResult = ValueTypeOf<typeof DataflowResultType>;
export type DataflowEvent = ValueTypeOf<typeof DataflowEventType>;
export type ApiExecutionStatus = ValueTypeOf<typeof ApiExecutionStatusType>;
export type DataflowExecutionSummary = ValueTypeOf<typeof DataflowExecutionSummaryType>;
export type DataflowBudget = ValueTypeOf<typeof DataflowBudgetType>;
export type UnitWait = ValueTypeOf<typeof UnitWaitType>;
export type SplitProgress = ValueTypeOf<typeof SplitProgressType>;
export type ApiDataflowExecutionState = ValueTypeOf<typeof ApiDataflowExecutionStateType>;
export type ExecutionHistoryStatus = ValueTypeOf<typeof ExecutionHistoryStatusType>;
export type ExecutionListItem = ValueTypeOf<typeof ExecutionListItemType>;
export type TreeKind = ValueTypeOf<typeof TreeKindType>;
export type ListEntry = ValueTypeOf<typeof ListEntryType>;
export type DatasetStatusDetail = ValueTypeOf<typeof DatasetStatusDetailType>;
export type ExecuteLimits = ValueTypeOf<typeof ExecuteLimitsType>;
export type Diagnostic = ValueTypeOf<typeof DiagnosticType>;
export type ExecuteResult = ValueTypeOf<typeof ExecuteResultType>;
export type CallArg = ValueTypeOf<typeof CallArgType>;
export type FunctionCallRequest = ValueTypeOf<typeof FunctionCallRequestType>;
export type FunctionSignature = ValueTypeOf<typeof FunctionSignatureType>;
export type OneShotRequest = ValueTypeOf<typeof OneShotRequestType>;
export type SplitCallArg = ValueTypeOf<typeof SplitCallArgType>;
export type SplitCallRequest = ValueTypeOf<typeof SplitCallRequestType>;
export type SplitCallProgress = ValueTypeOf<typeof SplitCallProgressType>;
export type SplitCallStatus = ValueTypeOf<typeof SplitCallStatusType>;
export type SplitCallPlan = ValueTypeOf<typeof SplitCallPlanType>;
export type MutationCallRequest = ValueTypeOf<typeof MutationCallRequestType>;
export type MutationResult = ValueTypeOf<typeof MutationResultType>;
export type RecordMigrationApplied = ValueTypeOf<typeof RecordMigrationAppliedType>;
export type RecordSignature = ValueTypeOf<typeof RecordSignatureType>;
export type RecordCommitInfo = ValueTypeOf<typeof RecordCommitInfoType>;
export type RecordArgPreview = ValueTypeOf<typeof RecordArgPreviewType>;
export type RecordCommitArgs = ValueTypeOf<typeof RecordCommitArgsType>;
export type RecordHistoryCommit = ValueTypeOf<typeof RecordHistoryCommitType>;
export type RecordHistoryResult = ValueTypeOf<typeof RecordHistoryResultType>;
