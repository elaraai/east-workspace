/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Scratch directories of local task executions (issue #770) and calls.
 *
 * An execution stages its inputs in a scratch directory, and its runner writes
 * the output there, once, in order (no runner spills anywhere). The directory
 * is named after the execution attempt and the orchestrator process that owns
 * it — `e3-exec-<task8>-<in8>-<pid>-<pidStartTime>-<executionId>` — and the
 * execution removes it when it finishes. A function or one-shot call a local
 * runner runs does the same in `e3-call-<pid>-<pidStartTime>-<callId>`. A
 * process that dies leaves its directories behind; {@link sweepScratchDirs}
 * removes them once that process is gone.
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

/** The name prefix of every call scratch directory. */
const CALL_SCRATCH_PREFIX = 'e3-call-';

/**
 * The directory a repository's execution and call scratch directories are
 * created under: `E3_SCRATCH_DIR`, or `<repo>/tmp/scratch`.
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

/**
 * The scratch directory for one call — a function or one-shot call a local
 * runner runs — owned by this process: its name carries this process's pid and
 * start time, and the call's id.
 *
 * @param repo - Path to the e3 repository
 * @param callId - The call's id, unique to it, with no dashes
 * @returns The directory's path (not yet created)
 */
export async function callScratchDir(repo: string, callId: string): Promise<string> {
  const pidStartTime = await getPidStartTime(process.pid);
  return path.join(scratchRoot(repo), `${CALL_SCRATCH_PREFIX}${process.pid}-${pidStartTime}-${callId}`);
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
 * Removes the execution and call scratch directories whose owner has exited.
 *
 * A directory's owner is gone when the pid in its name no longer has the
 * start time in its name. Where the platform reports no start time (Windows,
 * and any pid `/proc` cannot answer for), the pid's existence decides: a
 * directory is removed when its pid does not exist. Directories of live
 * processes, and anything else under the scratch root, are left alone.
 *
 * @param repo - Path to the e3 repository whose scratch root is swept
 * @returns The number of directories removed
 */
export async function sweepScratchDirs(repo: string): Promise<number> {
  const root = scratchRoot(repo);
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return 0; // no scratch root yet
  }
  let removed = 0;
  for (const entry of entries) {
    // The owner's pid and start time, from the name's fields.
    let owner: string[];
    if (entry.startsWith(SCRATCH_PREFIX)) {
      // <task8>-<in8>-<pid>-<pidStartTime>-<executionId>
      const fields = entry.slice(SCRATCH_PREFIX.length).split('-');
      if (fields.length !== 5) continue;
      owner = fields.slice(2, 4);
    } else if (entry.startsWith(CALL_SCRATCH_PREFIX)) {
      // <pid>-<pidStartTime>-<callId>
      const fields = entry.slice(CALL_SCRATCH_PREFIX.length).split('-');
      if (fields.length !== 3) continue;
      owner = fields.slice(0, 2);
    } else {
      continue;
    }
    const pid = Number(owner[0]);
    const startTime = await getPidStartTime(pid);
    // Both start times must be known for the comparison to mean anything: the
    // writer records 0 where its own platform could not answer, and comparing
    // that against a start time this sweeper CAN resolve says "gone" about a
    // live owner. With either unknown, existence decides.
    const recorded = Number(owner[1]);
    const ownerGone = startTime !== 0 && recorded !== 0 ? startTime !== recorded : !processExists(pid);
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
