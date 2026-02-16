/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Lambda Task Executor
 *
 * Thin wrapper around executeTaskCore for Lambda execution.
 * Uses the default 14-minute timeout (Lambda max is 15 min).
 *
 * Invoked directly by Step Functions for synchronous task execution.
 */

import { executeTaskCore } from './execute-task-core.js';

export type { TaskExecutionEvent, TaskExecutionResult } from './execute-task-core.js';
import type { TaskExecutionEvent, TaskExecutionResult } from './execute-task-core.js';

export async function handler(event: TaskExecutionEvent): Promise<TaskExecutionResult> {
  return executeTaskCore(event);
}
