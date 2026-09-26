/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * e3-types: Shared type definitions for e3 (East Execution Engine)
 *
 * This package defines the East types used for serializing e3 objects:
 * - Data references and tree structures
 * - Task definitions (command IR, input/output paths)
 * - Package objects
 * - Data structure and paths
 * - Workspace state
 * - Execution status
 *
 * Terminology:
 * - **Dataset**: A location holding a value (leaf node)
 * - **Tree**: A location containing other locations (branch node)
 * - **Structure**: The shape of the data tree
 * - **Task**: A computation with command IR and input/output paths
 * - **Path**: An address in the data tree
 */

// Data references and trees
export {
  DataRefType,
  type DataRef,
  unassignedRef,
  nullRef,
  DataTreeType,
} from './dataset.js';

// Per-dataset refs and version vectors (reactive dataflow)
export {
  VersionVectorType,
  type VersionVector,
  DatasetRefType,
  type DatasetRef,
} from './dataset-ref.js';

// Task definitions
export {
  TASK_OBJECT_KIND,
  TaskObjectType,
  type TaskObject,
  decodeTaskObject,
  TaskBodyType,
  type TaskBody,
  TaskPartitionType,
  type TaskPartition,
  TaskInputType,
  type TaskInput,
  TaskOutputKindType,
  type TaskOutputKind,
  TaskOutputType,
  type TaskOutput,
  DataManifestType,
  type DataManifest,
  TaskRoleType,
  type TaskRole,
} from './task.js';

// Execution environments
export {
  EnvironmentSpecType,
  type EnvironmentSpec,
  PythonEnvironmentType,
  type PythonEnvironment,
  NodeEnvironmentType,
  type NodeEnvironment,
  ImageEnvironmentType,
  type ImageEnvironment,
  ToolsEnvironmentType,
  type ToolsEnvironment,
  WorkspaceNodeEnvironmentType,
  type WorkspaceNodeEnvironment,
  environmentSpecObjectHashes,
} from './environment.js';

// Data structure and paths
export {
  StructureType,
  type Structure,
  PathSegmentType,
  type PathSegment,
  TreePathType,
  type TreePath,
  type ParsePathResult,
  type ParseDatasetPathResult,
  type ParsePackageRefResult,
  treePath,
  pathToString,
  parsePath,
  parseDatasetPath,
  parsePackageRef,
  urlPathToTreePath,
} from './structure.js';

// Runner wire types
export {
  RunnerType,
  type RunnerValue,
  withRunnerLifeline,
} from './runner.js';

// Function objects
export {
  FunctionObjectType,
  type FunctionObject,
  decodeFunctionObject,
} from './function.js';

// Record objects
export {
  RecordCommitType,
  type RecordCommit,
  MutationObjectType,
  type MutationObject,
  RecordObjectType,
  type RecordObject,
  decodeRecordObject,
  RecordIndexObjectType,
  type RecordIndexObject,
  RECORD_STATE_KIND,
  RecordStateType,
  type RecordState,
  isRecordStateType,
  indexCollectionType,
  indexWindowType,
  decodeRecordCommit,
  decodeMutationObject,
  type MutationForm,
  MigrationObjectType,
  type MigrationObject,
  decodeMigrationObject,
  type MigrationForm,
  DELTA_CONFLICT,
  patchOpsType,
  mutationDeltaType,
  editTypeOf,
  type DeltaTarget,
} from './record.js';

// Package objects
export {
  PackageDataType,
  type PackageData,
  PackageObjectType,
  type PackageObject,
  DatasetSourceWireType,
  type DatasetSourceWire,
  decodePackageObject,
  // Package transfer types
  PackageTransferInitRequestType,
  type PackageTransferInitRequest,
  PackageTransferInitResponseType,
  type PackageTransferInitResponse,
  PackageJobResponseType,
  type PackageJobResponse,
  PackageImportResultType,
  type PackageImportResult,
  PackageExportResultType,
  type PackageExportResult,
  PackageImportProgressType,
  type PackageImportProgress,
  PackageImportStatusType,
  type PackageImportStatus,
  PackageExportProgressType,
  type PackageExportProgress,
  PackageExportStatusType,
  type PackageExportStatus,
} from './package.js';

// Workspace state
export {
  WorkspaceStateType,
  type WorkspaceState,
  WorkspaceRecordType,
  type WorkspaceRecord,
} from './workspace.js';

// Execution status
export {
  ExecutionStatusType,
  type ExecutionStatus,
  decodeExecutionStatus,
  executionStatusRoots,
  ExecutionOwnerType,
  type ExecutionOwner,
} from './execution.js';

// Lock state
export {
  LockOperationType,
  type LockOperation,
  ProcessHolderType,
  type ProcessHolder,
  LambdaHolderType,
  type LambdaHolder,
  LockHolderVariantType,
  type LockHolderVariant,
  LockStateType,
  type LockState,
} from './lock.js';

// The repository's own record
export {
  RepoStatusType,
  type RepoStatus,
  RepoMetadataType,
  type RepoMetadata,
} from './repository.js';

// The names e3 makes paths of
export { type NamedKind, nameProblem } from './names.js';

// Dataset transfer types
export {
  TRANSFER_PROTOCOL_VERSION,
  transferPartCount,
  transferPartRange,
  TransferUploadRequestType,
  type TransferUploadRequest,
  TransferUploadResponseType,
  type TransferUploadResponse,
  TransferPartResponseType,
  type TransferPartResponse,
  TransferDoneResponseType,
  type TransferDoneResponse,
} from './transfer.js';

// Dataset blob encoding — the ONE branch deciding segmentation, shared by the
// store's door (e3-core `storeCollection`) and the package export (e3 `export_`)
export {
  isCollectionRoot,
  encodeDatasetBlob,
  writeCollectionManifest,
  type CollectionSegmentRef,
  type CollectionPiece,
  type SegmentSink,
} from './dataset-blob.js';

// The segment-object layout: a collection dataset is a manifest naming
// standalone segment objects, and the manifest is what the ref points at
export {
  COLLECTION_MANIFEST_KIND,
  CollectionManifestType,
  CollectionManifestEntryType,
  type CollectionManifest,
  type CollectionManifestEntry,
  isCollectionManifestType,
  isCollectionManifest,
  encodeCollectionManifest,
  decodeCollectionManifest,
  manifestElementCount,
  manifestByteSize,
} from './collection-manifest.js';

// The ONE declared-type-vs-wire-type check, shared by every door a value
// enters a dataset through (the export, the set, the adopt, the API)
export {
  checkDatasetType,
  datasetAddress,
  type DatasetTypeMismatch,
} from './dataset-type.js';

// Wire format constants
export { BEAST2_CONTENT_TYPE } from './constants.js';

// API wire types (shared between e3-api-client and e3-api-server)
export {
  // Error types
  WorkspaceNotFoundErrorType,
  WorkspaceNotDeployedErrorType,
  WorkspaceExistsErrorType,
  LockHolderType,
  WorkspaceLockedErrorType,
  PackageNotFoundErrorType,
  PackageExistsErrorType,
  PackageInvalidErrorType,
  DatasetNotFoundErrorType,
  TaskNotFoundErrorType,
  ExecutionNotFoundErrorType,
  ObjectNotFoundErrorType,
  DataflowErrorType,
  PermissionDeniedErrorType,
  InternalErrorType,
  RepositoryNotFoundErrorType,
  DatasetTypeMismatchErrorType,
  InvalidNameErrorType,
  ErrorType,
  ResponseType,
  // Repository
  RepositoryStatusType,
  GcRequestType,
  GcResultType,
  AsyncOperationStatusType,
  GcStartResultType,
  GcStatusResultType,
  // Packages
  PackageListItemType,
  PackageInfoType,
  PackageDetailsType,
  // Workspaces
  WorkspaceCreateRequestType,
  WorkspaceInfoType,
  WorkspaceDeployRequestType,
  WorkspaceExportRequestType,
  // Workspace Status
  DatasetStatusType,
  TaskStatusUpToDateType,
  TaskStatusWaitingType,
  TaskStatusInProgressType,
  TaskStatusFailedType,
  TaskStatusErrorType,
  TaskStatusStaleRunningType,
  TaskStatusType,
  DatasetStatusInfoType,
  TaskStatusInfoType,
  WorkspaceStatusSummaryType,
  WorkspaceStatusResultType,
  // Tasks
  TaskListItemType,
  TaskDetailsType,
  // Execution
  DataflowRequestType,
  LogChunkType,
  TaskExecutionResultType,
  DataflowResultType,
  // Dataflow API polling
  DataflowEventType,
  ApiExecutionStatusType,
  DataflowExecutionSummaryType,
  ApiDataflowExecutionStateType,
  // Task Execution History
  ExecutionHistoryStatusType,
  ExecutionListItemType,
  // Dataset List
  TreeKindType,
  ListEntryType,
  // Dataset Status Detail
  DatasetStatusDetailType,
  // Function / one-shot execution
  ExecuteLimitsType,
  DiagnosticType,
  ExecuteResultType,
  FunctionCallRequestType,
  FunctionSignatureType,
  OneShotRequestType,
  MutationCallRequestType,
  MutationResultType,
  RecordSignatureType,
  RecordCommitInfoType,
  RecordHistoryResultType,
  // Type aliases
  type Error,
  type RepositoryStatus,
  type GcRequest,
  type GcResult,
  type AsyncOperationStatus,
  type GcStartResult,
  type GcStatusResult,
  type PackageListItem,
  type PackageInfo,
  type PackageDetails,
  type WorkspaceInfo,
  type WorkspaceCreateRequest,
  type WorkspaceDeployRequest,
  type DatasetStatus,
  type TaskStatus as ApiTaskStatus,
  type DatasetStatusInfo,
  type TaskStatusInfo,
  type WorkspaceStatusSummary,
  type WorkspaceStatusResult,
  type TaskListItem,
  type TaskDetails,
  type DataflowRequest,
  type LogChunk,
  type TaskExecutionResult,
  type DataflowResult,
  type DataflowEvent,
  type ApiExecutionStatus,
  type DataflowExecutionSummary,
  type ApiDataflowExecutionState,
  type ExecutionHistoryStatus,
  type ExecutionListItem,
  type TreeKind,
  type ListEntry,
  type DatasetStatusDetail,
  type ExecuteLimits,
  type Diagnostic,
  type ExecuteResult,
  type FunctionCallRequest,
  type FunctionSignature,
  type OneShotRequest,
  type MutationCallRequest,
  type MutationResult,
  type RecordSignature,
  type RecordCommitInfo,
  type RecordHistoryResult,
} from './api.js';

// Dataflow execution state
export {
  type DataflowExecutionStatus,
  type TaskStatus,
  TaskStateType,
  type TaskState,
  DataflowGraphTaskType,
  type DataflowGraphTask,
  DataflowGraphType,
  type DataflowGraph,
  ExecutionEventType,
  type ExecutionEvent,
  type PartitionProgress,
  EXECUTION_STATE_VERSION,
  DataflowExecutionStateType,
  type DataflowExecutionState,
  decodeDataflowExecutionState,
  // Dataflow run history
  DataflowRunStatusType,
  type DataflowRunStatus,
  TaskExecutionRecordType,
  type TaskExecutionRecord,
  DataflowRunSummaryType,
  type DataflowRunSummary,
  DataflowRunType,
  type DataflowRun,
} from './dataflow.js';

// A split task's unit graph, a stage at a time
export {
  UNIT_PLAN_KIND,
  UnitPlanGroupType,
  type UnitPlanGroup,
  UnitPlanStageType,
  type UnitPlanStage,
  UnitPlanType,
  type UnitPlan,
  encodeUnitPlan,
  decodeUnitPlan,
} from './unit-plan.js';
