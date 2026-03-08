/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * @elaraai/e3-cloud-core/steps
 *
 * Cloud-agnostic dataflow step logic.
 *
 * Each step is a pure function that takes cloud-agnostic interfaces
 * and returns results. AWS Lambda handlers import from this module
 * and provide concrete AWS implementations via dependency injection.
 */

export { handleGetGraph } from './get-graph.js';
export type { GetGraphDeps, GetGraphEvent, GetGraphResult } from './get-graph.js';

export { handleGetReady } from './get-ready.js';
export type { GetReadyEvent, GetReadyResult } from './get-ready.js';

export { handleDispatchTask } from './dispatch-task.js';
export type { DispatchTaskDeps, DispatchTaskEvent, DispatchTaskResult } from './dispatch-task.js';

export { executeTaskCore, LogBuffer } from './execute-task.js';
export type { TaskExecutionDeps, TaskExecutionEvent, TaskExecutionResult, ExecuteTaskCoreOptions } from './execute-task.js';

export { handleCollectComputeResult } from './collect-compute-result.js';
export type { CollectComputeResultEvent } from './collect-compute-result.js';

export { handleApplyResults } from './apply-results.js';
export type { ApplyResultsEvent, ApplyResultsOutput, TaskResult } from './apply-results.js';

export { handleCheckCompletion } from './check-completion.js';
export type { CheckCompletionEvent, CheckCompletionResult, TaskCompletion, DispatchResult, DataflowEventType } from './check-completion.js';

export { handleMarkSkipped } from './mark-skipped.js';
export type { MarkSkippedEvent, MarkSkippedResult } from './mark-skipped.js';

export { handleFinalizeExecution } from './finalize-execution.js';
export type { FinalizeExecutionDeps, FinalizeExecutionEvent, FinalizeExecutionResult } from './finalize-execution.js';

export { handleScheduleTrigger } from './schedule-trigger.js';
export type { ScheduleTriggerDeps, ScheduleTriggerEvent, ScheduleTriggerResult } from './schedule-trigger.js';

export { handleProcessImport } from './process-import.js';
export type { ProcessImportDeps, ProcessImportInput, ProcessImportOutput } from './process-import.js';

export { handleMarkImportFailed } from './mark-import-failed.js';
export type { MarkImportFailedDeps, MarkImportFailedInput } from './mark-import-failed.js';
