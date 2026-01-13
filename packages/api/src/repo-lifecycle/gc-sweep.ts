/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * GC Sweep Phase Lambda Handler
 *
 * Implements the sweep phase of mark-and-sweep garbage collection:
 * 1. Load reachable set from S3 temp file (created by mark phase)
 * 2. List S3 objects with pagination
 * 3. Delete unreachable objects (respecting minAge and startTime)
 * 4. Self-terminate before timeout and return cursor for continuation
 *
 * Designed to be called repeatedly by Step Functions until complete.
 */

import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

// Initialize AWS clients once at Lambda cold start
const s3 = new S3Client({});

const BUCKET_NAME = process.env.BUCKET_NAME!;

// Time limit: quit at 13 minutes to leave buffer before 15 min Lambda timeout
const TIME_LIMIT_MS = 13 * 60 * 1000;

// Default minimum age for objects to be considered for deletion (60 seconds)
const DEFAULT_MIN_AGE_MS = 60 * 1000;

// Batch size for S3 list and delete operations
const LIST_BATCH_SIZE = 1000;

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
  /** S3 continuation token for resuming list operation */
  s3Cursor?: string;
  /** Accumulated stats from previous iterations */
  stats?: GcSweepStats;
  /** Minimum age in ms for objects to be deleted (default: 60000) */
  minAge?: number;
}

/**
 * Stats tracked during sweep phase.
 */
export interface GcSweepStats {
  /** Number of objects deleted */
  deletedObjects: number;
  /** Number of objects retained (reachable) */
  retainedObjects: number;
  /** Number of objects skipped due to being too young */
  skippedYoung: number;
  /** Total bytes freed */
  bytesFreed: number;
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
  /** S3 continuation token for next batch (if any) */
  s3Cursor?: string;
  /** Accumulated stats */
  stats: GcSweepStats;
}

/**
 * GC Sweep phase handler.
 *
 * Deletes unreachable objects from S3, respecting minAge to avoid race conditions.
 */
export const handler = async (input: GcSweepInput): Promise<GcSweepOutput> => {
  const { repo, gcId, startTime, reachableSetKey } = input;
  const minAge = input.minAge ?? DEFAULT_MIN_AGE_MS;
  const sweepStartTime = Date.now();
  let s3Cursor = input.s3Cursor;

  // Initialize or continue stats
  const stats: GcSweepStats = input.stats ?? {
    deletedObjects: 0,
    retainedObjects: 0,
    skippedYoung: 0,
    bytesFreed: 0,
  };

  console.log(`Starting GC sweep phase for repo: ${repo}, gcId: ${gcId}`, {
    hasCursor: !!s3Cursor,
    currentStats: stats,
  });

  // Load reachable set from S3 (only on first iteration or if not cached)
  const reachable = await loadReachableSet(reachableSetKey);
  console.log(`Loaded ${reachable.size} reachable hashes`);

  // Calculate cutoff time: objects created after this time are skipped
  const cutoffTime = startTime - minAge;

  // Sweep S3 objects
  const prefix = `${repo}/objects/`;

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
        s3Cursor,
        stats,
      };
    }

    // List objects
    const listResponse = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: prefix,
        MaxKeys: LIST_BATCH_SIZE,
        ContinuationToken: s3Cursor,
      })
    );

    if (!listResponse.Contents || listResponse.Contents.length === 0) {
      // No more objects
      break;
    }

    // Collect objects to delete
    const toDelete: { Key: string }[] = [];

    for (const obj of listResponse.Contents) {
      if (!obj.Key) continue;

      // Extract hash from key: {repo}/objects/{hash}
      const hash = obj.Key.slice(prefix.length);
      if (!hash || !/^[a-f0-9]{64}$/.test(hash)) {
        // Not a valid object hash (might be a directory marker or other file)
        continue;
      }

      // Check if object is reachable
      if (reachable.has(hash)) {
        stats.retainedObjects++;
        continue;
      }

      // Check if object is too young (created after cutoffTime)
      if (obj.LastModified && obj.LastModified.getTime() > cutoffTime) {
        stats.skippedYoung++;
        continue;
      }

      // Object is unreachable and old enough - mark for deletion
      toDelete.push({ Key: obj.Key });
      stats.bytesFreed += obj.Size ?? 0;
    }

    // Batch delete unreachable objects
    if (toDelete.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET_NAME,
          Delete: {
            Objects: toDelete,
            Quiet: true,
          },
        })
      );
      stats.deletedObjects += toDelete.length;
      console.log(`Deleted ${toDelete.length} objects in this batch`);
    }

    // Check for more objects
    if (listResponse.IsTruncated && listResponse.NextContinuationToken) {
      s3Cursor = listResponse.NextContinuationToken;
    } else {
      // No more objects
      s3Cursor = undefined;
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
