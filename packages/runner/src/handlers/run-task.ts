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

interface RunTaskEvent {
  repo: string;
  taskHash: string;
  inputHashes: string[];
}

interface RunTaskResult {
  state: 'success' | 'failed' | 'error';
  outputHash?: string;
  exitCode?: number;
  error?: string;
}

/**
 * Lambda handler: Execute a task.
 * Called by Step Functions to run east-node tasks.
 */
export async function handler(event: RunTaskEvent): Promise<RunTaskResult> {
  const { repo, taskHash, inputHashes } = event;

  console.log(`Running task ${taskHash} in repo ${repo}`);
  console.log(`Input hashes: ${inputHashes.join(', ')}`);

  // TODO: Call e3-core dataflowExecuteTask() once integrated
  // const result = await dataflowExecuteTask(storage, repo, taskHash, inputHashes, {
  //   onStdout: (data) => console.log(data),
  //   onStderr: (data) => console.error(data),
  // });
  // return result;

  // Placeholder
  void storage;
  return {
    state: 'success',
    outputHash: 'placeholder-output-hash',
  };
}
