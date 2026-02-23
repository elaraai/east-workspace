/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Collect Compute Result
 *
 * Reads the TaskExecutionResult from the ComputeResultStore
 * written by the Fargate container, deletes the item, and returns the result.
 * If the item is not found (container crashed before writing), returns
 * a failure result.
 */

import type { ComputeResultStore } from '../compute-result-store.js';
import type { TaskExecutionResult } from './execute-task.js';

export interface CollectComputeResultEvent {
  repo: string;
  workspace: string;
  taskExecutionId: string;
  taskName: string;
}

export async function handleCollectComputeResult(computeResultStore: ComputeResultStore, event: CollectComputeResultEvent): Promise<TaskExecutionResult> {
  const { repo, workspace, taskExecutionId, taskName } = event;

  console.log(`Collecting compute result for task ${taskName} (executionId: ${taskExecutionId})`);

  try {
    const resultJson = await computeResultStore.read(repo, workspace, taskExecutionId);

    if (!resultJson) {
      // Container crashed or failed before writing result
      console.error(`No compute result found for task ${taskName} — container may have crashed`);
      return {
        taskName,
        status: 'failed',
        error: 'Compute container exited without writing result (possible crash or OOM)',
        duration: 0,
      };
    }

    const result: TaskExecutionResult = JSON.parse(resultJson);

    // Delete the result item (one-time read)
    await computeResultStore.delete(repo, workspace, taskExecutionId);

    console.log(`Collected result for task ${taskName}: status=${result.status}`);
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to collect compute result for task ${taskName}:`, err);
    return {
      taskName,
      status: 'failed',
      error: `Failed to collect compute result: ${errorMsg}`,
      duration: 0,
    };
  }
}
