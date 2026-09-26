/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Moving many objects at once: a unit's staging, the adoption of a runner's
 * output directory, a splice's reads.
 *
 * Each object is a link on a local store and a request on a remote one, where
 * moving them one at a time leaves the caller waiting on the store's latency
 * rather than its bandwidth: a 1 GiB input is about 900 segments.
 *
 * @packageDocumentation
 */

/** How many objects are moved at once. */
export const OBJECT_CONCURRENCY = 16;

/**
 * Calls `fn` for every item, at most `width` calls at once.
 *
 * @remarks
 * Once a call fails, no item not yet started is started, and the first
 * failure is thrown once the calls in flight have settled, so nothing this
 * started runs on after it returns.
 *
 * @param items - The items
 * @param width - The most calls in flight at once
 * @param fn - Called for each item
 * @throws The first call's failure, once every call in flight has settled
 */
export async function eachAtMost<T>(items: readonly T[], width: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  let next = 0;
  const failures: unknown[] = [];
  const worker = async (): Promise<void> => {
    while (failures.length === 0) {
      const index = next++;
      if (index >= items.length) return;
      try {
        await fn(items[index]!);
      } catch (error) {
        failures.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
  if (failures.length > 0) throw failures[0];
}

/**
 * Yields `read(0)`, `read(1)`, … `read(count - 1)` in order, reading up to
 * `width` of them ahead of the one the consumer takes next.
 *
 * @remarks
 * A read starts only when the consumer asks for the next value, so at a width
 * of one the consumer holds a value and nothing is read ahead of it. A read
 * that fails is raised when the consumer reaches it; one abandoned in flight
 * settles unobserved.
 *
 * @param count - How many values
 * @param width - How many reads may be in flight at once
 * @param read - Reads value `index`
 * @returns The values, in order
 */
export async function* readInOrder<T>(count: number, width: number, read: (index: number) => Promise<T>): AsyncGenerator<T> {
  const pending: Promise<T>[] = [];
  let next = 0;
  for (;;) {
    for (; next < count && pending.length < width; next++) {
      const reading = read(next);
      reading.catch(() => { /* raised when the consumer reaches it */ });
      pending.push(reading);
    }
    const reading = pending.shift();
    if (reading === undefined) return;
    yield await reading;
  }
}
