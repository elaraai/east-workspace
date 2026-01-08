/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { EfsBackend } from '@elaraai/e3-storage';

interface WriteResultEvent {
  tenantId: string;
  workspace: string;
  taskHash: string;
  outputHash: string;
}

/**
 * Lambda handler: Write task output to workspace tree.
 * Called by Step Functions after successful task execution.
 */
export function handler(event: WriteResultEvent): void {
  const { tenantId, workspace, taskHash, outputHash } = event;

  const _storage = new EfsBackend(tenantId);
  console.log(`Writing result for task ${taskHash} to workspace ${workspace}`);
  console.log(`Output hash: ${outputHash}`);

  // TODO: Call e3-core dataflowWriteOutput() once StorageBackend is implemented
  // await dataflowWriteOutput(storage, workspace, taskHash, outputHash);
}
