/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * GC Cleanup Lambda Handler
 *
 * Implements the cleanup phase of garbage collection:
 * 1. Scan S3 object versions in the {repo}/objects/ prefix
 * 2. For each version older than MIN_AGE (24 hours):
 *    - Check if it matches the currentVersion in the catalogue
 *    - If not, delete the orphaned version
 * 3. Delete temporary files created during GC (reachable set file)
 *
 * This phase runs after sweep, which deleted catalogue entries for unreachable
 * objects. Cleanup deletes the actual S3 versions that are no longer referenced.
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

/**
 * Input for the GC cleanup handler.
 */
export interface GcCleanupInput {
  /** Repository name */
  repo: string;
  /** Unique GC run identifier */
  gcId: string;
  /** Final stats from sweep phase */
  stats: {
    deletedEntries: number;
    retainedEntries: number;
    skippedYoung: number;
  };
  /** S3 version pagination cursor for resuming */
  versionCursor?: string;
  /** Phase of cleanup: 'versions' or 'temp' */
  phase?: 'versions' | 'temp';
  /** Accumulated cleanup stats */
  cleanupStats?: GcCleanupStats;
  /** Minimum age in ms for versions to be deleted (default: 24 hours) */
  minAge?: number;
}

/**
 * Stats tracked during cleanup phase.
 */
export interface GcCleanupStats {
  /** Number of S3 versions deleted */
  deletedVersions: number;
  /** Number of S3 versions retained (current) */
  retainedVersions: number;
  /** Number of S3 versions skipped (too young) */
  skippedYoung: number;
  /** Number of temp files deleted */
  tempFilesDeleted: number;
}

/**
 * Output from the GC cleanup handler.
 */
export interface GcCleanupOutput {
  /** Repository name */
  repo: string;
  /** Unique GC run identifier */
  gcId: string;
  /** Final stats from sweep phase */
  stats: {
    deletedEntries: number;
    retainedEntries: number;
    skippedYoung: number;
  };
  /** Whether to continue ('continue') or if cleanup is complete ('done') */
  status: 'continue' | 'done';
  /** S3 version pagination cursor for next batch */
  versionCursor?: string;
  /** Phase of cleanup */
  phase?: 'versions' | 'temp';
  /** Accumulated cleanup stats */
  cleanupStats: GcCleanupStats;
}

/**
 * GC Cleanup handler.
 *
 * Deletes orphaned S3 versions and temporary GC files.
 * Uses the RepoStore interface for the cleanup operation.
 */
export const handler = async (input: GcCleanupInput): Promise<GcCleanupOutput> => {
  const { repo, gcId, stats } = input;

  // Note: The cleanup phase may be called with continuation support from Step Functions,
  // but the current RepoStore.gcCleanup() runs to completion. For large repos this may
  // need to be extended in the future.

  // Initialize cleanup stats (continuation not currently supported)
  const cleanupStats: GcCleanupStats = input.cleanupStats ?? {
    deletedVersions: 0,
    retainedVersions: 0,
    skippedYoung: 0,
    tempFilesDeleted: 0,
  };

  console.log(`Starting GC cleanup for repo: ${repo}, gcId: ${gcId}`);

  // Build the reachable set key from gcId
  const reachableSetKey = `gc-temp/${gcId}/reachable.txt`;

  // Use RepoStore.gcCleanup() for the cleanup operation
  await repoStore.gcCleanup(repo, reachableSetKey);

  // Cleanup complete
  console.log(`GC cleanup complete for repo: ${repo}`);

  return {
    repo,
    gcId,
    stats,
    status: 'done',
    cleanupStats,
  };
};
