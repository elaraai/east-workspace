/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { getStorage } from '../../storage/init.js';
import { handleMarkSkipped } from '@elaraai/e3-cloud-core/steps';
import type { MarkSkippedEvent, MarkSkippedResult } from '@elaraai/e3-cloud-core/steps';

export type { MarkSkippedEvent, MarkSkippedResult } from '@elaraai/e3-cloud-core/steps';
export { handleMarkSkipped } from '@elaraai/e3-cloud-core/steps';

/** Lambda handler: thin wrapper that injects dependencies. */
export async function handler(event: MarkSkippedEvent): Promise<MarkSkippedResult> {
  return handleMarkSkipped(getStorage(), event);
}
