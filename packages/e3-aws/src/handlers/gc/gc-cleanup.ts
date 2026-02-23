/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * GC Cleanup Lambda Handler — thin wrapper.
 */

import { getStorage, getGcTempStore } from '../../storage/init.js';
import { handleGcCleanup } from '@elaraai/e3-cloud-core/gc';
import type { GcCleanupInput, GcCleanupOutput } from '@elaraai/e3-cloud-core/gc';
import type { DynamoS3RepoStore } from '../../storage/index.js';

export type { GcCleanupInput, GcCleanupOutput, GcCleanupStats } from '@elaraai/e3-cloud-core/gc';

const storage = getStorage();
const tempStore = getGcTempStore();
// GC cleanup requires cloud-specific cleanupOrphanedVersions method
const cleanupStore = storage.repos as DynamoS3RepoStore;

/** Lambda handler: thin wrapper that injects dependencies. */
export const handler = async (input: GcCleanupInput): Promise<GcCleanupOutput> => {
  return handleGcCleanup(
    { cleanupStore, tempStore },
    input,
  );
};
