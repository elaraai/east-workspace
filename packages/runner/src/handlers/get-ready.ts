/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3DynamoStorage } from '@elaraai/e3-storage';
import { dataflowGetReadyTasks, type DataflowGraph } from '@elaraai/e3-core';

// Initialize clients once at Lambda cold start
const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});
const storage = new S3DynamoStorage(
  s3,
  dynamo,
  process.env.BUCKET_NAME!,
  process.env.TABLE_NAME!
);

export interface GetReadyEvent {
  repo: string;
  workspace: string;
  /** Numeric execution ID */
  executionId: number;
  graph?: DataflowGraph;
}

export interface GetReadyResult {
  repo: string;
  workspace: string;
  executionId: number;
  readyTasks: string[];
  allCompleted: boolean;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  inProgressCount: number;
}

/**
 * Lambda handler: Find tasks that are ready to execute.
 *
 * A task is ready when:
 * - All its dependencies have completed (success or cached)
 * - It is not already dispatched, running, completed, failed, or skipped
 *
 * Phase 3 schema:
 * - Task statuses at PK: TASK/{repo}/{executionId}
 * - Execution (with graph) at PK: EXEC/{repo}/{workspace}, SK: {executionId}
 */
export async function handler(event: GetReadyEvent): Promise<GetReadyResult> {
  const { repo, workspace, executionId } = event;

  console.log(`Getting ready tasks for execution ${executionId} in repo ${repo}`);

  // Get graph from event or execution record
  let graph = event.graph;
  if (!graph) {
    const execution = await storage.refs.getExecution(repo, workspace, executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found for workspace ${workspace}`);
    }
    if (!execution.graph) {
      throw new Error(`Execution ${executionId} has no graph (status: ${execution.status})`);
    }
    graph = JSON.parse(execution.graph) as DataflowGraph;
  }

  // Query all task statuses for this execution (Phase 3 schema)
  const taskStatuses = await storage.refs.getExecutionTasks(repo, executionId);

  // Build sets of task states
  const completed = new Set<string>();
  const inProgress = new Set<string>();
  const failed = new Set<string>();
  const skipped = new Set<string>();

  for (const task of taskStatuses) {
    switch (task.status) {
      case 'success':
      case 'cached':
        completed.add(task.taskName);
        break;
      case 'dispatched':
      case 'running':
        inProgress.add(task.taskName);
        break;
      case 'failed':
      case 'error':
        failed.add(task.taskName);
        break;
      case 'skipped':
        skipped.add(task.taskName);
        break;
    }
  }

  // Record events for newly completed tasks
  await recordEventsForCompletedTasks(repo, workspace, executionId, taskStatuses);

  // Get tasks that have all dependencies satisfied
  const readyCandidates = dataflowGetReadyTasks(graph, completed);

  // Filter out tasks that are already in-progress, failed, or skipped
  const readyTasks = readyCandidates.filter(
    (task) => !inProgress.has(task) && !failed.has(task) && !skipped.has(task)
  );

  // All tasks are complete when there are no ready tasks and no in-progress tasks
  // and all tasks are either completed, failed, or skipped
  const totalTasks = graph.tasks.length;
  const processedCount = completed.size + failed.size + skipped.size;
  const allCompleted = readyTasks.length === 0 && inProgress.size === 0 && processedCount >= totalTasks;

  console.log(`Ready: ${readyTasks.length}, In-progress: ${inProgress.size}, Completed: ${completed.size}, Failed: ${failed.size}, Skipped: ${skipped.size}`);

  return {
    repo,
    workspace,
    executionId,
    readyTasks,
    allCompleted,
    completedCount: completed.size,
    failedCount: failed.size,
    skippedCount: skipped.size,
    inProgressCount: inProgress.size,
  };
}

/**
 * Record events for newly completed tasks.
 * Only records events for tasks that haven't had events recorded yet.
 *
 * Note: Currently a no-op - events are recorded in write-result handler.
 * This function exists for potential future use when we might want to
 * record events during get-ready polling.
 */
function recordEventsForCompletedTasks(
  _repo: string,
  _workspace: string,
  _executionId: number,
  _taskStatuses: Array<{
    taskName: string;
    status: string;
    duration?: number;
    exitCode?: number;
    error?: string;
  }>
): Promise<void> {
  // Events are recorded in write-result handler to avoid duplicate events.
  // This function is kept for potential future use.
  return Promise.resolve();
}
