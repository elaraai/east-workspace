/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3DynamoStorage } from '@elaraai/e3-storage';
import {
  dataflowResolveInputHashes,
  dataflowCheckCache,
  type DataflowGraph,
} from '@elaraai/e3-core';
import { getStoredGraph } from './shared/graph-utils.js';

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
  graph?: DataflowGraph;
  force?: boolean; // Skip cache check if true
}

export interface DispatchTaskResult {
  taskName: string;
  status: 'ready' | 'cached' | 'not_ready';
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
 * 1. Resolves input hashes from the workspace
 * 2. Checks if the task is cached
 * 3. If cached, marks as cached and returns the output hash
 * 4. If not cached, returns task execution parameters for Step Functions
 *    to invoke the execute-task Lambda directly
 */
export async function handler(event: DispatchTaskEvent): Promise<DispatchTaskResult> {
  const { repo, workspace, executionId, taskName, force } = event;

  console.log(`Dispatching task ${taskName} for execution ${executionId} (force=${force ?? false})`);

  // Get graph from event or execution record
  let graph = event.graph;
  if (!graph) {
    graph = await getStoredGraph(storage, repo, workspace, executionId);
  }

  // Find the task in the graph
  const task = graph.tasks.find((t) => t.name === taskName);
  if (!task) {
    throw new Error(`Task ${taskName} not found in graph`);
  }

  // Resolve input hashes from workspace
  const inputHashes = await dataflowResolveInputHashes(storage, repo, workspace, task);

  console.log(`Task ${taskName} inputs: ${JSON.stringify(task.inputs)}`);
  console.log(`Task ${taskName} inputHashes: ${JSON.stringify(inputHashes)}`);

  // Check if any input is unassigned
  if (inputHashes.includes(null)) {
    console.log(`Task ${taskName} has unassigned inputs, not ready`);
    return { taskName, status: 'not_ready' };
  }

  // All inputs are assigned - cast to string[]
  const resolvedInputHashes = inputHashes as string[];

  // Check cache (skip if force=true)
  const cachedOutput = force ? null : await dataflowCheckCache(storage, repo, task.hash, resolvedInputHashes);
  if (cachedOutput) {
    console.log(`Task ${taskName} is cached with output ${cachedOutput}`);

    // Mark as cached in DynamoDB (Phase 3 schema: TASK/{repo}/{executionId})
    await storage.refs.setTaskStatus(repo, executionId, taskName, {
      status: 'cached',
      outputHash: cachedOutput,
      taskHash: task.hash,
      inputHashes: resolvedInputHashes,
      outputPath: task.output,
      completedAt: new Date().toISOString(),
    });

    // Return all fields needed by Step Functions state machine
    return {
      taskName,
      status: 'cached',
      outputHash: cachedOutput,
      taskHash: task.hash,
      inputHashes: resolvedInputHashes,
      outputPath: task.output,
    };
  }

  // Not cached - return task execution parameters for Step Functions
  // to invoke execute-task Lambda directly
  console.log(`Task ${taskName} ready for execution`);

  // Write ready status to DynamoDB (Phase 3 schema: TASK/{repo}/{executionId})
  await storage.refs.setTaskStatus(repo, executionId, taskName, {
    status: 'ready',
    taskHash: task.hash,
    inputHashes: resolvedInputHashes,
    outputPath: task.output,
    readyAt: new Date().toISOString(),
  });

  // Return task execution parameters for Step Functions
  return {
    taskName,
    status: 'ready',
    taskHash: task.hash,
    inputHashes: resolvedInputHashes,
    outputPath: task.output,
  };
}
