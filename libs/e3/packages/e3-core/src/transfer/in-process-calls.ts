/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A {@link FunctionCallDispatch} that runs each call in the process that
 * dispatches it, on the runner its repository's runs take: the local server's,
 * and e3 in a page's, whose process is the page's worker.
 *
 * @packageDocumentation
 */

import { variant } from '@elaraai/east';
import type { FunctionCallStatus } from '@elaraai/e3-types';
import { functionCallLost, handleProcessFunctionCall } from '../execution/functionCall.js';
import type { TaskRunner } from '../execution/interfaces.js';
import type { StorageBackend } from '../storage/interfaces.js';
import type { FunctionCallDispatch } from './interfaces.js';

/** Options for {@link InProcessFunctionCallDispatch}. */
export interface InProcessFunctionCallDispatchOptions {
  /** The storage the calls are kept in */
  readonly storage: StorageBackend;
  /** A repository's identifier, as the storage takes it, from its name, as a
   *  dispatch is given it (default: the name itself) */
  readonly getRepoPath?: (repo: string) => string;
  /** The runner a repository's calls run on, by its identifier */
  readonly getRunner: (repoPath: string) => TaskRunner;
  /** How often a running call reads its record for a request to cancel it, in
   *  ms (default a second). A request made through this dispatch stops the
   *  call at once whatever this is. */
  readonly watchMs?: number;
}

/** A call this process runs: how it ends, and what stops it at once. */
interface RunningCall {
  readonly settled: Promise<FunctionCallStatus | null>;
  readonly cancel: AbortController;
}

/**
 * Runs each call in this process, on the repository's runner, outliving the
 * request that filed it; its record is the storage's (`StorageBackend.calls`).
 *
 * @remarks
 * A call is run once, however often it is asked to run while it runs. A call
 * this process does not run — one another process ran, or one it ran before it
 * restarted — is the store's to answer: {@link wait} hears nothing of it. A
 * run the store fails under is recorded `lost`, if the store still takes the
 * record. A cancel stops a call this process runs at once; one it does not run
 * stops at its run's next look at its record.
 *
 * @example
 * ```ts
 * const dispatch = new InProcessFunctionCallDispatch({ storage, getRunner: () => runner });
 * const status = await dispatch.execute('default', 'production', job.call.id, { waitMs: 20_000 });
 * ```
 */
export class InProcessFunctionCallDispatch implements FunctionCallDispatch {
  private readonly running = new Map<string, RunningCall>();

  /**
   * @param options - The storage, each repository's identifier and runner,
   *   and how often a run looks for a request to cancel it
   */
  constructor(private readonly options: InProcessFunctionCallDispatchOptions) {}

  execute(repo: string, workspace: string, id: string, options: { waitMs: number }): Promise<FunctionCallStatus | null> {
    const key = callKey(repo, workspace, id);
    let run = this.running.get(key);
    if (run === undefined) {
      const { storage, getRunner, watchMs } = this.options;
      const repoPath = this.options.getRepoPath?.(repo) ?? repo;
      const cancel = new AbortController();
      const settled = handleProcessFunctionCall({
        storage,
        runner: getRunner(repoPath),
        cancel: cancel.signal,
        ...(watchMs !== undefined && { watchMs }),
      }, { repo: repoPath, workspace, id }).catch(async (err: unknown): Promise<FunctionCallStatus> => {
        // The store failed under the run: the call is recorded lost, if it can be
        const message = `the call's run failed: ${err instanceof Error ? err.message : String(err)}`;
        const job = await storage.calls.get(repoPath, workspace, id).catch(() => null);
        if (job !== null) await functionCallLost(storage, repoPath, job, message).catch(() => null);
        return variant('lost', { message });
      }).finally(() => {
        this.running.delete(key);
      });
      run = { settled, cancel };
      this.running.set(key, run);
    }
    return within(run.settled, options.waitMs);
  }

  wait(repo: string, workspace: string, id: string, options: { waitMs: number }): Promise<FunctionCallStatus | null> {
    const run = this.running.get(callKey(repo, workspace, id));
    // A call this process does not run is the store's to answer, once the
    // wait has passed: its run is elsewhere, or over
    return within(run === undefined ? new Promise<never>(() => {}) : run.settled, options.waitMs);
  }

  cancel(repo: string, workspace: string, id: string): Promise<void> {
    this.running.get(callKey(repo, workspace, id))?.cancel.abort();
    return Promise.resolve();
  }
}

/** A call's key among those this process runs. */
function callKey(repo: string, workspace: string, id: string): string {
  return `${repo}\0${workspace}\0${id}`;
}

/** What a promise settles to, or `null` once `ms` have passed first, or it
 *  rejects. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), Math.max(0, ms));
    // A wait keeps no process alive for its own sake
    (timer as unknown as { unref?: () => void }).unref?.();
    void promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}
