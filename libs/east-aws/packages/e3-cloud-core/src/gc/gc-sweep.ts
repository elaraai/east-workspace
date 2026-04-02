/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * GC Sweep Phase — Cloud-agnostic logic.
 *
 * Implements the sweep phase of mark-and-sweep garbage collection:
 * 1. Load reachable set from temp storage (created by mark phase)
 * 2. Query object catalogue entries via RepoStore.gcScanObjects (paginated)
 * 3. Use e3-core sweepBatch to decide which objects to delete
 * 4. Delete unreachable catalogue entries via RepoStore.gcDeleteObjects
 *
 * Designed to be called repeatedly by Step Functions until complete.
 */

import { sweepBatch, type RepoStore } from '@elaraai/e3-core';
import type { GcTempStore } from '../gc-temp-store.js';

export interface GcSweepDeps {
  repoStore: RepoStore;
  tempStore: GcTempStore;
}

export interface GcSweepInput {
  /** Repository name */
  repo: string;
  /** Unique GC run identifier */
  gcId: string;
  /** Timestamp when GC started (for consistent minAge calculation) */
  startTime: number;
  /** Opaque key where reachable set is stored */
  reachableSetKey: string;
  /** Opaque pagination cursor for resuming catalogue query */
  catalogueCursor?: unknown;
  /** Accumulated stats from previous iterations */
  stats?: GcSweepStats;
  /** Minimum age in ms for catalogue entries to be deleted (default: 60000) */
  minAge?: number;
}

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

export interface GcSweepOutput {
  /** Repository name */
  repo: string;
  /** Unique GC run identifier */
  gcId: string;
  /** Timestamp when GC started */
  startTime: number;
  /** Opaque key where reachable set is stored */
  reachableSetKey: string;
  /** Whether to continue ('continue') or if sweep is complete ('done') */
  status: 'continue' | 'done';
  /** Opaque pagination cursor for next batch (if any) */
  catalogueCursor?: unknown;
  /** Accumulated stats */
  stats: GcSweepStats;
}

// Default minimum age for catalogue entries to be considered for deletion (60 seconds)
const DEFAULT_MIN_AGE_MS = 60 * 1000;

/**
 * GC Sweep phase handler.
 *
 * Scans object catalogue via RepoStore.gcScanObjects, uses e3-core sweepBatch
 * to decide which objects to delete, then deletes via RepoStore.gcDeleteObjects.
 */
export async function handleGcSweep(deps: GcSweepDeps, input: GcSweepInput): Promise<GcSweepOutput> {
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

  // Load reachable set from temp storage
  const reachable = await deps.tempStore.readReachableSet(reachableSetKey);

  // Scan one batch of objects from catalogue
  const scanResult = await deps.repoStore.gcScanObjects(repo, catalogueCursor);

  // Use e3-core sweepBatch to decide what to delete
  const result = sweepBatch(scanResult.objects, reachable, minAge);

  // Delete unreachable objects
  if (result.toDelete.length > 0) {
    await deps.repoStore.gcDeleteObjects(repo, result.toDelete);
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
}
