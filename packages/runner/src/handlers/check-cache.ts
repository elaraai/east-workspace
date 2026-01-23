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

interface CheckCacheEvent {
  repo: string;
  taskHash: string;
  inputHashes: string[];
}

interface CheckCacheResult {
  cached: boolean;
  outputHash?: string;
}

/**
 * Lambda handler: Check if a task's output is cached.
 * Called by Step Functions before executing each task.
 */
export function handler(event: CheckCacheEvent): CheckCacheResult {
  const { repo, taskHash, inputHashes } = event;

  console.log(`Checking cache for task ${taskHash} in repo ${repo}`);

  // TODO: Call e3-core dataflowCheckCache() once integrated
  // const inputsHash = inputsHash(inputHashes);
  // const outputHash = await storage.refs.executionGetOutput(repo, taskHash, inputsHash);
  // return { cached: outputHash !== null, outputHash: outputHash ?? undefined };

  // Placeholder - always miss
  void storage;
  void inputHashes;
  return {
    cached: false,
  };
}
