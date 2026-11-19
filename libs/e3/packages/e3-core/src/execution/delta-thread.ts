/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Applying a mutation delta on a thread of its own: the local runner's place
 * for a large delta (`TaskRunner.applyDelta`).
 *
 * Applying a delta is a thread's work for as long as the delta is large, and a
 * local server answers every request on one thread: a load of a few hundred
 * thousand rows, or a save of as many, held every other request for seconds
 * while it was applied. Each such apply runs here on a worker thread started
 * for it and ended with it, which reads and writes the repository's objects by
 * its path, as another process of the machine does. The apply writes objects
 * nothing names yet and no ref, so where it runs changes nothing a commit
 * decides.
 *
 * @packageDocumentation
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { decodeBeast2For, segmentKeyTypeOf } from '@elaraai/east';
import { DatasetSegments } from '../dataset-open.js';
import {
  DeltaConflictError, DeltaStoppedError, ExternalEntryError, SummaryIntegrityError, applyDeltaSummarized,
  type ApplyDeltaOptions, type DeltaApplied, type DeltaArmSummary,
} from '../record-apply.js';
import { LocalStorage } from '../storage/local/index.js';
import type { StorageBackend } from '../storage/interfaces.js';
import type { Budget } from './budget.js';

/** What a thread is asked to apply: the repository by its path, and the
 *  apply's own arguments. @internal */
export interface DeltaThreadAsk {
  readonly repo: string;
  readonly targets: ReadonlyArray<readonly [string, string]>;
  readonly delta: string;
  /** The cases the write may touch; absent for any. */
  readonly cases?: readonly string[];
}

/** What a thread answers: what the apply wrote, or how it refused, by the
 *  class of the error it threw. @internal */
export type DeltaThreadAnswer =
  | { readonly kind: 'applied'; readonly written: ReadonlyArray<readonly [string, string]>; readonly summary: DeltaArmSummary[] }
  | { readonly kind: 'conflict' | 'summary' | 'error'; readonly message: string }
  /** The entry's key as beast2 of the record's key type, which the thread that asked decodes. */
  | { readonly kind: 'external'; readonly key: Uint8Array; readonly source: string; readonly printed: string };

/** The megabytes of stack a thread that applies a delta runs on: what e3's own
 *  process runs on, whose decoders descend as deep as a row's type is nested. */
const THREAD_STACK_MB = 8;

/** The worker's script, beside this module where e3 runs from its built files. */
const SCRIPT = new URL('./delta-thread-worker.js', import.meta.url);

/** The applies a budget's runners have on threads, and those waiting their turn. */
interface Turns {
  running: number;
  readonly waiting: Array<() => void>;
}

/** Each budget's turns: a server's runners, one for each repository, share its one budget. */
const turnsOf = new WeakMap<Budget, Turns>();

/**
 * Takes a turn among the applies a budget's runners have on threads: at once
 * while fewer run than the budget has cores, and otherwise once one ends.
 *
 * @remarks
 * A turn is counted apart from the budget's cores, which runner processes
 * hold: an apply that held one would keep a save's program waiting for it, on
 * a budget of few cores, for as long as a load takes to apply.
 *
 * @param budget - The budget whose runners apply the delta; absent, no turn is counted
 * @param signal - Gives the wait up once it fires
 * @returns Lets the turn go
 * @throws {DeltaStoppedError} When the signal fired while it waited
 */
async function turnTaken(budget: Budget | undefined, signal: AbortSignal | undefined): Promise<() => void> {
  if (budget === undefined) return () => {};
  const turns = turnsOf.get(budget) ?? { running: 0, waiting: [] };
  turnsOf.set(budget, turns);
  if (turns.running < budget.cores) turns.running++;
  else {
    await new Promise<void>((resolve, reject) => {
      const stop = (): void => {
        turns.waiting.splice(turns.waiting.indexOf(go), 1);
        reject(new DeltaStoppedError());
      };
      // The turn is handed over as it is let go: the count stays as it was
      const go = (): void => {
        signal?.removeEventListener('abort', stop);
        resolve();
      };
      turns.waiting.push(go);
      signal?.addEventListener('abort', stop, { once: true });
    });
  }
  return () => {
    const next = turns.waiting.shift();
    if (next === undefined) turns.running--;
    else next();
  };
}

/**
 * Applies a mutation delta on a thread of its own, as `applyDeltaSummarized`
 * applies it.
 *
 * @remarks
 * The thread is started for the apply and ended with it. No more deltas are
 * applied on threads at once than the runner's budget has cores, counted
 * apart from the cores its runner processes hold; one more waits its turn. A
 * signal that fires ends the thread at once, or the wait for a turn: what the
 * thread had written is named by nothing.
 *
 * A thread reads the repository by its path, so only a delta of a repository
 * the machine's own files hold is applied on one: over any other storage, and
 * where e3 runs from files that have no worker script beside this module, the
 * delta is applied where it is asked.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier: for local storage, its path
 * @param targets - target name -> the manifest hash it currently holds
 * @param deltaHash - the delta object's content hash
 * @param options - The cases the write may touch, and a signal that stops it
 * @param budget - The runner's budget, whose cores bound how many deltas
 *   its runners apply on threads at once
 * @returns `written`, the targets' new manifests, and `summary`, what the
 *   delta did to each
 * @throws {DeltaConflictError} As `applyDeltaSummarized` does.
 * @throws {ExternalEntryError} As `applyDeltaSummarized` does.
 * @throws {SummaryIntegrityError} As `applyDeltaSummarized` does.
 * @throws {DeltaStoppedError} When `options.signal` stopped it.
 * @throws {Error} When the delta does not apply for another reason, or its
 *   thread ended before it answered: out of memory, say
 *
 * @example
 * ```ts
 * const { written } = await applyDeltaOnThread(storage, repoPath, stateTargets(state), delta, { cases: new Set(['own']) }, budget);
 * ```
 */
export async function applyDeltaOnThread(
  storage: StorageBackend,
  repo: string,
  targets: Map<string, string>,
  deltaHash: string,
  options: ApplyDeltaOptions = {},
  budget?: Budget,
): Promise<DeltaApplied> {
  if (!(storage instanceof LocalStorage) || !existsSync(fileURLToPath(SCRIPT))) {
    return applyDeltaSummarized(storage, repo, targets, deltaHash, options);
  }
  const { signal, cases } = options;
  if (signal?.aborted === true) throw new DeltaStoppedError();
  const done = await turnTaken(budget, signal);
  let answer: DeltaThreadAnswer;
  try {
    const ask: DeltaThreadAsk = { repo, targets: [...targets], delta: deltaHash, ...(cases !== undefined && { cases: [...cases] }) };
    answer = await answered(ask, signal);
  } finally {
    done();
  }
  switch (answer.kind) {
    case 'applied': return { written: new Map(answer.written), summary: answer.summary };
    case 'conflict': throw new DeltaConflictError(answer.message);
    case 'summary': throw new SummaryIntegrityError(answer.message);
    case 'error': throw new Error(answer.message);
    case 'external': {
      // The key's type is the record's own collection's, which the thread encoded it by
      const keyType = segmentKeyTypeOf((await DatasetSegments.open(storage, repo, targets.get('primary')!)).typeValue);
      throw new ExternalEntryError(decodeBeast2For(keyType!)(answer.key), answer.source, answer.printed);
    }
  }
}

/**
 * Runs one apply on a thread, to its answer.
 *
 * @param ask - What the thread applies
 * @param signal - Ends the thread once it fires
 * @returns The thread's answer
 * @throws {DeltaStoppedError} When the signal ended it
 * @throws {Error} When the thread failed, or ended before it answered
 */
function answered(ask: DeltaThreadAsk, signal: AbortSignal | undefined): Promise<DeltaThreadAnswer> {
  return new Promise<DeltaThreadAnswer>((resolve, reject) => {
    // A stop that came as the apply took its turn starts no thread
    if (signal?.aborted === true) {
      reject(new DeltaStoppedError());
      return;
    }
    // A thread loads one module and needs none of the process's options, which it could refuse
    const thread = new Worker(SCRIPT, { workerData: ask, execArgv: [], resourceLimits: { stackSizeMb: THREAD_STACK_MB } });
    const stop = (): void => {
      void thread.terminate();
      reject(new DeltaStoppedError());
    };
    signal?.addEventListener('abort', stop, { once: true });
    const settle = (): void => signal?.removeEventListener('abort', stop);
    thread.once('message', (answer: DeltaThreadAnswer) => {
      settle();
      resolve(answer);
    });
    thread.once('error', (err) => {
      settle();
      reject(new Error(`applying delta ${ask.delta.slice(0, 8)} failed on its thread: ${err.message}`, { cause: err }));
    });
    // After its answer, a thread's exit settles nothing; before it, the thread ended without one
    thread.once('exit', (code) => {
      settle();
      reject(new Error(`the thread applying delta ${ask.delta.slice(0, 8)} ended before it answered (exit code ${code})`));
    });
  });
}
