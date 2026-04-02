/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * GC Cleanup Phase — Cloud-agnostic logic.
 *
 * Implements the cleanup phase of garbage collection:
 * 1. Clean up orphaned object versions via GcCleanupStore
 * 2. Delete temporary files created during GC via GcTempStore
 */

import type { GcCleanupStore } from '../gc-cleanup-store.js';
import type { GcTempStore } from '../gc-temp-store.js';

export interface GcCleanupDeps {
  cleanupStore: GcCleanupStore;
  tempStore: GcTempStore;
}

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
}

export interface GcCleanupStats {
  /** Number of temp files deleted */
  tempFilesDeleted: number;
}

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
  /** Whether cleanup is complete */
  status: 'done';
  /** Accumulated cleanup stats */
  cleanupStats: GcCleanupStats;
}

/**
 * GC Cleanup handler.
 *
 * Deletes orphaned cloud storage versions and temporary GC files.
 */
export async function handleGcCleanup(deps: GcCleanupDeps, input: GcCleanupInput): Promise<GcCleanupOutput> {
  const { repo, gcId, stats } = input;

  // Clean up orphaned versions via cloud-specific store
  await deps.cleanupStore.cleanupOrphanedVersions(repo);

  // Clean up temporary GC files
  const tempFilesDeleted = await deps.tempStore.cleanupTempFiles(gcId);

  return {
    repo,
    gcId,
    stats,
    status: 'done',
    cleanupStats: { tempFilesDeleted },
  };
}
