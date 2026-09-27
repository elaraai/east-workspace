/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Local filesystem implementation of locking.
 *
 * Provides exclusive and shared locks on a resource — a workspace, a
 * workspace's dataflow, the repository's tasks, or one dataset's ref — using
 * pure Node.js primitives, no external commands (works on Linux, macOS,
 * Windows).
 *
 * Each resource's locks are files in `locks/<resource>/`, each holding a
 * beast2 {@link LockState}:
 * - Exclusive: `exclusive.beast2`, created atomically with its content;
 * - Shared: one `shared.<pid>.<token>.beast2` per holder;
 * - Stale detection: the holder's process is gone (pid, start time and boot);
 * - Release: unlink the file, and the directory once it is empty.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { encodeBeast2For, decodeBeast2For, variant, none } from '@elaraai/east';
import { LockStateType, type LockHolderVariant, type LockState, type LockOperation } from '@elaraai/e3-types';
import { InvalidNameError, WorkspaceLockError, checkName, type LockHolderInfo } from '../../errors.js';
import { getBootId, getPidStartTime, isProcessAlive } from '../../execution/processHelpers.js';
import { atomicWriteFile, isTransientFsError } from './localHelpers.js';
import type { LockHandle, LockService } from '../interfaces.js';

/** Sleep helper for bounded filesystem-operation backoff. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Errno codes meaning the volume genuinely cannot hardlink (as opposed to a
 *  transient Windows sharing violation). Only these demote to the O_EXCL
 *  fallback immediately; a transient EPERM/EACCES/EBUSY is retried first. */
const HARDLINK_UNSUPPORTED = new Set(['ENOSYS', 'EXDEV', 'EMLINK', 'EOPNOTSUPP']);
const LINK_MAX_ATTEMPTS = 25;
const UNLINK_MAX_ATTEMPTS = 10;

/** How often a lock file is written again when a release removed its
 *  resource's directory in between: the window is a few instructions wide. */
const DIRECTORY_GONE_ATTEMPTS = 5;

/** The exclusive lock's file in its resource's directory. */
const EXCLUSIVE = 'exclusive.beast2';

const encodeLockState = encodeBeast2For(LockStateType);
const decodeLockState = decodeBeast2For(LockStateType);

/**
 * Unlink a lock file, retrying transient Windows sharing violations.
 *
 * A lock that ultimately resists deletion is left for stale-detection to
 * reclaim: a lingering lock only keeps OTHER acquirers out (fail-safe for the
 * no-lost-update invariant), so the final failure is swallowed rather than
 * thrown — but the bounded retry clears the common transient case promptly so a
 * just-released lock doesn't stall the next acquirer to the 30s timeout.
 */
async function unlinkWithRetry(targetPath: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.unlink(targetPath);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return; // already gone
      // Non-transient, or budget spent: give up (stale-detection will reclaim).
      if (!isTransientFsError(err) || attempt >= UNLINK_MAX_ATTEMPTS - 1) return;
      await sleep(Math.min(2 ** attempt, 100));
    }
  }
}

/** Removes a resource's directory once its last lock has gone; one still in
 *  use, or already gone, is left as it is. */
async function removeIfEmpty(dir: string): Promise<void> {
  try {
    await fs.rmdir(dir);
  } catch {
    // Not empty: another holder, or a lock being created.
  }
}

/**
 * Runs `write` into a resource's directory, making the directory first. A
 * release removes a directory once its last lock has gone, which can land
 * between the making and the write, or inside the making: a recursive `mkdir`
 * that finds the directory there checks it with a `stat`, and fails `ENOENT`
 * when the release lands between the two. Either way both are made again.
 */
async function writeInto<T>(dir: string, write: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.mkdir(dir, { recursive: true });
      return await write();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT' || attempt >= DIRECTORY_GONE_ATTEMPTS - 1) throw err;
    }
  }
}

// =============================================================================
// Types
// =============================================================================

/**
 * Handle to a held lock.
 * Call release() when done to free the lock.
 */
export interface WorkspaceLockHandle {
  readonly resource: string;
  readonly workspace: string;
  readonly lockPath: string;
  release(): Promise<void>;
}

/**
 * Options for acquiring a lock.
 */
export interface AcquireLockOptions {
  /** If true, wait for the lock to become available. Default: false */
  wait?: boolean;
  /** Timeout in milliseconds when wait=true. Default: 30000 */
  timeout?: number;
  /** Lock mode. Default: 'exclusive' */
  mode?: 'shared' | 'exclusive';
}

// =============================================================================
// Lock File Paths
// =============================================================================

/**
 * The directory a resource's locks are kept in: `locks/<resource>/`.
 *
 * @throws {InvalidNameError} When the resource cannot be one path segment
 */
function lockDir(repoPath: string, resource: string): string {
  checkName('lock', resource);
  return path.join(repoPath, 'locks', resource);
}

/** Path to the exclusive lock file for a resource. */
export function workspaceLockPath(repoPath: string, resource: string): string {
  return path.join(lockDir(repoPath, resource), EXCLUSIVE);
}

/** Whether a file of a resource's directory is a shared holder's. */
function isSharedLock(name: string): boolean {
  return name.startsWith('shared.') && name.endsWith('.beast2');
}

// =============================================================================
// Lock File I/O
// =============================================================================

async function readLockState(lockPath: string): Promise<LockState | null> {
  try {
    const data = await fs.readFile(lockPath);
    if (data.length === 0) return null;
    return decodeLockState(data);
  } catch {
    return null;
  }
}

/**
 * A lock's holder as an error names it.
 *
 * @param state - The lock's state
 * @returns The holder's details, flattened for a message
 */
export function lockStateToHolderInfo(state: LockState): LockHolderInfo {
  const info: LockHolderInfo = {
    acquiredAt: state.acquiredAt.toISOString(),
    operation: state.operation.type,
  };
  if (state.holder.type === 'process') {
    info.pid = Number(state.holder.value.pid);
    info.bootId = state.holder.value.bootId;
    info.startTime = Number(state.holder.value.startTime);
    info.command = state.holder.value.command;
  }
  return info;
}

// =============================================================================
// Stale Lock Detection
// =============================================================================

/**
 * Defense-in-depth grace before a present-but-empty/undecodable lock file is
 * reclaimed as stale.
 *
 * Every lock file is created *atomically with its content* — an exclusive lock
 * by a hard link, a shared one by a rename — so a held lock is never observed
 * empty and this branch does not fire for them. The grace still guards the
 * O_EXCL+write *fallback* used on filesystems without hardlink support, whose
 * file is empty until its write lands. Reclaiming such a file mid-creation
 * would admit a second holder — a silent lost update under the record
 * compare-and-swap in `writeIf`. The grace covers a create→write window
 * generously while staying far below the 30s lock-wait timeout, so a genuinely
 * crashed-mid-create remnant is still reclaimed promptly. Exported so tests can
 * pin the boundary without sleeping.
 */
export const EMPTY_LOCK_GRACE_MS = 1_000;

/**
 * Whether a lock's holder is still alive: a process that still runs, or a
 * cloud function, which its lease bounds instead.
 *
 * @param holder - The holder a lock's state names
 * @returns Whether the holder still holds the lock
 */
export async function isLockHolderAlive(holder: LockHolderVariant): Promise<boolean> {
  if (holder.type === 'process') {
    return isProcessAlive(Number(holder.value.pid), Number(holder.value.startTime), holder.value.bootId);
  }
  return true;
}

/** Delete a lock file if its holder process is no longer alive. */
async function cleanIfStale(lockPath: string): Promise<void> {
  const state = await readLockState(lockPath);
  if (!state) {
    // Present-but-empty/undecodable. Only the O_EXCL fallback leaves a lock
    // file empty, until its write lands, so it is reclaimed as a crashed
    // remnant only once it has sat unfilled past the grace.
    try {
      const st = await fs.stat(lockPath);
      if (Date.now() - st.mtimeMs < EMPTY_LOCK_GRACE_MS) return;
    } catch {
      return; // vanished already — nothing to clean
    }
    try { await fs.unlink(lockPath); } catch {}
    return;
  }
  if (!(await isLockHolderAlive(state.holder))) {
    try { await fs.unlink(lockPath); } catch {}
  }
}

/** Return paths of all live shared lock files for a resource, cleaning the
 *  stale ones. */
async function liveSharedLocks(repoPath: string, resource: string): Promise<string[]> {
  const dir = lockDir(repoPath, resource);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const shared = entries.filter(isSharedLock).map((name) => path.join(dir, name));
  await Promise.all(shared.map((file) => cleanIfStale(file)));
  const live: string[] = [];
  for (const file of shared) {
    try {
      await fs.access(file);
      live.push(file);
    } catch {
      // Cleaned as stale.
    }
  }
  return live;
}

/**
 * Removes the locks their holders left when they exited, of every resource
 * `owns` picks, and each resource's directory once it is empty. A lock a live
 * process holds is left for it to release.
 *
 * @param repoPath - Path to the e3 repository
 * @param owns - Whether a resource, by its name, is one to sweep
 */
export async function removeStaleLocks(repoPath: string, owns: (resource: string) => boolean): Promise<void> {
  const locksDir = path.join(repoPath, 'locks');
  let resources: string[];
  try {
    resources = await fs.readdir(locksDir);
  } catch {
    return; // No lock was ever taken
  }
  for (const resource of resources.filter(owns)) {
    const dir = path.join(locksDir, resource);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue; // Released meanwhile
    }
    await Promise.all(files.filter((file) => file === EXCLUSIVE || isSharedLock(file)).map((file) => cleanIfStale(path.join(dir, file))));
    await removeIfEmpty(dir);
  }
}

// =============================================================================
// Lock Acquisition
// =============================================================================

async function buildLockState(operation: LockOperation): Promise<LockState> {
  const pid = process.pid;
  return {
    operation,
    holder: variant('process', {
      pid: BigInt(pid),
      bootId: await getBootId(),
      startTime: BigInt(await getPidStartTime(pid)),
      command: process.argv.join(' '),
    }),
    acquiredAt: new Date(),
    expiresAt: none,
  };
}

/**
 * Create `lockPath` already containing `data`, atomically, failing if it exists.
 *
 * `fs.open(path, 'wx')` claims the name atomically but leaves the file empty until
 * a second `write` lands — a window in which a concurrent acquirer can observe the
 * lock empty and reclaim it (see {@link EMPTY_LOCK_GRACE_MS}), admitting two
 * holders and a lost update under the record CAS. Writing the bytes to a private
 * `.partial` and hard-linking it into place removes the window entirely: the lock
 * name, the instant it exists, already holds the bytes. `link` fails with `EEXIST`
 * if the name is taken, giving the same mutual exclusion as O_EXCL.
 *
 * Falls back to O_EXCL+write on filesystems without hardlink support (rare — some
 * network/FAT mounts); there {@link EMPTY_LOCK_GRACE_MS} is the safety net.
 *
 * @returns true if we created the lock; false if another holder already has it.
 */
async function atomicCreateLockFile(lockPath: string, data: Uint8Array): Promise<boolean> {
  const tmp = `${lockPath}.${process.pid}.${randomBytes(6).toString('hex')}.partial`;
  try {
    await writeInto(path.dirname(lockPath), () => fs.writeFile(tmp, data));
    // Prefer the atomic create-with-content (hardlink). A transient Windows
    // EPERM/EACCES/EBUSY is RETRIED rather than demoted to the racy O_EXCL+write
    // path: demoting on transient contention was exactly how that fallback
    // stayed reachable on NTFS. Only a genuine "no hardlinks" code — or an
    // EPERM/EACCES that PERSISTS past the budget (a truly hardlink-less volume
    // that reports EPERM) — falls back, and it falls back rather than throwing,
    // so availability on such volumes is preserved.
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.link(tmp, lockPath);
        return true;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') return false; // another holder already has it
        if (code !== undefined && HARDLINK_UNSUPPORTED.has(code)) break; // no hardlinks → fallback
        if (isTransientFsError(err) && attempt < LINK_MAX_ATTEMPTS - 1) {
          await sleep(Math.min(2 ** attempt, 100)); // transient contention → retry
          continue;
        }
        break; // persistent EPERM/EACCES or unexpected error → fall back, don't throw
      }
    }
    // O_EXCL + write fallback. The brief empty window is covered by
    // EMPTY_LOCK_GRACE_MS in cleanIfStale (and, on hardlink-less volumes, is the
    // only available create primitive).
    try {
      const fd = await fs.open(lockPath, 'wx');
      try { await fd.write(data); } finally { await fd.close(); }
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw err;
    }
  } finally {
    // The lock keeps the inode alive via its own hardlink; drop our temp name.
    await fs.unlink(tmp).catch(() => {});
  }
}

/** Try once to acquire an exclusive lock. Returns lock path or null. */
async function tryExclusiveOnce(repoPath: string, resource: string, operation: LockOperation): Promise<string | null> {
  const lockPath = workspaceLockPath(repoPath, resource);

  // Clean stale exclusive lock
  await cleanIfStale(lockPath);

  // Fail if any live shared locks exist
  if ((await liveSharedLocks(repoPath, resource)).length > 0) return null;

  // Atomic create-with-content — false (not us) if another holder beat us to it.
  if (!(await atomicCreateLockFile(lockPath, encodeLockState(await buildLockState(operation))))) return null;

  // A shared acquirer may have written its file after the check above and
  // looked for ours before it existed, and so holds the lock. Each side
  // checks for the other only after its own file exists, so at most one of
  // them finds nothing, and one that finds the other backs out.
  if ((await liveSharedLocks(repoPath, resource)).length > 0) {
    await unlinkWithRetry(lockPath);
    return null;
  }
  return lockPath;
}

/** Try once to acquire a shared lock. Returns lock path or null. */
async function trySharedOnce(repoPath: string, resource: string, operation: LockOperation): Promise<string | null> {
  const exclusivePath = workspaceLockPath(repoPath, resource);

  // Clean stale exclusive lock
  await cleanIfStale(exclusivePath);

  // Fail if a live exclusive lock exists
  const exclusiveState = await readLockState(exclusivePath);
  if (exclusiveState && (await isLockHolderAlive(exclusiveState.holder))) {
    return null;
  }

  // Create our shared lock file, whole the moment it exists
  const sharedPath = path.join(lockDir(repoPath, resource), `shared.${process.pid}.${randomBytes(4).toString('hex')}.beast2`);
  const data = encodeLockState(await buildLockState(operation));
  await writeInto(path.dirname(sharedPath), () => atomicWriteFile(sharedPath, data));

  // Re-check that no exclusive lock appeared between our check and our write
  const recheckState = await readLockState(exclusivePath);
  if (recheckState && (await isLockHolderAlive(recheckState.holder))) {
    try { await fs.unlink(sharedPath); } catch {}
    return null;
  }

  return sharedPath;
}

const POLL_INTERVAL_MS = 100;

/**
 * Acquire an exclusive or shared lock on a resource.
 *
 * Uses an atomic create-with-content (exclusive) or a per-holder file (shared),
 * in the resource's directory. Works on Linux, macOS, and Windows without
 * external commands.
 *
 * @throws {WorkspaceLockError} If the lock cannot be acquired
 * @throws {InvalidNameError} If the resource cannot be one path segment
 */
export async function acquireWorkspaceLock(
  repoPath: string,
  resource: string,
  operation: LockOperation,
  options: AcquireLockOptions = {}
): Promise<WorkspaceLockHandle> {
  const isShared = options.mode === 'shared';
  const deadline = Date.now() + (options.wait ? (options.timeout ?? 30000) : 0);

  const tryOnce = isShared
    ? () => trySharedOnce(repoPath, resource, operation)
    : () => tryExclusiveOnce(repoPath, resource, operation);

  let lockPath = await tryOnce();

  while (lockPath === null && Date.now() < deadline) {
    // Jitter the poll so a herd of losers released together don't re-stampede
    // the create in lock-step (which on Windows maximises sharing-violation churn).
    await sleep(POLL_INTERVAL_MS * (0.5 + Math.random()));
    lockPath = await tryOnce();
  }

  if (lockPath === null) {
    const existingState = await readLockState(workspaceLockPath(repoPath, resource));
    const holderInfo = existingState ? lockStateToHolderInfo(existingState) : undefined;
    throw new WorkspaceLockError(resource, holderInfo);
  }

  const held = lockPath;
  let released = false;
  return {
    resource,
    workspace: resource,
    lockPath: held,
    async release() {
      if (released) return;
      released = true;
      await unlinkWithRetry(held);
      await removeIfEmpty(path.dirname(held));
    },
  };
}

// =============================================================================
// Status Queries
// =============================================================================

/**
 * The state of a resource's exclusive lock, or `null` when none is held; a
 * stale one is cleaned.
 */
export async function getWorkspaceLockState(
  repoPath: string,
  resource: string
): Promise<LockState | null> {
  const lockPath = workspaceLockPath(repoPath, resource);
  const state = await readLockState(lockPath);
  if (!state) return null;
  if (!(await isLockHolderAlive(state.holder))) {
    try { await fs.unlink(lockPath); } catch {}
    return null;
  }
  return state;
}

/** The holder of a resource's exclusive lock, or `null` when none is held. */
export async function getWorkspaceLockHolder(
  repoPath: string,
  resource: string
): Promise<LockHolderInfo | null> {
  const state = await getWorkspaceLockState(repoPath, resource);
  return state ? lockStateToHolderInfo(state) : null;
}

// =============================================================================
// LockService Interface Implementation
// =============================================================================

export class LocalLockService implements LockService {
  async acquire(
    repo: string,
    resource: string,
    operation: LockOperation,
    options?: { wait?: boolean; timeout?: number; mode?: 'shared' | 'exclusive' }
  ): Promise<LockHandle | null> {
    try {
      const handle = await acquireWorkspaceLock(repo, resource, operation, {
        wait: options?.wait ?? false,
        timeout: options?.timeout,
        mode: options?.mode ?? 'exclusive',
      });
      return { resource, release: () => handle.release() };
    } catch (err) {
      // A name no path can hold is the caller's error, never a held lock.
      if (err instanceof InvalidNameError) throw err;
      return null;
    }
  }

  getState(repo: string, resource: string): Promise<LockState | null> {
    return getWorkspaceLockState(repo, resource);
  }

  isHolderAlive(holder: LockHolderVariant): Promise<boolean> {
    return isLockHolderAlive(holder);
  }
}
