/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { EfsBackend } from '@elaraai/e3-cloud-storage';

interface RunTaskEvent {
  tenantId: string;
  taskHash: string;
  inputHashes: string[];
}

interface RunTaskResult {
  state: 'success' | 'failed' | 'error';
  outputHash?: string;
  exitCode?: number;
  error?: string;
}

/**
 * Lambda handler: Execute a task.
 * Called by Step Functions to run east-node tasks.
 */
export async function handler(event: RunTaskEvent): Promise<RunTaskResult> {
  const { tenantId, taskHash, inputHashes } = event;

  const storage = new EfsBackend(tenantId);
  console.log(`Running task ${taskHash} at ${storage.repoPath}`);
  console.log(`Input hashes: ${inputHashes.join(', ')}`);

  // TODO: Call e3-core dataflowExecuteTask() once StorageBackend is implemented
  // const result = await dataflowExecuteTask(storage, taskHash, inputHashes, {
  //   onStdout: (data) => console.log(data),
  //   onStderr: (data) => console.error(data),
  // });
  // return result;

  // Placeholder
  return {
    state: 'success',
    outputHash: 'placeholder-output-hash',
  };
}
