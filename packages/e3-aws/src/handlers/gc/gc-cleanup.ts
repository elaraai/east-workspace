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

import { getStorage } from '../../storage/init.js';
import type { DynamoS3RepoStore } from '../../storage/index.js';

const storage = getStorage();
// GC cleanup requires cloud-specific methods (cleanupOrphanedVersions, cleanupTempFiles)
const repoStore = storage.repos as DynamoS3RepoStore;

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
    deletedObjects: number;
    retainedObjects: number;
    skippedYoung: number;
    bytesFreed: number;
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
    deletedObjects: number;
    retainedObjects: number;
    skippedYoung: number;
    bytesFreed: number;
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
 * Calls cloud-specific methods on DynamoS3RepoStore directly.
 */
export const handler = async (input: GcCleanupInput): Promise<GcCleanupOutput> => {
  const { repo, gcId, stats } = input;

  // Initialize cleanup stats
  const cleanupStats: GcCleanupStats = input.cleanupStats ?? {
    deletedVersions: 0,
    retainedVersions: 0,
    skippedYoung: 0,
    tempFilesDeleted: 0,
  };

  // Call cloud-specific cleanup methods directly
  await repoStore.cleanupOrphanedVersions(repo);
  await repoStore.cleanupTempFiles(gcId);

  return {
    repo,
    gcId,
    stats,
    status: 'done',
    cleanupStats,
  };
};
