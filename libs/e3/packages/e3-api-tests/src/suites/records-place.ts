/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Where a narrowing's rows sit in a record (#1349): `place`, how many of a
 * narrowing's rows each record segment holds, from its runs of one of the
 * record's indexes, and `within`, which of some index entries those runs hold.
 *
 * Each plan form a record Slice resolves to runs — one value, several values,
 * a prefix, a range, a Set field's one value, and an interval index's start
 * and carry-in runs — is planned here as a client plans it, its runs found in
 * one request, and held to the record read whole: the rows its choices match,
 * counted in the segments pages by segment say the record holds. Then the
 * windows a placement is read in, `within` against a search by each entry's
 * key intersected with the runs, the bounds a page holds a window to, the most
 * runs a request takes, and the refusals: a stale pin, runs that are no runs
 * of the index and a key that is no entry key.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ArrayType, DateTimeType, IntegerType, NullType, OptionType, StringType, StructType, compareFor, decodeBeast2For, encodeBeast2For, equalFor,
  isTypeEqual, none, printFor, variant, type EastType, type ValueTypeOf,
} from '@elaraai/east';
import {
  ApiError,
  DatasetHashMismatchError,
  packageImport,
  workspaceCreate,
  workspaceDeploy,
  workspaceRecordMutate,
  datasetFindKeys,
  datasetGet,
  datasetGetPage,
  datasetGetRuns,
  datasetGetStatus,
  datasetPlace,
  datasetWithin,
  type DatasetKeySearch,
  type DatasetPlacedSegment,
} from '@elaraai/e3-api-client';
import { indexWindowType } from '@elaraai/e3-types';

import { assertMutationCommitted } from '../assertions.js';
import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { createPlaceRecordPackageZip, ORDERS_FROM, OrderRowType, OrdersType } from '../fixtures.js';

const PKG = 'place-record-pkg';
const VERSION = '1.0.0';
const WS = 'place-record-ws';
const ordersPath = [variant('field', 'records'), variant('field', 'orders')];

/** How many orders the record holds: more than a page's 10,000 entries, so a
 *  placement of every entry of an index is cut and placed on. */
const ORDERS = 12_000n;

type Order = ValueTypeOf<typeof OrderRowType>;
type Orders = ValueTypeOf<typeof OrdersType>;
type Run = [number, number];

const encodeInt = encodeBeast2For(IntegerType);
const decodeOrders = decodeBeast2For(OrdersType);
const printString = printFor(StringType);
const printInteger = printFor(IntegerType);
const printDateTime = printFor(DateTimeType);
const stringEqual = equalFor(StringType);
const integerOrder = compareFor(IntegerType);
const dateTimeOrder = compareFor(DateTimeType);

/** An entry key of an index whose key is one String: `(ik=…, k=…)`. */
const printStringEntry = printFor(StructType({ ik: StringType, k: StringType }));
/** The interval index's key: an entry's node, then the order's start. */
const IntervalKeyType = StructType({ __interval: IntegerType, start: DateTimeType });
/** An entry key of the interval index: its node and start, then the order's key. */
const printIntervalEntry = printFor(StructType({ ik: IntervalKeyType, k: StringType }));
/**
 * A window of an index's entries as a read of its runs decodes them, unjoined:
 * e3-types' `indexWindowType` of the orders' key, the index's key, the Null
 * an index on fields carries, and the row. The membership test holds each to
 * `indexWindowType` itself.
 */
const windowOf = <IK extends EastType>(ik: IK) => ArrayType(StructType({ ik, key: StringType, value: NullType, row: OptionType(OrderRowType) }));
const StringWindowType = windowOf(StringType);
const IntervalWindowType = windowOf(IntervalKeyType);
const decodeStringWindow = decodeBeast2For(StringWindowType);
const decodeIntervalWindow = decodeBeast2For(IntervalWindowType);

/** The interval tree's leaves and bias, as the SDK files an event (`record-interval.ts`). */
const BIAS = 1n << 53n;
const LEAVES = 1n << 54n;

/** The window the interval plan reads: `[from, to)`. */
const WINDOW = { from: new Date(ORDERS_FROM.getTime() + 20 * 3_600_000), to: new Date(ORDERS_FROM.getTime() + 50 * 3_600_000) };

/**
 * One plan form: the index it reads, its searches as a client plans them, and
 * what its choices mean — the rows it matches, by the record's own fields.
 */
interface Plan {
  name: string;
  index: string;
  searches: DatasetKeySearch[];
  matches(order: Order): boolean;
}

/**
 * An interval window's searches, as a record Slice plans them (east-ui's
 * `intervalQueries`): the starts inside it, then the carry-ins from each
 * ancestor of its lower bound.
 */
function intervalSearches(from: Date, to: Date): DatasetKeySearch[] {
  const zero = printInteger(0n);
  const searches: DatasetKeySearch[] = [{ from: [zero, printDateTime(from)], to: [zero, printDateTime(to)] }];
  const after = printDateTime(new Date(from.getTime() + 1));
  for (let child = 3n * (1n << 53n) + BigInt(from.getTime()); child > 1n; child /= 2n) {
    const right = child % 2n === 1n;
    const code = 2n * (child / 2n) + (right ? 1n : 0n);
    searches.push(right
      ? { from: [printInteger(code), after], to: [printInteger(code + 1n)] }
      : { from: [printInteger(code)], to: [printInteger(code), printDateTime(from)] });
  }
  return searches;
}

/** The plan forms a record Slice resolves to runs of an index. */
const PLANS: readonly Plan[] = [
  { name: 'one value', index: 'orders_by_status', searches: [{ key: printString('late') }], matches: (order) => stringEqual(order.status, 'late') },
  {
    name: 'several values', index: 'orders_by_status', searches: [{ key: printString('held') }, { key: printString('late') }],
    matches: (order) => stringEqual(order.status, 'held') || stringEqual(order.status, 'late'),
  },
  { name: 'a prefix', index: 'orders_by_name', searches: [{ prefix: 'Ce' }], matches: (order) => order.name.startsWith('Ce') },
  {
    name: 'a range', index: 'orders_by_due', searches: [{ from: [printInteger(1000n)], to: [printInteger(3000n)] }],
    matches: (order) => integerOrder(order.due, 1000n) >= 0 && integerOrder(order.due, 3000n) < 0,
  },
  { name: 'a Set field\'s one value', index: 'orders_by_tag', searches: [{ key: printString('t3') }], matches: (order) => order.tags.has('t3') },
  {
    name: 'an interval index\'s start and carry-in runs', index: 'orders_by_time', searches: intervalSearches(WINDOW.from, WINDOW.to),
    // Starts inside the window, or carried into it: started before, ended after its start.
    matches: (order) => (dateTimeOrder(order.start, WINDOW.from) >= 0 && dateTimeOrder(order.start, WINDOW.to) < 0)
      || (dateTimeOrder(order.start, WINDOW.from) < 0 && dateTimeOrder(order.end, WINDOW.from) > 0),
  },
];

/** One index entry of an order: its key's `.east` literal, `(ik=…, k=…)`, and the literals of the index's flattened key, `ik`'s leaves then `k`. */
interface Entry {
  key: string;
  flat: string[];
}

/** An order's entries in an index, as the SDK files them: one a row, one a tag, or the interval's up to three. */
function entriesOf(index: string, key: string, order: Order): Entry[] {
  const byString = (ik: string): Entry => ({ key: printStringEntry({ ik, k: key }), flat: [printString(ik), printString(key)] });
  const byNode = (node: bigint, at: Date): Entry => ({
    key: printIntervalEntry({ ik: { __interval: node, start: at }, k: key }),
    flat: [printInteger(node), printDateTime(at), printString(key)],
  });
  switch (index) {
    case 'orders_by_status': return [byString(order.status)];
    case 'orders_by_name': return [byString(order.name)];
    case 'orders_by_tag': return [...order.tags].map(byString);
    case 'orders_by_time': {
      const start = BigInt(order.start.getTime());
      const end = BigInt(order.end.getTime());
      const entries = [byNode(0n, order.start)];
      // A positive duration is filed at the lowest common ancestor of its first and last milliseconds, by its start and by its end.
      if (end > start + 1n) {
        let left = start + BIAS + LEAVES;
        let right = end - 1n + BIAS + LEAVES;
        while (left !== right) { left /= 2n; right /= 2n; }
        entries.push(byNode(2n * left, order.start), byNode(2n * left + 1n, order.end));
      }
      return entries;
    }
    default: throw new Error(`no entries of ${index}`);
  }
}

/** Adds placements up, segment by segment. */
function sum(placements: readonly DatasetPlacedSegment[][]): DatasetPlacedSegment[] {
  const held = new Map<number, DatasetPlacedSegment>();
  for (const segment of placements.flat()) {
    const known = held.get(segment.segment);
    held.set(segment.segment, known === undefined ? { ...segment } : { ...known, rows: known.rows + segment.rows });
  }
  return [...held.values()].sort((a, b) => a.segment - b.segment);
}

export function placeRecordTests(setup: TestSetup<TestContext>): void {
  /** A deployed record of {@link ORDERS} orders, the content hash it holds, and its orders as it holds them. */
  const withOrders = async (t: Parameters<TestSetup<TestContext>>[0]): Promise<{ ctx: TestContext; hash: string; orders: Orders }> => {
    const ctx = await setup(t);
    const opts = await ctx.opts();
    const zipPath = await createPlaceRecordPackageZip(ctx.tempDir, PKG, VERSION);
    await packageImport(ctx.config.baseUrl, ctx.repoName, readFileSync(zipPath), opts);
    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, WS, opts);
    await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, WS, `${PKG}@${VERSION}`, opts);
    const seeded = await workspaceRecordMutate(
      ctx.config.baseUrl, ctx.repoName, WS, 'orders', 'seed',
      { args: [encodeInt(ORDERS)], actor: none, limits: none }, opts,
    );
    assertMutationCommitted(seeded, 'seeding');
    const status = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, WS, ordersPath, opts);
    assert.ok(status.hash.type === 'some', 'the record holds a state');
    const { data } = await datasetGet(ctx.config.baseUrl, ctx.repoName, WS, ordersPath, opts);
    return { ctx, hash: status.hash.value, orders: decodeOrders(data as Uint8Array) };
  };

  /** A plan's runs of its index: its searches in one request, sorted, the empty ones dropped. */
  const runsOf = async (ctx: TestContext, plan: Plan, hash: string): Promise<Run[]> => {
    const found = await datasetFindKeys(ctx.config.baseUrl, ctx.repoName, WS, ordersPath,
      { queries: plan.searches, index: plan.index, hash }, await ctx.opts());
    return found.results.filter((result) => result.count > 0)
      .map((result): Run => [result.row, result.count]).sort((a, b) => a[0] - b[0]);
  };

  /**
   * Each run's first and last entries, and the entries just outside it — where
   * a slip at a run's edge shows — read from the index in one request: each
   * entry's key, `(ik=…, k=…)`, beside the row it sits at.
   */
  const edgesOf = async (ctx: TestContext, index: string, runs: readonly Run[], hash: string): Promise<{ row: number; key: string }[]> => {
    const opts = await ctx.opts();
    const base = [ctx.config.baseUrl, ctx.repoName, WS, ordersPath] as const;
    const size = (await datasetGetPage(...base, { offset: 0, limit: 1, index, hash }, opts)).totalElements;
    const rows = [...new Set(runs.flatMap(([row, count]) => [row - 1, row, row + count - 1, row + count]))]
      .filter((row) => row >= 0 && row < size).sort((a, b) => a - b);
    const read = await datasetGetRuns(...base, { runs: rows.map((row): Run => [row, 1]), hash, index }, opts);
    assert.equal(read.count, rows.length, 'the edges are read in one request');
    const keys = index === 'orders_by_time'
      ? decodeIntervalWindow(read.data).map((entry) => printIntervalEntry({ ik: entry.ik, k: entry.key }))
      : decodeStringWindow(read.data).map((entry) => printStringEntry({ ik: entry.ik, k: entry.key }));
    return keys.map((key, i) => ({ row: rows[i]!, key }));
  };

  /** Every window of a placement, read on from what each placed until the runs are placed, adding up. */
  const placeAll = async (ctx: TestContext, index: string, runs: readonly Run[], hash: string, limit?: number) => {
    const opts = await ctx.opts();
    const windows: DatasetPlacedSegment[][] = [];
    let offset = 0;
    for (;;) {
      const window = await datasetPlace(ctx.config.baseUrl, ctx.repoName, WS, ordersPath,
        { index, runs, offset, hash, ...(limit !== undefined && { limit }) }, opts);
      assert.equal(window.hash, hash, 'every window is placed at the content pinned');
      if (window.placed === 0) break;
      windows.push(window.segments);
      offset += window.placed;
      if (offset === window.runEntries) break;
    }
    return { windows, placed: offset, segments: sum(windows) };
  };

  /** The record's segments, as pages by segment answer them: each one's first row and its rows. */
  const segmentsOf = async (ctx: TestContext, hash: string): Promise<{ offset: number; count: number }[]> => {
    const opts = await ctx.opts();
    const first = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, WS, ordersPath, { segment: 0, hash }, opts);
    const segments = [{ offset: first.offset, count: first.count }];
    for (let segment = 1; segment < first.segmentCount; segment++) {
      const page = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, WS, ordersPath, { segment, hash }, opts);
      segments.push({ offset: page.offset, count: page.count });
    }
    return segments;
  };

  /** Where the orders a plan matches sit, worked out from the record read whole: each segment holding some, with how many. */
  const expectedOf = (orders: Orders, segments: readonly { offset: number; count: number }[], matches: (order: Order) => boolean): DatasetPlacedSegment[] => {
    const held = new Map<number, number>();
    let position = 0;
    let segment = 0;
    for (const order of orders.values()) {
      while (position >= segments[segment]!.offset + segments[segment]!.count) segment++;
      if (matches(order)) held.set(segment, (held.get(segment) ?? 0) + 1);
      position++;
    }
    return [...held].sort((a, b) => a[0] - b[0]).map(([at, rows]) => ({ segment: at, offset: segments[at]!.offset, count: segments[at]!.count, rows }));
  };

  describe('where a narrowing\'s rows sit in a record', { concurrency: false }, () => {
    it('places each plan form\'s rows segment by segment, as the record read whole has them', async (t) => {
      const { ctx, hash, orders } = await withOrders(t);
      const segments = await segmentsOf(ctx, hash);
      assert.ok(segments.length > 2, `the record spans segments, ${segments.length} of them`);
      assert.equal(segments.reduce((total, segment) => total + segment.count, 0), Number(ORDERS), 'the segments hold every order');
      for (const plan of PLANS) {
        const runs = await runsOf(ctx, plan, hash);
        const placed = await placeAll(ctx, plan.index, runs, hash);
        const expected = expectedOf(orders, segments, plan.matches);
        assert.ok(expected.length > 0, `${plan.name} matches some orders`);
        assert.deepEqual(placed.segments, expected, `${plan.name}: the rows it matches, in the segments that hold them`);
        assert.equal(placed.placed, expected.reduce((total, segment) => total + segment.rows, 0), `${plan.name}: one entry a matched row`);
      }
    });

    it('places a window of the runs at a time, the windows adding up to one window\'s placement', async (t) => {
      const { ctx, hash } = await withOrders(t);
      const plan = PLANS[1]!;
      const runs = await runsOf(ctx, plan, hash);
      const whole = await placeAll(ctx, plan.index, runs, hash);
      assert.equal(whole.windows.length, 1, 'half the orders place in one window');
      const windows = await placeAll(ctx, plan.index, runs, hash, 333);
      assert.ok(windows.windows.length > 10, `333 at a time takes many windows, took ${windows.windows.length}`);
      assert.deepEqual(windows.segments, whole.segments, 'the windows add up to the whole, segment by segment');
      const past = await datasetPlace(ctx.config.baseUrl, ctx.repoName, WS, ordersPath,
        { index: plan.index, runs, offset: whole.placed, hash }, await ctx.opts());
      assert.deepEqual([past.segments, past.placed], [[], 0], 'past the runs\' end, nothing is placed');
    });

    it('holds a window to a page\'s bounds, and takes as many as 10,000 runs, refusing more', async (t) => {
      const { ctx, hash } = await withOrders(t);
      const opts = await ctx.opts();
      const base = [ctx.config.baseUrl, ctx.repoName, WS, ordersPath] as const;
      // Every entry of an index of one entry an order.
      const every: Run[] = [[0, Number(ORDERS)]];
      const first = await datasetPlace(...base, { index: 'orders_by_due', runs: every, hash }, opts);
      assert.equal(first.placed, 10_000, 'a window places a page\'s 10,000 entries at most');
      assert.equal(first.runEntries, Number(ORDERS));
      assert.equal(first.totalElements, Number(ORDERS), 'the record\'s rows');
      const rest = await datasetPlace(...base, { index: 'orders_by_due', runs: every, offset: first.placed, hash }, opts);
      assert.equal(rest.placed, Number(ORDERS) - 10_000, 'the rest places on from where the first stopped');
      const all = sum([first.segments, rest.segments]);
      assert.deepEqual(all.map((segment) => segment.rows), all.map((segment) => segment.count), 'every row of every segment is placed once');

      const most: Run[] = Array.from({ length: 10_000 }, (_, i): Run => [i, 1]);
      const many = await datasetPlace(...base, { index: 'orders_by_due', runs: most, hash }, opts);
      assert.equal(many.placed, 10_000, 'ten thousand runs, the most a placement takes, place in one request');
      assert.deepEqual((await datasetWithin(...base, { index: 'orders_by_due', runs: most, keys: [], hash }, opts)).within, []);
      for (const read of [
        () => datasetPlace(...base, { index: 'orders_by_due', runs: [...most, [10_000, 1]], hash }, opts),
        () => datasetWithin(...base, { index: 'orders_by_due', runs: [...most, [10_000, 1]], keys: [], hash }, opts),
      ]) {
        await assert.rejects(read, (err: unknown) => {
          assert.ok(err instanceof ApiError && err.code === 'bad_request', `more than 10,000 runs are refused, got ${String(err)}`);
          return true;
        });
      }
    });

    it('answers which entries the runs hold as a search by each entry\'s key, intersected with the runs, does', async (t) => {
      const { ctx, hash, orders } = await withOrders(t);
      const opts = await ctx.opts();
      for (const plan of [PLANS[1]!, PLANS[4]!, PLANS[5]!]) {
        const runs = await runsOf(ctx, plan, hash);
        // Every 29th order's entries, in the runs or not.
        const sampled = [...orders].filter((_, i) => i % 29 === 0);
        const entries = sampled.map(([key, order]) => entriesOf(plan.index, key, order));
        const keys = entries.flat();
        const { within, hash: answered } = await datasetWithin(ctx.config.baseUrl, ctx.repoName, WS, ordersPath,
          { index: plan.index, runs, keys: keys.map((entry) => entry.key), hash }, opts);
        assert.equal(answered, hash);
        assert.equal(within.length, keys.length);
        // Each entry's row in the index: where a search of the index's flattened key from the entry lands.
        const found = await datasetFindKeys(ctx.config.baseUrl, ctx.repoName, WS, ordersPath,
          { index: plan.index, hash, queries: keys.map((entry) => ({ from: entry.flat })) }, opts);
        const inRuns = (row: number) => runs.some(([start, count]) => row >= start && row < start + count);
        assert.deepEqual(within, found.results.map((result) => inRuns(result.row)),
          `${plan.name}: an entry is in the runs exactly when its row is`);
        // And by the record read whole: a row is in the narrowing when any of its entries is.
        let at = 0;
        for (const [i, [key, order]] of sampled.entries()) {
          const count = entries[i]!.length;
          assert.equal(within.slice(at, at + count).some(Boolean), plan.matches(order), `${plan.name}: ${key}`);
          at += count;
        }
        assert.ok(within.some(Boolean) && within.some((held) => !held), `${plan.name}: the sample is in and out of the runs`);

        const edges = await edgesOf(ctx, plan.index, runs, hash);
        const atEdges = await datasetWithin(ctx.config.baseUrl, ctx.repoName, WS, ordersPath,
          { index: plan.index, runs, keys: edges.map((edge) => edge.key), hash }, opts);
        assert.deepEqual(atEdges.within, edges.map((edge) => runs.some(([start, count]) => edge.row >= start && edge.row < start + count)),
          `${plan.name}: each run holds its first and last entries, and not those beside it`);
      }
      assert.ok(isTypeEqual(StringWindowType, indexWindowType(StringType, StringType, NullType, OrderRowType)), 'a String index\'s window is e3-types\' index window');
      assert.ok(isTypeEqual(IntervalWindowType, indexWindowType(StringType, IntervalKeyType, NullType, OrderRowType)), 'the interval index\'s window is e3-types\' index window');
    });

    it('refuses a stale pin, runs that are no runs of the index, a key that is no entry key, and an index the record lacks', async (t) => {
      const { ctx, hash } = await withOrders(t);
      const opts = await ctx.opts();
      const base = [ctx.config.baseUrl, ctx.repoName, WS, ordersPath] as const;
      const key = printStringEntry({ ik: 'late', k: 'order-1' });
      const stale = '0'.repeat(64);
      for (const read of [
        () => datasetPlace(...base, { index: 'orders_by_status', runs: [[0, 1]], hash: stale }, opts),
        () => datasetWithin(...base, { index: 'orders_by_status', runs: [[0, 1]], keys: [key], hash: stale }, opts),
      ]) {
        await assert.rejects(read, (err: unknown) => {
          assert.ok(err instanceof DatasetHashMismatchError, `expected a refused pin, got ${String(err)}`);
          assert.equal(err.currentHash, hash, 'the refusal names the content the record holds');
          return true;
        });
      }
      const refusal = async (read: () => Promise<unknown>, code: string, words: RegExp) => {
        await assert.rejects(read, (err: unknown) => {
          assert.ok(err instanceof ApiError && err.code === code, `expected ${code}, got ${String(err)}`);
          assert.match(String(err.details), words);
          return true;
        });
      };
      await refusal(() => datasetPlace(...base, { index: 'orders_by_status', runs: [[10, 5], [12, 3]], hash }, opts), 'bad_request', /run 1 starts at row 12/);
      await refusal(() => datasetPlace(...base, { index: 'orders_by_status', runs: [[Number(ORDERS), 1]], hash }, opts), 'bad_request', /past the collection's/);
      await refusal(() => datasetWithin(...base, { index: 'orders_by_status', runs: [[0, 0]], keys: [], hash }, opts), 'bad_request', /run 0 is \[0, 0\]/);
      await refusal(() => datasetWithin(...base, { index: 'orders_by_status', runs: [[0, 1]], keys: [key, printString('late')], hash }, opts), 'key_parse_error', /^key 1: /);
      await refusal(() => datasetPlace(...base, { index: 'nope', runs: [[0, 1]], hash }, opts), 'index_not_found', /has no index 'nope'/);
    });
  });
}
