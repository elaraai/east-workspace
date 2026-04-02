/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { getStorage } from '../../storage/init.js';
import { handleCheckCompletion } from '@elaraai/e3-cloud-core/steps';
import type { CheckCompletionEvent, CheckCompletionResult } from '@elaraai/e3-cloud-core/steps';

export type { CheckCompletionEvent, CheckCompletionResult, TaskCompletion, DispatchResult, DataflowEventType } from '@elaraai/e3-cloud-core/steps';
export { handleCheckCompletion } from '@elaraai/e3-cloud-core/steps';

/** Lambda handler: thin wrapper that injects dependencies. */
export async function handler(event: CheckCompletionEvent): Promise<CheckCompletionResult> {
  return handleCheckCompletion(getStorage().executionTracker, event);
}
