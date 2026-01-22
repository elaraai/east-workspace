/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
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

export interface GetGraphEvent {
  repo: string;
  workspace: string;
  /** Execution ID created by API handler (passed from Step Function input) */
  executionId: number;
  force?: boolean; // Skip cache check if true
}

export interface GetGraphResult {
  repo: string;
  workspace: string;
  /** Numeric execution ID (from API handler) */
  executionId: number;
  graph: DataflowGraph;
  taskCount: number;
  force: boolean; // Pass through force flag
}

/**
 * Lambda handler: Get the task dependency graph for a workspace.
 * Called by Step Functions at the start of dataflow execution.
 *
 * This handler:
 * 1. Calls e3-core dataflowGetGraph to build the dependency graph
 * 2. Transitions the execution from 'starting' to 'running'
 * 3. Stores the graph as an attribute of the execution record
 * 4. Returns the execution ID and graph for the state machine
 *
 * The execution record is pre-created by the API handler with 'starting' status.
 * This ensures clients can poll for status immediately after the API call returns.
 */
export async function handler(event: GetGraphEvent): Promise<GetGraphResult> {
  const { repo, workspace, executionId, force } = event;

  console.log(`Getting graph for workspace ${workspace} in repo ${repo} (execution ${executionId})`);

  // Build the dependency graph
  const graph = await dataflowGetGraph(storage, repo, workspace);

  console.log(`Graph has ${graph.tasks.length} tasks`);

  // Transition execution from 'starting' to 'running' and store the graph
  await storage.refs.startExecution(
    repo,
    workspace,
    executionId,
    JSON.stringify(graph),
    graph.tasks.length
  );

  console.log(`Started execution ${executionId} for workspace ${workspace}`);

  return {
    repo,
    workspace,
    executionId,
    graph,
    taskCount: graph.tasks.length,
    force: force ?? false,
  };
}
