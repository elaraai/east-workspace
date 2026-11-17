/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A deploy's intent: the lock a deploy of a workspace announces itself by,
 * and what every other taker of the workspace's lock reads of it.
 *
 * A deploy takes a workspace exclusively, and the work that shares a workspace
 * — a run, a record write, a dataset write — holds it shared, some of it for
 * as long as people keep editing. So a deploy first takes the workspace's
 * intent, a lock of its own: a run in flight reads it and stops, and no new
 * shared taker starts while it is held, so the deploy gets the workspace once
 * what held it has let go. It goes through the lock service alone, so it
 * holds on any backend, across processes and machines.
 */

import { variant } from '@elaraai/east';
import type { LockOperation } from '@elaraai/e3-types';
import { WorkspaceLockError, lockStateToHolderInfo } from './errors.js';
import type { LockHandle, StorageBackend } from './storage/interfaces.js';

/** How long a deploy waits, for its intent and then for the workspace's lock,
 *  before it is refused: a run in flight stops within about a second of the
 *  intent, and a write in progress finishes. */
export const DEPLOY_WAIT_MS = 30_000;

/** How often a run in flight asks whether a deploy of its workspace has
 *  announced itself, in milliseconds: it stops within about this long of the
 *  deploy's intent. */
export const DEPLOY_PROBE_MS = 1_000;

/**
 * The lock a deploy of a workspace announces itself by.
 *
 * @param ws - Workspace name
 * @returns The lock's name, which no workspace's can be: a lock's name may
 *   hold the `#` a workspace's may not
 */
export function deployIntentLock(ws: string): string {
  return `${ws}#deploy`;
}

/**
 * Whether a deploy of the workspace has announced itself: it holds the
 * workspace's intent, and waits for the workspace or holds it.
 *
 * @remarks
 * What a run in flight asks once a second, and every shared taker of the
 * workspace's lock before it takes it. It reads the intent's state, and where
 * that shows no holder writes nothing: on a lock service whose locks are
 * writes to a store, a probe that took the lock and let it go would be two
 * writes each time. Where the state shows a holder it asks for the intent
 * shared, without waiting, so the holder is judged as the lock service judges
 * every holder, and one that died is cleaned as any is.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @returns Whether a deploy holds the workspace's intent
 */
export async function deployAnnounced(storage: StorageBackend, repo: string, ws: string): Promise<boolean> {
  const intent = deployIntentLock(ws);
  if (await storage.locks.getState(repo, intent) === null) return false;
  const probe = await storage.locks.acquire(repo, intent, variant('dataflow', null), { mode: 'shared' });
  if (probe === null) return true;
  await probe.release();
  return false;
}

/**
 * The refusal of a workspace's lock: it names the deploy that has announced
 * itself, when one has, and otherwise what holds the workspace exclusively.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @returns The error a caller refused the workspace's lock throws
 */
export async function workspaceLockRefusal(storage: StorageBackend, repo: string, ws: string): Promise<WorkspaceLockError> {
  const state = await storage.locks.getState(repo, deployIntentLock(ws)) ?? await storage.locks.getState(repo, ws);
  return new WorkspaceLockError(ws, state ? lockStateToHolderInfo(state) : undefined);
}

/**
 * Takes a workspace's lock shared, unless a deploy has announced itself.
 *
 * @remarks
 * Every shared taker of a workspace's lock takes it through here: a run's
 * start and its resume, a record's write and a function's call, a dataset's
 * write, a bundle's export and a copy's source. Shared holders never exclude
 * one another, so without it a workspace people keep writing to would never
 * fall free for a deploy that waits. One that took the lock just before the
 * deploy announced itself finishes, and the deploy waits for it.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param operation - What takes the lock
 * @returns The lock's handle, or null when a deploy has announced itself or
 *   something holds the workspace exclusively, which
 *   {@link workspaceLockRefusal} names
 * @throws {InvalidNameError} When the workspace's name is one no lock can be
 *   keyed by
 */
export async function acquireWorkspaceShared(
  storage: StorageBackend,
  repo: string,
  ws: string,
  operation: LockOperation,
): Promise<LockHandle | null> {
  if (await deployAnnounced(storage, repo, ws)) return null;
  return storage.locks.acquire(repo, ws, operation, { mode: 'shared' });
}

/**
 * Takes a workspace for a deploy: its intent first, which stops a run in
 * flight and holds every new shared taker off, then its lock, exclusively.
 *
 * @remarks
 * A deploy takes its lock through here whoever holds it for the deploy: a
 * host that hands a deploy a lock of its own — one that runs a deploy over
 * several calls, and holds the workspace from the first to the last — takes
 * that lock here too, or its deploy would wait behind a run that never ends.
 *
 * The handle is the workspace lock's: what its holder reports is read as the
 * workspace's progress, as a deploy's is. Its release lets the workspace go,
 * then the intent, which goes whatever becomes of the workspace's lock.
 *
 * The lock is a deploy's, and is never handed to a run. A run started under
 * it (a start's `lock`) reads the intent as every run does, and stops itself
 * within a second, saying a deploy started: a host that deploys and then runs
 * lets this lock go first, and starts its run as any run is started.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param options - `waitMs`: how long the deploy waits in all, for the intent
 *   and then for the workspace ({@link DEPLOY_WAIT_MS} when omitted)
 * @returns One handle over the workspace's lock and its intent
 * @throws {WorkspaceLockError} When another deploy holds the intent for the
 *   whole wait, or the workspace is still held once it is over; it names the
 *   holder
 * @throws {InvalidNameError} When the workspace's name is one no lock can be
 *   keyed by
 *
 * @example
 * ```ts
 * // A deploy job that runs over several calls holds the workspace across them
 * const lock = await acquireForDeploy(storage, repo, 'production');
 * try {
 *   await workspaceDeploy(storage, repo, 'production', 'orders', '2.0.0', { lock });
 * } finally {
 *   await lock.release();
 * }
 * ```
 */
export async function acquireForDeploy(
  storage: StorageBackend,
  repo: string,
  ws: string,
  options: { waitMs?: number } = {},
): Promise<LockHandle> {
  const deadline = Date.now() + (options.waitMs ?? DEPLOY_WAIT_MS);
  // A wait of nothing left is a single try
  const wait = (): { wait?: boolean; timeout?: number } => {
    const left = deadline - Date.now();
    return left > 0 ? { wait: true, timeout: left } : {};
  };
  const operation = variant('deployment', null);
  const intent = await storage.locks.acquire(repo, deployIntentLock(ws), operation, wait());
  if (intent === null) throw await workspaceLockRefusal(storage, repo, ws);
  let lock: LockHandle | null;
  try {
    lock = await storage.locks.acquire(repo, ws, operation, wait());
  } catch (err) {
    await intent.release();
    throw err;
  }
  if (lock === null) {
    await intent.release();
    throw await workspaceLockRefusal(storage, repo, ws);
  }
  const held = lock;
  return {
    resource: held.resource,
    report: (progress) => held.report(progress),
    async release() {
      // The intent goes whatever becomes of the workspace's lock: one left
      // held would refuse every write and run start of the workspace for as
      // long as this process lives
      try {
        await held.release();
      } finally {
        await intent.release();
      }
    },
  };
}
