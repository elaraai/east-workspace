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
 * from this package, after a build. Each spec's time is its slowest system's,
 * so a split levels the slowest system's shards.
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
const times = new Map<string, number>();
for (const path of reportsIn(dir)) {
  for (const [spec, ms] of Object.entries(JSON.parse(readFileSync(path, 'utf8')) as Record<string, number>)) {
    times.set(spec, Math.max(times.get(spec) ?? 0, ms));
  }
}
if (times.size === 0) throw new Error(`no spec's time in the reports under ${dir}`);
const sorted = Object.fromEntries([...times].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
writeFileSync(out ?? new URL('../integration.timings.json', import.meta.url), `${JSON.stringify(sorted, null, 1)}\n`);
console.log(`${out ?? 'integration.timings.json'}: ${times.size} specs`);
