/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { EfsBackend } from '@elaraai/e3-storage';

interface CheckCacheEvent {
  tenantId: string;
  taskHash: string;
  inputHashes: string[];
}

interface CheckCacheResult {
  cached: boolean;
  outputHash?: string;
}

/**
 * Lambda handler: Check if a task's output is cached.
 * Called by Step Functions before executing each task.
 */
export function handler(event: CheckCacheEvent): CheckCacheResult {
  const { tenantId, taskHash, inputHashes: _inputHashes } = event;

  const storage = new EfsBackend(tenantId);
  console.log(`Checking cache for task ${taskHash} at ${storage.repoPath}`);

  // TODO: Call e3-core dataflowCheckCache() once StorageBackend is implemented
  // const outputHash = await dataflowCheckCache(storage, taskHash, inputHashes);
  // return { cached: outputHash !== null, outputHash: outputHash ?? undefined };

  // Placeholder - always miss
  return {
    cached: false,
  };
}
