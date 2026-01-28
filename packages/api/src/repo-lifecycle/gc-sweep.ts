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

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoS3RepoStore, DynamoRefStore, S3ObjectStore } from '@elaraai/e3-storage';

// Initialize AWS clients once at Lambda cold start
const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});

const BUCKET_NAME = process.env.BUCKET_NAME!;
const TABLE_NAME = process.env.TABLE_NAME!;

// Create stores for RepoStore
const refStore = new DynamoRefStore(dynamo, TABLE_NAME);
const objectStore = new S3ObjectStore(s3, dynamo, BUCKET_NAME, TABLE_NAME);
const repoStore = new DynamoS3RepoStore(s3, dynamo, BUCKET_NAME, TABLE_NAME, refStore, objectStore);

// Default minimum age for catalogue entries to be considered for deletion (60 seconds)
// This protects against race conditions where an object is written during GC
const DEFAULT_MIN_AGE_MS = 60 * 1000;

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
 * Uses the RepoStore interface for the sweep operation.
 */
export const handler = async (input: GcSweepInput): Promise<GcSweepOutput> => {
  const { repo, gcId, startTime, reachableSetKey } = input;
  const minAge = input.minAge ?? DEFAULT_MIN_AGE_MS;
  const catalogueCursor = input.catalogueCursor;

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

  // Use RepoStore.gcSweep() for the sweep operation
  const result = await repoStore.gcSweep(repo, reachableSetKey, {
    minAge,
    cursor: catalogueCursor,
  });

  // Update stats with this batch's results
  stats.deletedEntries += result.deleted;
  stats.skippedYoung += result.skippedYoung;
  // Note: retainedEntries is tracked in stats but not returned by RepoStore.gcSweep

  if (result.status === 'continue') {
    console.log(`Sweep batch complete, continuing...`, {
      deletedThisBatch: result.deleted,
      skippedYoung: result.skippedYoung,
    });
    return {
      repo,
      gcId,
      startTime,
      reachableSetKey,
      status: 'continue',
      catalogueCursor: result.cursor,
      stats,
    };
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
