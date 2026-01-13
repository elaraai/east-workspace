/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Delete Batch Lambda Handler
 *
 * Incrementally deletes S3 objects and DynamoDB items for a repository.
 * Designed to be called repeatedly by a Step Function until complete.
 *
 * Contract:
 * - Input: { repo, s3Cursor?, dynamoCursor?, startTime? }
 * - Output: { status: 'continue' | 'done', s3Cursor?, dynamoCursor?, s3Deleted, dynamoDeleted }
 *
 * The handler self-terminates before the Lambda timeout to allow graceful
 * continuation via Step Functions retry.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3ObjectStore, DynamoRefStore } from '@elaraai/e3-storage';

// Initialize AWS clients once at Lambda cold start
const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});

const objectStore = new S3ObjectStore(s3, process.env.BUCKET_NAME!);
const refStore = new DynamoRefStore(dynamo, process.env.TABLE_NAME!);

/**
 * Input for the delete batch handler.
 */
export interface DeleteBatchInput {
  /** Repository name to delete */
  repo: string;
  /** S3 continuation token from previous batch */
  s3Cursor?: string;
  /** DynamoDB pagination cursor from previous batch */
  dynamoCursor?: string;
  /** Timestamp when deletion started (for time tracking) */
  startTime?: number;
}

/**
 * Output from the delete batch handler.
 */
export interface DeleteBatchOutput {
  /** Whether to continue ('continue') or if deletion is complete ('done') */
  status: 'continue' | 'done';
  /** S3 continuation token for next batch (if any) */
  s3Cursor?: string;
  /** DynamoDB pagination cursor for next batch (if any) */
  dynamoCursor?: string;
  /** Number of S3 objects deleted in this batch */
  s3Deleted: number;
  /** Number of DynamoDB items deleted in this batch */
  dynamoDeleted: number;
}

// Time limit: quit at 13 minutes to leave buffer before 15 min Lambda timeout
const TIME_LIMIT_MS = 13 * 60 * 1000;

/**
 * Delete batch handler for Step Functions.
 *
 * Deletes S3 objects and DynamoDB items in batches, self-terminating
 * before Lambda timeout to allow continuation.
 */
export const handler = async (input: DeleteBatchInput): Promise<DeleteBatchOutput> => {
  const { repo } = input;
  const startTime = input.startTime ?? Date.now();
  let s3Cursor = input.s3Cursor;
  let dynamoCursor = input.dynamoCursor;
  let s3Deleted = 0;
  let dynamoDeleted = 0;

  console.log(`Starting delete batch for repo: ${repo}`, {
    hasS3Cursor: !!s3Cursor,
    hasDynamoCursor: !!dynamoCursor,
  });

  // Phase 1: Delete S3 objects (if not already done)
  while (s3Cursor !== null) {
    // Check time limit
    if (Date.now() - startTime > TIME_LIMIT_MS) {
      console.log('Time limit reached during S3 deletion, continuing...');
      return {
        status: 'continue',
        s3Cursor: s3Cursor ?? undefined,
        dynamoCursor,
        s3Deleted,
        dynamoDeleted,
      };
    }

    const result = await objectStore.deleteRepoBatch(repo, s3Cursor, 1000);
    s3Deleted += result.deleted;

    if (!result.cursor) {
      // S3 deletion complete
      s3Cursor = null as any; // Mark as done
      console.log(`S3 deletion complete, deleted ${s3Deleted} objects`);
      break;
    }

    s3Cursor = result.cursor;
  }

  // Phase 2: Delete DynamoDB items (excluding #META which is deleted last by state machine)
  while (dynamoCursor !== null) {
    // Check time limit
    if (Date.now() - startTime > TIME_LIMIT_MS) {
      console.log('Time limit reached during DynamoDB deletion, continuing...');
      return {
        status: 'continue',
        s3Cursor: undefined, // S3 is done
        dynamoCursor: dynamoCursor ?? undefined,
        s3Deleted,
        dynamoDeleted,
      };
    }

    const result = await refStore.deleteRepoBatch(repo, dynamoCursor, 100);
    dynamoDeleted += result.deleted;

    if (!result.cursor) {
      // DynamoDB deletion complete
      dynamoCursor = null as any; // Mark as done
      console.log(`DynamoDB deletion complete, deleted ${dynamoDeleted} items`);
      break;
    }

    dynamoCursor = result.cursor;
  }

  // Both phases complete
  console.log(`Delete batch complete for repo: ${repo}`, {
    s3Deleted,
    dynamoDeleted,
  });

  return {
    status: 'done',
    s3Deleted,
    dynamoDeleted,
  };
};
