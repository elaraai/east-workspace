/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The integration specs one of CI's shards runs (#1466), split by the times CI
 * recorded (`integration.timings.json`) rather than named by hand: longest
 * first, each to the shard with the least time so far, a spec with no time
 * recorded counting as the median. libs/e3's Makefile prints a shard's with
 *
 *     node dist/shard.js <n> <count> <spec>...
 *
 * the specs by their paths from this package.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The specs' recorded times, in ms, by their paths from this package:
 * `integration.timings.json`, which `dist/integration-timings.js` writes from
 * the reports of a CI run.
 */
const TIMINGS = JSON.parse(readFileSync(new URL('../integration.timings.json', import.meta.url), 'utf8')) as Record<string, number>;

/**
 * Splits the specs into shards of equal recorded time: longest first, each to
 * the shard with the least time so far, ties by path, so every shard works the
 * same split out. A spec with no time recorded, a new or a renamed one, counts
 * as the median of those recorded.
 *
 * @param specs - The compiled specs, by their paths from this package
 * @param count - How many shards
 * @param timings - The recorded times, in ms, by path
 * @returns Each shard's specs, in the order given
 */
export function splitSpecs(specs: readonly string[], count: number, timings: Readonly<Record<string, number>> = TIMINGS): string[][] {
  const recorded = Object.values(timings).sort((a, b) => a - b);
  const median = recorded.length > 0 ? recorded[Math.floor(recorded.length / 2)]! : 1;
  const order = specs.map((spec, index) => ({ spec, index, ms: timings[spec] ?? median }))
    .sort((a, b) => b.ms - a.ms || (a.spec < b.spec ? -1 : a.spec > b.spec ? 1 : 0));
  const times = Array.from({ length: count }, () => 0);
  const shards: { spec: string; index: number }[][] = Array.from({ length: count }, () => []);
  for (const entry of order) {
    let least = 0;
    for (let shard = 1; shard < count; shard++) if (times[shard]! < times[least]!) least = shard;
    times[least]! += entry.ms;
    shards[least]!.push(entry);
  }
  return shards.map((shard) => shard.sort((a, b) => a.index - b.index).map((entry) => entry.spec));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [n, count, ...specs] = process.argv.slice(2);
  const shard = Number(n);
  const total = Number(count);
  if (!Number.isSafeInteger(shard) || !Number.isSafeInteger(total) || shard < 1 || shard > total) {
    throw new Error(`usage: node dist/shard.js <n> <count> <spec>..., with 1 <= n <= count; got ${n}/${count}`);
  }
  console.log(splitSpecs(specs, total)[shard - 1]!.join('\n'));
}
