/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { stepGetReady, stepIsComplete, stepDetectInputChanges, stepInvalidateTasks } from '@elaraai/e3-core';
import type { DataflowStorage } from '../dataflow-storage.js';

export interface GetReadyEvent {
  repo: string;
  workspace: string;
  /** Numeric execution ID */
  executionId: number;
}

export interface GetReadyResult {
  repo: string;
  workspace: string;
  executionId: number;
  readyTasks: string[];
  allCompleted: boolean;
  cancelled: boolean;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  inProgressCount: number;
  deferredCount: number;
}

/**
 * Find tasks that are ready to execute.
 *
 * A task is ready when:
 * - All its dependencies have completed (success or cached)
 * - It is not already dispatched, running, completed, failed, or skipped
 *
 * Uses e3-core step functions (stepGetReady, stepIsComplete) to eliminate
 * duplicated business logic.
 */
export async function handleGetReady(storage: DataflowStorage, event: GetReadyEvent): Promise<GetReadyResult> {
  const { repo, workspace, executionId } = event;
  const execId = executionId.toString().padStart(10, '0');

  console.log(`Getting ready tasks for execution ${executionId} in repo ${repo}`);

  // Renew both lock TTLs on every iteration to prevent expiry during long-running dataflows
  await storage.locks.renewLock(repo, workspace);                 // shared workspace lock
  await storage.locks.renewLock(repo, `${workspace}#dataflow`);   // exclusive dataflow lock

  // Read execution state from the store
  const state = await storage.executions.read(repo, workspace, execId);

  // Check for cancellation
  if (!state || state.status === 'cancelled') {
    console.log(`Execution ${executionId} was cancelled or not found`);
    return {
      repo,
      workspace,
      executionId,
      readyTasks: [],
      allCompleted: true,
      cancelled: true,
      completedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      inProgressCount: 0,
      deferredCount: 0,
    };
  }

  // Detect input changes and invalidate affected tasks (reactive dataflow)
  try {
    const { changes } = await stepDetectInputChanges(storage, state);
    if (changes.length > 0) {
      const { invalidated } = stepInvalidateTasks(state, changes);
      if (invalidated.length > 0) {
        console.log(`Invalidated ${invalidated.length} tasks due to input changes: ${invalidated.join(', ')}`);
      }
      await storage.executions.update(state);
    }
  } catch (err) {
    // stepDetectInputChanges may fail if workspace structure is unavailable
    // (e.g. workspace not yet deployed). This is non-fatal — skip detection.
    console.log(`Skipping input change detection: ${err instanceof Error ? err.message : err}`);
  }

  // Use step functions to get ready tasks and completion status
  const readyTasks = stepGetReady(state);
  const allCompleted = stepIsComplete(state);

  // Count tasks by status for reporting
  let completedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let inProgressCount = 0;
  let deferredCount = 0;

  for (const [, taskState] of state.tasks) {
    switch (taskState.status) {
      case 'completed':
        completedCount++;
        break;
      case 'failed':
        failedCount++;
        break;
      case 'skipped':
        skippedCount++;
        break;
      case 'in_progress':
        inProgressCount++;
        break;
      case 'deferred':
        deferredCount++;
        break;
    }
  }

  console.log(`Ready: ${readyTasks.length}, In-progress: ${inProgressCount}, Completed: ${completedCount}, Failed: ${failedCount}, Skipped: ${skippedCount}, Deferred: ${deferredCount}`);

  return {
    repo,
    workspace,
    executionId,
    readyTasks,
    allCompleted,
    cancelled: false,
    completedCount,
    failedCount,
    skippedCount,
    inProgressCount,
    deferredCount,
  };
}
