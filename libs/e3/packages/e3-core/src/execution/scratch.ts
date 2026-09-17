/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Scratch directories of local task executions (issue #770).
 *
 * An execution stages its inputs in a scratch directory, and its runner writes
 * the output there, spill runs included. The directory is named after the
 * execution and the orchestrator process that owns it —
 * `e3-exec-<task8>-<in8>-<pid>-<pidStartTime>-<ms>` — and the execution
 * removes it when it finishes. An orchestrator that dies leaves its
 * directories behind; {@link sweepScratchDirs} removes them once that process
 * is gone.
 *
 * Scratch directories are created under `E3_SCRATCH_DIR`, or the system temp
 * directory when it is unset. A temp directory on tmpfs keeps spill runs in
 * memory, so large outputs want `E3_SCRATCH_DIR` on a disk.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';
import { getPidStartTime } from './processHelpers.js';

/** The name prefix of every execution scratch directory. */
const SCRATCH_PREFIX = 'e3-exec-';

/**
 * The directory execution scratch directories are created under:
 * `E3_SCRATCH_DIR`, or the system temp directory.
 *
 * @returns The scratch root
 */
export function scratchRoot(): string {
  return process.env.E3_SCRATCH_DIR ?? tmpdir();
}

/**
 * The scratch directory for one execution, owned by this process: its name
 * carries the execution's task and inputs hashes, this process's pid and start
 * time, and the creation time.
 *
 * @param taskHash - Hash of the task object
 * @param inHash - Combined inputs hash
 * @returns The directory's path (not yet created)
 */
export async function executionScratchDir(taskHash: string, inHash: string): Promise<string> {
  const pidStartTime = await getPidStartTime(process.pid);
  return path.join(
    scratchRoot(),
    `${SCRATCH_PREFIX}${taskHash.slice(0, 8)}-${inHash.slice(0, 8)}-${process.pid}-${pidStartTime}-${Date.now()}`
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

/**
 * Removes the execution scratch directories whose orchestrator has exited.
 *
 * A directory's owner is gone when the pid in its name no longer has the
 * start time in its name. A directory named in the older form, without a start
 * time, is removed when its pid does not exist and the directory is older than
 * `minAge`. Directories of live processes, and anything else under the scratch
 * root, are left alone.
 *
 * @param options - The age gate for directories named in the older form
 * @returns The number of directories removed
 */
export async function sweepScratchDirs(options: SweepScratchOptions): Promise<number> {
  const root = scratchRoot();
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
    if (fields.length === 5) {
      // <task8>-<in8>-<pid>-<pidStartTime>-<ms>
      ownerGone = await getPidStartTime(Number(fields[2])) !== Number(fields[3]);
    } else if (fields.length === 4) {
      // <task8>-<in8>-<pid>-<ms>
      ownerGone = await getPidStartTime(Number(fields[2])) === 0 && now - Number(fields[3]) > options.minAge;
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
