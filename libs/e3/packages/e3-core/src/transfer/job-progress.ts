/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * How a job writes its progress to its store: what the handlers of a split
 * call's job and a record load's job share.
 */

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
