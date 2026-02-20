/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { getStorage, getTaskConfigStore } from '../../storage/init.js';
import { handleDispatchTask } from '@elaraai/e3-cloud-core/steps';
import type { DispatchTaskEvent, DispatchTaskResult } from '@elaraai/e3-cloud-core/steps';

export type { DispatchTaskDeps, DispatchTaskEvent, DispatchTaskResult } from '@elaraai/e3-cloud-core/steps';
export { handleDispatchTask } from '@elaraai/e3-cloud-core/steps';

/** Lambda handler: thin wrapper that injects dependencies. */
export async function handler(event: DispatchTaskEvent): Promise<DispatchTaskResult> {
  return handleDispatchTask({ storage: getStorage(), taskConfigStore: getTaskConfigStore() }, event);
}
