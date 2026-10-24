/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The area index (#1385) on the real runners.
 *
 * Its keys are East the SDK generates, so every runtime must file every row
 * under the same key, byte for byte, and a maintained index must be the one a
 * reindex rebuilds. This deploys the same record to a workspace per runtime —
 * its patch door and its area indexes on that runtime — writes the same rows
 * through the door, then moves, grows, retags, deletes and unplaces some, and
 * compares the states hash for hash: across the runtimes, and against a
 * rebuild in each. Any divergence — a Float rounded otherwise, a division
 * truncated otherwise, a NaN compared otherwise, a Set fanned out in another
 * order — shows up as one hash.
 *
 * The parity compares every runtime installed and skips with fewer than two,
 * as the mutation delta's does; the rest runs on each runtime installed.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert';
import { join, dirname } from 'node:path';
import {
  DictType, FloatType, IntegerType, OptionType, PatchType, SetType, SortedMap, SortedSet, StringType, StructType,
  compareFor, decodeBeast2For, diffFor, encodeBeast2For, equalFor, none, some, type ValueTypeOf,
} from '@elaraai/east';
import e3 from '@elaraai/e3';
import { readDatasetWhole } from './dataset-open.js';
import { recordMutate, recordReindex, readRecordState } from './records.js';
import { packageImport } from './package-files.js';
import { workspaceCreate } from './workspaces.js';
import { workspaceDeploy } from './workspace-files.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir } from './test-helpers.js';
import { LocalStorage } from './storage/local/index.js';
import { LocalTaskRunner } from './execution/LocalTaskRunner.js';
import type { StorageBackend, TaskRunner } from './index.js';

/** Whether a runtime's CLI answers on PATH. */
function onPath(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore', shell: process.platform === 'win32' });
    return true;
  } catch {
    return false;
  }
}

/**
 * A rack: its hall and tags, placed by its centre or not yet, sized, and the
 * zone it was drawn in, by that zone's minimum corner.
 */
const RackRow = StructType({
  hall: StringType, tags: SetType(StringType),
  x: OptionType(FloatType), y: OptionType(FloatType), w: FloatType, h: FloatType,
  zx: FloatType, zy: FloatType,
});
const RacksType = DictType(StringType, RackRow);
type Rack = ValueTypeOf<typeof RackRow>;
type Racks = ValueTypeOf<typeof RacksType>;
const keyOrder = compareFor(StringType);
const sameRack = equalFor(RackRow);
const sameInteger = equalFor(IntegerType);

/** A runner selection, as the SDK's constructors take one. */
type RunnerConfig = Parameters<typeof e3.mutation.reduce>[3];

/**
 * The record, its patch door and its area indexes, on a runner: the box by its
 * centre, with no leading field and led by the hall; a point led by a Set,
 * fanning out, at a coarser cell; and the zone's box by its corner, over Float
 * fields that are never unplaced.
 */
function declared(runner?: RunnerConfig) {
  const racks = e3.record('racks', RacksType, new Map());
  return {
    racks,
    patch: e3.mutation.patch(racks, 'patch', runner),
    indexes: [
      e3.recordIndex.area('racks_by_area', racks, { x: 'x', y: 'y', width: 'w', height: 'h', at: 'centre', cell: 0.01 }, runner),
      e3.recordIndex.area('racks_by_hall_area', racks, { on: ['hall'], x: 'x', y: 'y', width: 'w', height: 'h', at: 'centre', cell: 0.01 }, runner),
      e3.recordIndex.area('racks_by_tag_area', racks, { on: ['tags'], x: 'x', y: 'y', cell: 0.5 }, runner),
      e3.recordIndex.area('racks_by_zone', racks, { x: 'zx', y: 'zy', width: 'w', height: 'h', cell: 0.25 }, runner),
    ] as const,
  };
}

/** The index names, in declaration order. */
const INDEXES = declared().indexes.map((index) => index.name);

/** A seeded stream of numbers in [0, 1) (mulberry32): the same rows on every run. */
function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The finest cell of the two centre indexes: 0.01 rounded down to a power of two. */
const CELL = 2 ** -7;
/** The half side of their domain, `cell · 2²⁷`. */
const HALF = 2 ** 20;

/**
 * The rows the test writes first: racks of every size from a speck to most of
 * the domain, spread over every scale; some unplaced; some on cell corners and
 * exactly at a level's threshold; some on the domain's edges, outside it, larger
 * than half of it, or not finite, which file under the root.
 */
function seeded(): Racks {
  const next = stream(1385);
  const rows = new SortedMap<string, Rack>(undefined, keyOrder);
  const put = (key: string, place: { x: number; y: number } | undefined, w: number, h: number, zx: number, zy: number, n: number) => {
    rows.set(key, {
      hall: `H${n % 4}`,
      tags: new SortedSet(n % 5 === 0 ? [] : [`t${n % 3}`, `t${(n + 1) % 3}`], keyOrder),
      x: place === undefined ? none : some(place.x), y: place === undefined ? none : some(place.y),
      w, h, zx, zy,
    });
  };
  const spreads = [0.004, 0.05, 1, 20, 400, 9_000, 500_000];
  for (let i = 0; i < 400; i++) {
    const spread = spreads[i % spreads.length]!;
    const x = (next() - 0.5) * spread * 40;
    const y = (next() - 0.5) * spread * 40;
    const w = next() * spread * (i % 3 === 0 ? 4 : 0.5);
    const h = next() * spread * (i % 2 === 0 ? 0.25 : 2);
    put(`r-${String(i).padStart(4, '0')}`, i % 13 === 0 ? undefined : { x, y }, w, h, x - w / 2, y - h / 2, i);
  }
  // On cell corners, each box exactly half a level's cell: the threshold.
  for (let n = -6; n <= 6; n++) {
    const side = CELL * 2 ** (Math.abs(n) % 5);
    put(`c-${n + 6}`, { x: n * CELL, y: -n * CELL * 3 }, side / 2, side / 4, n * CELL * 8, n * 0.25, n + 6);
  }
  // The domain's edges, outside it, too large, and not finite.
  put('e-lo', { x: -HALF, y: -HALF }, 1, 1, -(2 ** 25), -(2 ** 25), 1);
  put('e-hi', { x: HALF - CELL, y: HALF - CELL }, 0, 0, 2 ** 25 - 0.25, 2 ** 25 - 0.25, 2);
  put('e-out', { x: HALF, y: 0 }, 0, 0, 2 ** 25, 0, 3);
  put('e-half', { x: 0, y: 0 }, HALF, 1, 0, 0, 4);
  put('e-over', { x: 0, y: 0 }, HALF + 1, 1, 0, 0, 6);
  put('e-nan', { x: Number.NaN, y: 0 }, 1, 1, Number.NaN, 0, 7);
  put('e-inf', { x: 0, y: Number.POSITIVE_INFINITY }, 1, 1, 0, Number.NEGATIVE_INFINITY, 8);
  put('e-wnan', { x: 3, y: 3 }, Number.NaN, 1, 3, 3, 9);
  put('e-neg', { x: -3.5, y: 2.25 }, -1.5, -0.75, -3.5, 2.25, 11);
  put('e-zero', { x: -0, y: -0 }, 0, 0, -0, -0, 12);
  return rows;
}

/**
 * The same rows after another session's edits: some deleted, unplaced, nudged
 * across a cell's edge, moved far, grown, shrunk, retagged or moved to another
 * hall; and some new ones, placed and not.
 */
function edited(rows: Racks): Racks {
  const next = new SortedMap<string, Rack>([...rows], keyOrder);
  let n = 0;
  for (const [key, row] of rows) {
    n++;
    const shift = (value: number, by: number) => value + by;
    switch (n % 9) {
      case 1: next.delete(key); break;
      case 2: next.set(key, { ...row, x: none, y: none }); break;
      case 3: next.set(key, {
        ...row,
        x: row.x.type === 'some' ? some(shift(row.x.value, 0.001)) : some(0.001),
        y: row.y.type === 'some' ? some(row.y.value) : some(-0.001),
        zx: shift(row.zx, 0.001),
      }); break;
      case 4: next.set(key, { ...row, x: some(-400 + n), y: some(900 - n), zx: 7_000 - n, zy: n }); break;
      case 5: next.set(key, { ...row, w: row.w * 40, h: row.h * 40 }); break;
      case 6: next.set(key, { ...row, w: row.w / 1_000, h: row.h / 1_000 }); break;
      case 7: next.set(key, { ...row, tags: new SortedSet([`t${n % 7}`], keyOrder) }); break;
      case 8: next.set(key, { ...row, hall: 'H9' }); break;
      default: break;
    }
  }
  for (let i = 0; i < 20; i++) {
    next.set(`s-${i}`, {
      hall: 'H9', tags: new SortedSet(['t9'], keyOrder),
      x: i % 4 === 0 ? none : some(i * CELL), y: i % 4 === 0 ? none : some(-i * CELL),
      w: 0, h: 0, zx: i * 0.25, zy: -i * 0.25,
    });
  }
  return next;
}

describe('the area index on the real runners', () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;
  let realRunner: TaskRunner;

  /** The runtimes to compare, minus any that is not installed. */
  const runtimes: Array<{ ws: string; runner: RunnerConfig }> = [
    { ws: 'node', runner: { runner: { runtime: 'east-node', platforms: ['@elaraai/east-node-std'] } } },
    ...(onPath('east-c', ['version']) ? [{ ws: 'c', runner: { runner: { runtime: 'east-c' as const, platforms: [] } } }] : []),
    ...(onPath('east-py', ['version']) ? [{ ws: 'py', runner: { runner: { runtime: 'east-py' as const, platforms: [] } } }] : []),
  ];
  const missing = runtimes.length < 2
    ? `needs east-c or east-py on PATH beside east-node; have ${runtimes.map((r) => r.ws).join(', ')}`
    : false;

  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));
    realRunner = new LocalTaskRunner(repo);
    for (const { ws, runner } of runtimes) {
      const { racks, patch, indexes } = declared(runner);
      const pkg = e3.package(`area-${ws}`, '1.0.0', racks, patch, ...indexes);
      const zip = join(tempDir, `area-${ws}.zip`);
      await e3.export(pkg, zip);
      await packageImport(storage, repo, zip);
      await workspaceCreate(storage, repo, ws);
      await workspaceDeploy(storage, repo, ws, `area-${ws}`, '1.0.0', { runner: realRunner });
    }
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  /** The record's state in a workspace: its primary, and each index's manifest. */
  async function state(ws: string): Promise<{ primary: string; indexes: Record<string, string> }> {
    const ref = await storage.datasets.read(repo, ws, 'records/racks');
    assert.ok(ref && ref.type === 'value');
    const held = await readRecordState(storage, repo, ref.value.hash);
    return { primary: held.primary, indexes: Object.fromEntries(INDEXES.map((name) => [name, held.indexes.get(name)!.manifest])) };
  }

  /** Writes `next` through a workspace's patch door, from `before`. */
  async function write(ws: string, before: Racks, next: Racks): Promise<void> {
    const patch = diffFor(RacksType)(before, next);
    const outcome = await recordMutate(storage, realRunner, repo, ws, 'racks', 'patch',
      [encodeBeast2For(PatchType(RacksType))(patch)], { actor: 'cli:test' });
    assert.strictEqual(outcome.kind, 'committed', `${ws}: ${JSON.stringify(outcome)}`);
  }

  /** Every entry of each index in a workspace, decoded by its declared types. */
  async function entries(ws: string) {
    const held = await state(ws);
    return Promise.all(declared().indexes.map(async (index) => {
      const collection = DictType(StructType({ ik: index.keyType, k: StringType }), index.valueType);
      return { name: index.name, entries: decodeBeast2For(collection)(await readDatasetWhole(storage, repo, held.indexes[index.name]!)) };
    }));
  }

  it('carries each row whole, once a row, its Set fanned out and an unplaced row under -1, on each runtime', async () => {
    const rows = seeded();
    for (const { ws } of runtimes) {
      await write(ws, new SortedMap<string, Rack>(undefined, keyOrder), rows);
      for (const { name, entries: held } of await entries(ws)) {
        const expected = name === 'racks_by_tag_area'
          ? [...rows.values()].reduce((total, row) => total + row.tags.size, 0)
          : rows.size;
        assert.strictEqual(held.size, expected, `${ws}/${name}: an entry a row, or a tag`);
        for (const [entry, row] of held) {
          const written = rows.get(entry.k);
          assert.ok(written !== undefined && sameRack(row, written), `${ws}/${name}: ${entry.k}'s entry carries its row`);
          const unplaced = name !== 'racks_by_zone' && written.x.type === 'none';
          assert.strictEqual(sameInteger(entry.ik.__area, -1n), unplaced, `${ws}/${name}: ${entry.k} is under -1 exactly when it has no place`);
        }
      }
    }
  });

  it('maintains each area index as a reindex rebuilds it, hash for hash, on each runtime', async () => {
    const first = seeded();
    const second = edited(first);
    for (const { ws } of runtimes) {
      await write(ws, new SortedMap<string, Rack>(undefined, keyOrder), first);
      await write(ws, first, second);
      const maintained = await state(ws);
      const rebuilt = await recordReindex(storage, realRunner, repo, ws, 'racks', { actor: 'cli:test' });
      assert.strictEqual(rebuilt.kind, 'committed', `${ws}: ${JSON.stringify(rebuilt)}`);
      assert.deepStrictEqual(await state(ws), maintained, `${ws}: maintained ≡ rebuilt`);
    }
  });

  it('files every row under the same key on every runtime, hash for hash', { skip: missing }, async () => {
    const first = seeded();
    const second = edited(first);
    const written: Array<{ ws: string; seeded: Awaited<ReturnType<typeof state>>; edited: Awaited<ReturnType<typeof state>> }> = [];
    for (const { ws } of runtimes) {
      await write(ws, new SortedMap<string, Rack>(undefined, keyOrder), first);
      const afterSeed = await state(ws);
      await write(ws, first, second);
      written.push({ ws, seeded: afterSeed, edited: await state(ws) });
    }
    for (const seen of written.slice(1)) {
      assert.deepStrictEqual(seen.seeded, written[0]!.seeded, `${seen.ws} disagrees with ${written[0]!.ws} once the rows are written`);
      assert.deepStrictEqual(seen.edited, written[0]!.edited, `${seen.ws} disagrees with ${written[0]!.ws} once they are edited`);
    }
  });
});
