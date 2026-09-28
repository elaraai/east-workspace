/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The local `RepoStore`'s gc sweep: what a local repository keeps beside its
 * objects and records, which gc's mark does not reach — the staging files of
 * writes and transfers that never finished, the scratch directories of
 * orchestrators that have exited, and the built environments no kept object
 * names.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { GcBackendSweepOptions, GcBackendSweepResult } from '../interfaces.js';
import { transferStagingDir } from './localHelpers.js';
import { sweepScratchDirs } from '../../execution/scratch.js';
import { sweepEnvironments } from '../../execution/environment.js';

/**
 * Sweeps a local repository of what gc's mark does not reach.
 *
 * @remarks
 * A staging file younger than `minAge` may be a write in flight, and is left.
 * A dry run counts the staging files, and removes nothing. What cannot be
 * removed is left for the next gc.
 *
 * @param repoPath - Path to the repository
 * @param reachable - The objects gc's mark reached
 * @param options - The age gate, and whether this is a dry run
 * @returns The staging files removed, and those left as too young
 */
export async function sweepLocalRepository(
  repoPath: string,
  reachable: ReadonlySet<string>,
  options: GcBackendSweepOptions,
): Promise<GcBackendSweepResult> {
  const { minAge, dryRun } = options;
  let deletedPartials = 0;
  let skippedYoung = 0;

  // The staging files of object writes, and the transfers staged in the
  // repository
  try {
    const result = await cleanupPartials(repoPath, minAge, dryRun);
    deletedPartials += result.deleted;
    skippedYoung += result.skippedYoung;
  } catch {
    // Not a fatal error
  }

  // The staging files atomicWriteFile leaves in the record trees —
  // cleanupPartials above only covers objects/ and the staged transfers — and
  // beside the repository's own record, at the root. The root holds the trees
  // and what the other steps sweep, so it is swept without being walked.
  const now = Date.now();
  for (const [refRoot, walk] of [
    ['', false], ['packages', true], ['workspaces', true], ['executions', true],
    ['dataflows', true], ['adoptions', true], ['locks', true],
  ] as const) {
    try {
      const result = await cleanupRefTreePartials(path.join(repoPath, refRoot), now, minAge, dryRun, walk);
      deletedPartials += result.deleted;
      skippedYoung += result.skippedYoung;
    } catch {
      // Not a fatal error
    }
  }

  // The scratch directories of executions whose orchestrator has exited, and
  // the built environments the mark no longer reached
  if (!dryRun) {
    try {
      await sweepScratchDirs(repoPath);
    } catch {
      // Not a fatal error
    }
    try {
      await sweepEnvironments(repoPath, reachable);
    } catch {
      // Not a fatal error
    }
  }

  return { deletedPartials, skippedYoung };
}

/**
 * Clean up orphaned .partial staging files in the objects directory — both
 * the per-prefix stages of whole-object writes and the root-level
 * `stage.*.partial` files of streaming writes (which cannot stage under a
 * prefix: the content path is unknown until the digest names it) — and the
 * transfers staged in {@link transferStagingDir}, which a transfer that was
 * never finished leaves behind and nothing else removes.
 */
async function cleanupPartials(
  repoPath: string,
  minAge: number,
  dryRun: boolean
): Promise<{ deleted: number; skippedYoung: number }> {
  const objectsDir = path.join(repoPath, 'objects');
  const now = Date.now();
  let deleted = 0;
  let skippedYoung = 0;

  const sweep = async (filePath: string): Promise<void> => {
    try {
      const fileStat = await fs.stat(filePath);
      const age = now - fileStat.mtimeMs;
      if (minAge > 0 && age < minAge) {
        skippedYoung++;
        return;
      }
      if (!dryRun) {
        await fs.unlink(filePath);
      }
      deleted++;
    } catch {
      // Skip files we can't stat or delete
    }
  };

  try {
    const entries = await fs.readdir(objectsDir);
    for (const entry of entries) {
      if (entry.endsWith('.partial')) {
        await sweep(path.join(objectsDir, entry));
        continue;
      }
      if (!/^[a-f0-9]{2}$/.test(entry)) continue;
      const subdirPath = path.join(objectsDir, entry);
      try {
        const stat = await fs.stat(subdirPath);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }

      const files = await fs.readdir(subdirPath);
      for (const file of files) {
        if (!file.endsWith('.partial')) continue;
        await sweep(path.join(subdirPath, file));
      }
    }
  } catch {
    // Objects directory doesn't exist
  }

  // Transfers staged under the repository. An in-flight upload is young, so
  // the same age gate keeps gc from racing it.
  const stagingDir = transferStagingDir(repoPath);
  let staged: string[] = [];
  try {
    staged = await fs.readdir(stagingDir);
  } catch {
    // No upload has been staged in this repository (ENOENT) — nothing to sweep
  }
  for (const entry of staged) {
    if (entry.endsWith('.partial')) {
      await sweep(path.join(stagingDir, entry));
    }
  }

  return { deleted, skippedYoung };
}

/**
 * Unlink aged `.partial` staging files in a directory, and in every directory
 * beneath it when it is walked.
 *
 * `atomicWriteFile` stages bytes in a sibling `<dest>.<rand>.partial` file
 * before renaming it over the destination; that staging file survives only if a
 * writer crashed between the write and the rename. This sweeps those orphans
 * from the record trees (packages/, workspaces/ — including nested dataset
 * refs —, executions/, dataflows/, adoptions/, locks/) and the repository's
 * root, which {@link cleanupPartials} does not cover. The age gate ensures a
 * live, in-flight staging file is never raced.
 *
 * @param rootDir - The directory to sweep
 * @param now - Reference timestamp for the age gate
 * @param minAge - Minimum age (ms) before a staging file is eligible for removal
 * @param dryRun - When true, count but do not delete
 * @param walk - Whether the directories beneath it are swept too
 * @returns Counts of deleted and too-young-to-delete staging files
 */
async function cleanupRefTreePartials(
  rootDir: string,
  now: number,
  minAge: number,
  dryRun: boolean,
  walk: boolean
): Promise<{ deleted: number; skippedYoung: number }> {
  let deleted = 0;
  let skippedYoung = 0;

  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => null);
  if (!entries) return { deleted, skippedYoung }; // Root directory doesn't exist

  for (const entry of entries) {
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (!walk) continue;
      const sub = await cleanupRefTreePartials(full, now, minAge, dryRun, walk);
      deleted += sub.deleted;
      skippedYoung += sub.skippedYoung;
    } else if (entry.name.endsWith('.partial')) {
      try {
        const fileStat = await fs.stat(full);
        if (minAge > 0 && now - fileStat.mtimeMs < minAge) {
          skippedYoung++;
          continue;
        }
        if (!dryRun) {
          await fs.unlink(full);
        }
        deleted++;
      } catch {
        // Skip files we can't stat or delete
      }
    }
  }

  return { deleted, skippedYoung };
}
