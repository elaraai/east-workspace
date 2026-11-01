/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Writes the times CI's shards are split by (`dist/shard.js`, #1466) from the
 * reports a CI run's shards uploaded, one for each operating system and shard
 * (`dist/file-times.js`): `integration.timings.json` from the integration
 * shards', or with `--out=<file>` another, as e3-core's from its shards':
 *
 *     gh run download <run> -p 'integration-timings-*' -D <dir>
 *     node dist/spec-timings.js <dir>
 *     gh run download <run> -p 'core-timings-*' -D <dir>
 *     node dist/spec-timings.js --out=../../packages/e3-core/spec.timings.json <dir>
 *
 * from this package, after a build. Each system's times are its own (`linux`,
 * `darwin`, `win32`), as its reports name it: a spec takes another share of
 * one system's time than of another's, and each system's shards level by its
 * own.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function reportsIn(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? reportsIn(path) : name.endsWith('.json') ? [path] : [];
  });
}

const args = process.argv.slice(2);
const out = args[0]?.startsWith('--out=') === true ? args.shift()!.slice('--out='.length) : undefined;
const dir = args[0];
if (dir === undefined) throw new Error('usage: node dist/spec-timings.js [--out=<file>] <a directory of the shards\' reports>');
const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const systems = new Map<string, Map<string, number>>();
for (const path of reportsIn(dir)) {
  for (const [system, specs] of Object.entries(JSON.parse(readFileSync(path, 'utf8')) as Record<string, Record<string, number>>)) {
    const times = systems.get(system) ?? new Map<string, number>();
    systems.set(system, times);
    for (const [spec, ms] of Object.entries(specs)) times.set(spec, Math.max(times.get(spec) ?? 0, ms));
  }
}
if (systems.size === 0) throw new Error(`no spec's time in the reports under ${dir}`);
const sorted = Object.fromEntries([...systems].sort(([a], [b]) => byName(a, b))
  .map(([system, times]) => [system, Object.fromEntries([...times].sort(([a], [b]) => byName(a, b)))]));
writeFileSync(out ?? new URL('../integration.timings.json', import.meta.url), `${JSON.stringify(sorted, null, 1)}\n`);
console.log(`${out ?? 'integration.timings.json'}: ${[...systems].map(([system, times]) => `${system} ${times.size} specs`).join(', ')}`);
