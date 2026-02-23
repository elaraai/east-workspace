/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Note: This handler may no longer be needed since apply-results now handles
 * skipping dependent tasks via stepTasksSkipped when a task fails. Keeping it
 * for backward compatibility with existing Step Functions workflows.
 */

import { stepTasksSkipped, dataflowGetDependentsToSkip } from '@elaraai/e3-core';
import type { DataflowStorage } from '../dataflow-storage.js';

export interface MarkSkippedEvent {
  repo: string;
  workspace: string;
  /** Numeric execution ID */
  executionId: number;
  failedTask: string;
}

export interface MarkSkippedResult {
  skippedTasks: string[];
  skippedCount: number;
}

/**
 * Mark downstream tasks as skipped after a task failure.
 *
 * When a task fails, all tasks that transitively depend on it should be
 * marked as skipped since they cannot execute without their dependency.
 *
 * Note: This is now handled by apply-results via stepTaskFailed + stepTasksSkipped.
 * This handler is kept for backward compatibility but may be a no-op if tasks
 * are already skipped by apply-results.
 */
export async function handleMarkSkipped(storage: DataflowStorage, event: MarkSkippedEvent): Promise<MarkSkippedResult> {
  const { repo, workspace, executionId, failedTask } = event;
  const execId = executionId.toString().padStart(10, '0');

  console.log(`Marking dependents of failed task ${failedTask} as skipped`);

  // Read execution state
  const state = await storage.executions.read(repo, workspace, execId);
  if (!state) {
    console.error(`Execution ${executionId} not found`);
    return { skippedTasks: [], skippedCount: 0 };
  }

  // Get graph from state
  const graph = state.graph.type === 'some' ? state.graph.value : null;
  if (!graph) {
    console.error(`Execution ${executionId} has no graph`);
    return { skippedTasks: [], skippedCount: 0 };
  }

  // Build completed and skipped sets from current state
  const completedTasks = new Set<string>();
  const skippedTasks = new Set<string>();

  for (const [taskName, taskState] of state.tasks) {
    if (taskState.status === 'completed') {
      completedTasks.add(taskName);
    } else if (taskState.status === 'skipped') {
      skippedTasks.add(taskName);
    }
  }

  // Find all tasks that should be skipped
  const toSkip = dataflowGetDependentsToSkip(graph, failedTask, completedTasks, skippedTasks);

  if (toSkip.length === 0) {
    console.log(`No additional tasks to skip`);
    return { skippedTasks: [], skippedCount: 0 };
  }

  console.log(`Found ${toSkip.length} tasks to skip: ${toSkip.join(', ')}`);

  // Use stepTasksSkipped to mark tasks as skipped
  stepTasksSkipped(state, toSkip, failedTask);

  // Save updated state
  await storage.executions.update(state);

  return {
    skippedTasks: toSkip,
    skippedCount: toSkip.length,
  };
}
