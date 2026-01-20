/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient, PutItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { S3DynamoStorage } from '@elaraai/e3-storage';
import {
  dataflowResolveInputHashes,
  dataflowCheckCache,
  type DataflowGraph,
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

const TABLE_NAME = process.env.TABLE_NAME!;

export interface DispatchTaskEvent {
  repo: string;
  workspace: string;
  executionId: string;
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

  // Get graph from event or DynamoDB
  let graph = event.graph;
  if (!graph) {
    graph = await getStoredGraph(repo, executionId);
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

    // Mark as cached in DynamoDB
    await dynamo.send(
      new PutItemCommand({
        TableName: TABLE_NAME,
        Item: marshall({
          PK: `REPO#${repo}`,
          SK: `EXEC#TASK#${executionId}#${taskName}`,
          status: 'cached',
          outputHash: cachedOutput,
          completedAt: new Date().toISOString(),
        }),
      })
    );

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

  // Write ready status to DynamoDB (for tracking)
  await dynamo.send(
    new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({
        PK: `REPO#${repo}`,
        SK: `EXEC#TASK#${executionId}#${taskName}`,
        status: 'ready',
        taskHash: task.hash,
        inputHashes: resolvedInputHashes,
        outputPath: task.output,
        readyAt: new Date().toISOString(),
      }),
    })
  );

  // Return task execution parameters for Step Functions
  return {
    taskName,
    status: 'ready',
    taskHash: task.hash,
    inputHashes: resolvedInputHashes,
    outputPath: task.output,
  };
}

/**
 * Get stored graph from DynamoDB.
 */
async function getStoredGraph(repo: string, executionId: string): Promise<DataflowGraph> {
  const response = await dynamo.send(
    new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({
        PK: `REPO#${repo}`,
        SK: `EXEC#GRAPH#${executionId}`,
      }),
      ConsistentRead: true,
    })
  );

  if (!response.Item) {
    throw new Error(`Graph not found for execution ${executionId}`);
  }

  const item = unmarshall(response.Item);
  return JSON.parse(item.graph as string) as DataflowGraph;
}
