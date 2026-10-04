/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * How a repository upgrade step works through its units in parts: in the order
 * of their keys, a batch at a time, until the clock passes when its part
 * stops. Where a part stopped is the key of the last unit it did, which the
 * next part takes the step up from: every unit whose key comes before it is
 * done.
 *
 * @packageDocumentation
 */

import { eachAtMost } from '../concurrency.js';

/**
 * Orders a step's unit keys as their strings do, code unit by code unit: the
 * order a step's cursor is kept in, the same in every release.
 *
 * @param a - A key
 * @param b - Another
 * @returns Negative when `a` comes first, positive when `b` does, 0 when they
 *   are the same key
 */
export function compareUnitKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Works through a step's units in the order of their keys, from past where the
 * part before stopped, `width` at a time, until the clock passes `until` once
 * a batch is done.
 *
 * @param units - The step's units, each with its key, in any order: the keys
 *   are distinct
 * @param at - Where the part before stopped, the key of the last unit it did;
 *   `null` for the step's first part
 * @param until - When the part stops, in epoch milliseconds, once it has done
 *   at least a batch
 * @param width - How many units are worked at once, which is a batch
 * @param work - Rewrites one unit's records
 * @returns The key of the last unit the part did, which the next part is
 *   given; `null` once every unit is done
 * @throws The first unit's failure, once the batch's other units in flight
 *   have settled: the part records nothing, so its batch is done again
 */
export async function workInParts<T>(
  units: readonly { readonly key: string; readonly unit: T }[],
  at: string | null,
  until: number,
  width: number,
  work: (unit: T) => Promise<void>,
): Promise<string | null> {
  const left = units
    .filter(({ key }) => at === null || compareUnitKeys(key, at) > 0)
    .sort((a, b) => compareUnitKeys(a.key, b.key));
  for (let from = 0; from < left.length; from += width) {
    const batch = left.slice(from, from + width);
    await eachAtMost(batch, width, ({ unit }) => work(unit));
    if (from + width < left.length && Date.now() >= until) return batch[batch.length - 1]!.key;
  }
  return null;
}
