/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Maps backend work with bounded concurrency, preserving request order.
 * Stops scheduling after a failure and joins every started operation before
 * rejecting, so the caller's lease fence covers all in-flight side effects.
 * @param items - Backend requests
 * @param atOnce - Maximum concurrent operations
 * @param map - Operation for one request
 * @returns Results in request order
 * @internal
 */
export async function mapBounded<T, R>(items: readonly T[], atOnce: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const answers = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  let failure: unknown;
  const worker = async (): Promise<void> => {
    while (next < items.length && !failed) {
      const index = next++;
      try {
        answers[index] = await map(items[index]!);
      } catch (error) {
        if (!failed) { failed = true; failure = error; }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, atOnce), items.length) }, worker));
  if (failed) throw failure;
  return answers;
}
