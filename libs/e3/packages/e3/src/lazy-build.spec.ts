/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * {@link lazyBuilds} (#1466): each getter's value built once, the first time
 * it is read, with no location captured — so a function's IR is the same
 * whoever reads it first — and a property that is no getter left as it is.
 * And the SDK's own East functions, kept so: importing the SDK builds none of
 * them and loads no TypeScript, each is built with no location, as an
 * installed SDK builds it, and `@elaraai/e3/internal` gives the four the UI
 * checks its tiles against.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DateTimeType, East, IntegerType, decodeEastIR, encodeEastIR, sha256Hex, variant, type EastIR } from '@elaraai/east';
import { RecordLevelType } from '@elaraai/e3-types';
import { lazyBuilds } from './lazy-build.js';
import { AREA_FNS } from './record-area.js';
import { INTERVAL_FNS } from './record-interval.js';
import { KIT_CALLED, KIT_UNCALLED, NESTED_FNS } from './record-nested-programs.js';
import { PROGRAM_FNS } from './record-programs.js';
import { SERIES_FNS } from './record-series.js';
import { TILE_FNS } from './record-tiles.js';
import { eventFilings, tileNext, tileShares, tileStart } from './internal.js';

describe('lazyBuilds', () => {
  it('builds each getter\'s value once, the first time it is read, and leaves a property that is no getter as it is', () => {
    let builds = 0;
    const library = lazyBuilds({
      kept: 1,
      get built() {
        builds++;
        return { at: builds };
      },
    });
    assert.equal(builds, 0, 'nothing is built until it is read');
    const first = library.built;
    assert.equal(library.built, first);
    assert.equal(builds, 1, 'built once');
    assert.equal(library.kept, 1);
    assert.deepEqual(Object.keys(library), ['kept', 'built'], 'both stay enumerable, in order');
    const descriptor = Object.getOwnPropertyDescriptor(library, 'built');
    assert.equal(descriptor?.get, undefined, 'once built, the value is a property of its own');
    assert.equal(descriptor?.value, first);
  });

  it('builds an East function with no location captured: its IR is the same read first at the top or inside a caller\'s body', () => {
    const make = () => lazyBuilds({
      get double() {
        return East.function([IntegerType], IntegerType, ($, n) => {
          const twice = $.let(n.add(n));
          return twice;
        });
      },
    });
    const irOf = (fn: { toIR(): EastIR<[IntegerType], IntegerType> }) => sha256Hex(encodeEastIR(fn.toIR()));
    const atTop = make();
    const top = irOf(atTop.double);
    const inCaller = make();
    East.function([IntegerType], IntegerType, ($, n) => {
      const double = $.const(inCaller.double);
      return double(n);
    });
    assert.equal(irOf(inCaller.double), top, 'the caller\'s frames and names never reach it');
  });
});

/** Each object of the SDK's own East functions, by the module that holds it. */
const HOLDERS = {
  'record-area.js': { AREA_FNS },
  'record-interval.js': { INTERVAL_FNS },
  'record-nested-programs.js': { KIT_CALLED, KIT_UNCALLED, NESTED_FNS },
  'record-programs.js': { PROGRAM_FNS },
  'record-series.js': { SERIES_FNS },
  'record-tiles.js': { TILE_FNS },
};

/**
 * Run in a process of its own: imports the SDK with `East.function` counted,
 * then names, of each holder, the functions already built, and reads one twice.
 */
const IMPORT_PROBE = `
import { createRequire } from 'node:module';
const { East } = await import('@elaraai/east');
let built = 0;
const build = East.function;
East.function = function (...args) { built += 1; return build.apply(this, args); };
const [index, holders] = process.argv.slice(1);
await import(index);
const atImport = built;
const typescript = Object.keys(createRequire(import.meta.url).cache).some((path) => /[\\\\/]typescript[\\\\/]/.test(path));
const read = {};
let tiles;
for (const [module, names] of Object.entries(JSON.parse(holders))) {
  const loaded = await import(module);
  for (const name of names) {
    read[name] = Object.entries(Object.getOwnPropertyDescriptors(loaded[name])).filter(([, d]) => d.get === undefined).map(([key]) => key);
    if (name === 'TILE_FNS') tiles = loaded[name];
  }
}
const before = built;
const first = tiles.tileStart;
const once = built - before;
const again = tiles.tileStart === first ? built - before - once : -1;
console.log(JSON.stringify({ atImport, typescript, read, once, again }));
`;

/** A function's IR, as far as the files its locations name. */
type Located = { toIR(): { source_map: { entries(): readonly (readonly { filename: string }[])[] } } };

describe('the SDK\'s own East functions', () => {
  it('none is built, nor TypeScript loaded, when the SDK is imported; each is built the first time it is read, once', () => {
    const modules = Object.fromEntries(Object.entries(HOLDERS).map(([module, holders]) => [new URL(module, import.meta.url).href, Object.keys(holders)]));
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', IMPORT_PROBE, new URL('index.js', import.meta.url).href, JSON.stringify(modules)], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout) as { atImport: number; typescript: boolean; read: Record<string, string[]>; once: number; again: number };
    assert.equal(result.atImport, 0, 'importing the SDK builds no East function');
    assert.equal(result.typescript, false, 'nor loads TypeScript, which East loads for its first build');
    const none = Object.fromEntries(Object.values(HOLDERS).flatMap((holders) => Object.keys(holders)).map((name) => [name, []]));
    assert.deepEqual(result.read, none, 'no holder\'s function was read');
    assert.ok(result.once > 0, 'reading a function builds it');
    assert.equal(result.again, 0, 'reading it again gives the same function and builds nothing');
  });

  it('builds each with no location: its IR names no file, as an installed SDK builds it, whose frames East never captures', () => {
    for (const holders of Object.values(HOLDERS)) {
      for (const [holder, fns] of Object.entries(holders)) {
        for (const [name, fn] of Object.entries(fns as Record<string, Located>)) {
          const files = fn.toIR().source_map.entries().flat().map((location) => location.filename);
          assert.deepEqual(files, [], `${holder}.${name}`);
        }
      }
    }
  });

  it('`@elaraai/e3/internal` gives the four tile functions, each an East function to compile, call from another, or keep as IR', () => {
    assert.equal(import.meta.resolve('@elaraai/e3/internal'), new URL('internal.js', import.meta.url).href, 'the package\'s entry is this module');
    const month = variant('month', null);
    const day = variant('day', null);
    const at = new Date('2026-10-17T13:00:00.000Z');
    assert.deepEqual(East.compile(tileStart, [])(month, at), new Date('2026-10-01T00:00:00.000Z'));
    const following = East.function([RecordLevelType, DateTimeType], DateTimeType, ($, level, instant) => {
      const start = $.const(tileStart);
      const next = $.const(tileNext);
      return next(level, start(level, instant));
    });
    assert.deepEqual(East.compile(following, [])(month, at), new Date('2026-11-01T00:00:00.000Z'), 'called from another function');
    const shares = decodeEastIR(encodeEastIR(tileShares.toIR())).compile([]) as (level: unknown, start: Date, end: Date, what: string) => unknown;
    assert.deepEqual(shares(day, new Date('2026-10-17T12:00:00.000Z'), new Date('2026-10-18T06:00:00.000Z'), 'a job'), [
      { tile: new Date('2026-10-17T00:00:00.000Z'), ms: 43_200_000n },
      { tile: new Date('2026-10-18T00:00:00.000Z'), ms: 21_600_000n },
    ], 'kept as IR, encoded, decoded and compiled');
    assert.deepEqual(East.compile(eventFilings, [])(day, new Date('2026-10-17T12:00:00.000Z'), new Date('2026-10-18T06:00:00.000Z'), 'a job'), [
      { level: day, tile: new Date('2026-10-17T00:00:00.000Z') },
    ], 'eighteen hours are filed under the day they start in');
  });
});
