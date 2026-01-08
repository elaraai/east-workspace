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

interface WriteResultEvent {
  repo: string;
  workspace: string;
  taskHash: string;
  outputHash: string;
}

/**
 * Lambda handler: Write task output to workspace tree.
 * Called by Step Functions after successful task execution.
 */
export async function handler(event: WriteResultEvent): Promise<void> {
  const { repo, workspace, taskHash, outputHash } = event;

  console.log(`Writing result for task ${taskHash} to workspace ${workspace} in repo ${repo}`);
  console.log(`Output hash: ${outputHash}`);

  // TODO: Call e3-core dataflowWriteOutput() once integrated
  // await dataflowWriteOutput(storage, repo, workspace, taskHash, outputHash);

  void storage;
}
