/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * GC Mark Phase — Cloud-agnostic logic.
 *
 * Implements the mark phase of mark-and-sweep garbage collection:
 * 1. Collect all root hashes via RepoStore gcScan*Roots primitives
 * 2. Trace object graph using BEAST2 schema-aware traversal (e3-core)
 * 3. Write reachable set to temp storage for sweep phase
 */

import { collectAllRoots, markReachable, type RepoStore } from '@elaraai/e3-core';
import type { GcTempStore } from '../gc-temp-store.js';

export interface GcMarkDeps {
  repoStore: RepoStore;
  objectStore: { read(repo: string, hash: string): Promise<Uint8Array | null> };
  tempStore: GcTempStore;
}

export interface GcMarkInput {
  /** Repository name */
  repo: string;
  /** Unique GC run identifier */
  gcId: string;
  /** Timestamp when GC started (for consistent minAge calculation) */
  startTime: number;
}

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
  /** Opaque key where reachable set is stored */
  reachableSetKey: string;
}

/**
 * GC Mark phase handler.
 *
 * Collects all root hashes via RepoStore gcScan*Roots primitives, then
 * traces the object graph using e3-core's BEAST2-aware markReachable.
 */
export async function handleGcMark(deps: GcMarkDeps, input: GcMarkInput): Promise<GcMarkOutput> {
  const { repo, gcId, startTime } = input;

  // Step 1: Collect all root hashes via e3-core
  const roots = await collectAllRoots(deps.repoStore, repo);

  // Step 2: Trace object graph using BEAST2 schema-aware traversal
  const readObject = async (hash: string): Promise<Uint8Array | null> => {
    try {
      return await deps.objectStore.read(repo, hash);
    } catch {
      return null;
    }
  };
  const reachable = await markReachable(readObject, roots);

  // Step 3: Write reachable set to temp storage
  const reachableSetKey = await deps.tempStore.writeReachableSet(gcId, reachable);

  return {
    repo,
    gcId,
    startTime,
    reachableCount: reachable.size,
    rootCount: roots.size,
    reachableSetKey,
  };
}
