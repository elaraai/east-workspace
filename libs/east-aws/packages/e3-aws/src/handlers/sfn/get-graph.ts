/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { getStorage } from '../../storage/init.js';
import { handleGetGraph } from '@elaraai/e3-cloud-core/steps';
import type { GetGraphEvent, GetGraphResult } from '@elaraai/e3-cloud-core/steps';

export type { GetGraphEvent, GetGraphResult, GetGraphDeps } from '@elaraai/e3-cloud-core/steps';
export { handleGetGraph } from '@elaraai/e3-cloud-core/steps';

/** Lambda handler: thin wrapper that injects dependencies. */
export async function handler(event: GetGraphEvent): Promise<GetGraphResult> {
  const storage = getStorage();
  return handleGetGraph({ storage, dataflowRuns: storage.dataflowRuns }, event);
}
