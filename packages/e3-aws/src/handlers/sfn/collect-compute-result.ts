/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { getComputeResultStore } from '../../storage/init.js';
import { handleCollectComputeResult } from '@elaraai/e3-cloud-core/steps';
import type { CollectComputeResultEvent, TaskExecutionResult } from '@elaraai/e3-cloud-core/steps';

export type { CollectComputeResultEvent } from '@elaraai/e3-cloud-core/steps';
export { handleCollectComputeResult } from '@elaraai/e3-cloud-core/steps';

/** Lambda handler: thin wrapper that injects dependencies. */
export async function handler(event: CollectComputeResultEvent): Promise<TaskExecutionResult> {
  return handleCollectComputeResult(getComputeResultStore(), event);
}
