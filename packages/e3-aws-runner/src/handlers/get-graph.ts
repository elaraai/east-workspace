/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3DynamoStorage } from '@elaraai/e3-aws-storage';
import { stepInitialize, type DataflowGraph } from '@elaraai/e3-core';

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
 * 1. Calls e3-core stepInitialize to build the dependency graph and initial state
 * 2. Stores the state in the executions store
 * 3. Returns the execution ID and graph for the state machine
 *
 * Uses e3-core step functions to eliminate duplicated business logic.
 */
export async function handler(event: GetGraphEvent): Promise<GetGraphResult> {
  const { repo, workspace, executionId, force } = event;
  const execId = executionId.toString().padStart(10, '0');

  console.log(`Getting graph for workspace ${workspace} in repo ${repo} (execution ${executionId})`);

  // Use stepInitialize to build the graph and create initial state
  const { state, readyTasks } = await stepInitialize(
    storage,
    repo,
    workspace,
    execId,
    { force: force ?? false, concurrency: 4 }
  );

  // Extract graph (stepInitialize always sets it inline)
  const graph = state.graph.type === 'some' ? state.graph.value : null;
  if (!graph) {
    throw new Error('stepInitialize did not return a graph');
  }

  console.log(`Graph has ${graph.tasks.length} tasks, ${readyTasks.length} ready`);

  // Update the state in the executions store
  // (initial state was created by API handler to avoid race with polling)
  await storage.executions.update(state);

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
