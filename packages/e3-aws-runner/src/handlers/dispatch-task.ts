/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3DynamoStorage } from '@elaraai/e3-aws-storage';
import {
  stepPrepareTask,
  stepTaskStarted,
  stepTaskCompleted,
} from '@elaraai/e3-core';

// Initialize clients once at Lambda cold start
const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});
const storage = new S3DynamoStorage(
  s3,
  dynamo,
  process.env.BUCKET_NAME!,
  process.env.TABLE_NAME!
);

export interface DispatchTaskEvent {
  repo: string;
  workspace: string;
  /** Numeric execution ID */
  executionId: number;
  taskName: string;
  force?: boolean; // Skip cache check if true
}

export interface DispatchTaskResult {
  taskName: string;
  status: 'ready' | 'cached' | 'not_ready' | 'cancelled';
  outputHash?: string;
  // Task execution parameters (when status is 'ready')
  taskHash?: string;
  inputHashes?: string[];
  outputPath?: string;
}

/**
 * Lambda handler: Dispatch a task for execution.
 *
 * This handler:
 * 1. Checks for cancellation before doing expensive work
 * 2. Uses stepPrepareTask to resolve inputs and check cache
 * 3. If cached, uses stepTaskCompleted to update state and returns cached status
 * 4. If not cached, uses stepTaskStarted to mark task as started
 * 5. Returns task execution parameters for Step Functions to invoke execute-task
 *
 * Uses e3-core step functions to eliminate duplicated business logic.
 */
export async function handler(event: DispatchTaskEvent): Promise<DispatchTaskResult> {
  const { repo, workspace, executionId, taskName, force } = event;
  const execId = executionId.toString().padStart(10, '0');

  console.log(`Dispatching task ${taskName} for execution ${executionId} (force=${force ?? false})`);

  // Read execution state
  const state = await storage.executions.read(repo, workspace, execId);

  // Check for cancellation before doing expensive work
  if (!state || state.status === 'cancelled') {
    console.log(`Execution ${executionId} was cancelled, skipping task ${taskName}`);
    return { taskName, status: 'cancelled' };
  }

  // Use stepPrepareTask to resolve inputs and check cache
  // Note: stepPrepareTask uses state.force, which was set during initialization
  const prepare = await stepPrepareTask(storage, state, taskName);

  console.log(`Task ${taskName} inputs: ${prepare.inputHashes.length} hashes`);

  // Helper to check and preserve cancelled status before saving
  // This handles race conditions where cancel was called during our operation
  const preserveCancelledStatus = async () => {
    const currentState = await storage.executions.read(repo, workspace, execId);
    if (currentState?.status === 'cancelled') {
      (state as { status: string }).status = 'cancelled';
    }
  };

  // If cached and not forcing, mark as completed from cache
  if (prepare.cachedOutputHash && !force) {
    console.log(`Task ${taskName} is cached with output ${prepare.cachedOutputHash}`);

    // Use stepTaskCompleted to update state (cached=true, duration=0)
    stepTaskCompleted(state, taskName, prepare.cachedOutputHash, true, 0);

    // Check for cancellation before saving
    await preserveCancelledStatus();
    await storage.executions.update(state);

    return {
      taskName,
      status: 'cached',
      outputHash: prepare.cachedOutputHash,
      taskHash: prepare.taskHash,
      inputHashes: prepare.inputHashes,
      outputPath: prepare.outputPath,
    };
  }

  // Not cached - mark as started and return execution parameters
  console.log(`Task ${taskName} ready for execution`);

  // Use stepTaskStarted to mark the task as in-progress
  stepTaskStarted(state, taskName);

  // Check for cancellation before saving
  await preserveCancelledStatus();
  await storage.executions.update(state);

  return {
    taskName,
    status: 'ready',
    taskHash: prepare.taskHash,
    inputHashes: prepare.inputHashes,
    outputPath: prepare.outputPath,
  };
}
