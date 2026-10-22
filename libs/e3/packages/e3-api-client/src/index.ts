/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3-api-client: TypeScript client library for e3 API server
 *
 * Stateless functions for interacting with an e3 API server.
 * Uses BEAST2 serialization for request/response bodies.
 */

// Types
export {
  ApiTypes, TASK_EXECUTIONS_PAGE_DEFAULT, TASK_EXECUTIONS_PAGE_MAX, RECORD_ARG_TEXT_CHARS, RECORD_ARG_TEXT_BYTES, RECORD_ARGS_READ_BYTES,
} from './types.js';
export type {
  RepositoryStatus,
  GcRequest,
  GcResult,
  GcStartResult,
  GcStatusResult,
  AsyncOperationStatus,
  RepositoryRemoval,
  PackageListItem,
  PackageImportResult,
  WorkspaceInfo,
  SchemaPolicy,
  InputPolicy,
  RecordPlan,
  RecordIndexPlan,
  InputPlan,
  WorkspaceDeployResult,
  WorkspaceDeployProgress,
  WorkspaceDeployStatus,
  LockStatus,
  LockProgress,
  DeployProgress,
  RecordDeployState,
  RecordDeployStep,
  IntakeFile,
  IntakeStep,
  WorkspaceStatusResult,
  DatasetStatus,
  DatasetStatusInfo,
  TaskStatus,
  TaskStatusInfo,
  WorkspaceStatusSummary,
  TaskListItem,
  TaskDetails,
  DataflowGraph,
  DataflowGraphTask,
  LogChunk,
  TaskLogChunk,
  TaskExecutionResult,
  DataflowResult,
  DataflowEvent,
  ExecutionStatus,
  DataflowExecutionSummary,
  DataflowBudget,
  UnitWait,
  SplitProgress,
  StageUnit,
  RequeueReason,
  DataflowExecutionState,
  ExecutionListItem,
  ExecutionHistoryStatus,
  TreeKind,
  ListEntry,
  DatasetStatusDetail,
  RunnerValue,
  ExecuteLimits,
  Diagnostic,
  ExecuteResult,
  CallArg,
  FunctionCallRequest,
  FunctionSignature,
  OneShotRequest,
  SplitCallArg,
  SplitCallRequest,
  SplitCallProgress,
  SplitCallStatus,
  SplitCallPlan,
  MutationCallRequest,
  MutationResult,
  RecordMigrationApplied,
  RecordSignature,
  RecordCommitInfo,
  RecordArgPreview,
  RecordCommitArgs,
  RecordHistoryCommit,
  RecordHistoryResult,
} from './types.js';

// HTTP utilities and auth
export {
  ApiError, AuthError, DatasetHashMismatchError, fetchWithAuth, fetchWithRetry, requestFetch, get, getConditional, post, put, del, putEmpty,
  parseErrorBody, requestAnswered, retryingRefusal, pollRequestOptions, NO_RETRY, RETRY_REFUSAL_MAX_MS,
} from './http.js';
export type { RequestOptions, RetryOptions, Response, Answered, Conditional } from './http.js';

// Repository
export type { RepositoryRecord } from '@elaraai/e3-types';
export {
  repoStatus,
  repoRecord,
  repoGc,
  repoGcStart,
  repoGcStatus,
  repoCreate,
  repoRemove,
  type RepoRemoveOptions,
} from './repository.js';

// Repos (multi-repo operations)
export { repoList } from './repos.js';

// Packages
export {
  packageList,
  packageGet,
  packageImport,
  packageExport,
  packageRemove,
  pollExport,
} from './packages.js';

// Workspaces
export {
  workspaceList,
  workspaceCreate,
  workspaceCopy,
  workspaceGet,
  workspaceStatus,
  workspaceStatusSince,
  workspaceLockStatus,
  workspaceRemove,
  workspaceDeploy,
  workspaceExport,
  type WorkspaceDeployOptions,
  type WorkspaceStatusQuery,
  type WorkspaceStatusAnswer,
} from './workspaces.js';

// Datasets
export {
  datasetList,
  datasetListAt,
  datasetListRecursive,
  datasetListRecursivePaths,
  datasetListWithStatus,
  datasetGet,
  datasetGetStream,
  datasetGetPage,
  datasetGetStatus,
  datasetFindKey,
  datasetFindKeys,
  datasetGetRows,
  datasetGetRuns,
  DATASET_BATCH_MAX,
  datasetSet,
  datasetSetStream,
  objectGet,
  collectionGetStream,
  parsePage,
  type DatasetTransferSource,
  type DatasetTransferOptions,
  type DatasetPage,
  type DatasetPageWindow,
  type DatasetFindQuery,
  type DatasetFindResult,
  type DatasetKeySearch,
  type DatasetFindKeysQuery,
  type DatasetFindKeysResult,
  type DatasetRowsQuery,
  type DatasetRows,
  type DatasetRunsQuery,
  type DatasetRuns,
} from './datasets.js';

// Tasks
export { taskList, taskGet, taskExecutionList } from './tasks.js';

// Functions / one-shot
export {
  functionList,
  functionDescribe,
  functionCall,
  workspaceFunctionList,
  workspaceFunctionDescribe,
  workspaceFunctionCall,
  oneShotExecute,
  splitCallLaunch,
  splitCallStatus,
  splitCallExplain,
  splitCall,
  type SplitCallOptions,
  type SplitCallAnswer,
} from './functions.js';

// Records (describe + mutations + history + compaction)
export { workspaceRecordDescribe, workspaceRecordMutate, workspaceRecordCompact, workspaceRecordHistory } from './records.js';

// Executions
export {
  dataflowExecute,
  dataflowExecuteLaunch,
  dataflowExecutePoll,
  dataflowEventsRemain,
  dataflowBudget,
  dataflowGraph,
  dataflowCancel,
  taskLogs,
  type DataflowOptions,
  type DataflowPollOptions,
  type DataflowCancelOptions,
  type LogOptions,
  type ExecutionStateOptions,
} from './executions.js';

// Platform functions
export {
  Platform,
  platformImplementation,
  type PlatformImplementationOptions,
  LogOptionsType,
  platform_repo_status,
  platform_repo_gc,
  platform_package_list,
  platform_package_get,
  platform_package_import,
  platform_package_export,
  platform_package_remove,
  platform_workspace_list,
  platform_workspace_create,
  platform_workspace_get,
  platform_workspace_status,
  platform_workspace_remove,
  platform_workspace_deploy,
  platform_workspace_export,
  platform_dataset_list,
  platform_dataset_list_at,
  platform_dataset_get,
  platform_dataset_set,
  platform_task_list,
  platform_task_get,
  platform_dataflow_start,
  platform_dataflow_execute,
  platform_dataflow_graph,
  platform_task_logs,
  platform_function_call,
  platform_one_shot_execute,
} from './platform.js';
