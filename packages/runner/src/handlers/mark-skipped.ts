/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Note: This handler may no longer be needed since write-result.ts now handles
 * skipping dependent tasks via stepTasksSkipped when a task fails. Keeping it
 * for backward compatibility with existing Step Functions workflows.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3DynamoStorage } from '@elaraai/e3-storage';
import { stepTasksSkipped, dataflowGetDependentsToSkip } from '@elaraai/e3-core';

// Initialize clients once at Lambda cold start
const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});
const storage = new S3DynamoStorage(
  s3,
  dynamo,
  process.env.BUCKET_NAME!,
  process.env.TABLE_NAME!
);

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
 * Lambda handler: Mark downstream tasks as skipped after a task failure.
 *
 * When a task fails, all tasks that transitively depend on it should be
 * marked as skipped since they cannot execute without their dependency.
 *
 * Note: This is now handled by write-result.ts via stepTaskFailed + stepTasksSkipped.
 * This handler is kept for backward compatibility but may be a no-op if tasks
 * are already skipped by write-result.
 */
export async function handler(event: MarkSkippedEvent): Promise<MarkSkippedResult> {
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
