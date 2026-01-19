/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Lambda handlers for Step Functions dataflow execution.
 *
 * Handlers:
 * - getGraphHandler: Build task dependency graph from workspace
 * - getReadyHandler: Find tasks ready to execute
 * - dispatchTaskHandler: Check cache and dispatch task to SQS
 * - checkCompletionHandler: Poll for task completion status
 * - writeResultHandler: Write task output to workspace
 * - markSkippedHandler: Mark downstream tasks as skipped after failure
 * - checkCacheHandler: (legacy) Direct cache check
 * - runTaskHandler: (legacy) Direct task execution
 */

// Dataflow state machine handlers
export { handler as getGraphHandler } from './handlers/get-graph.js';
export { handler as getReadyHandler } from './handlers/get-ready.js';
export { handler as dispatchTaskHandler } from './handlers/dispatch-task.js';
export { handler as checkCompletionHandler } from './handlers/check-completion.js';
export { handler as writeResultHandler } from './handlers/write-result.js';
export { handler as markSkippedHandler } from './handlers/mark-skipped.js';

// Legacy handlers (may be removed in future)
export { handler as checkCacheHandler } from './handlers/check-cache.js';
export { handler as runTaskHandler } from './handlers/run-task.js';

// Type exports
export type { GetGraphEvent, GetGraphResult } from './handlers/get-graph.js';
export type { GetReadyEvent, GetReadyResult } from './handlers/get-ready.js';
export type { DispatchTaskEvent, DispatchTaskResult } from './handlers/dispatch-task.js';
export type { CheckCompletionEvent, CheckCompletionResult, TaskCompletion } from './handlers/check-completion.js';
export type { WriteResultEvent } from './handlers/write-result.js';
export type { MarkSkippedEvent, MarkSkippedResult } from './handlers/mark-skipped.js';
