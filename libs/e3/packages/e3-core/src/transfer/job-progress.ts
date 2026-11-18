/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * How a job that runs for a while keeps its store's record of it: what the
 * handlers of a split call's job and a record load's job share. Each watches
 * its record for word that it should stop, writes its progress one write at a
 * time, and ends failed unless its caller stopped it to run it again.
 */

/**
 * Watches a running job's record, as often as `pollMs`, for word that the job
 * should stop: its end written by another, or a request to cancel it.
 *
 * @param stops - Reads the job's record, and answers whether it says to stop
 * @param pollMs - How often the record is read
 * @param stop - Told once the record says so
 * @returns Ends the watch
 */
export function watchJob(stops: () => Promise<boolean>, pollMs: number, stop: () => void): () => void {
  const watch = setInterval(() => {
    stops().then((found) => {
      if (found) stop();
    }, () => {
      // A read that fails leaves the job running: the next one looks again.
    });
  }, pollMs);
  return () => clearInterval(watch);
}

/** A job's writes of its progress to its store, one at a time. */
export interface ProgressWrites<P> {
  /** Writes a progress, after every one before it. */
  write(progress: P): void;
  /** Resolves once every progress written so far has been: before the job's
   *  end is written, so no progress lands after it. */
  written(): Promise<void>;
}

/**
 * Writes a job's progress to its store one write at a time, in the order
 * given.
 *
 * @remarks
 * A write the store refuses says the job has ended there, cancelled or ended
 * by another, and the job is told to stop. A write that fails leaves the last
 * progress standing.
 *
 * @typeParam P - The progress written
 * @param update - Writes a progress to the job's record, answering whether
 *   the store took it
 * @param refused - Told when the store refuses one
 * @returns The writes
 */
export function progressWrites<P>(update: (progress: P) => Promise<boolean>, refused: () => void): ProgressWrites<P> {
  let writes: Promise<void> = Promise.resolve();
  return {
    write(progress) {
      writes = writes.then(async () => {
        if (!await update(progress)) refused();
      }).catch(() => {
        // A progress write that fails leaves the last one standing.
      });
    },
    written: () => writes,
  };
}

/**
 * Ends a job whose run threw: recorded `failed`, with the error's message,
 * unless its caller's signal stopped it, when it is handed over as it stands
 * for the call that runs it again. The error is thrown again either way.
 *
 * @param err - What the run threw
 * @param signal - The caller's signal, which hands the job over
 * @param fail - Records the job failed, with a message
 * @throws The error
 */
export async function failedUnlessHandedOver(err: unknown, signal: AbortSignal | undefined, fail: (message: string) => Promise<unknown>): Promise<never> {
  // A job its caller stopped is handed over, not failed.
  if (signal?.aborted !== true) await fail(err instanceof Error ? err.message : String(err));
  throw err;
}

/**
 * What one source's load jobs are ordered under ({@link JobOrder}): the
 * repository, the workspace, the record and the source.
 *
 * @param job - A load job
 * @returns The key
 */
export function loadJobKey(job: { readonly repo: string; readonly workspace: string; readonly record: string; readonly source: string }): string {
  return [job.repo, job.workspace, job.record, job.source].join('\u0000');
}

/** A job's place among the jobs filed under one key, in the order they were
 *  filed ({@link JobOrder.take}). */
export interface JobPlace {
  /** Whether a job filed before it under its key had yet to end as it took
   *  its place: it waits */
  readonly waits: boolean;
  /** Settles once every job filed before it under its key has ended */
  readonly before: Promise<void>;
  /** Lets the job filed after it go on: called once, when this one has ended,
   *  or was not run */
  leave(): void;
}

/**
 * The order the jobs filed under one key run in, in a store that runs its
 * jobs in one process: each after every one filed before it.
 *
 * @remarks
 * A place is taken as a job is asked to run, before anything is awaited, so
 * the order the store is asked in is the order the jobs run in, however long
 * each takes to start. A job that is not run after all, or ends early, leaves
 * its place, and the one after it still waits for every job before that.
 *
 * @example
 * ```ts
 * const order = new JobOrder();
 * const place = order.take('main/orders/erp');
 * await place.before;       // every load of orders.erp filed before this one has ended
 * try { await run(); } finally { place.leave(); }
 * ```
 */
export class JobOrder {
  private readonly last = new Map<string, Promise<void>>();

  /**
   * Takes a job's place after every job that took one under `key` before it.
   *
   * @param key - What the jobs are ordered under: a record's source, say
   * @returns The place
   */
  take(key: string): JobPlace {
    const earlier = this.last.get(key);
    const before = earlier ?? Promise.resolve();
    let leave!: () => void;
    const left = new Promise<void>((resolve) => { leave = resolve; });
    // Ended once every job before it has, and it has
    const ended = before.then(() => left);
    this.last.set(key, ended);
    void ended.then(() => {
      if (this.last.get(key) === ended) this.last.delete(key);
    });
    return { waits: earlier !== undefined, before, leave };
  }
}

/**
 * Progress that comes many times a second, held back so that its job's store
 * is written no more often than an interval.
 */
export interface HeldProgress<P> {
  /** Takes a count: written at once where the interval has passed since the
   *  last, and otherwise held as the newest, to be written once it has. */
  hold(progress: P): void;
  /** Writes the count held, if any: before the step after is written. */
  flush(): void;
  /** Lets go of the count held and of its timer: the job has settled. */
  stop(): void;
}

/**
 * Holds back progress that comes many times a second.
 *
 * @remarks
 * The first count is written at once. One that comes within `intervalMs` of
 * the last write is held as the newest, and a timer writes it once the
 * interval has passed: a count then stands in the store no longer than the
 * interval, though no later one comes — a piece may run for minutes after the
 * ones before it came from the cache in a few milliseconds.
 *
 * @typeParam P - The progress written
 * @param write - Writes a count to the job's store
 * @param intervalMs - The least time between two writes
 * @returns The hold
 *
 * @example
 * ```ts
 * const pieces = heldProgress(write, 500);
 * pieces.hold(first);   // written
 * pieces.hold(second);  // held: written 500 ms after `first`, or by `flush`
 * pieces.stop();
 * ```
 */
export function heldProgress<P>(write: (progress: P) => void, intervalMs: number): HeldProgress<P> {
  let writtenAt = 0;
  let held: { readonly progress: P } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const settle = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const flush = (): void => {
    settle();
    if (held === null) return;
    const { progress } = held;
    held = null;
    writtenAt = Date.now();
    write(progress);
  };
  return {
    hold(progress) {
      const since = Date.now() - writtenAt;
      if (since < intervalMs) {
        held = { progress };
        timer ??= setTimeout(flush, intervalMs - since);
        return;
      }
      held = { progress };
      flush();
    },
    flush,
    stop() {
      settle();
      held = null;
    },
  };
}
