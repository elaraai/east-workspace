/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Lambda Task Executor
 *
 * Thin wrapper around executeTaskCore for Lambda execution.
 * Uses the task's configured timeout (from dispatch-task), capped at 14 minutes
 * to stay within Lambda's 15-minute maximum.
 *
 * Invoked directly by Step Functions for synchronous task execution.
 */

import { executeTaskCore } from '@elaraai/e3-cloud-core/steps';
import { getStorage } from '../../storage/init.js';

export type { TaskExecutionEvent, TaskExecutionResult } from '@elaraai/e3-cloud-core/steps';
import type { TaskExecutionEvent, TaskExecutionResult } from '@elaraai/e3-cloud-core/steps';

// Lambda max is 15 min; leave 1 minute buffer for overhead
const MAX_LAMBDA_TIMEOUT_MS = 14 * 60 * 1000;

export async function handler(event: TaskExecutionEvent): Promise<TaskExecutionResult> {
  const storage = getStorage();
  const deps = {
    objects: storage.objects,
    logs: storage.logs,
    executions: storage.executions,
    executionTracker: storage.executionTracker,
  };
  const timeoutMs = event.timeoutMinutes != null
    ? Math.min(event.timeoutMinutes * 60 * 1000, MAX_LAMBDA_TIMEOUT_MS)
    : MAX_LAMBDA_TIMEOUT_MS;
  return executeTaskCore(event, deps, { timeoutMs });
}
