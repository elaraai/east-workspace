/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { getStorage } from '../../storage/init.js';
import { handleFinalizeExecution } from '@elaraai/e3-cloud-core/steps';
import type { FinalizeExecutionEvent, FinalizeExecutionResult } from '@elaraai/e3-cloud-core/steps';

export type { FinalizeExecutionDeps, FinalizeExecutionEvent, FinalizeExecutionResult } from '@elaraai/e3-cloud-core/steps';
export { handleFinalizeExecution } from '@elaraai/e3-cloud-core/steps';

/** Lambda handler: thin wrapper that injects dependencies. */
export async function handler(event: FinalizeExecutionEvent): Promise<FinalizeExecutionResult> {
  const storage = getStorage();
  return handleFinalizeExecution({ storage, dataflowRuns: storage.dataflowRuns }, event);
}
