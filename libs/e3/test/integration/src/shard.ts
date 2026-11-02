/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The specs one of CI's shards runs (#1466), split by the times CI recorded
 * rather than named by hand: longest first, each to the shard with the least
 * time so far, a spec with no time recorded counting as the median. libs/e3's
 * Makefile prints a shard's with
 *
 *     node dist/shard.js [--timings=<file>] [--glob=<pattern>] <n> <count> [<spec>...]
 *
 * run from the package whose specs they are: the specs given, or those the
 * glob finds there (as a package's test script names them, so a spec in a new
 * directory is never left out), and their times those of the system it runs on
 * (`process.platform`) in `integration.timings.json`, or in the file —
 * e3-core's `spec.timings.json`.
 */

import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Recorded times, in ms, by system (`process.platform`), then by spec path. */
export type Timings = Readonly<Record<string, Readonly<Record<string, number>>>>;

/**
 * The integration specs' recorded times: `integration.timings.json`, which
 * `dist/spec-timings.js` writes from the reports of a CI run.
 */
export const TIMINGS = JSON.parse(readFileSync(new URL('../integration.timings.json', import.meta.url), 'utf8')) as Timings;

/**
 * Splits the specs into shards of equal recorded time: longest first, each to
 * the shard with the least time so far, ties by path, so every shard works the
 * same split out. A spec with no time recorded, a new or a renamed one, counts
 * as the median of those recorded.
 *
 * @param specs - The compiled specs, by their paths from this package
 * @param count - How many shards
 * @param timings - The recorded times, in ms, by path: this system's, by default
 * @returns Each shard's specs, in the order given
 */
export function splitSpecs(specs: readonly string[], count: number, timings: Readonly<Record<string, number>> = TIMINGS[process.platform] ?? {}): string[][] {
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
  const args = process.argv.slice(2);
  const options = new Map<string, string>();
  while (args[0]?.startsWith('--') === true) {
    const [key, ...value] = args.shift()!.slice(2).split('=');
    options.set(key!, value.join('='));
  }
  const [n, count, ...listed] = args;
  const shard = Number(n);
  const total = Number(count);
  if (!Number.isSafeInteger(shard) || !Number.isSafeInteger(total) || shard < 1 || shard > total) {
    throw new Error(`usage: node dist/shard.js [--timings=<file>] [--glob=<pattern>] <n> <count> [<spec>...], with 1 <= n <= count; got ${n}/${count}`);
  }
  const pattern = options.get('glob');
  const specs = pattern === undefined ? listed : globSync(pattern).map((spec) => spec.replaceAll('\\', '/')).sort();
  const file = options.get('timings');
  const timings = file === undefined ? TIMINGS : JSON.parse(readFileSync(file, 'utf8')) as Timings;
  console.log(splitSpecs(specs, total, timings[process.platform] ?? {})[shard - 1]!.join('\n'));
}
