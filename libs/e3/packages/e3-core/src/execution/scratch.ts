/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Scratch directories of local task executions (issue #770).
 *
 * An execution stages its inputs in a scratch directory, and its runner writes
 * the output there, once, in order (no runner spills anywhere). The directory
 * is named after the execution attempt and the orchestrator process that owns
 * it — `e3-exec-<task8>-<in8>-<pid>-<pidStartTime>-<executionId>` — and the
 * execution removes it when it finishes. An orchestrator that dies leaves its
 * directories behind; {@link sweepScratchDirs} removes them once that process
 * is gone.
 *
 * Scratch directories are created inside the repository, under
 * `<repo>/tmp/scratch`, or under `E3_SCRATCH_DIR` when it is set. Inside the
 * repository they are on the object store's filesystem, so an output that is
 * not a collection is stored by a link rather than a copy, and no output waits
 * in memory on a tmpfs temp directory. A collection output is read back and
 * written as segment objects, which is a copy: until the execution finishes,
 * the disk holds the output and its segments both.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { getPidStartTime } from './processHelpers.js';

/** The name prefix of every execution scratch directory. */
const SCRATCH_PREFIX = 'e3-exec-';

/**
 * The directory a repository's execution scratch directories are created
 * under: `E3_SCRATCH_DIR`, or `<repo>/tmp/scratch`.
 *
 * @param repo - Path to the e3 repository
 * @returns The scratch root
 */
export function scratchRoot(repo: string): string {
  return process.env.E3_SCRATCH_DIR ?? path.join(repo, 'tmp', 'scratch');
}

/**
 * The scratch directory for one execution attempt, owned by this process: its
 * name carries the execution's task and inputs hashes, this process's pid and
 * start time, and the attempt's id.
 *
 * @remarks
 * The attempt's id is what keeps two attempts at one execution apart when they
 * run at once in one process — two mutations of a record over the same state
 * with the same arguments, say. Its dashes are dropped, so the name keeps the
 * five fields {@link sweepScratchDirs} reads.
 *
 * @param repo - Path to the e3 repository
 * @param taskHash - Hash of the task object
 * @param inHash - Combined inputs hash
 * @param executionId - The attempt's execution id
 * @returns The directory's path (not yet created)
 */
export async function executionScratchDir(repo: string, taskHash: string, inHash: string, executionId: string): Promise<string> {
  const pidStartTime = await getPidStartTime(process.pid);
  return path.join(
    scratchRoot(repo),
    `${SCRATCH_PREFIX}${taskHash.slice(0, 8)}-${inHash.slice(0, 8)}-${process.pid}-${pidStartTime}-${executionId.replaceAll('-', '')}`
  );
}

/** Options for {@link sweepScratchDirs}. */
export interface SweepScratchOptions {
  /**
   * Minimum age in milliseconds of a directory named without its owner's
   * start time (the older `e3-exec-<task8>-<in8>-<pid>-<ms>` form) before it
   * is removed: with no start time, a reused pid cannot be told apart.
   */
  minAge: number;
}

/** Whether a process with `pid` exists — signal 0 sends nothing.
 *
 *  EPERM is an existence answer, not a denial of one: the process is there,
 *  it just is not ours to signal (another user's orchestrator, or a reused
 *  pid). Reading it as "gone" would delete a live execution's staged inputs
 *  and its output. A pid below 1 is no process — and POSIX would read 0 and
 *  -1 as this process group and every process. */
function processExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Removes the execution scratch directories whose orchestrator has exited.
 *
 * A directory's owner is gone when the pid in its name no longer has the
 * start time in its name. Where the platform reports no start time (Windows,
 * and any pid `/proc` cannot answer for), the pid's existence decides: a
 * directory is removed when its pid does not exist. A directory named in the
 * older form, without a start time, is removed when its pid does not exist
 * and the directory is older than `minAge`. Directories of live processes,
 * and anything else under the scratch root, are left alone.
 *
 * @param repo - Path to the e3 repository whose scratch root is swept
 * @param options - The age gate for directories named in the older form
 * @returns The number of directories removed
 */
export async function sweepScratchDirs(repo: string, options: SweepScratchOptions): Promise<number> {
  const root = scratchRoot(repo);
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return 0; // no scratch root yet
  }
  const now = Date.now();
  let removed = 0;
  for (const entry of entries) {
    if (!entry.startsWith(SCRATCH_PREFIX)) continue;
    const fields = entry.slice(SCRATCH_PREFIX.length).split('-');
    let ownerGone: boolean;
    const pid = Number(fields[2]);
    const startTime = await getPidStartTime(pid);
    if (fields.length === 5) {
      // <task8>-<in8>-<pid>-<pidStartTime>-<executionId>, or the creation
      // time in its place from an older e3. Both start times must be
      // known for the comparison to mean anything: the writer records 0 where
      // its own platform could not answer, and comparing that against a start
      // time this sweeper CAN resolve says "gone" about a live owner. With
      // either unknown, existence decides, as it does for the older form.
      const recorded = Number(fields[3]);
      ownerGone = startTime !== 0 && recorded !== 0
        ? startTime !== recorded
        : !processExists(pid);
    } else if (fields.length === 4) {
      // <task8>-<in8>-<pid>-<ms>: with no start time, a reused pid cannot be
      // told apart, so the directory must also be old.
      ownerGone = startTime === 0 && !processExists(pid) && now - Number(fields[3]) > options.minAge;
    } else {
      continue;
    }
    if (!ownerGone) continue;
    try {
      await fs.rm(path.join(root, entry), { recursive: true, force: true });
      removed++;
    } catch {
      // Left for the next sweep
    }
  }
  return removed;
}
