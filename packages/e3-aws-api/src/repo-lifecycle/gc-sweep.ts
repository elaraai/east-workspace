/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * GC Sweep Phase Lambda Handler
 *
 * Implements the sweep phase of mark-and-sweep garbage collection:
 * 1. Load reachable set from S3 temp file (created by mark phase)
 * 2. Query object catalogue entries via RepoStore.gcScanObjects (paginated)
 * 3. Use e3-core sweepBatch to decide which objects to delete
 * 4. Delete unreachable catalogue entries via RepoStore.gcDeleteObjects
 *
 * This phase deletes catalogue entries only - orphaned S3 versions are cleaned up
 * by the cleanup phase.
 *
 * Designed to be called repeatedly by Step Functions until complete.
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getStorage } from '@elaraai/e3-aws-storage/init';
import { sweepBatch } from '@elaraai/e3-core';

const s3 = new S3Client({});
const BUCKET_NAME = process.env.BUCKET_NAME!;

const storage = getStorage();
const repoStore = storage.repos;

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
  /** Opaque DynamoDB pagination cursor for resuming catalogue query */
  catalogueCursor?: unknown;
  /** Accumulated stats from previous iterations */
  stats?: GcSweepStats;
  /** Minimum age in ms for catalogue entries to be deleted (default: 60000) */
  minAge?: number;
}

/**
 * Stats tracked during sweep phase.
 * Field names match the API contract (GcResult) since sweep catalogue entries
 * are the user-visible objects.
 */
export interface GcSweepStats {
  /** Number of objects deleted from catalogue */
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
  /** Opaque DynamoDB pagination cursor for next batch (if any) */
  catalogueCursor?: unknown;
  /** Accumulated stats */
  stats: GcSweepStats;
}

/**
 * Load the reachable set from S3.
 */
async function loadReachableSet(bucket: string, key: string): Promise<Set<string>> {
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );

  if (!response.Body) {
    return new Set();
  }

  const data = await response.Body.transformToString();
  const hashes = data.split('\n').filter((h: string) => h.length === 64);

  return new Set(hashes);
}

/**
 * GC Sweep phase handler.
 *
 * Scans object catalogue via RepoStore.gcScanObjects, uses e3-core sweepBatch
 * to decide which objects to delete, then deletes via RepoStore.gcDeleteObjects.
 */
export const handler = async (input: GcSweepInput): Promise<GcSweepOutput> => {
  const { repo, gcId, startTime, reachableSetKey } = input;
  const minAge = input.minAge ?? DEFAULT_MIN_AGE_MS;
  const catalogueCursor = input.catalogueCursor;

  // Initialize or continue stats
  const stats: GcSweepStats = input.stats ?? {
    deletedObjects: 0,
    retainedObjects: 0,
    skippedYoung: 0,
    bytesFreed: 0,
  };

  // Load reachable set from S3
  const reachable = await loadReachableSet(BUCKET_NAME, reachableSetKey);

  // Scan one batch of objects from catalogue
  const scanResult = await repoStore.gcScanObjects(repo, catalogueCursor);

  // Use e3-core sweepBatch to decide what to delete
  const result = sweepBatch(scanResult.objects, reachable, minAge);

  // Delete unreachable objects
  if (result.toDelete.length > 0) {
    await repoStore.gcDeleteObjects(repo, result.toDelete);
  }

  // Update stats
  stats.deletedObjects += result.toDelete.length;
  stats.retainedObjects += result.retained;
  stats.skippedYoung += result.skippedYoung;
  stats.bytesFreed += result.bytesFreed;

  if (scanResult.cursor !== undefined) {
    return {
      repo,
      gcId,
      startTime,
      reachableSetKey,
      status: 'continue',
      catalogueCursor: scanResult.cursor,
      stats,
    };
  }

  // Sweep complete
  return {
    repo,
    gcId,
    startTime,
    reachableSetKey,
    status: 'done',
    stats,
  };
};
