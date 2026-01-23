/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3DynamoStorage } from '@elaraai/e3-storage';
import { inputsHash } from '@elaraai/e3-core';
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
 * Called by Step Functions after task execution. Updates task status and counters,
 * but does NOT write to workspace tree directly. Tree updates are collected and
 * applied serially by the ApplyTreeUpdates step to avoid lost update race conditions.
 *
 * @returns Tree update info (outputPath, outputHash) for successful tasks
 */
export async function handler(event: WriteResultEvent): Promise<WriteResultOutput> {
  const { repo, workspace, executionId, taskName, outputPath, outputHash, taskHash, inputHashes, status, duration, error } = event;
  const now = new Date().toISOString();

  // Handle failed tasks differently - no output to write
  if (status === 'failed') {
    console.log(`Recording failure for task ${taskName} in workspace ${workspace}`);
    console.log(`Error: ${error ?? 'unknown'}`);

    // Update task status to 'failed' (Phase 3 schema: TASK/{repo}/{executionId})
    await storage.refs.updateTaskStatus(repo, executionId, taskName, {
      status: 'failed',
      error: error ?? 'Task execution failed',
      completedAt: now,
    });

    // Update execution counters (Phase 3 schema: EXEC/{repo}/{workspace})
    await storage.refs.incrementExecutionCounters(repo, workspace, executionId, {
      failedCount: 1,
    });

    // Record 'failed' event (start event already recorded by execute-task)
    await storage.refs.addExecutionEvent(repo, workspace, executionId, {
      type: 'failed',
      task: taskName,
      timestamp: now,
      duration: duration ?? 0,
      exitCode: -1,
    });

    console.log(`Recorded failure for task ${taskName}`);
    return { needsTreeUpdate: false };
  }

  const isCached = status === 'cached';
  console.log(`Recording result for task ${taskName} in workspace ${workspace} (${isCached ? 'cached' : 'executed'})`);
  console.log(`Output path: ${outputPath}, hash: ${outputHash}${isCached ? '' : `, duration: ${duration ?? 0}ms`}`);

  if (isCached) {
    // Cached task: dispatch-task already set status to 'cached', just increment counter
    // Phase 3 schema: EXEC/{repo}/{workspace}
    await storage.refs.incrementExecutionCounters(repo, workspace, executionId, {
      cachedCount: 1,
      completedCount: 1,
    });
    // No need to write execution cache - already exists from previous run

    // Record cached event
    await storage.refs.addExecutionEvent(repo, workspace, executionId, {
      type: 'cached',
      task: taskName,
      timestamp: now,
    });
  } else {
    // Executed task: update status to 'success' with duration
    // Phase 3 schema: TASK/{repo}/{executionId}
    await storage.refs.updateTaskStatus(repo, executionId, taskName, {
      status: 'success',
      outputHash: outputHash,
      completedAt: new Date().toISOString(),
      duration: duration ?? 0,
    });

    // Update execution counters (Phase 3 schema: EXEC/{repo}/{workspace})
    await storage.refs.incrementExecutionCounters(repo, workspace, executionId, {
      completedCount: 1,
    });

    // Write execution cache record for e3-core's workspaceStatus to detect 'up-to-date'
    // This is the record that executionGet() looks for when computing task status
    const cacheTime = new Date();
    const inHash = inputsHash(inputHashes!);
    const executionStatus: ExecutionStatus = variant('success', {
      inputHashes: inputHashes!,
      outputHash: outputHash!,
      startedAt: cacheTime,  // We don't have the actual start time, use completion time
      completedAt: cacheTime,
    });
    await storage.refs.executionWrite(repo, taskHash!, inHash, executionStatus);

    // Record 'complete' event (start event already recorded by execute-task)
    await storage.refs.addExecutionEvent(repo, workspace, executionId, {
      type: 'complete',
      task: taskName,
      timestamp: now,
      duration: duration ?? 0,
    });
  }

  console.log(`Recorded result for task ${taskName} (${isCached ? 'cached' : 'executed'})`);

  // Return tree update info - actual tree write happens in ApplyTreeUpdates step
  return {
    outputPath,
    outputHash: outputHash!,
    needsTreeUpdate: true,
  };
}
