/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * GC Sweep Phase Lambda Handler
 *
 * Implements the sweep phase of mark-and-sweep garbage collection:
 * 1. Load reachable set from S3 temp file (created by mark phase)
 * 2. Query object catalogue entries with pagination
 * 3. Delete unreachable catalogue entries (respecting lastReferencedAt for race protection)
 * 4. Self-terminate before timeout and return cursor for continuation
 *
 * This phase deletes catalogue entries only - orphaned S3 versions are cleaned up
 * by the cleanup phase.
 *
 * Designed to be called repeatedly by Step Functions until complete.
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import {
  DynamoDBClient,
  QueryCommand,
  BatchWriteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

// Initialize AWS clients once at Lambda cold start
const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});

const BUCKET_NAME = process.env.BUCKET_NAME!;
const TABLE_NAME = process.env.TABLE_NAME!;

// Time limit: quit at 13 minutes to leave buffer before 15 min Lambda timeout
const TIME_LIMIT_MS = 13 * 60 * 1000;

// Default minimum age for catalogue entries to be considered for deletion (60 seconds)
// This protects against race conditions where an object is written during GC
const DEFAULT_MIN_AGE_MS = 60 * 1000;

// Batch sizes for DynamoDB operations
const QUERY_BATCH_SIZE = 1000;
const DELETE_BATCH_SIZE = 25; // BatchWriteItem limit

/**
 * Input for the GC sweep phase handler.
 */
export interface GcSweepInput {
  /** Repository name */
  repo: string;
  /** Unique GC run identifier */
  gcId: string;
  /** Timestamp when GC started (for consistent minAge calculation) */
  startTime: number;
  /** S3 key where reachable set is stored */
  reachableSetKey: string;
  /** DynamoDB pagination cursor for resuming catalogue query */
  catalogueCursor?: string;
  /** Accumulated stats from previous iterations */
  stats?: GcSweepStats;
  /** Minimum age in ms for catalogue entries to be deleted (default: 60000) */
  minAge?: number;
}

/**
 * Stats tracked during sweep phase.
 */
export interface GcSweepStats {
  /** Number of catalogue entries deleted */
  deletedEntries: number;
  /** Number of catalogue entries retained (reachable) */
  retainedEntries: number;
  /** Number of catalogue entries skipped due to being too young */
  skippedYoung: number;
}

/**
 * Output from the GC sweep phase handler.
 */
export interface GcSweepOutput {
  /** Repository name */
  repo: string;
  /** Unique GC run identifier */
  gcId: string;
  /** Timestamp when GC started */
  startTime: number;
  /** S3 key where reachable set is stored */
  reachableSetKey: string;
  /** Whether to continue ('continue') or if sweep is complete ('done') */
  status: 'continue' | 'done';
  /** DynamoDB pagination cursor for next batch (if any) */
  catalogueCursor?: string;
  /** Accumulated stats */
  stats: GcSweepStats;
}

/**
 * GC Sweep phase handler.
 *
 * Deletes unreachable catalogue entries from DynamoDB, respecting lastReferencedAt
 * to avoid race conditions with concurrent writes.
 */
export const handler = async (input: GcSweepInput): Promise<GcSweepOutput> => {
  const { repo, gcId, startTime, reachableSetKey } = input;
  const minAge = input.minAge ?? DEFAULT_MIN_AGE_MS;
  const sweepStartTime = Date.now();
  let catalogueCursor = input.catalogueCursor;

  // Initialize or continue stats
  const stats: GcSweepStats = input.stats ?? {
    deletedEntries: 0,
    retainedEntries: 0,
    skippedYoung: 0,
  };

  console.log(`Starting GC sweep phase for repo: ${repo}, gcId: ${gcId}`, {
    hasCursor: !!catalogueCursor,
    currentStats: stats,
  });

  // Load reachable set from S3 (only on first iteration or if not cached)
  const reachable = await loadReachableSet(reachableSetKey);
  console.log(`Loaded ${reachable.size} reachable hashes`);

  // Calculate cutoff time: catalogue entries updated after this time are skipped
  const cutoffTime = new Date(startTime - minAge).toISOString();

  // Query and process catalogue entries
  while (true) {
    // Check time limit
    if (Date.now() - sweepStartTime > TIME_LIMIT_MS) {
      console.log('Time limit reached during sweep, continuing...');
      return {
        repo,
        gcId,
        startTime,
        reachableSetKey,
        status: 'continue',
        catalogueCursor,
        stats,
      };
    }

    // Query catalogue entries
    let exclusiveStartKey: Record<string, any> | undefined;
    if (catalogueCursor) {
      exclusiveStartKey = JSON.parse(catalogueCursor);
    }

    const queryResponse = await dynamo.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: marshall({ ':pk': `OBJ/${repo}` }),
        ProjectionExpression: 'PK, SK, lastReferencedAt',
        ExclusiveStartKey: exclusiveStartKey,
        Limit: QUERY_BATCH_SIZE,
        ConsistentRead: true,
      })
    );

    if (!queryResponse.Items || queryResponse.Items.length === 0) {
      // No more entries
      break;
    }

    // Collect entries to delete
    const toDelete: { PK: string; SK: string }[] = [];

    for (const item of queryResponse.Items) {
      const unmarshalled = unmarshall(item);
      const hash = unmarshalled.SK as string;
      const lastReferencedAt = unmarshalled.lastReferencedAt as string;

      // Check if hash is reachable
      if (reachable.has(hash)) {
        stats.retainedEntries++;
        continue;
      }

      // Check if entry was updated after cutoff (race protection)
      if (lastReferencedAt && lastReferencedAt > cutoffTime) {
        stats.skippedYoung++;
        continue;
      }

      // Entry is unreachable and old enough - mark for deletion
      toDelete.push({
        PK: unmarshalled.PK as string,
        SK: hash,
      });
    }

    // Batch delete unreachable entries
    if (toDelete.length > 0) {
      await batchDeleteCatalogueEntries(toDelete);
      stats.deletedEntries += toDelete.length;
      console.log(`Deleted ${toDelete.length} catalogue entries in this batch`);
    }

    // Check for more entries
    if (queryResponse.LastEvaluatedKey) {
      catalogueCursor = JSON.stringify(queryResponse.LastEvaluatedKey);
    } else {
      // No more entries
      catalogueCursor = undefined;
      break;
    }
  }

  // Sweep complete
  console.log(`GC sweep complete for repo: ${repo}`, stats);

  return {
    repo,
    gcId,
    startTime,
    reachableSetKey,
    status: 'done',
    stats,
  };
};

/**
 * Load the reachable set from S3.
 */
async function loadReachableSet(key: string): Promise<Set<string>> {
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    })
  );

  if (!response.Body) {
    return new Set();
  }

  const data = await response.Body.transformToString();
  const hashes = data.split('\n').filter((h) => h.length === 64);

  return new Set(hashes);
}

/**
 * Batch delete catalogue entries from DynamoDB.
 */
async function batchDeleteCatalogueEntries(
  entries: Array<{ PK: string; SK: string }>
): Promise<void> {
  for (let i = 0; i < entries.length; i += DELETE_BATCH_SIZE) {
    const batch = entries.slice(i, i + DELETE_BATCH_SIZE);

    await dynamo.send(
      new BatchWriteItemCommand({
        RequestItems: {
          [TABLE_NAME]: batch.map((entry) => ({
            DeleteRequest: {
              Key: marshall({ PK: entry.PK, SK: entry.SK }),
            },
          })),
        },
      })
    );
  }
}
