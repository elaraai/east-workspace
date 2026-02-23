/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { getStorage } from '../../storage/init.js';
import { handleGetReady } from '@elaraai/e3-cloud-core/steps';
import type { GetReadyEvent, GetReadyResult } from '@elaraai/e3-cloud-core/steps';

export type { GetReadyEvent, GetReadyResult } from '@elaraai/e3-cloud-core/steps';
export { handleGetReady } from '@elaraai/e3-cloud-core/steps';

/** Lambda handler: thin wrapper that injects dependencies. */
export async function handler(event: GetReadyEvent): Promise<GetReadyResult> {
  return handleGetReady(getStorage(), event);
}
