/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The local `RepoStore`'s gc sweep: what a local repository keeps beside its
 * objects and records, which gc's mark does not reach — the staging files of
 * writes and transfers that never finished, the scratch directories of
 * orchestrators that have exited, the built environments no kept object
 * names, the runs of a gc in steps that were given up, the unreachable notes
 * of objects already gone, and the places in the indexes of running attempts
 * and of each task's runs that a crash left.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { decodeExecutionStatus } from '@elaraai/e3-types';
import type { GcBackendSweepOptions, GcBackendSweepResult } from '../interfaces.js';
import {
  GC_ASIDE_SUFFIX, executionPath, gcDir, objectPath, restoreAside, runOf, runningAttemptOf, transferStagingDir,
} from './localHelpers.js';
import { isNotFoundError } from '../../errors.js';
import { isObjectHash } from '../../objects.js';
import { isUuidv7, uuidv7Timestamp } from '../../uuid.js';
import { sweepScratchDirs } from '../../execution/scratch.js';
import { sweepEnvironments } from '../../execution/environment.js';

/** How old a gc run in steps is before the sweep takes it for given up: a
 *  week, which no step of a run takes. */
const GIVEN_UP_GC_RUN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Sweeps a local repository of what gc's mark does not reach.
 *
 * @remarks
 * A staging file younger than `minAge` may be a write in flight, and is left.
 * A dry run counts the staging files, and removes nothing. What cannot be
 * removed is left for the next gc. An object a sweep beside running work moved
 * aside to delete, and did not, is put back, and a note whose object is gone
 * is dropped.
 *
 * Beside running work (`options.held` false), the built environments are
 * left: a running task may be using one no kept object names yet. So are the
 * places in the indexes of running attempts and of runs: an attempt being
 * written may be between its place and its record.
 *
 * @param repoPath - Path to the repository
 * @param reachable - The objects gc's mark reached
 * @param options - The age gate, whether this is a dry run, and whether gc
 *   holds the repository still
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
    ['', false], ['packages', true], ['workspaces', true], ['executions', true], ['running', true], ['runs', true],
    ['dataflows', true], ['adoptions', true], ['locks', true], ['gc', true],
  ] as const) {
    try {
      const result = await cleanupRefTreePartials(path.join(repoPath, refRoot), now, minAge, dryRun, walk);
      deletedPartials += result.deleted;
      skippedYoung += result.skippedYoung;
    } catch {
      // Not a fatal error
    }
  }

  // The scratch directories of executions whose orchestrator has exited, the
  // built environments the mark no longer reached and the places in the
  // indexes of running attempts and of runs a crash left, the gc runs in steps
  // given up, and the notes of objects already gone
  if (!dryRun) {
    try {
      await sweepScratchDirs(repoPath);
    } catch {
      // Not a fatal error
    }
    if (options.held) {
      try {
        await sweepEnvironments(repoPath, reachable);
      } catch {
        // Not a fatal error
      }
      try {
        await sweepStaleRunning(repoPath);
      } catch {
        // Not a fatal error
      }
      try {
        await sweepStaleRuns(repoPath);
      } catch {
        // Not a fatal error
      }
    }
    try {
      await sweepGivenUpRuns(repoPath);
    } catch {
      // Not a fatal error
    }
    try {
      await sweepOrphanNotes(repoPath);
    } catch {
      // Not a fatal error
    }
  }

  return { deletedPartials, skippedYoung };
}

/**
 * Drops the unreachable notes whose objects are gone: what a delete a crash
 * cut short between the object and its note leaves. The object scan passes
 * them over, so a dry run changes nothing, and dropping one only ever delays a
 * delete.
 */
async function sweepOrphanNotes(repoPath: string): Promise<void> {
  const notesDir = path.join(gcDir(repoPath), 'unreachable');
  for (const prefix of await fs.readdir(notesDir).catch(() => [] as string[])) {
    if (!/^[a-f0-9]{2}$/.test(prefix)) continue;
    for (const name of await fs.readdir(path.join(notesDir, prefix)).catch(() => [] as string[])) {
      const hash = prefix + name;
      if (!isObjectHash(hash)) continue;
      try {
        await fs.access(objectPath(repoPath, hash));
      } catch (err) {
        if (!isNotFoundError(err)) continue;
        await fs.unlink(path.join(notesDir, prefix, name)).catch(() => { /* cleared meanwhile */ });
      }
    }
  }
}

/**
 * Takes out of each task's index of running attempts the places at which no
 * attempt is recorded running — one whose record was never written, a crash
 * between its place and its `running` status, or says it ended, one between
 * its outcome and its place's removal — and then each task's directory left
 * empty.
 *
 * @remarks
 * Only while gc holds the repository still, when no attempt is between its
 * two writes. A place whose attempt's record does not decode is left: it may
 * be running. A read of the index passes over a stale place as it is, so
 * taking it out only spares that read.
 */
async function sweepStaleRunning(repoPath: string): Promise<void> {
  const root = path.join(repoPath, 'running');
  for (const taskHash of await fs.readdir(root).catch(() => [] as string[])) {
    if (!isObjectHash(taskHash)) continue;
    const taskDir = path.join(root, taskHash);
    for (const name of await fs.readdir(taskDir).catch(() => [] as string[])) {
      const attempt = runningAttemptOf(name);
      if (attempt === null) continue;
      const status = path.join(executionPath(repoPath, taskHash, attempt.inputsHash, attempt.executionId), 'status.beast2');
      let running: boolean;
      try {
        running = decodeExecutionStatus(await fs.readFile(status)).type === 'running';
      } catch (err) {
        if (!isNotFoundError(err)) continue;
        running = false;
      }
      if (!running) await fs.unlink(path.join(taskDir, name)).catch(() => { /* taken meanwhile */ });
    }
    await fs.rmdir(taskDir).catch(() => { /* an attempt runs, or a staging file is left */ });
  }
}

/**
 * Takes out of each task's index of runs the places whose run has no record —
 * a crash between its place and its first status, or a deletion cut short
 * between its record and its place — and then each task's directory left
 * empty.
 *
 * @remarks
 * Only while gc holds the repository still, when no run is between its two
 * writes. A read of the index passes over such a place as it is, so taking it
 * out only spares that read.
 */
async function sweepStaleRuns(repoPath: string): Promise<void> {
  const root = path.join(repoPath, 'runs');
  for (const taskHash of await fs.readdir(root).catch(() => [] as string[])) {
    if (!isObjectHash(taskHash)) continue;
    const taskDir = path.join(root, taskHash);
    for (const name of await fs.readdir(taskDir).catch(() => [] as string[])) {
      const run = runOf(name);
      if (run === null) continue;
      try {
        await fs.access(path.join(executionPath(repoPath, taskHash, run.inputsHash, run.executionId), 'status.beast2'));
      } catch (err) {
        if (!isNotFoundError(err)) continue;
        await fs.unlink(path.join(taskDir, name)).catch(() => { /* taken meanwhile */ });
      }
    }
    await fs.rmdir(taskDir).catch(() => { /* a run is left, or a staging file */ });
  }
}

/** Removes the gc runs in steps a week old: given up, since no run takes
 *  that long. */
async function sweepGivenUpRuns(repoPath: string): Promise<void> {
  const runsDir = path.join(gcDir(repoPath), 'runs');
  const now = Date.now();
  for (const run of await fs.readdir(runsDir).catch(() => [] as string[])) {
    if (!isUuidv7(run) || now - uuidv7Timestamp(run).getTime() < GIVEN_UP_GC_RUN_MS) continue;
    await fs.rm(path.join(runsDir, run), { recursive: true, force: true });
  }
}

/**
 * Clean up orphaned .partial staging files in the objects directory — both
 * the per-prefix stages of whole-object writes and the root-level
 * `stage.*.partial` files of streaming writes (which cannot stage under a
 * prefix: the content path is unknown until the digest names it) — and the
 * transfers staged in {@link transferStagingDir}, which a transfer that was
 * never finished leaves behind and nothing else removes.
 *
 * An object a sweep beside running work moved aside to delete is no staging
 * file: one a crash left aside is put back, since a touch may have answered
 * for it, and the next sweep deletes it again if it is still unreachable.
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

  // An object left aside past the age gate, by the time its name holds: a
  // delete in flight takes a moment, and puts back what it does not delete
  const putBack = async (dir: string, file: string): Promise<void> => {
    const end = file.indexOf('.beast2.');
    if (end < 0) return;
    const movedAt = Number(file.slice(end + '.beast2.'.length).split('.')[0]);
    if (dryRun || (minAge > 0 && now - movedAt < minAge)) return;
    try {
      await restoreAside(path.join(dir, file), path.join(dir, file.slice(0, end + '.beast2'.length)));
    } catch {
      // Left for the next gc
    }
  };

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
        if (file.endsWith(GC_ASIDE_SUFFIX)) {
          await putBack(subdirPath, file);
          continue;
        }
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
 * refs —, executions/, running/, dataflows/, adoptions/, locks/) and the
 * repository's root, which {@link cleanupPartials} does not cover. The age
 * gate ensures a live, in-flight staging file is never raced.
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
