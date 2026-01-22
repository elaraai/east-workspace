/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3DynamoStorage } from '@elaraai/e3-storage';
import { dataflowGetDependentsToSkip, type DataflowGraph } from '@elaraai/e3-core';

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
  graph?: DataflowGraph;
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
 * Phase 3 schema: TASK/{repo}/{executionId}
 */
export async function handler(event: MarkSkippedEvent): Promise<MarkSkippedResult> {
  const { repo, workspace, executionId, failedTask } = event;

  console.log(`Marking dependents of failed task ${failedTask} as skipped`);

  // Get graph from event or execution record
  let graph = event.graph;
  if (!graph) {
    graph = await getStoredGraph(repo, workspace, executionId);
  }

  // Get current task states
  const taskStates = await getTaskStates(repo, executionId);

  // Build completed and skipped sets
  const completedTasks = new Set<string>();
  const skippedTasks = new Set<string>();

  for (const [taskName, status] of taskStates) {
    if (status === 'success' || status === 'cached') {
      completedTasks.add(taskName);
    } else if (status === 'skipped') {
      skippedTasks.add(taskName);
    }
  }

  // Find all tasks that should be skipped
  const toSkip = dataflowGetDependentsToSkip(graph, failedTask, completedTasks, skippedTasks);

  console.log(`Found ${toSkip.length} tasks to skip: ${toSkip.join(', ')}`);

  // Mark each task as skipped and record event (Phase 3 schema)
  const now = new Date().toISOString();
  for (const taskName of toSkip) {
    await storage.refs.setTaskStatus(repo, executionId, taskName, {
      status: 'skipped',
      reason: `Dependency '${failedTask}' failed`,
      skippedAt: now,
    });

    // Record 'skipped' event
    await storage.refs.addExecutionEvent(repo, workspace, executionId, {
      type: 'skipped',
      task: taskName,
      timestamp: now,
      reason: `Dependency '${failedTask}' failed`,
    });
  }

  // Update execution counters (Phase 3 schema)
  if (toSkip.length > 0) {
    await storage.refs.incrementExecutionCounters(repo, workspace, executionId, {
      skippedCount: toSkip.length,
    });
  }

  return {
    skippedTasks: toSkip,
    skippedCount: toSkip.length,
  };
}

/**
 * Get stored graph from execution record.
 * Phase 3 schema: Graph is stored as an attribute of the execution record.
 */
async function getStoredGraph(repo: string, workspace: string, executionId: number): Promise<DataflowGraph> {
  const execution = await storage.refs.getExecution(repo, workspace, executionId);
  if (!execution) {
    throw new Error(`Execution ${executionId} not found for workspace ${workspace}`);
  }
  if (!execution.graph) {
    throw new Error(`Execution ${executionId} has no graph (status: ${execution.status})`);
  }
  return JSON.parse(execution.graph) as DataflowGraph;
}

/**
 * Get all task states for an execution.
 * Phase 3 schema: TASK/{repo}/{executionId}
 */
async function getTaskStates(
  repo: string,
  executionId: number
): Promise<Map<string, string>> {
  const states = new Map<string, string>();

  // Use the storage helper for Phase 3 schema
  const tasks = await storage.refs.getExecutionTasksV2(repo, executionId);

  for (const task of tasks) {
    states.set(task.taskName, task.status);
  }

  return states;
}
