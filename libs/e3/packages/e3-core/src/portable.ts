/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 Core, portable: the e3 that runs wherever JavaScript does.
 *
 * This entry (`@elaraai/e3-core/portable`) is e3's logic over the interfaces a
 * backend implements — a {@link StorageBackend}, a {@link TaskRunner}, an
 * {@link ExecutionStateStore}, a {@link TransferBackend} — with nothing of the
 * machine it runs on: no Node module, no `Buffer`, no `process`. Its modules
 * import only one another, `@elaraai/east` and `@elaraai/e3-types`, which
 * `seams.spec.ts` checks through every module it reaches.
 *
 * The root entry (`@elaraai/e3-core`) re-exports every one of these — the same
 * functions, classes and errors — and adds what needs this machine: local
 * storage, the local runner, the file state store, and the forms of a few
 * operations that read files or run tasks here, or hash natively. Where the
 * root has its own form of a name here, it is the one that does so:
 *
 * - `computeHash` is East's SHA-256; the root's is Node's own, which gives the
 *   same digest natively.
 * - `LocalOrchestrator` runs a run's tasks on the runner its start names, or
 *   its host's; the root's is a subclass whose host is this process.
 * - `probeExecutionCache` and `executeSplitTask` take the judgement of whether
 *   an execution recorded `running` can finish; the root's judge by this
 *   machine's processes when none is given.
 * - `storeCollection` takes a stored collection, chunks or elements; the
 *   root's also takes a file or a directory on this machine.
 * - `intakeDelivery` takes in a delivery the store holds; the root's also one
 *   that is a file on this machine.
 * - `workspaceDeploy` reads no `file` source; the root's reads them here.
 * - `openZip`, `packageImport`, `packageZipOpen` and `handleProcessImport`
 *   read a zip from a source read by ranges; the root's also read one that is
 *   a file on this machine. `packageExport`, `workspaceExport` and
 *   `handleProcessExport` write a zip to a WHATWG `WritableStream`; the
 *   root's write one to a file on this machine, or to a Node stream.
 *
 * @packageDocumentation
 */

// =============================================================================
// Storage and Execution Abstractions
// =============================================================================

export type {
  ObjectStore,
  RefStore,
  LockHandle,
  LockService,
  LockState,
  LockOperation,
  LogChunk,
  LogStore,
  RepoStore,
  RepoStatus,
  RepoStatusName,
  RepoMetadata,
  BatchResult,
  GcRootScanResult,
  GcObjectEntry,
  GcObjectScanResult,
  GcBackendSweepOptions,
  GcBackendSweepResult,
  DatasetRefStore,
  RepositoryUpgrade,
  StorageBackend,
} from './storage/interfaces.js';

// How a log store cuts a window of a log, as every one does: at the longest
// prefix of its bytes that holds whole characters
export { completeUtf8Length } from './storage/utf8.js';

export type {
  TaskExecuteOptions,
  TaskResult,
  TaskRunner,
  RunningExecution,
  ExecutionLiveness,
  MergeParts,
  SplitUnit,
  UnitRequeue,
  IntakeSource,
  IntakeSpec,
  IntakeOptions,
  IntakeResult,
  DetachedArg,
  DetachedSpec,
  DetachedResult,
  DetachedRunOptions,
} from './execution/interfaces.js';

// =============================================================================
// Repository
// =============================================================================

// The repository record, and the upgrades an open applies: every backend's
export {
  repositoryOpen,
  newRepositoryRecord,
  type RepositoryOpenOptions,
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

// Object storage: an object's hash, by East's SHA-256, and the form every
// store checks one has
export { computeHash, isObjectHash } from './objects.js';

// =============================================================================
// Packages and Workspaces
// =============================================================================

// Package operations over the store, and a package's zip: its import from a
// zip read by ranges, a view of one, and its export to a stream
export {
  packageRemove,
  packageList,
  packageGetLatestVersion,
  packageResolve,
  packageRead,
  packageImport,
  packageZipOpen,
  packageExport,
  packageZipCheckpointWithin,
  type PackageImportResult,
  type PackageImportOptions,
  type PackageZip,
  type PackageExportResult,
  type PackageExportOptions,
} from './packages.js';

// Zips read by ranges where they lie, and written to a stream an entry at a
// time
export {
  ZipWriter,
  ZipSourceError,
  openZip,
  iterateZipEntries,
  type ZipSource,
  type ZipEntry,
  type ZipReader,
  type ZipRecord,
  type ZipWritten,
} from './zip.js';

// Workspace operations. This entry's deploy reads no `file` source, and its
// export writes to a stream.
export {
  workspaceList,
  workspaceCreate,
  workspaceRemove,
  workspaceGetState,
  workspaceGetPackage,
  workspaceLockStatus,
  workspaceDeploy,
  workspaceExport,
  type WorkspaceRemoveOptions,
  type WorkspaceDeployOptions,
  type DeploySourceProgress,
  type WorkspaceExportResult,
  type WorkspaceExportOptions,
} from './workspaces.js';

// What a deploy decides for each record and index, and its schema policy: the
// wire types' values, which its callbacks and its job report alike
export type { SchemaPolicy, RecordPlan, RecordIndexPlan } from '@elaraai/e3-types';

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

// =============================================================================
// Records, Trees and Datasets
// =============================================================================

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

// Tree and dataset operations: low-level, by hash, and high-level, by path
export {
  treeRead,
  treeWrite,
  datasetRead,
  datasetWrite,
  workspaceResolveDataset,
  packageListTree,
  workspaceListTree,
  workspaceGetDataset,
  workspaceGetDatasetHash,
  workspaceGetDatasetStatus,
  workspaceSetDataset,
  workspaceSetDatasetBytes,
  workspaceSetDatasetByHash,
  workspaceGetTree,
  type DatasetLeaf,
  type WorkspaceGetDatasetStatusOptions,
  type TreeObject,
  type DatasetStatusResult,
  type WorkspaceSetDatasetOptions,
  type WorkspaceGetTreeOptions,
  type TreeNode,
  type TreeBranchNode,
  type TreeLeafNode,
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
// stored collection, chunks or elements
export {
  storeCollection,
  storeDatasetBytes,
  type CollectionSource,
} from './store-collection.js';

// The write path a mutation delta takes: only the segments it touched
export {
  applyDelta,
  summarizeDelta,
  DeltaConflictError,
  type DeltaArmSummary,
} from './record-apply.js';

// A delivery the store holds, taken into a workspace as a dataset value
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

// A stored delivered collection taken in by intake units on the runners, in
// pieces, and a piece of one as the blob of its own an intake unit reads
export {
  intakeDelivery,
  deliveryPiece,
  type DeliveryIntake,
  type DeliveryIntakeOptions,
  type DeliveryIntakeProgress,
  type DeliveryPiece,
} from './delivery-intake.js';

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

// =============================================================================
// Tasks and Executions
// =============================================================================

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
  inputsHash,
  executionGet,
  executionGetLatest,
  executionGetOutput,
  executionListIds,
  executionListForTask,
  executionList,
  executionFindCurrent,
  type CurrentExecutionRef,
  executionReadLog,
  type LogReadOptions,
  evaluateCommandIr,
} from './executions.js';

// UUID utilities (for execution history)
export { uuidv7, uuidv7Timestamp, isUuidv7 } from './uuid.js';

// The execution cache every runner serves from, and what an execution is to
// every runner
export {
  probeExecutionCache,
  type ExecuteOptions,
  type ExecutionIds,
  type ExecutionResult,
} from './execution/cache.js';

// An execution attempt's records, as every runner writes them
export {
  ExecutionAttempt,
  readTaskObject,
  toTaskResult,
  type AttemptRunner,
  type LogAppender,
} from './execution/attempt.js';

// The units a task runs as, wherever they run, and where each one's output is
export {
  UNIT_FILE,
  UNIT_RESULT_FILE,
  UNIT_OUTPUT_DIR,
  OUTPUT_MERGE_FILE,
  OUTPUT_MERGE_RESULT,
  OUTPUT_MERGE_DIR,
  INTAKE_TYPE_FILE,
  INTAKE_OUTPUT_FILE,
  runUnitOf,
  mergeUnitOf,
  callUnitOf,
  intakeUnitOf,
  emitsRuns,
  outputRunsOf,
  outputMergeUnitOf,
  unitOutputOf,
  emittedCollectionType,
  type StockRunner,
  type UnitForm,
  type UnitStage,
  type UnitOutputPlace,
} from './execution/unit-forms.js';

// The engine: a task split into pieces, as the stages its units run in, and
// the driver that runs a task on its own
export {
  SplitTask,
  isSplitTask,
  stageUnits,
  executeSplitTask,
  type SplitStage,
  type SplitTaskDriver,
  type ThrownUnit,
  type UnitExecutor,
} from './execution/engine.js';

// The pieces of a split task, and where a host reads the piece size a test
// sets
export {
  PIECE_SIZES,
  pieceSizes,
  pieceBoundaries,
  planPieces,
  readTestPieceBytesFrom,
  type PieceSizes,
  type SplitPoint,
  type PiecePlan,
} from './execution/pieces.js';

// The merge fan-in of a split task's sorted partials
export {
  MERGE_TREE_FANIN,
  mergeComponents,
  planMergeRanges,
  mergeTreeGroups,
  mergeTreeLevels,
  type MergeComponent,
} from './execution/steps.js';

// One-shot: a caller's IR run once under the grant the host's auth gives it,
// and the limits and result every graph-free call shares
export {
  oneShotExecute,
  oneShotPlatformUse,
  resolveExecuteLimits,
  resolveJobLimits,
  detachedToExecuteResult,
  invalidExecuteResult,
  type OneShotGrant,
  type OneShotOptions,
  type ExecuteCeilings,
  type ResolvedLimits,
} from './execution/oneShot.js';

// Split calls: a caller's program run over a dataset's pieces as a job, under
// one-shot's grant
export {
  splitCallPlatformUse,
  splitCallPlatformFree,
  splitCallPrepare,
  splitCallReference,
  splitCallExplain,
  splitCallRun,
  splitCallResult,
  splitCallInvalid,
  SplitCallOutcomeType,
  type SplitCallOutcome,
  type SplitCallTask,
  type SplitCallOptions,
  type SplitCallRunOptions,
} from './execution/splitCall.js';

// =============================================================================
// Dataflow
// =============================================================================

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

// Resumable dataflow execution: its types (re-exported from e3-types) and
// results
export type {
  DataflowExecutionState,
  DataflowExecutionStatus,
  ExecutionStateSummary,
  TaskState,
  TaskStatus as DataflowTaskStatus,
  ExecutionEvent,
  DataflowGraph as DataflowGraphType,
  DataflowGraphTask as DataflowGraphTaskType,
  InitializeResult,
  PrepareTaskResult,
  TaskExecuteResult,
  TaskCompletedResult,
  TaskFailedResult,
  FinalizeResult,
} from './dataflow/types.js';

// Step functions, and the refusals a start makes before anything runs
export {
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
} from './dataflow/steps.js';

// State store
export type {
  ExecutionStateStore,
  StateWriteOutcome,
  StoredRunState,
  TaskStatusDetails,
  ExecutionStatusDetails,
} from './dataflow/state-store/interfaces.js';
export { InMemoryStateStore } from './dataflow/state-store/InMemoryStateStore.js';

// Orchestrator
export {
  stateToStatus,
  type DataflowOrchestrator,
  type ExecutionHandle,
  type ExecutionProgress,
  type ExecutionStatus as OrchestratorExecutionStatus,
  type OrchestratorStartOptions,
  type ResumeOptions,
  type TaskCompletedCallback,
} from './dataflow/orchestrator/interfaces.js';
export { LocalOrchestrator, type LocalOrchestratorHost } from './dataflow/orchestrator/LocalOrchestrator.js';

// API compatibility layer
export {
  coreEventToApiEvent,
  coreStatusToApiStatus,
  coreStateToApiState,
  type ApiDataflowEventType,
  type ApiDataflowEvent,
  type ApiExecutionStatus,
  type ApiExecutionSummary,
  type ApiExecutionState,
} from './dataflow/api-compat.js';

// =============================================================================
// Errors
// =============================================================================

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

// =============================================================================
// Transfer
// =============================================================================

// The records a transfer backend keeps, and the stores it is made of
export {
  DatasetUploadType,
  type DatasetUpload,
  DatasetCommitStatusType,
  type DatasetCommitStatus,
  PackageImportType,
  PackageImportProgressType,
  PackageImportStatusType,
  type PackageImport,
  PackageExportType,
  PackageExportProgressType,
  PackageExportStatusType,
  type PackageExport,
  PackageZipCheckpointType,
  type PackageZipCheckpoint,
  WorkspaceDeployJobType,
  type WorkspaceDeployJob,
  RepoGcJobType,
  type RepoGcJob,
  SplitCallJobStatusType,
  SplitCallJobType,
  type SplitCallJob,
} from './transfer/types.js';

export type {
  DatasetPartUpload,
  DatasetUploadStore,
  DatasetDownloadStore,
  PackageImportStore,
  PackageExportStore,
  WorkspaceDeployStore,
  RepoGcStore,
  SplitCallStore,
  TransferBackend,
} from './transfer/interfaces.js';

// The jobs: an import, whose zip is read by ranges where it lies, an export,
// written to a stream, a deploy, gc, and a split call
export {
  handleProcessImport,
  handleProcessExport,
  handleProcessDeploy,
  handleProcessGc,
  handleProcessSplitCall,
  type ProcessImportDeps,
  type ProcessImportInput,
  type ProcessExportDeps,
  type ProcessExportInput,
  type ProcessDeployDeps,
  type ProcessDeployInput,
  type ProcessGcDeps,
  type ProcessGcInput,
  type ProcessSplitCallDeps,
  type ProcessSplitCallInput,
} from './transfer/process.js';
