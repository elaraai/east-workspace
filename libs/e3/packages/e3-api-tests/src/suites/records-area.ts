/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A record read by area (#1385): a window over a floor's racks, read through
 * an area index (`e3.recordIndex.area`) as its searches in one request
 * (`findKeys`) and the runs they select (the runs form), from the index alone —
 * each entry carries its rack's row whole, so nothing is joined.
 *
 * The suite plans each window itself, by the area index's planning rule, as a
 * client plans it, and works out each rack's key by the rule its keys are
 * filed by, so what a server answers is held to a brute force: the racks filed
 * under the window's searches and no other, every rack whose box meets the
 * window — its margin with it — among them, each once, each with its row, at
 * one content hash. Then the unplaced read, a rack moved out of one window
 * into another, and a stale pin refused.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ArrayType, IntegerType, OptionType, PatchType, SortedMap, StringType, StructType, compareFor, decodeBeast2For, diffFor,
  encodeBeast2For, equalFor, isTypeEqual, isTypeValueEqual, none, printFor, some, toEastTypeValue, variant,
  type EastType, type ValueTypeOf,
} from '@elaraai/east';
import { indexWindowType } from '@elaraai/e3-types';
import {
  DatasetHashMismatchError,
  packageImport,
  workspaceCreate,
  workspaceDeploy,
  workspaceRecordDescribe,
  workspaceRecordMutate,
  datasetFindKeys,
  datasetGet,
  datasetGetPage,
  datasetGetRuns,
  datasetGetStatus,
  type DatasetKeySearch,
} from '@elaraai/e3-api-client';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { createAreaRecordPackageZip, RACK_CELL, RackAreaKeyType, RackHallAreaKeyType, RackRowType, RacksType } from '../fixtures.js';

const PKG = 'area-record-pkg';
const VERSION = '1.0.0';
const WS = 'area-record-ws';
const racksPath = [variant('field', 'records'), variant('field', 'racks')];

/** How many racks the floor holds: more than a segment's 4,096 entries at
 *  most, so each index spans segments, and its searches and runs cross them. */
const RACKS = 10_000n;

type Rack = ValueTypeOf<typeof RackRowType>;
type Racks = ValueTypeOf<typeof RacksType>;

/**
 * A window's entries as a read through an area index decodes them: e3-types'
 * `indexWindowType` of the racks' key, the index's key and the row, which the
 * index carries whole as its projection. The first test holds each to
 * `indexWindowType` itself.
 */
const windowOf = <IK extends EastType>(ik: IK) => ArrayType(StructType({ ik, key: StringType, value: RackRowType, row: OptionType(RackRowType) }));
const AreaWindowType = windowOf(RackAreaKeyType);
const HallAreaWindowType = windowOf(RackHallAreaKeyType);
type AreaEntry = ValueTypeOf<typeof AreaWindowType>[number];
type HallAreaEntry = ValueTypeOf<typeof HallAreaWindowType>[number];

/** A viewport, in world units: its minimum and maximum corners. */
interface View { minX: number; minY: number; maxX: number; maxY: number }
/** A window's search as the `__area` keys it holds: one exact key, or a half-open range of them. */
type Span = { exact: bigint } | { from: bigint; to: bigint };

const encodeInt = encodeBeast2For(IntegerType);
const encodePatch = encodeBeast2For(PatchType(RacksType));
const decodeRacks = decodeBeast2For(RacksType);
const decodeAreaWindow = decodeBeast2For(AreaWindowType);
const decodeHallAreaWindow = decodeBeast2For(HallAreaWindowType);
const printInteger = printFor(IntegerType);
const printString = printFor(StringType);
const rackEqual = equalFor(RackRowType);
const unjoined = equalFor(OptionType(RackRowType));
const integerEqual = equalFor(IntegerType);
const integerOrder = compareFor(IntegerType);
const stringEqual = equalFor(StringType);
const stringOrder = compareFor(StringType);

/** The finest level: a level-28 cell is the finest cell, {@link RACK_CELL} wide. */
const FINEST = 28;
/** Half the side of the indexes' domain, `RACK_CELL · 2²⁷` world units. */
const HALF = RACK_CELL * 2 ** 27;

/**
 * The `__area` a rack is filed under, by the rule its keys are filed by: the
 * deepest level whose cell is at least twice its box's larger side; the cell
 * of that level holding its centre; that cell's Morton code at the finest
 * level (x in the even bits, y in the odd) times 32, plus the level. −1 with no
 * place; the root's, 0, outside the domain, not finite, or larger than half
 * the domain.
 */
function keyOf(rack: Rack): bigint {
  if (rack.x.type === 'none' || rack.y.type === 'none') return -1n;
  const cx = rack.x.value, cy = rack.y.value;
  const side = Math.max(Math.abs(rack.w), Math.abs(rack.h));
  if (![cx, cy, side].every(Number.isFinite) || cx < -HALF || cx >= HALF || cy < -HALF || cy >= HALF || side > HALF) return 0n;
  let level = FINEST, size = RACK_CELL, step = 1n;
  while (size < 2 * side) { size *= 2; level--; step *= 2n; }
  // The finest cell holding the centre, then its level's cell, aligned to the finest level.
  let x = (BigInt(Math.floor(cx / RACK_CELL)) + (1n << 27n)) / step * step;
  let y = (BigInt(Math.floor(cy / RACK_CELL)) + (1n << 27n)) / step * step;
  let code = 0n;
  for (let i = 0, bit = 1n; i < FINEST; i++, bit *= 4n) {
    code += (x % 2n) * bit + (y % 2n) * bit * 2n;
    x /= 2n;
    y /= 2n;
  }
  return code * 32n + BigInt(level);
}

/**
 * A window's searches, by the area index's planning rule: the viewport grown
 * by an eighth of its larger side on each side; `C`, the deepest level whose
 * cell is at least an eighth of that's larger side; at each level coarser than
 * `C`, the exact key of each cell whose bounds grown by a quarter of its side
 * meet it, the root's always; at `C`, for each such cell, the range from its
 * key to its last descendant's.
 */
function windowSpans(view: View): Span[] {
  const margin = Math.max(view.maxX - view.minX, view.maxY - view.minY) / 8;
  const fromX = view.minX - margin, toX = view.maxX + margin, fromY = view.minY - margin, toY = view.maxY + margin;
  const larger = Math.max(toX - fromX, toY - fromY);
  let deepest = FINEST;
  while (deepest > 0 && RACK_CELL * 2 ** (FINEST - deepest) < larger / 8) deepest--;
  const spans: Span[] = [];
  for (let level = 0; level <= deepest; level++) {
    const size = RACK_CELL * 2 ** (FINEST - level);
    /** The level's cells along an axis whose loose bounds meet [from, to]. */
    const meeting = (from: number, to: number): number[] => {
      if (level === 0) return [0];
      const cells: number[] = [];
      for (let i = Math.max(0, Math.floor((from + HALF) / size) - 2); i <= Math.min(2 ** level - 1, Math.floor((to + HALF) / size) + 2); i++) {
        const start = -HALF + i * size;
        if (start - size / 4 <= to && start + size + size / 4 >= from) cells.push(i);
      }
      return cells;
    };
    for (const ix of meeting(fromX, toX)) {
      for (const iy of meeting(fromY, toY)) {
        let m = 0n;
        for (let bit = 0; bit < level; bit++) {
          m |= BigInt((ix >>> bit) & 1) << BigInt(2 * bit);
          m |= BigInt((iy >>> bit) & 1) << BigInt(2 * bit + 1);
        }
        m <<= BigInt(2 * (FINEST - level));
        const key = m * 32n + BigInt(level);
        spans.push(level < deepest ? { exact: key } : { from: key, to: (m + 4n ** BigInt(FINEST - level)) * 32n });
      }
    }
  }
  return spans;
}

/** The searches of a window's spans, after the index's leading values. */
function searchesOf(spans: readonly Span[], prefix: readonly string[]): DatasetKeySearch[] {
  return spans.map((span) => 'exact' in span
    ? { fields: [...prefix, printInteger(span.exact)] }
    : { from: [...prefix, printInteger(span.from)], to: [...prefix, printInteger(span.to)] });
}

/** Whether a span holds a key. */
function holds(span: Span, key: bigint): boolean {
  return 'exact' in span ? integerEqual(key, span.exact) : integerOrder(span.from, key) <= 0 && integerOrder(key, span.to) < 0;
}

/** Whether a rack's box — its footprint about its centre — meets a viewport grown by its margin. */
function meets(rack: Rack, view: View): boolean {
  if (rack.x.type === 'none' || rack.y.type === 'none') return false;
  const margin = Math.max(view.maxX - view.minX, view.maxY - view.minY) / 8;
  const x = rack.x.value, y = rack.y.value;
  return x - rack.w / 2 <= view.maxX + margin && x + rack.w / 2 >= view.minX - margin
    && y - rack.h / 2 <= view.maxY + margin && y + rack.h / 2 >= view.minY - margin;
}

/** The floor's racks stand in x from −30 to 31.2 and in y from −20 to 331. */
const FLOOR: View = { minX: -35, minY: -25, maxX: 35, maxY: 340 };
/** The viewports the suite reads: a few racks, less than a rack's footprint, the whole floor, and none of it. */
const VIEWS: readonly View[] = [
  { minX: -5, minY: 0, maxX: 5, maxY: 6 },
  { minX: 0.1, minY: 0.2, maxX: 0.6, maxY: 0.5 },
  FLOOR,
  { minX: 1_000, minY: 1_000, maxX: 1_010, maxY: 1_006 },
];

export function areaRecordTests(setup: TestSetup<TestContext>): void {
  /** A deployed floor of {@link RACKS} racks, the content hash it holds, and its racks as it holds them. */
  const withRacks = async (t: Parameters<TestSetup<TestContext>>[0]): Promise<{ ctx: TestContext; hash: string; racks: Racks }> => {
    const ctx = await setup(t);
    const opts = await ctx.opts();
    const zipPath = await createAreaRecordPackageZip(ctx.tempDir, PKG, VERSION);
    await packageImport(ctx.config.baseUrl, ctx.repoName, readFileSync(zipPath), opts);
    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, WS, opts);
    await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, WS, `${PKG}@${VERSION}`, opts);
    const seeded = await workspaceRecordMutate(
      ctx.config.baseUrl, ctx.repoName, WS, 'racks', 'seed',
      { args: [encodeInt(RACKS)], actor: none, limits: none }, opts,
    );
    assert.equal(seeded.outcome.type, 'committed', `seeding must commit, got ${seeded.outcome.type}`);
    return { ctx, hash: await hashOf(ctx), racks: await racksOf(ctx) };
  };

  /** The content hash the floor holds now. */
  const hashOf = async (ctx: TestContext): Promise<string> => {
    const status = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, WS, racksPath, await ctx.opts());
    assert.ok(status.hash.type === 'some', 'the record holds a state');
    return status.hash.value;
  };

  /** The floor's racks, read whole through the ordinary dataset door. */
  const racksOf = async (ctx: TestContext): Promise<Racks> => {
    const { data } = await datasetGet(ctx.config.baseUrl, ctx.repoName, WS, racksPath, await ctx.opts());
    return decodeRacks(data as Uint8Array);
  };

  /**
   * A window read through an index: its searches in one request, then the runs
   * they select, read on until every entry is in hand — each at the hash
   * given, and none joined.
   */
  const readWindow = async <E>(ctx: TestContext, index: string, decode: (data: Uint8Array) => E[], searches: DatasetKeySearch[], hash: string): Promise<E[]> => {
    const opts = await ctx.opts();
    const base = [ctx.config.baseUrl, ctx.repoName, WS, racksPath] as const;
    const found = await datasetFindKeys(...base, { queries: searches, index, hash }, opts);
    assert.equal(found.hash, hash, 'every search is answered at the content pinned');
    assert.equal(found.results.length, searches.length, 'an answer a search');
    let rest = found.results.filter((result) => result.count > 0)
      .map((result): [number, number] => [result.row, result.count]).sort((a, b) => a[0] - b[0]);
    const entries: E[] = [];
    while (rest.length > 0) {
      const read = await datasetGetRuns(...base, { runs: rest, hash, index }, opts);
      assert.equal(read.hash, hash, 'the runs are read at the content pinned');
      assert.ok(read.count > 0, 'a read of runs answers some of their entries');
      entries.push(...decode(read.data));
      // The runs named, less the entries in hand.
      let taken = read.count;
      const next: [number, number][] = [];
      for (const [row, count] of rest) {
        if (taken >= count) { taken -= count; continue; }
        next.push([row + taken, count - taken]);
        taken = 0;
      }
      rest = next;
    }
    return entries;
  };

  /**
   * Holds a window's entries to the brute force — the racks `keep` keeps that
   * are filed under its spans, and no other, each once, each with its row,
   * filed under the key its box gives and read from the index alone — and,
   * given its viewport, every rack `keep` keeps whose box meets it among them.
   *
   * @returns The keys of the racks read, in East's order
   */
  const assertWindow = (entries: readonly (AreaEntry | HallAreaEntry)[], racks: Racks, spans: readonly Span[],
    keep: (rack: Rack) => boolean, view: View | undefined): string[] => {
    const keys = entries.map((entry) => entry.key).sort(stringOrder);
    assert.equal(new Set(keys).size, keys.length, 'each rack once');
    for (const entry of entries) {
      const rack = racks.get(entry.key);
      assert.ok(rack !== undefined, `${entry.key} is a rack the floor holds`);
      assert.ok(rackEqual(entry.value, rack), `${entry.key}'s entry carries its row whole`);
      assert.ok(unjoined(entry.row, none), `${entry.key} is read from the index alone, never joined`);
      assert.ok(integerEqual(entry.ik.__area, keyOf(rack)), `${entry.key} is filed under the key its box gives`);
    }
    const filed = [...racks].filter(([, rack]) => keep(rack) && spans.some((span) => holds(span, keyOf(rack))))
      .map(([key]) => key).sort(stringOrder);
    assert.deepEqual(keys, filed, 'the racks filed under the window\'s searches, and no other');
    if (view !== undefined) {
      const read = new Set(keys);
      const missed = [...racks].filter(([key, rack]) => keep(rack) && meets(rack, view) && !read.has(key)).map(([key]) => key);
      assert.deepEqual(missed, [], 'every rack whose box meets the window is read');
    }
    return keys;
  };

  describe('records read by area', { concurrency: false }, () => {
    it('reads a window from an area index alone: the racks filed under its searches, every rack whose box meets it among them, each once with its row, at one hash', async (t) => {
      const { ctx, hash, racks } = await withRacks(t);
      const opts = await ctx.opts();
      const base = [ctx.config.baseUrl, ctx.repoName, WS, racksPath] as const;

      // Each index as the record describes it: built, keyed by its leading
      // fields and `__area`, and carrying the row whole.
      const sig = await workspaceRecordDescribe(ctx.config.baseUrl, ctx.repoName, WS, 'racks', opts);
      assert.deepEqual(sig.indexes.map(({ name, multi, built }) => [name, multi, built]),
        [['racks_by_area', false, true], ['racks_by_hall_area', false, true]]);
      for (const [at, keyType, windowType] of [[0, RackAreaKeyType, AreaWindowType], [1, RackHallAreaKeyType, HallAreaWindowType]] as const) {
        const index = sig.indexes[at]!;
        assert.ok(isTypeValueEqual(index.keyType, toEastTypeValue(keyType)), `${index.name}'s key is its leading fields, then __area`);
        assert.ok(isTypeValueEqual(index.valueType, toEastTypeValue(RackRowType)), `${index.name} carries the row whole`);
        assert.ok(isTypeEqual(windowType, indexWindowType(StringType, keyType, RackRowType, RackRowType)), `${index.name}'s window is e3-types' index window`);
        const page = await datasetGetPage(...base, { offset: 0, limit: 1, index: index.name, hash }, opts);
        assert.equal(BigInt(page.totalElements), RACKS, `${index.name} files each rack once`);
        assert.ok(page.segmentCount >= 2, `${index.name} spans segments, got ${page.segmentCount}`);
      }

      const reads: number[] = [];
      for (const view of VIEWS) {
        const spans = windowSpans(view);
        assert.ok(spans.length <= 266, `a window is at most 266 searches, planned ${spans.length}`);
        const entries = await readWindow(ctx, 'racks_by_area', decodeAreaWindow, searchesOf(spans, []), hash);
        reads.push(assertWindow(entries, racks, spans, () => true, view).length);
      }
      const placed = [...racks.values()].filter((rack) => rack.x.type === 'some').length;
      assert.ok(reads[0]! > 0 && reads[0]! < placed / 10, `a few racks' window reads a few of the floor's, read ${reads[0]} of ${placed}`);
      assert.equal(reads[2], placed, 'a window over the whole floor reads every placed rack');
      assert.equal(reads[3], 0, 'a window over none of it reads nothing');
    });

    it('a hall chosen beside a window reads through the area index the hall leads', async (t) => {
      const { ctx, hash, racks } = await withRacks(t);
      const view = VIEWS[0]!;
      const spans = windowSpans(view);
      for (const hall of ['H0', 'H1', 'H2']) {
        const entries = await readWindow(ctx, 'racks_by_hall_area', decodeHallAreaWindow, searchesOf(spans, [printString(hall)]), hash);
        assert.ok(entries.every((entry) => stringEqual(entry.ik.hall, hall)), `hall ${hall}'s searches read only its own entries`);
        const keys = assertWindow(entries, racks, spans, (rack) => stringEqual(rack.hall, hall), view);
        assert.ok(keys.length > 0, `hall ${hall} has racks in the window`);
      }
    });

    it('the unplaced read is the racks with no place, under -1', async (t) => {
      const { ctx, hash, racks } = await withRacks(t);
      const unplaced = [...racks].filter(([, rack]) => rack.x.type === 'none').map(([key]) => key).sort(stringOrder);
      assert.equal(unplaced.length, Math.ceil(Number(RACKS) / 11), 'every eleventh rack is not yet placed');
      const spans: Span[] = [{ exact: -1n }];
      const all = await readWindow(ctx, 'racks_by_area', decodeAreaWindow, searchesOf(spans, []), hash);
      assert.deepEqual(assertWindow(all, racks, spans, () => true, undefined), unplaced);
      const inHall = await readWindow(ctx, 'racks_by_hall_area', decodeHallAreaWindow, searchesOf(spans, [printString('H2')]), hash);
      assert.deepEqual(assertWindow(inHall, racks, spans, (rack) => stringEqual(rack.hall, 'H2'), undefined),
        unplaced.filter((key) => stringEqual(racks.get(key)!.hall, 'H2')));
    });

    it('a moved rack leaves the window it left and is read in the one it moved into, and a stale pin is refused', async (t) => {
      const { ctx, hash, racks } = await withRacks(t);
      const opts = await ctx.opts();
      const view = VIEWS[0]!;
      const before = await readWindow(ctx, 'racks_by_area', decodeAreaWindow, searchesOf(windowSpans(view), []), hash);
      const moved = before.find((entry) => meets(entry.value, view))?.key;
      assert.ok(moved !== undefined, 'a rack stands in the window');
      // Another session moves it across the floor, through the record's patch door.
      const next = new SortedMap(racks, stringOrder);
      next.set(moved, { ...racks.get(moved)!, x: some(25.5), y: some(280.25) });
      const patched = await workspaceRecordMutate(ctx.config.baseUrl, ctx.repoName, WS, 'racks', 'patch',
        { args: [encodePatch(diffFor(RacksType)(racks, next))], actor: none, limits: none }, opts);
      assert.equal(patched.outcome.type, 'committed', `the move must commit, got ${patched.outcome.type}`);
      const movedHash = await hashOf(ctx);
      assert.notEqual(movedHash, hash, 'the move gives the floor another state');
      const now = await racksOf(ctx);
      assert.ok(rackEqual(now.get(moved)!, next.get(moved)!), 'the floor holds the rack where it was moved to');

      const after = await readWindow(ctx, 'racks_by_area', decodeAreaWindow, searchesOf(windowSpans(view), []), movedHash);
      assert.ok(!after.some((entry) => stringEqual(entry.key, moved)), 'the moved rack has left the window');
      assertWindow(after, now, windowSpans(view), () => true, view);
      const there: View = { minX: 24, minY: 279, maxX: 27, maxY: 281 };
      const arrived = await readWindow(ctx, 'racks_by_area', decodeAreaWindow, searchesOf(windowSpans(there), []), movedHash);
      assert.ok(arrived.some((entry) => stringEqual(entry.key, moved)), 'it is read in the window it moved into');
      assertWindow(arrived, now, windowSpans(there), () => true, there);

      const base = [ctx.config.baseUrl, ctx.repoName, WS, racksPath] as const;
      for (const read of [
        () => datasetFindKeys(...base, { queries: searchesOf(windowSpans(view), []), index: 'racks_by_area', hash }, opts),
        () => datasetGetRuns(...base, { runs: [[0, 1]], hash, index: 'racks_by_area' }, opts),
      ]) {
        await assert.rejects(read, (err: unknown) => {
          assert.ok(err instanceof DatasetHashMismatchError, `expected a refused pin, got ${String(err)}`);
          assert.equal(err.currentHash, movedHash, 'the refusal names the content the floor holds');
          return true;
        });
      }
    });
  });
}
