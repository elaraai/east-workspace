/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { getStorage } from '../../storage/init.js';
import { handleApplyResults } from '@elaraai/e3-cloud-core/steps';
import type { ApplyResultsEvent, ApplyResultsOutput } from '@elaraai/e3-cloud-core/steps';

export type { ApplyResultsEvent, ApplyResultsOutput, TaskResult } from '@elaraai/e3-cloud-core/steps';
export { handleApplyResults } from '@elaraai/e3-cloud-core/steps';

/** Lambda handler: thin wrapper that injects dependencies. */
export async function handler(event: ApplyResultsEvent): Promise<ApplyResultsOutput> {
  return handleApplyResults(getStorage(), event);
}
