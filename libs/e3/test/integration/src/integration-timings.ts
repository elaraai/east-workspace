/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Writes `integration.timings.json`, the times CI's integration shards are
 * split by (`dist/shard.js`, #1466), from the reports a CI run's shards
 * uploaded, one for each operating system and shard (`dist/file-times.js`):
 *
 *     gh run download <run> -p 'integration-timings-*' -D <dir>
 *     node dist/integration-timings.js <dir>
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

const dir = process.argv[2];
if (dir === undefined) throw new Error('usage: node dist/integration-timings.js <a directory of the shards\' reports>');
const times = new Map<string, number>();
for (const path of reportsIn(dir)) {
  for (const [spec, ms] of Object.entries(JSON.parse(readFileSync(path, 'utf8')) as Record<string, number>)) {
    times.set(spec, Math.max(times.get(spec) ?? 0, ms));
  }
}
if (times.size === 0) throw new Error(`no spec's time in the reports under ${dir}`);
const sorted = Object.fromEntries([...times].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
writeFileSync(new URL('../integration.timings.json', import.meta.url), `${JSON.stringify(sorted, null, 1)}\n`);
console.log(`integration.timings.json: ${times.size} specs`);
