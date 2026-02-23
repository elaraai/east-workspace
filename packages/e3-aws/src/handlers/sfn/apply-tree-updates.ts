/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { getStorage } from '../../storage/init.js';
import { handleApplyTreeUpdates } from '@elaraai/e3-cloud-core/steps';
import type { ApplyTreeUpdatesEvent, ApplyTreeUpdatesOutput } from '@elaraai/e3-cloud-core/steps';

export type { TreeUpdate, ApplyTreeUpdatesEvent, ApplyTreeUpdatesOutput } from '@elaraai/e3-cloud-core/steps';
export { handleApplyTreeUpdates } from '@elaraai/e3-cloud-core/steps';

/** Lambda handler: thin wrapper that injects dependencies. */
export async function handler(event: ApplyTreeUpdatesEvent): Promise<ApplyTreeUpdatesOutput> {
  return handleApplyTreeUpdates(getStorage(), event);
}
