/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A workspace a stopping run still holds (#1286).
 *
 * A run asked to stop holds its workspace until its tasks have stopped, which
 * on a server whose tasks run in other processes or machines outlasts the
 * cancel's answer, and it lets the workspace go just after its state says it
 * has ended. A start, a deploy or a workspace's removal the workspace's lock
 * refuses meanwhile is answered `workspace_locked` with a `Retry-After`, so its
 * client asks again once the run has let go, rather than failing.
 *
 * Whether a stopping run holds the workspace is asked before the request as
 * well as after a refusal. A run lets the workspace go before its dataflow
 * lock, so one found holding neither before the request has let the workspace
 * go too, and a refusal that follows is another holder's. Asked only after, a
 * run that let go of both between its refusal and the asking would leave that
 * refusal answered with no wait, though the request would now go through.
 */

import { DateTimeType, lessFor, type EastType } from '@elaraai/east';
import type { ExecutionStateStore, StorageBackend } from '@elaraai/e3-core/portable';
import type { WorkspaceLockError } from '@elaraai/e3-core/portable';
import { sendError } from './beast2.js';
import { errorToVariant } from './errors.js';

/** How long, in seconds, a client is told to wait before it asks again of a
 *  workspace a stopping run holds. */
export const STOPPING_RUN_RETRY_AFTER_S = 1;

/** Whether one time comes before another. */
const before = lessFor(DateTimeType);

/**
 * Whether a run that is stopping holds a workspace: one asked to stop that has
 * not yet stopped, or one that has ended and still holds the dataflow lock it
 * took as it started, which it lets go after every other.
 *
 * @param storage - Storage backend, whose lock service holds the run's lock
 * @param stateStore - The store the repository's runs keep their state in
 * @param repo - Repository identifier
 * @param workspace - The workspace
 * @returns Whether its latest run is stopping and holds it
 */
export async function heldByStoppingRun(
  storage: StorageBackend,
  stateStore: ExecutionStateStore,
  repo: string,
  workspace: string,
): Promise<boolean> {
  const run = await stateStore.readLatestSummary(repo, workspace);
  if (run === null) return false;
  if (run.status === 'running') return run.cancelRequested;
  if (run.completedAt.type !== 'some') return false;
  // Taken after the run ended, the lock is another's: a new run's, or a gc's.
  const lock = await storage.locks.getState(repo, `${workspace}#dataflow`);
  return lock !== null && !before(run.completedAt.value, lock.acquiredAt);
}

/**
 * Sends an error with a `Retry-After`: a refusal its client asks again of.
 *
 * @param type - The success type of the route that refused
 * @param err - The refusal
 * @returns The response
 */
export function sendRetryableError<T extends EastType>(type: T, err: unknown): Response {
  const refused = sendError(type, errorToVariant(err));
  refused.headers.set('Retry-After', String(STOPPING_RUN_RETRY_AFTER_S));
  return refused;
}

/**
 * Whether a stopping run holds a workspace, asked before a request its lock
 * may refuse: what {@link sendLockRefusal} is given as `stoppingBefore`. A
 * holder that cannot be told is no stopping run.
 *
 * @param storage - Storage backend
 * @param stateStore - The store the repository's runs keep their state in
 * @param repo - Repository identifier
 * @param workspace - The workspace, its name already checked
 * @returns Whether its latest run is stopping and holds it
 */
export function stoppingRunBefore(
  storage: StorageBackend,
  stateStore: ExecutionStateStore,
  repo: string,
  workspace: string,
): Promise<boolean> {
  return heldByStoppingRun(storage, stateStore, repo, workspace).catch(() => false);
}

/**
 * The answer to a request a workspace's lock refused: `workspace_locked`, with
 * a `Retry-After` when a stopping run held the workspace before the request,
 * or holds it now.
 *
 * @param type - The success type of the route that refused
 * @param err - The lock's refusal
 * @param stoppingBefore - Whether a stopping run held the workspace before
 *   the request ({@link stoppingRunBefore})
 * @param storage - Storage backend
 * @param stateStore - The store the repository's runs keep their state in
 * @param repo - Repository identifier
 * @param workspace - The workspace
 * @returns The response
 */
export async function sendLockRefusal<T extends EastType>(
  type: T,
  err: WorkspaceLockError,
  stoppingBefore: boolean,
  storage: StorageBackend,
  stateStore: ExecutionStateStore,
  repo: string,
  workspace: string,
): Promise<Response> {
  const stopping = stoppingBefore || await stoppingRunBefore(storage, stateStore, repo, workspace);
  return stopping ? sendRetryableError(type, err) : sendError(type, errorToVariant(err));
}
