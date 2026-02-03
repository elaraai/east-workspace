/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3DynamoStorage } from '@elaraai/e3-aws-storage';
import { stepGetReady, stepIsComplete } from '@elaraai/e3-core';

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
}

/**
 * Lambda handler: Find tasks that are ready to execute.
 *
 * A task is ready when:
 * - All its dependencies have completed (success or cached)
 * - It is not already dispatched, running, completed, failed, or skipped
 *
 * Uses e3-core step functions (stepGetReady, stepIsComplete) to eliminate
 * duplicated business logic.
 */
export async function handler(event: GetReadyEvent): Promise<GetReadyResult> {
  const { repo, workspace, executionId } = event;
  const execId = executionId.toString().padStart(10, '0');

  console.log(`Getting ready tasks for execution ${executionId} in repo ${repo}`);

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
    };
  }

  // Use step functions to get ready tasks and completion status
  const readyTasks = stepGetReady(state);
  const allCompleted = stepIsComplete(state);

  // Count tasks by status for reporting
  let completedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let inProgressCount = 0;

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
    }
  }

  console.log(`Ready: ${readyTasks.length}, In-progress: ${inProgressCount}, Completed: ${completedCount}, Failed: ${failedCount}, Skipped: ${skippedCount}`);

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
  };
}
