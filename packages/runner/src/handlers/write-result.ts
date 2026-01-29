/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3DynamoStorage } from '@elaraai/e3-storage';
import {
  stepTaskCompleted,
  stepTaskFailed,
  stepTasksSkipped,
  inputsHash,
} from '@elaraai/e3-core';
import { variant } from '@elaraai/east';
import type { ExecutionStatus } from '@elaraai/e3-types';

// Initialize clients once at Lambda cold start
const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});
const storage = new S3DynamoStorage(
  s3,
  dynamo,
  process.env.BUCKET_NAME!,
  process.env.TABLE_NAME!
);

export interface WriteResultEvent {
  repo: string;
  workspace: string;
  /** Numeric execution ID */
  executionId: number;
  taskName: string;
  outputPath: string;
  outputHash?: string; // Undefined for failed tasks
  taskHash?: string; // Undefined for failed tasks
  inputHashes?: string[]; // Undefined for failed tasks
  status: 'completed' | 'cached' | 'failed'; // Task status from Step Functions
  duration?: number; // Task execution duration in ms (only for executed tasks)
  error?: string; // Error message for failed tasks
  exitCode?: number; // Exit code for failed tasks
}

export interface WriteResultOutput {
  /** Output path in workspace tree (e.g., ".tasks.add.output") */
  outputPath?: string;
  /** Hash of the output value in S3 */
  outputHash?: string;
  /** Whether this task needs a tree update (false for failed tasks) */
  needsTreeUpdate: boolean;
}

/**
 * Lambda handler: Record task result and return tree update info.
 *
 * Called by Step Functions after task execution. Updates task status using
 * e3-core step functions, but does NOT write to workspace tree directly.
 * Tree updates are collected and applied serially by the ApplyTreeUpdates
 * step to avoid lost update race conditions.
 *
 * Uses e3-core step functions to eliminate duplicated business logic.
 *
 * @returns Tree update info (outputPath, outputHash) for successful tasks
 */
export async function handler(event: WriteResultEvent): Promise<WriteResultOutput> {
  const { repo, workspace, executionId, taskName, outputPath, outputHash, taskHash, inputHashes, status, duration, error, exitCode } = event;
  const execId = executionId.toString().padStart(10, '0');

  // Read execution state
  const state = await storage.executions.read(repo, workspace, execId);
  if (!state) {
    throw new Error(`Execution ${executionId} not found`);
  }

  // Helper to check and preserve cancelled status before saving
  // This handles race conditions where cancel was called during our operation
  const preserveCancelledStatus = async () => {
    const currentState = await storage.executions.read(repo, workspace, execId);
    if (currentState?.status === 'cancelled') {
      (state as { status: string }).status = 'cancelled';
    }
  };

  // Handle failed tasks
  if (status === 'failed') {
    console.log(`Recording failure for task ${taskName} in workspace ${workspace}`);
    console.log(`Error: ${error ?? 'unknown'}`);

    // Use stepTaskFailed to update state and get tasks to skip
    const { result } = stepTaskFailed(state, taskName, error, exitCode, duration ?? 0);

    // Skip dependent tasks
    if (result.toSkip.length > 0) {
      console.log(`Skipping ${result.toSkip.length} dependent tasks: ${result.toSkip.join(', ')}`);
      stepTasksSkipped(state, result.toSkip, taskName);
    }

    // Check for cancellation before saving
    await preserveCancelledStatus();

    // Save updated state
    await storage.executions.update(state);

    console.log(`Recorded failure for task ${taskName}`);
    return { needsTreeUpdate: false };
  }

  const isCached = status === 'cached';
  console.log(`Recording result for task ${taskName} in workspace ${workspace} (${isCached ? 'cached' : 'executed'})`);
  console.log(`Output path: ${outputPath}, hash: ${outputHash}${isCached ? '' : `, duration: ${duration ?? 0}ms`}`);

  // Use stepTaskCompleted to update state
  // Note: For cached tasks, dispatch-task already called stepTaskCompleted,
  // but we call it again here for consistency (it's idempotent for same task)
  if (!isCached) {
    stepTaskCompleted(state, taskName, outputHash!, false, duration ?? 0);
  }

  // Check for cancellation before saving
  await preserveCancelledStatus();

  // Save updated state
  await storage.executions.update(state);

  // Write execution cache record for e3-core's workspaceStatus to detect 'up-to-date'
  // This is the record that executionGet() looks for when computing task status
  if (!isCached && taskHash && inputHashes && outputHash) {
    const cacheTime = new Date();
    const inHash = inputsHash(inputHashes);
    const executionStatus: ExecutionStatus = variant('success', {
      inputHashes: inputHashes,
      outputHash: outputHash,
      startedAt: cacheTime, // We don't have the actual start time, use completion time
      completedAt: cacheTime,
    });
    await storage.refs.executionWrite(repo, taskHash, inHash, executionStatus);
  }

  console.log(`Recorded result for task ${taskName} (${isCached ? 'cached' : 'executed'})`);

  // Return tree update info - actual tree write happens in ApplyTreeUpdates step
  return {
    outputPath,
    outputHash: outputHash!,
    needsTreeUpdate: true,
  };
}
