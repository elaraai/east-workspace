/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * GC Mark Phase Lambda Handler
 *
 * Implements the mark phase of mark-and-sweep garbage collection:
 * 1. Query all refs from DynamoDB (packages, workspaces, executions)
 * 2. Trace object graph by reading S3 objects and extracting hash references
 * 3. Write reachable set to S3 temp file for sweep phase
 *
 * The reachable set is stored in S3 rather than passed in Step Function payload
 * to avoid the 256KB payload limit.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoS3RepoStore, DynamoRefStore, S3ObjectStore } from '@elaraai/e3-aws-storage';

// Initialize AWS clients once at Lambda cold start
const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});

const BUCKET_NAME = process.env.BUCKET_NAME!;
const TABLE_NAME = process.env.TABLE_NAME!;

// Create stores for RepoStore
const refStore = new DynamoRefStore(dynamo, TABLE_NAME);
const objectStore = new S3ObjectStore(s3, dynamo, BUCKET_NAME, TABLE_NAME);
const repoStore = new DynamoS3RepoStore(s3, dynamo, BUCKET_NAME, TABLE_NAME, refStore, objectStore);

/**
 * Input for the GC mark phase handler.
 */
export interface GcMarkInput {
  /** Repository name */
  repo: string;
  /** Unique GC run identifier */
  gcId: string;
  /** Timestamp when GC started (for consistent minAge calculation) */
  startTime: number;
}

/**
 * Output from the GC mark phase handler.
 */
export interface GcMarkOutput {
  /** Repository name */
  repo: string;
  /** Unique GC run identifier */
  gcId: string;
  /** Timestamp when GC started */
  startTime: number;
  /** Number of reachable objects found */
  reachableCount: number;
  /** Number of root refs found */
  rootCount: number;
  /** S3 key where reachable set is stored */
  reachableSetKey: string;
}

/**
 * GC Mark phase handler.
 *
 * Collects all root hashes and traces the object graph to build the reachable set.
 * Uses the RepoStore interface for the mark operation.
 */
export const handler = async (input: GcMarkInput): Promise<GcMarkOutput> => {
  const { repo, gcId, startTime } = input;

  console.log(`Starting GC mark phase for repo: ${repo}, gcId: ${gcId}`);

  // Use RepoStore.gcMark() for the mark operation
  const result = await repoStore.gcMark(repo);

  console.log(`Found ${result.rootCount} roots, marked ${result.reachableCount} reachable objects`);
  console.log(`Wrote reachable set to s3://${BUCKET_NAME}/${result.reachableSetRef}`);

  return {
    repo,
    gcId,
    startTime,
    reachableCount: result.reachableCount,
    rootCount: result.rootCount,
    reachableSetKey: result.reachableSetRef,
  };
};
