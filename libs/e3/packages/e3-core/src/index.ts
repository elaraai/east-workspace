/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 Core - Programmatic API for e3 repository operations
 *
 * This package provides the filesystem-based business logic for e3,
 * similar to libgit2 for git. It has no UI dependencies and can be
 * used programmatically.
 *
 * This root entry is the portable entry (`@elaraai/e3-core/portable`,
 * `portable.ts`) — the same functions, classes and errors — and what needs
 * this machine: local storage, the local runner, the file state store, and the
 * forms of a few operations that read files or run tasks here
 * (`LocalOrchestrator`, `probeExecutionCache`, `executeSplitTask`,
 * `storeCollection`, `intakeDelivery`, `workspaceDeploy`), or read a zip from
 * a file here, or write one to a file or a Node stream (`openZip`,
 * `packageImport`, `packageZipOpen`, `packageExport`, `workspaceExport`,
 * `handleProcessImport`, `handleProcessExport`); and `computeHash`, which is
 * Node's own SHA-256 here, the portable entry's digest natively.
 */

// =============================================================================
// Storage and Execution Abstractions
// =============================================================================
// These interfaces enable e3-core to work against different backends:
// - Local filesystem (default, CLI and local dev)
// - AWS EFS (Lambda/Fargate cloud deployment)
// - S3 + DynamoDB (future optimization)

export * from './storage/index.js';
export * from './execution/index.js';

// How a log store cuts a window of a log, as every one does: at the longest
// prefix of its bytes that holds whole characters
export { completeUtf8Length } from './storage/utf8.js';

// =============================================================================
// Repository Operations (filesystem-based)
// =============================================================================
// These functions use repoPath directly. Future versions will also accept
// a StorageBackend for backend-agnostic operation.

// Repository management (local filesystem)
export {
  repoInit,
  repoFind,
  repoGet,
  type InitRepositoryResult,
} from './storage/local/repository.js';

// The repository record, and the upgrades an open applies, or a host's job a
// part at a time: every backend's
export {
  repositoryOpen,
  repositoryUpgradeStep,
  newRepositoryRecord,
  type RepositoryOpenOptions,
  type RepositoryUpgradeStepOptions,
  type RepositoryUpgradeStepResult,
} from './repository-record.js';

// What holds a repository: running work shared, and gc or an upgrade exclusive
export {
  TASKS_LOCK,
  withRunningWork,
  withRepositoryHeld,
  type RepositoryHoldOptions,
} from './running-work.js';

// Moving many objects at once
export {
  OBJECT_CONCURRENCY,
  TOUCH_BATCH,
  eachAtMost,
  readInOrder,
} from './concurrency.js';

// Garbage collection: holding the repository still, or beside running work in
// steps; and the re-reference of what a caller roots without writing it
export {
  repoGc,
  repoGcStep,
  GcStepType,
  collectAllRoots,
  gcObjectReaders,
  markReachable,
  touchReachable,
  sweepBatch,
  type GcOptions,
  type GcRetention,
  type GcResult,
  type GcStep,
  type GcStepOptions,
  type GcStepResult,
  type MarkReachableOptions,
  type SweepBatchResult,
} from './gc.js';

// The roots gc marks from, read through a backend's ref stores: what a
// `RepoStore` serves its gc root scans from
export { packageRoots, workspaceRoots, executionRoots } from './gc-roots.js';

// The history gc keeps: which runs and executions, and the deletion of the rest
export {
  pruneHistory,
  DEFAULT_KEEP_RUNS,
  DEFAULT_KEEP_DAYS,
  type HistoryOptions,
  type HistoryResult,
} from './history.js';

// Object storage: an object's hash, by Node's own SHA-256 — the portable
// entry's digest, natively — and the form every store checks one has
export { computeHash } from './objects-node.js';
export { isObjectHash } from './objects.js';

// Local object storage functions (for backwards compatibility)
export {
  objectWrite,
  objectWriteStream,
  objectRead,
  objectExists,
} from './storage/local/LocalObjectStore.js';

export {
  objectPath,
  objectAbbrev,
  transferStagingDir,
  transferStagingPath,
  packageStagingPath,
} from './storage/local/localHelpers.js';

// Package operations: a zip read from a file on this machine or a source, and
// written to a file or a Node stream; and the store's
export {
  packageImport,
  packageZipOpen,
  packageExport,
} from './package-files.js';
export {
  packageZipCheckpointWithin,
  packageRemove,
  packageList,
  packageGetLatestVersion,
  packageResolve,
  packageRead,
  type PackageImportResult,
  type PackageImportOptions,
  type PackageZip,
  type PackageExportResult,
  type PackageExportOptions,
} from './packages.js';

// Zips read by ranges where they lie — a file on this machine among them — and
// written to a stream an entry at a time
export { openZip } from './package-files.js';
export {
  ZipWriter,
  ZipSourceError,
  iterateZipEntries,
  type ZipSource,
  type ZipEntry,
  type ZipReader,
  type ZipRecord,
  type ZipWritten,
} from './zip.js';

// Workspace operations: a deploy that reads its `file` sources here, and an
// export to a zip on this machine, beside the store's
export { workspaceDeploy, workspaceExport } from './workspace-files.js';
export {
  workspaceList,
  workspaceCreate,
  workspaceRemove,
  workspaceGetState,
  workspaceGetPackage,
  workspaceLockStatus,
  type WorkspaceExportResult,
  type WorkspaceExportOptions,
  type WorkspaceRemoveOptions,
  type WorkspaceDeployOptions,
  type DeploySourceProgress,
} from './workspaces.js';

// What a deploy decides for each record and index, and its schema policy: the
// wire types' values, which its callbacks and its job report alike
export type { SchemaPolicy, RecordPlan, RecordIndexPlan } from '@elaraai/e3-types';

// Record mutations and history (the write half of the CQRS pair)
export {
  recordMutate,
  recordHistory,
  recordDescribe,
  recordCompact,
  recordReindex,
  recordSystemCommit,
  readRecordState,
  writeRecordState,
  resolveRecordIndex,
  recordIndexNames,
  appliedMigrations,
  resolveRecord,
  recordLeafType,
  type RecordRef,
  type RecordSystemCommitOptions,
  type RecordSystemCommitTarget,
  type RecordStateRefs,
  type ResolvedRecord,
  type ResolvedRecordIndex,
  type MutationOutcome,
  type RecordMutateOptions,
  type RecordCompactOptions,
  type RecordReindexOptions,
  type RecordMutateLimits,
  type RecordHistoryEntry,
  type RecordSignature,
} from './records.js';

// Tree and dataset operations (low-level, by hash)
export {
  treeRead,
  treeWrite,
  datasetRead,
  datasetWrite,
  workspaceResolveDataset,
  type DatasetLeaf,
  type WorkspaceGetDatasetStatusOptions,
  type TreeObject,
} from './trees.js';

// The opener door: how every reader reaches a stored collection dataset,
// whether it is a segment manifest or a bare segmented blob
export {
  DatasetSegments,
  readManifest,
  openDatasetObject,
  readDatasetWhole,
} from './dataset-open.js';

// The store's door: the one way a collection reaches the object store, from a
// stored collection, chunks, elements, or a file or a directory on this machine
export {
  storeCollection,
  storeDatasetFile,
  type CollectionSource,
} from './store-collection-file.js';
export { storeDatasetBytes } from './store-collection.js';

// The write path a mutation delta takes: only the segments it touched
export {
  applyDelta,
  summarizeDelta,
  DeltaConflictError,
  type DeltaArmSummary,
} from './record-apply.js';

// Taking an existing file into a workspace as a dataset value (#765), and a
// delivery the store holds
export {
  datasetAdoptFile,
  objectAdoptFile,
  type DatasetAdoptOptions,
} from './dataset-adopt-file.js';
export {
  datasetAdoptObject,
  datasetAdoptKnown,
  adoptProgressToIntakeFile,
  type DatasetAdoptObjectOptions,
  type DatasetAdoptProgress,
  type DatasetAdoptResult,
  type DatasetTaken,
  type ObjectAdoptResult,
} from './dataset-adopt.js';

// A delivered collection taken in by intake units on the runners, in pieces:
// one the store holds, or a file on this machine; and a piece of one the store
// holds, as the blob of its own an intake unit reads
export { intakeDelivery } from './delivery-intake-file.js';
export {
  deliveryPiece,
  type DeliveryIntake,
  type DeliveryIntakeOptions,
  type DeliveryIntakeProgress,
  type DeliveryPiece,
} from './delivery-intake.js';

// Tree and dataset operations (high-level, by path)
export {
  packageListTree,
  workspaceListTree,
  workspaceGetDataset,
  workspaceGetDatasetHash,
  workspaceGetDatasetStatus,
  workspaceSetDataset,
  workspaceSetDatasetBytes,
  workspaceSetDatasetByHash,
  workspaceGetTree,
  type DatasetStatusResult,
  type WorkspaceSetDatasetOptions,
  type WorkspaceGetTreeOptions,
  type TreeNode,
  type TreeBranchNode,
  type TreeLeafNode,
} from './trees.js';

// Task operations
export {
  packageListTasks,
  packageGetTask,
  workspaceListTasks,
  workspaceGetTask,
  workspaceGetTaskHash,
} from './tasks.js';

// Execution operations
export {
  // Identity
  inputsHash,
  // Status
  executionGet,
  executionGetLatest,
  executionGetOutput,
  executionListIds,
  executionListForTask,
  executionList,
  // Find current execution for a task in workspace
  executionFindCurrent,
  type CurrentExecutionRef,
  // Logs
  executionReadLog,
  type LogReadOptions,
  // Note: LogChunk is exported from './storage/index.js' (aligned interface)
  // Command IR evaluation
  evaluateCommandIr,
} from './executions.js';

// UUID utilities (for execution history)
export { uuidv7, uuidv7Timestamp, isUuidv7 } from './uuid.js';

// Local process execution (in execution/ directory), and the execution cache
// every runner serves from
export {
  taskExecute,
  taskExecuteUnit,
  probeExecutionCache,
  type ExecuteOptions,
  type ExecutionIds,
  type ExecutionResult,
} from './execution/LocalTaskRunner.js';

// Process identification helpers (local execution support)
export {
  getBootId,
  getPidStartTime,
  isProcessAlive,
  processOwner,
} from './execution/processHelpers.js';

// Dataflow execution: a workspace's dataflow run on this machine
export {
  dataflowExecute,
  dataflowStart,
  LocalOrchestrator,
} from './execution/local-orchestrator.js';
export {
  dataflowGetGraph,
  dataflowGetReadyTasks,
  dataflowCheckCache,
  dataflowGetDependentsToSkip,
  dataflowResolveInputHashes,
  findAffectedTasks,
  parsePathString,
  type DataflowGraph,
  type DataflowOptions,
  type DataflowResult,
  type TaskExecutionResult,
} from './dataflow.js';

// Resumable dataflow execution
export {
  // Types (re-exported from e3-types)
  type DataflowExecutionState,
  type DataflowExecutionStatus,
  type ExecutionStateSummary,
  type TaskState,
  type TaskStatus as DataflowTaskStatus,
  type ExecutionEvent,
  type DataflowGraph as DataflowGraphType,
  type DataflowGraphTask as DataflowGraphTaskType,
  // Result types (TypeScript-only)
  type InitializeResult,
  type PrepareTaskResult,
  type TaskExecuteResult,
  type TaskCompletedResult,
  type TaskFailedResult,
  type FinalizeResult,
  // Step functions, and the refusals a start makes before anything runs
  checkDataflowStart,
  stepInitialize,
  stepGetReady,
  stepPrepareTask,
  stepTaskStarted,
  stepTaskSplit,
  stepTaskMergeStarted,
  stepTaskMergeCompleted,
  stepUnitRequeued,
  stepTaskCompleted,
  stepTaskFailed,
  stepTasksSkipped,
  stepIsComplete,
  stepFinalize,
  stepCancel,
  stepYield,
  stepApplyTreeUpdate,
  stepDetectInputChanges,
  stepInvalidateTasks,
  stepCheckVersionConsistency,
  type StepInitializeOptions,
  // State store
  type ExecutionStateStore,
  type StateWriteOutcome,
  type StoredRunState,
  type TaskStatusDetails,
  type ExecutionStatusDetails,
  InMemoryStateStore,
  FileStateStore,
  // Orchestrator
  type DataflowOrchestrator,
  type ExecutionHandle,
  type ExecutionProgress,
  type ExecutionStatus as OrchestratorExecutionStatus,
  type OrchestratorStartOptions,
  type ResumeOptions,
  type TaskCompletedCallback,
  type LocalOrchestratorHost,
  stateToStatus,
  // API compatibility layer
  type ApiDataflowEventType,
  type ApiDataflowEvent,
  type ApiExecutionStatus,
  type ApiExecutionSummary,
  type ApiExecutionState,
  coreEventToApiEvent,
  coreStatusToApiStatus,
  coreStateToApiState,
} from './dataflow/index.js';

// A run's events, as every state store keeps them apart from its state
export {
  EVENT_SEGMENT_EVENTS,
  eventSegment,
  decodeEventSegment,
  segmentBefore,
  planEventAppend,
  eventsSince,
  stateWithoutEvents,
  compareEventSeqs,
  type EventSegment,
  type EventAppend,
} from './dataflow/state-store/events.js';

// Workspace locking (in storage/local/)
export {
  acquireWorkspaceLock,
  getWorkspaceLockState,
  getWorkspaceLockHolder,
  isLockHolderAlive,
  workspaceLockPath,
  type WorkspaceLockHandle,
  type AcquireLockOptions,
} from './storage/local/LocalLockService.js';

// Workspace status
export {
  workspaceStatus,
  type DatasetStatus,
  type TaskStatus,
  type DatasetStatusInfo,
  type TaskStatusInfo,
  type WorkspaceStatusOptions,
  type WorkspaceStatusResult,
} from './workspaceStatus.js';

// Dataset refs (reactive dataflow)
export {
  checkVersionConsistency,
  mergeVersionVectors,
  inputVersionVector,
  keypathToRefPath,
  refPathToKeypath,
  snapshotInputVersions,
  detectInputChanges,
  computeRootHash,
  writeRefsFromTree,
  writeRefsFromPackage,
} from './dataset-refs.js';

// Errors
export {
  // Base
  E3Error,
  // Repository
  RepoNotFoundError,
  RepoAlreadyExistsError,
  RepoStatusConflictError,
  RepoLayoutError,
  RepositoryBusyError,
  RepositoryUpgradePendingError,
  // Names, hashes and ids
  InvalidNameError,
  checkName,
  checkHash,
  checkId,
  // Workspace
  WorkspaceNotFoundError,
  WorkspaceNotDeployedError,
  WorkspaceExistsError,
  WorkspaceLockError,
  RecordDeployRefusedError,
  lockStateToHolderInfo,
  type LockHolderInfo,
  // Package
  PackageNotFoundError,
  PackageInvalidError,
  PackageExistsError,
  ExportStoppedError,
  // Dataset
  DatasetNotFoundError,
  DatasetRefConflictError,
  DatasetTypeMismatchError,
  DeliveryRefusedError,
  // Task
  TaskNotFoundError,
  // Object
  ObjectNotFoundError,
  ObjectCorruptError,
  GcReadError,
  // Execution
  ExecutionCorruptError,
  ExecutionNotFoundError,
  // Dataflow
  DataflowError,
  DataflowAbortedError,
  DataflowSupersededError,
  // Generic
  PermissionDeniedError,
  // Helpers
  isNotFoundError,
  isPermissionError,
  isExistsError,
  wrapError,
} from './errors.js';

// Transfer backend
export * from './transfer/index.js';
