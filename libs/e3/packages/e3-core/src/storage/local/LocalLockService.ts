/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Local filesystem implementation of workspace locking.
 *
 * Provides exclusive and shared locks on workspaces using pure Node.js
 * primitives — no external commands required (works on Linux, macOS, Windows).
 *
 * Lock mechanism:
 * - Exclusive: atomic O_CREAT|O_EXCL file creation (`fs.open('wx')`)
 * - Shared: per-holder slock files (`{workspace}.{pid}.{token}.slock`)
 * - Stale detection: process.kill(pid, 0) with /proc fallback for precise detection
 * - Release: unlink the lock file
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { encodeBeast2For, decodeBeast2For, printFor, parseInferred, variant, none, VariantType } from '@elaraai/east';
import { LockStateType, ProcessHolderType, type LockState, type LockOperation } from '@elaraai/e3-types';
import { WorkspaceLockError, type LockHolderInfo } from '../../errors.js';
import { getBootId, getPidStartTime, isProcessAlive } from '../../execution/processHelpers.js';
import type { LockHandle, LockService } from '../interfaces.js';

// =============================================================================
// Holder Encoding
// =============================================================================

const HolderVariantType = VariantType({
  process: ProcessHolderType,
});

const printProcessHolder = printFor(HolderVariantType);

function parseHolder(holderStr: string): { type: string; value: any } | null {
  try {
    const [_type, value] = parseInferred(holderStr);
    return value as { type: string; value: any };
  } catch {
    return null;
  }
}

// =============================================================================
// Types
// =============================================================================

/**
 * Handle to a held workspace lock.
 * Call release() when done to free the lock.
 */
export interface WorkspaceLockHandle {
  readonly resource: string;
  readonly workspace: string;
  readonly lockPath: string;
  release(): Promise<void>;
}

/**
 * Options for acquiring a workspace lock.
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

/** Path to the exclusive lock file for a workspace. */
export function workspaceLockPath(repoPath: string, workspace: string): string {
  return path.join(repoPath, 'workspaces', `${workspace}.lock`);
}

/** Directory containing lock files for a workspace. */
function workspaceLockDir(repoPath: string, _workspace: string): string {
  return path.join(repoPath, 'workspaces');
}

/** Path to a shared lock file for a specific holder. */
function sharedLockPath(repoPath: string, workspace: string, pid: number, token: string): string {
  return path.join(repoPath, 'workspaces', `${workspace}.${pid}.${token}.slock`);
}

/** Glob prefix used to find all shared lock files for a workspace. */
function sharedLockPrefix(workspace: string): string {
  return `${workspace}.`;
}

// =============================================================================
// Lock File I/O
// =============================================================================

async function readLockState(lockPath: string): Promise<LockState | null> {
  try {
    const data = await fs.readFile(lockPath);
    if (data.length === 0) return null;
    const decoder = decodeBeast2For(LockStateType);
    return decoder(data);
  } catch {
    return null;
  }
}

async function writeLockState(lockPath: string, state: LockState): Promise<void> {
  const encoder = encodeBeast2For(LockStateType);
  await fs.writeFile(lockPath, encoder(state));
}

export function lockStateToHolderInfo(state: LockState): LockHolderInfo {
  const info: LockHolderInfo = {
    acquiredAt: state.acquiredAt.toISOString(),
    operation: state.operation.type,
  };
  const holder = parseHolder(state.holder);
  if (holder?.type === 'process') {
    info.pid = Number(holder.value.pid);
    info.bootId = holder.value.bootId;
    info.startTime = Number(holder.value.startTime);
    info.command = holder.value.command;
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
 * Exclusive locks are created *atomically with their content* (see
 * {@link atomicCreateLockFile}), so a held exclusive lock is never observed empty
 * and this branch does not fire for them. The grace still guards two residual
 * sources of a transiently-empty lock file: the O_EXCL+write *fallback* used on
 * filesystems without hardlink support, and shared `.slock` files (written
 * non-atomically). Reclaiming such a file mid-creation would admit a second holder
 * — a silent lost update under the record compare-and-swap in `writeIf`. The grace
 * covers a create→write window generously while staying far below the 30s
 * lock-wait timeout, so a genuinely crashed-mid-create remnant is still reclaimed
 * promptly. Exported so tests can pin the boundary without sleeping.
 */
export const EMPTY_LOCK_GRACE_MS = 1_000;

export async function isLockHolderAlive(holderStr: string): Promise<boolean> {
  const holder = parseHolder(holderStr);
  if (!holder) return true; // Can't parse — assume alive

  if (holder.type === 'process') {
    return isProcessAlive(
      Number(holder.value.pid),
      Number(holder.value.startTime),
      holder.value.bootId
    );
  }

  return true; // Unknown type — assume alive
}

/** Delete a lock file if its holder process is no longer alive. */
async function cleanIfStale(lockPath: string): Promise<void> {
  const state = await readLockState(lockPath);
  if (!state) {
    // Present-but-empty/undecodable. Exclusive locks are created atomically with
    // content (atomicCreateLockFile), so this is not a live exclusive holder; but
    // the O_EXCL fallback path and non-atomic .slock writes can momentarily leave a
    // file empty. Reclaiming one mid-creation would admit a second holder, so only
    // treat it as a crashed remnant once it has sat unfilled past the grace.
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

/** Find and clean all stale shared lock files for a workspace. */
async function cleanStaleSharedLocks(repoPath: string, workspace: string): Promise<void> {
  const dir = workspaceLockDir(repoPath, workspace);
  const prefix = sharedLockPrefix(workspace);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }
  const slocks = entries.filter(e => e.startsWith(prefix) && e.endsWith('.slock'));
  await Promise.all(slocks.map(e => cleanIfStale(path.join(dir, e))));
}

/** Return paths of all live shared lock files for a workspace. */
async function liveSharedLocks(repoPath: string, workspace: string): Promise<string[]> {
  await cleanStaleSharedLocks(repoPath, workspace);
  const dir = workspaceLockDir(repoPath, workspace);
  const prefix = sharedLockPrefix(workspace);
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter(e => e.startsWith(prefix) && e.endsWith('.slock'))
      .map(e => path.join(dir, e));
  } catch {
    return [];
  }
}

// =============================================================================
// Lock Acquisition
// =============================================================================

async function buildLockState(operation: LockOperation): Promise<{ state: LockState; holder: string }> {
  const pid = process.pid;
  const bootId = await getBootId();
  const startTime = await getPidStartTime(pid);
  const holderVariant = variant('process', {
    pid: BigInt(pid),
    bootId,
    startTime: BigInt(startTime),
    command: process.argv.join(' '),
  });
  const holder = printProcessHolder(holderVariant);
  const state: LockState = {
    operation,
    holder,
    acquiredAt: new Date(),
    expiresAt: none,
  };
  return { state, holder };
}

/**
 * Create `lockPath` already containing `data`, atomically, failing if it exists.
 *
 * `fs.open(path, 'wx')` claims the name atomically but leaves the file empty until
 * a second `write` lands — a window in which a concurrent acquirer can observe the
 * lock empty and reclaim it (see {@link EMPTY_LOCK_GRACE_MS}), admitting two
 * holders and a lost update under the record CAS. Writing the bytes to a private
 * temp and hard-linking it into place removes the window entirely: the lock name,
 * the instant it exists, already holds the bytes. `link` fails with `EEXIST` if the
 * name is taken, giving the same mutual exclusion as O_EXCL.
 *
 * Falls back to O_EXCL+write on filesystems without hardlink support (rare — some
 * network/FAT mounts); there {@link EMPTY_LOCK_GRACE_MS} is the safety net.
 *
 * @returns true if we created the lock; false if another holder already has it.
 */
async function atomicCreateLockFile(lockPath: string, data: Uint8Array): Promise<boolean> {
  const tmp = `${lockPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, data);
    try {
      await fs.link(tmp, lockPath);
      return true;
    } catch (err: any) {
      if (err.code === 'EEXIST') return false;
      // Hardlinks unsupported on this filesystem — fall back to O_EXCL + write.
      if (err.code === 'EPERM' || err.code === 'ENOSYS' || err.code === 'EXDEV'
          || err.code === 'EMLINK' || err.code === 'EOPNOTSUPP') {
        try {
          const fd = await fs.open(lockPath, 'wx');
          try { await fd.write(data); } finally { await fd.close(); }
          return true;
        } catch (err2: any) {
          if (err2.code === 'EEXIST') return false;
          throw err2;
        }
      }
      throw err;
    }
  } finally {
    // The lock keeps the inode alive via its own hardlink; drop our temp name.
    await fs.unlink(tmp).catch(() => {});
  }
}

/** Try once to acquire an exclusive lock. Returns lock path or null. */
async function tryExclusiveOnce(repoPath: string, workspace: string, operation: LockOperation): Promise<string | null> {
  const lockPath = workspaceLockPath(repoPath, workspace);

  // Clean stale exclusive lock
  await cleanIfStale(lockPath);

  // Fail if any live shared locks exist
  const shared = await liveSharedLocks(repoPath, workspace);
  if (shared.length > 0) return null;

  // Atomic create-with-content — false (not us) if another holder beat us to it.
  const { state } = await buildLockState(operation);
  const encoder = encodeBeast2For(LockStateType);
  const created = await atomicCreateLockFile(lockPath, encoder(state));
  return created ? lockPath : null;
}

/** Try once to acquire a shared lock. Returns lock path or null. */
async function trySharedOnce(repoPath: string, workspace: string, operation: LockOperation): Promise<string | null> {
  const exclusivePath = workspaceLockPath(repoPath, workspace);

  // Clean stale exclusive lock
  await cleanIfStale(exclusivePath);

  // Fail if a live exclusive lock exists
  const exclusiveState = await readLockState(exclusivePath);
  if (exclusiveState && (await isLockHolderAlive(exclusiveState.holder))) {
    return null;
  }

  // Create our shared lock file
  const token = randomBytes(4).toString('hex');
  const sPath = sharedLockPath(repoPath, workspace, process.pid, token);
  const { state } = await buildLockState(operation);
  await writeLockState(sPath, state);

  // Re-check that no exclusive lock appeared between our check and our write
  const recheckState = await readLockState(exclusivePath);
  if (recheckState && (await isLockHolderAlive(recheckState.holder))) {
    try { await fs.unlink(sPath); } catch {}
    return null;
  }

  return sPath;
}

const POLL_INTERVAL_MS = 100;

/**
 * Acquire an exclusive or shared lock on a workspace.
 *
 * Uses atomic O_CREAT|O_EXCL file creation (exclusive) or per-holder slock
 * files (shared). Works on Linux, macOS, and Windows without external commands.
 *
 * @throws {WorkspaceLockError} If the lock cannot be acquired
 */
export async function acquireWorkspaceLock(
  repoPath: string,
  workspace: string,
  operation: LockOperation,
  options: AcquireLockOptions = {}
): Promise<WorkspaceLockHandle> {
  await fs.mkdir(path.join(repoPath, 'workspaces'), { recursive: true });

  const isShared = options.mode === 'shared';
  const deadline = Date.now() + (options.wait ? (options.timeout ?? 30000) : 0);

  const tryOnce = isShared
    ? () => trySharedOnce(repoPath, workspace, operation)
    : () => tryExclusiveOnce(repoPath, workspace, operation);

  let lockPath = await tryOnce();

  while (lockPath === null && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    lockPath = await tryOnce();
  }

  if (lockPath === null) {
    const exclusivePath = workspaceLockPath(repoPath, workspace);
    const existingState = await readLockState(exclusivePath);
    const holderInfo = existingState ? lockStateToHolderInfo(existingState) : undefined;
    throw new WorkspaceLockError(workspace, holderInfo);
  }

  let released = false;
  return {
    resource: workspace,
    workspace,
    lockPath,
    async release() {
      if (released) return;
      released = true;
      try { await fs.unlink(lockPath); } catch {}
    },
  };
}

// =============================================================================
// Status Queries
// =============================================================================

export async function getWorkspaceLockState(
  repoPath: string,
  workspace: string
): Promise<LockState | null> {
  const lockPath = workspaceLockPath(repoPath, workspace);
  const state = await readLockState(lockPath);
  if (!state) return null;
  if (!(await isLockHolderAlive(state.holder))) {
    try { await fs.unlink(lockPath); } catch {}
    return null;
  }
  return state;
}

export async function getWorkspaceLockHolder(
  repoPath: string,
  workspace: string
): Promise<LockHolderInfo | null> {
  const state = await getWorkspaceLockState(repoPath, workspace);
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
    } catch {
      return null;
    }
  }

  getState(repo: string, resource: string): Promise<LockState | null> {
    return getWorkspaceLockState(repo, resource);
  }

  isHolderAlive(holder: string): Promise<boolean> {
    return isLockHolderAlive(holder);
  }
}
