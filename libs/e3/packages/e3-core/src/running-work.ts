/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The repository's tasks lock, and what holds it.
 *
 * Work that writes objects before a ref names them, or reads what a sweep or
 * an upgrade would change under it, holds the lock shared, and what must find
 * the repository still while it decides — gc, and an upgrade — holds it
 * exclusive, with every workspace's dataflow lock. Both go through the lock
 * service, so they hold any backend's repository.
 */

import { variant } from '@elaraai/east';
import { RepositoryBusyError } from './errors.js';
import type { LockHandle, StorageBackend } from './storage/interfaces.js';

/**
 * The lock gc takes exclusive, and every write that stores objects before a
 * ref names them holds shared, so the two never overlap: an ad-hoc task run
 * (`e3 run`), which has no dataflow lock, a record write, a dataset write
 * through the store's door, a deploy, and a package import. Each writes
 * objects it has not yet rooted, which a concurrent sweep would delete. A
 * package's or a workspace's export holds it too, since what it reads may be
 * named by nothing by the time it reads it, and an upgrade must not rewrite
 * it meanwhile.
 */
export const TASKS_LOCK = '#tasks';

/**
 * Runs `fn` holding the tasks lock shared, so a sweep cannot run while it
 * does.
 *
 * @remarks
 * A write through the store's door stores objects before anything names them
 * — a delivery's segments, a delta, an index build's output — exactly as an
 * ad-hoc task run does, and the answer is the same one: gc takes this lock
 * exclusively, so the two never overlap and none of it needs rooting. Without
 * it a sweep landing mid-write deletes objects the ref it is about to write
 * names.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param fn - the work, which writes objects before anything names them
 * @returns what `fn` returns
 * @throws {Error} When a garbage collection or an upgrade holds the
 *   repository.
 */
export async function withRunningWork<T>(storage: StorageBackend, repo: string, fn: () => Promise<T>): Promise<T> {
  const lock = await storage.locks.acquire(repo, TASKS_LOCK, variant('dataflow', null), { mode: 'shared' });
  if (!lock) throw new Error('a garbage collection or an upgrade holds this repository — retry when it finishes');
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

/** How {@link withRepositoryHeld} takes the repository. */
export interface RepositoryHoldOptions {
  /** What holds the repository, which a refusal begins with. */
  doing: string;
  /** How long to wait for each lock, in milliseconds; unset, a lock held
   *  elsewhere refuses at once. */
  wait?: number;
}

/**
 * Runs `fn` with the repository held still: the tasks lock exclusive, so no
 * write that stores objects before a ref names them runs, and every
 * workspace's dataflow lock, so no dataflow runs.
 *
 * @remarks
 * What gc decides from, and what an upgrade rewrites, must not change under
 * it. The locks are released once `fn` settles, whether or not it throws.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param options - What holds the repository, and how long to wait for it
 * @param fn - the work
 * @returns what `fn` returns
 * @throws {RepositoryBusyError} When a task is running in the repository, or
 *   a dataflow in one of its workspaces, beginning with `options.doing`.
 */
export async function withRepositoryHeld<T>(
  storage: StorageBackend,
  repo: string,
  options: RepositoryHoldOptions,
  fn: () => Promise<T>
): Promise<T> {
  const acquire = options.wait === undefined ? {} : { wait: true, timeout: options.wait };
  const locks: LockHandle[] = [];
  try {
    const tasks = await storage.locks.acquire(repo, TASKS_LOCK, variant('dataflow', null), acquire);
    if (tasks === null) {
      throw new RepositoryBusyError(options.doing, null);
    }
    locks.push(tasks);
    for (const ws of await storage.refs.workspaceList(repo)) {
      const lock = await storage.locks.acquire(repo, `${ws}#dataflow`, variant('dataflow', null), acquire);
      if (lock === null) {
        throw new RepositoryBusyError(options.doing, ws);
      }
      locks.push(lock);
    }
    return await fn();
  } finally {
    for (const lock of locks) {
      await lock.release();
    }
  }
}
