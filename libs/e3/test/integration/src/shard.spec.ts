/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * CI's integration shards (#1466): the specs split by recorded time, every spec
 * in one shard, the shards level, and a spec with no time recorded counted as
 * the median.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { splitSpecs } from './shard.js';

describe('the integration shards', () => {
  it('split by recorded time: longest first, each to the shard with the least so far, an unrecorded spec as the median, each shard in the order given', () => {
    const timings = { 'dist/a.spec.js': 10, 'dist/b.spec.js': 9, 'dist/c.spec.js': 4, 'dist/d.spec.js': 3, 'dist/e.spec.js': 2 };
    const specs = ['dist/e.spec.js', 'dist/new.spec.js', 'dist/d.spec.js', 'dist/c.spec.js', 'dist/b.spec.js', 'dist/a.spec.js'];
    // `new` counts as the median, 4, after c, its tie, by path: a to the first shard, b the second, c the second, new the first, d the second, e the first.
    assert.deepEqual(splitSpecs(specs, 2, timings), [
      ['dist/e.spec.js', 'dist/new.spec.js', 'dist/a.spec.js'],
      ['dist/d.spec.js', 'dist/c.spec.js', 'dist/b.spec.js'],
    ]);
    assert.deepEqual(splitSpecs(specs, 1, timings), [specs], 'one shard runs every spec, in the order given');
  });

  it('split the specs CI runs into four level shards, every spec in one, each recorded spec a spec of this package', () => {
    const specs = readdirSync(new URL('.', import.meta.url)).filter((name) => name.endsWith('.spec.js')).map((name) => `dist/${name}`);
    const shards = splitSpecs(specs, 4);
    assert.deepEqual(shards.flat().sort(), [...specs].sort());
    const timings = JSON.parse(readFileSync(new URL('../integration.timings.json', import.meta.url), 'utf8')) as Record<string, number>;
    assert.deepEqual(Object.keys(timings).filter((spec) => !specs.includes(spec)), [], 'no recorded spec is gone');
    const recorded = Object.values(timings).sort((a, b) => a - b);
    const timeOf = (spec: string) => timings[spec] ?? recorded[Math.floor(recorded.length / 2)]!;
    const times = shards.map((shard) => shard.reduce((sum, spec) => sum + timeOf(spec), 0));
    assert.ok(Math.max(...times) - Math.min(...times) <= Math.max(...specs.map(timeOf)), `shards of ${times.join(', ')} ms`);
  });
});
