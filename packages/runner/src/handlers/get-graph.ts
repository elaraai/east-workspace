/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { S3DynamoStorage } from '@elaraai/e3-storage';
import { dataflowGetGraph, type DataflowGraph } from '@elaraai/e3-core';

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

export interface GetGraphEvent {
  repo: string;
  workspace: string;
  executionId: string;
}

export interface GetGraphResult {
  repo: string;
  workspace: string;
  executionId: string;
  graph: DataflowGraph;
  taskCount: number;
}

/**
 * Lambda handler: Get the task dependency graph for a workspace.
 * Called by Step Functions at the start of dataflow execution.
 *
 * This handler:
 * 1. Calls e3-core dataflowGetGraph to build the dependency graph
 * 2. Stores the graph in DynamoDB (for large DAGs >256KB limit)
 * 3. Returns the graph with task count for the state machine
 */
export async function handler(event: GetGraphEvent): Promise<GetGraphResult> {
  const { repo, workspace, executionId } = event;

  console.log(`Getting graph for workspace ${workspace} in repo ${repo}`);
  console.log(`Execution ID: ${executionId}`);

  // Build the dependency graph from workspace state
  const graph = await dataflowGetGraph(storage, repo, workspace);

  console.log(`Graph has ${graph.tasks.length} tasks`);

  // Store graph in DynamoDB for later retrieval
  // This handles large DAGs that might exceed Step Functions state size limits
  await dynamo.send(
    new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({
        PK: `REPO#${repo}`,
        SK: `EXEC#GRAPH#${executionId}`,
        graph: JSON.stringify(graph),
        workspace,
        createdAt: new Date().toISOString(),
      }),
    })
  );

  // Initialize execution state
  await dynamo.send(
    new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({
        PK: `REPO#${repo}`,
        SK: `EXEC#STATE#${workspace}`,
        executionId,
        status: 'running',
        startedAt: new Date().toISOString(),
        taskCount: graph.tasks.length,
        completedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        cachedCount: 0,
      }),
    })
  );

  return {
    repo,
    workspace,
    executionId,
    graph,
    taskCount: graph.tasks.length,
  };
}
