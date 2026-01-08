/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3DynamoStorage } from '@elaraai/e3-storage';

// Initialize storage once at Lambda cold start
const storage = new S3DynamoStorage(
  new S3Client({}),
  new DynamoDBClient({}),
  process.env.BUCKET_NAME!,
  process.env.TABLE_NAME!
);

interface GetGraphEvent {
  repo: string;
  workspace: string;
}

interface TaskGraph {
  tasks: Record<string, { dependencies: string[] }>;
}

/**
 * Lambda handler: Get the task dependency graph for a workspace.
 * Called by Step Functions at the start of dataflow execution.
 */
export async function handler(event: GetGraphEvent): Promise<TaskGraph> {
  const { repo, workspace } = event;

  console.log(`Getting graph for workspace ${workspace} in repo ${repo}`);

  // TODO: Call e3-core dataflowGetGraph() once integrated
  // const graph = await dataflowGetGraph(storage, repo, workspace);
  // return graph;

  // Placeholder
  void storage;
  return {
    tasks: {},
  };
}
