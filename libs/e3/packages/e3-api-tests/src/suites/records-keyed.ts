/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Keyed-record test suite — the write forms, on a record that spans segments.
 *
 * The scalar-record suite covers the commit protocol; this one covers what a
 * remote backend has to reproduce for a keyed record: one big enough to span
 * segments, written through all three forms — each form described, each
 * commit landing with the delta it wrote, a stale patch refused by key with
 * nothing written — and read as its rows, and through its index in the
 * index's own order, where a key search takes the index's key.
 *
 * It pins results, not costs. Content-defined cutting gives an equal value the
 * same manifest, so a backend that rewrote the whole state on every write
 * would read back identically and pass; the apply's own cost is measured in
 * e3-core's tests.
 *
 * `E3_RECORD_ROWS` sizes the record (default 10,000); a perf run raises it to
 * 100,000 without changing an assertion, because no assertion here is a time.
 *
 * And a record filing a Dict field entry by entry (`index.entries`, #1521): a
 * parcel depot's stations, each with its services' own figures. It is held to
 * a brute force over the rows written — one service's range, read alone,
 * holds every station's entry for it in key order, and the lean rows kept
 * beside it, and the index beside them, carry each station with its services
 * emptied — and, after a patch, an edit and a reduce, to its rebuild: a
 * workspace given the same rows under the version declaring no index, then
 * deployed the version declaring them, whose deploy builds every index over
 * them as `e3 reindex` does, reads page for page as the maintained one and
 * holds the same state, by its content hash.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  IntegerType, OptionType, SortedMap, StringType, compareFor, decodeBeast2For, diffFor, encodeBeast2For, equalFor, isTypeValueEqual, printFor,
  toEastTypeValue, variant, none, PatchType, type PatchTypeOf, type ValueTypeOf,
} from '@elaraai/east';
import { indexWindowType } from '@elaraai/e3-types';
import {
  packageImport,
  workspaceCreate,
  workspaceDeploy,
  datasetFindKey,
  datasetFindKeys,
  datasetGet,
  datasetGetPage,
  datasetGetRuns,
  datasetGetStatus,
  workspaceRecordDescribe,
  workspaceRecordMutate,
  workspaceRecordHistory,
  type DatasetFindQuery,
  type DatasetKeySearch,
} from '@elaraai/e3-api-client';

import { assertMutationCommitted } from '../assertions.js';
import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { templateWorkspace } from '../template.js';
import {
  createEntriesRecordPackageZip, createKeyedRecordPackageZip, PlanRowType, PlanStatusKeyType, PlansType, STATION_SERVICES, StationServiceType,
  StationType, StationsType,
} from '../fixtures.js';

const PKG = 'keyed-record-pkg';
const VERSION = '1.0.0';
const plansPath = [variant('field', 'records'), variant('field', 'plans')];

/** How many rows the record holds. 10,000 spans segments under any key
 *  distribution; a perf run sets 100,000. */
const ROWS = BigInt(process.env['E3_RECORD_ROWS'] ?? '10000');

const encodeInt = encodeBeast2For(IntegerType);
const encodePatch = encodeBeast2For(PatchType(PlansType));
const decodePlans = decodeBeast2For(PlansType);
/** The wire shape of an index page: ordered rows, in the INDEX's order. */
const decodeStatusWindow = decodeBeast2For(
  indexWindowType(StringType, PlanStatusKeyType, StringType, PlanRowType) as never) as
  (data: Uint8Array) => Array<{ ik: { status: string; due: bigint }; key: string; value: string; row: unknown }>;
const planKeys = compareFor(StringType);
/** A conflict's detail, printed as East prints it. */
const printDetail = printFor(OptionType(StringType));
/** What one touched key of a plans patch carries — derived from the patch type
 *  rather than hand-written, so it follows the row type. */
type PlanOp = Extract<ValueTypeOf<PatchTypeOf<typeof PlansType>>, { type: 'patch' }>['value'] extends Map<string, infer Op>
  ? Op : never;

const ENTRIES_PKG = 'entries-record-pkg';
const stationsPath = [variant('field', 'records'), variant('field', 'stations')];
/** How many stations the entries fixture seeds: enough that its indexes span segments. */
const STATIONS = 3000n;
/** How many entries a read of an index's pages asks for at a time. */
const PAGE = 1000;
const encodeString = encodeBeast2For(StringType);
const encodeStationsPatch = encodeBeast2For(PatchType(StationsType));
const decodeStations = decodeBeast2For(StationsType);
type Stations = ValueTypeOf<typeof StationsType>;
type Station = ValueTypeOf<typeof StationType>;
type StationService = ValueTypeOf<typeof StationServiceType>;
/** A window of the entries index: each station's entry for a service, under the service's name, in the index's order. */
const decodeServiceWindow = decodeBeast2For(indexWindowType(StringType, StringType, StationServiceType, StationType) as never) as
  (data: Uint8Array) => Array<{ ik: string; key: string; value: StationService; row: unknown }>;
/** A window of an index carrying the row, under a String: the lean rows, under each station's key, and `by_site`. */
const decodeRowWindow = decodeBeast2For(indexWindowType(StringType, StringType, StationType, StationType) as never) as
  (data: Uint8Array) => Array<{ ik: string; key: string; value: Station; row: unknown }>;
const stringOrder = compareFor(StringType);
const stationEqual = equalFor(StationType);
const serviceEqual = equalFor(StationServiceType);

export function keyedRecordTests(setup: TestSetup<TestContext>): void {
  /** The record's rows, read through the ordinary dataset door. */
  async function readRows(ctx: TestContext, ws: string): Promise<Map<string, { title: string }>> {
    const opts = await ctx.opts();
    const { data } = await datasetGet(ctx.config.baseUrl, ctx.repoName, ws, plansPath, opts);
    return decodePlans(data as Uint8Array) as Map<string, { title: string }>;
  }

  describe('keyed records', { concurrency: false }, () => {
    /** A copy of the deployed, seeded record, the test's own: deployed and seeded once for the suite. */
    const withRecord = templateWorkspace(setup, async (ctx, ws) => {
      const opts = await ctx.opts();
      const zipPath = await createKeyedRecordPackageZip(ctx.tempDir, PKG, VERSION);
      await packageImport(ctx.config.baseUrl, ctx.repoName, readFileSync(zipPath), opts);
      await workspaceCreate(ctx.config.baseUrl, ctx.repoName, ws, opts);
      await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, ws, `${PKG}@${VERSION}`, opts);
      const seeded = await workspaceRecordMutate(
        ctx.config.baseUrl, ctx.repoName, ws, 'plans', 'seed',
        { args: [encodeInt(ROWS)], actor: none, limits: none }, opts,
      );
      assertMutationCommitted(seeded, 'seeding');
    });

    it('describes each mutation\'s write form, and each index with the types a read through it decodes by, built', async (t) => {
      const { ctx, workspace: ws } = await withRecord(t);
      const sig = await workspaceRecordDescribe(ctx.config.baseUrl, ctx.repoName, ws, 'plans', await ctx.opts());
      assert.deepEqual(
        Object.fromEntries(sig.mutations.map((m) => [m.name, m.form])),
        { seed: 'reduce', retitle: 'edit', patch: 'patch' });
      assert.deepEqual(sig.indexes.map(({ name, multi, built }) => [name, multi, built]), [['by_status', false, true]],
        'the deploy built the index, and the state holds it under its declaration');
      assert.deepEqual(sig.migrations, [], 'the record declares no migration');
      assert.ok(isTypeValueEqual(sig.indexes[0]!.keyType, toEastTypeValue(PlanStatusKeyType)), 'the index key\'s type');
      assert.ok(isTypeValueEqual(sig.indexes[0]!.valueType, toEastTypeValue(StringType)), 'the covering projection\'s type');
    });

    it('reads as its rows through the ordinary dataset door, index and all', async (t) => {
      const { ctx, workspace: ws } = await withRecord(t);
      const opts = await ctx.opts();
      const page = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, ws, plansPath, { offset: 0, limit: 3 }, opts);
      assert.equal(BigInt(page.totalElements), ROWS, 'a record with an index still pages as its rows');
      assert.ok(page.segmentCount >= 2, `a ${ROWS}-row record spans segments, got ${page.segmentCount}`);
      assert.equal((await readRows(ctx, ws)).get('p-7')!.title, 'Plan 7');
    });

    it('an edit mutation commits, and the commit names the delta it wrote', async (t) => {
      const { ctx, workspace: ws } = await withRecord(t);
      const opts = await ctx.opts();

      const result = await workspaceRecordMutate(
        ctx.config.baseUrl, ctx.repoName, ws, 'plans', 'retitle',
        { args: [encodeBeast2For(StringType)('p-7')], actor: none, limits: none }, opts,
      );
      assertMutationCommitted(result, 'the edit');
      assert.equal((await readRows(ctx, ws)).get('p-7')!.title, 'RETITLED');

      const { commits } = await workspaceRecordHistory(ctx.config.baseUrl, ctx.repoName, ws, 'plans', 1, opts);
      assert.equal(commits[0]!.mutation, 'retitle');
      assert.equal(commits[0]!.delta.type, 'some', 'the commit records what changed');
    });

    it('a patch mutation applies a client-computed change', async (t) => {
      const { ctx, workspace: ws } = await withRecord(t);
      const opts = await ctx.opts();

      const ops = new SortedMap<string, PlanOp>([
        ['p-11', variant('update', variant('patch', {
          status: variant('unchanged', null),
          due: variant('unchanged', null),
          title: variant('replace', { before: 'Plan 11', after: 'PATCHED' }),
        }))],
      ], planKeys);
      const result = await workspaceRecordMutate(
        ctx.config.baseUrl, ctx.repoName, ws, 'plans', 'patch',
        { args: [encodePatch(variant('patch', ops))], actor: none, limits: none }, opts,
      );
      assertMutationCommitted(result, 'the patch');
      assert.equal((await readRows(ctx, ws)).get('p-11')!.title, 'PATCHED');
    });

    it('a stale patch conflicts, names the key, and writes nothing', async (t) => {
      const { ctx, workspace: ws } = await withRecord(t);
      const opts = await ctx.opts();

      const ops = new SortedMap<string, PlanOp>([
        ['p-11', variant('delete', { status: 'ok', due: 11n, title: 'SOMETHING ELSE' })],
      ], planKeys);
      const result = await workspaceRecordMutate(
        ctx.config.baseUrl, ctx.repoName, ws, 'plans', 'patch',
        { args: [encodePatch(variant('patch', ops))], actor: none, limits: none }, opts,
      );
      assert.ok(result.outcome.type === 'conflict', `expected conflict, got ${result.outcome.type}`);
      // A caller retries a lost race; it re-reads and resubmits a stale write.
      // Only the detail tells the two apart, so it has to reach the caller.
      const { detail } = result.outcome.value;
      assert.ok(detail.type === 'some' && detail.value.includes('p-11'),
        `the conflict names the key that disagreed, got ${printDetail(detail)}`);
      assert.equal((await readRows(ctx, ws)).get('p-11')!.title, 'Plan 11', 'the row is untouched');
    });

    it('reads through the index in the index\'s own order', async (t) => {
      const { ctx, workspace: ws } = await withRecord(t);
      const opts = await ctx.opts();
      const page = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, ws, plansPath,
        { offset: 0, limit: 5, index: 'by_status' }, opts);
      const window = decodeStatusWindow(page.data);
      assert.equal(window.length, 5);
      assert.ok(window.every((entry) => entry.ik.status === 'late'),
        'every `late` entry precedes every `ok` one, whatever their primary keys');
    });

    it('searches through the index by the index\'s own key', async (t) => {
      const { ctx, workspace: ws } = await withRecord(t);
      const opts = await ctx.opts();
      const find = async (query: DatasetFindQuery): Promise<{ found: boolean; row: number; count: number }> => {
        const { found, row, count } = await datasetFindKey(ctx.config.baseUrl, ctx.repoName, ws, plansPath, query, opts);
        return { found, row, count };
      };
      // Every third plan is late, due on its own number, and the late ones sort first.
      const late = Number((ROWS + 2n) / 3n);
      assert.deepEqual(await find({ prefix: 'o', index: 'by_status' }), { found: true, row: late, count: Number(ROWS) - late });
      assert.deepEqual(await find({ fields: ['"late"'], index: 'by_status' }), { found: true, row: 0, count: late });
      assert.deepEqual(await find({ key: '(status="late", due=9)', index: 'by_status' }), { found: true, row: 3, count: 1 });
    });
    it('searches nullable String fields through scalar and compound indexes without including Unset', async (t) => {
      const { ctx, workspace: ws } = await withRecord(t);
      const opts = await ctx.opts();
      const path = [variant('field', 'records'), variant('field', 'contacts')];
      const find = async (query: DatasetFindQuery) => {
        const { found, row, count } = await datasetFindKey(ctx.config.baseUrl, ctx.repoName, ws, path, query, opts);
        return { found, row, count };
      };
      assert.deepEqual(await find({ index: 'by_name', prefix: 'Ad' }), { found: true, row: 1, count: 3 });
      assert.deepEqual(await find({ index: 'by_name', prefix: '' }), { found: true, row: 1, count: 5 });
      assert.deepEqual(await find({ index: 'by_name', key: '.none' }), { found: true, row: 0, count: 1 });
      assert.deepEqual(await find({ index: 'by_name', prefix: 'É' }), { found: true, row: 5, count: 1 });
      assert.deepEqual(await find({ index: 'by_group_name', fields: ['"east"'], prefix: 'Ad' }),
        { found: true, row: 1, count: 2 });
      assert.deepEqual(await find({ index: 'by_group_name', fields: ['"east"'], prefix: '' }),
        { found: true, row: 1, count: 4 });
      assert.deepEqual(await find({ index: 'by_group_name', fields: ['"west"'], prefix: 'Z' }),
        { found: false, row: 6, count: 0 });
    });
  });

  describe('a record filing a Dict field entry by entry (index.entries)', { concurrency: false }, () => {
    /** Writes the stations through their patch door. */
    const writeStations = async (ctx: TestContext, ws: string, patch: Uint8Array): Promise<void> => {
      const written = await workspaceRecordMutate(ctx.config.baseUrl, ctx.repoName, ws, 'stations', 'patch',
        { args: [patch], actor: none, limits: none }, await ctx.opts());
      assertMutationCommitted(written, 'the stations\' patch');
    };

    /** The stations, read whole through the ordinary dataset door. */
    const stationsOf = async (ctx: TestContext, ws: string): Promise<Stations> => {
      const { data } = await datasetGet(ctx.config.baseUrl, ctx.repoName, ws, stationsPath, await ctx.opts());
      return decodeStations(data as Uint8Array);
    };

    /** The content hash the stations hold now: the hash of their rows' and every index's collections. */
    const stationsHash = async (ctx: TestContext, ws: string): Promise<string> => {
      const status = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, ws, stationsPath, await ctx.opts());
      assert.ok(status.hash.type === 'some', 'the stations hold a state');
      return status.hash.value;
    };

    /** An index's pages from its first entry to its last, each as its bytes, and the segments it is held in. */
    const indexPages = async (ctx: TestContext, ws: string, index: string): Promise<{ pages: Uint8Array[]; segments: number }> => {
      const opts = await ctx.opts();
      const pages: Uint8Array[] = [];
      let segments = 0;
      for (let offset = 0, total = 1; offset < total; offset += PAGE) {
        const page = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, ws, stationsPath, { offset, limit: PAGE, index }, opts);
        pages.push(page.data);
        total = page.totalElements;
        segments = page.segmentCount;
      }
      return { pages, segments };
    };

    /**
     * The entries of the entries index the searches select: the searches in
     * one request, then the ranges they select, read on until every entry is
     * in hand — each at the hash given.
     */
    const readRuns = async (ctx: TestContext, ws: string, searches: DatasetKeySearch[], hash: string) => {
      const opts = await ctx.opts();
      const base = [ctx.config.baseUrl, ctx.repoName, ws, stationsPath] as const;
      const found = await datasetFindKeys(...base, { queries: searches, index: 'by_service', hash }, opts);
      assert.equal(found.hash, hash, 'every search is answered at the content pinned');
      let rest = found.results.filter((result) => result.count > 0)
        .map((result): [number, number] => [result.row, result.count]).sort((a, b) => a[0] - b[0]);
      const entries: ReturnType<typeof decodeServiceWindow> = [];
      while (rest.length > 0) {
        const read = await datasetGetRuns(...base, { runs: rest, hash, index: 'by_service' }, opts);
        assert.equal(read.hash, hash, 'the ranges are read at the content pinned');
        assert.ok(read.count > 0, 'a read of the ranges answers some of their entries');
        entries.push(...decodeServiceWindow(read.data));
        // The ranges named, less the entries in hand.
        let taken = read.count;
        const next: [number, number][] = [];
        for (const [row, count] of rest) {
          if (taken >= count) { taken -= count; continue; }
          next.push([row + taken, count - taken]);
          taken = 0;
        }
        rest = next;
      }
      return { found: found.results, entries };
    };

    /** How many rebuilds the suite has made, each in a workspace of its own. */
    let rebuilds = 0;

    /**
     * Holds a workspace's stations to their rebuild: a workspace given the same
     * rows under 1.0.0, which declares no index, then deployed 2.0.0, whose
     * deploy builds every index over them as `e3 reindex` does. Each index
     * reads page for page as its rebuild's, and the record's state — its rows'
     * and every index's collections — has the rebuild's content hash.
     */
    const assertRebuilt = async (ctx: TestContext, ws: string, after: string): Promise<void> => {
      const opts = await ctx.opts();
      const rebuilt = `rebuilt-${++rebuilds}`;
      await workspaceCreate(ctx.config.baseUrl, ctx.repoName, rebuilt, opts);
      await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, rebuilt, `${ENTRIES_PKG}@1.0.0`, opts);
      await writeStations(ctx, rebuilt, encodeStationsPatch(diffFor(StationsType)(new SortedMap(undefined, stringOrder), await stationsOf(ctx, ws))));
      await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, rebuilt, `${ENTRIES_PKG}@2.0.0`, opts);
      for (const index of ['by_service', 'by_service_rows', 'by_site']) {
        const maintained = await indexPages(ctx, ws, index);
        const built = await indexPages(ctx, rebuilt, index);
        assert.equal(maintained.pages.length, built.pages.length, `after ${after}, ${index} holds as many entries as its rebuild`);
        maintained.pages.forEach((page, at) => {
          assert.ok(Buffer.from(page).equals(built.pages[at]!), `after ${after}, page ${at} of ${index} is its rebuild's, byte for byte`);
        });
      }
      assert.equal(await stationsHash(ctx, ws), await stationsHash(ctx, rebuilt),
        `after ${after}, the stations' state — their rows and every index — is the rebuild's, byte for byte`);
    };

    /** A copy of the deployed, seeded stations, the test's own: both versions held, 2.0.0 deployed and seeded once for the suite. */
    const withStations = templateWorkspace(setup, async (ctx, ws) => {
      const opts = await ctx.opts();
      for (const version of ['1.0.0', '2.0.0'] as const) {
        const zipPath = await createEntriesRecordPackageZip(ctx.tempDir, ENTRIES_PKG, version);
        await packageImport(ctx.config.baseUrl, ctx.repoName, readFileSync(zipPath), opts);
      }
      await workspaceCreate(ctx.config.baseUrl, ctx.repoName, ws, opts);
      await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, ws, `${ENTRIES_PKG}@2.0.0`, opts);
      const seeded = await workspaceRecordMutate(ctx.config.baseUrl, ctx.repoName, ws, 'stations', 'seed',
        { args: [encodeInt(STATIONS)], actor: none, limits: none }, opts);
      assertMutationCommitted(seeded, 'seeding the stations');
    });

    it('describes the entries index and the lean rows beside it, each built, typed by the field it files', async (t) => {
      const { ctx, workspace: ws } = await withStations(t);
      const sig = await workspaceRecordDescribe(ctx.config.baseUrl, ctx.repoName, ws, 'stations', await ctx.opts());
      const indexes = [...sig.indexes].sort((a, b) => stringOrder(a.name, b.name));
      assert.deepEqual(indexes.map(({ name, multi, built }) => [name, multi, built]),
        [['by_service', true, true], ['by_service_rows', false, true], ['by_site', false, true]],
        'the deploy built the entries index, the lean rows it keeps beside it, and the index beside them');
      const [byService, rows] = indexes;
      assert.ok(isTypeValueEqual(byService!.keyType, toEastTypeValue(StringType)), 'the entries index is keyed by the field\'s own key');
      assert.ok(isTypeValueEqual(byService!.valueType, toEastTypeValue(StationServiceType)), 'and carries the field\'s value');
      assert.ok(isTypeValueEqual(rows!.keyType, toEastTypeValue(StringType)), 'the lean rows are keyed by the station');
      assert.ok(isTypeValueEqual(rows!.valueType, toEastTypeValue(StationType)), 'and carry its row');
    });

    it('reads one service\'s entries as one range, every station\'s in key order, and two services\' as two in one request', async (t) => {
      const { ctx, workspace: ws } = await withStations(t);
      const stations = await stationsOf(ctx, ws);
      const hash = await stationsHash(ctx, ws);
      /** Each station's entry for a service, in the stations' key order: what the service's range holds. */
      const filed = (service: string) => [...stations].flatMap(([key, station]) => {
        const held = station.byService.get(service);
        return held === undefined ? [] : [{ ik: service, key, value: held }];
      });
      const assertRange = (read: ReturnType<typeof decodeServiceWindow>, services: readonly string[], what: string) => {
        const expected = services.flatMap(filed);
        assert.deepEqual(read.map(({ ik, key }) => [ik, key]), expected.map(({ ik, key }) => [ik, key]),
          `${what}: every station holding it, in key order, and no other entry`);
        read.forEach((entry, at) => {
          assert.ok(serviceEqual(entry.value, expected[at]!.value), `${what}: ${entry.key}'s ${entry.ik} carries its own value`);
        });
      };
      const priority = await readRuns(ctx, ws, [{ key: '"Priority"' }], hash);
      assert.deepEqual(priority.found.map(({ found, count }) => [found, count]), [[true, filed('Priority').length]],
        'the search finds one range, an entry for each station holding Priority');
      assertRange(priority.entries, ['Priority'], 'Priority');
      const two = await readRuns(ctx, ws, [{ key: '"Standard"' }, { key: '"Economy"' }], hash);
      assertRange(two.entries, ['Economy', 'Standard'], 'Economy and Standard');
      const unheld = await readRuns(ctx, ws, [{ key: '"Overnight"' }], hash);
      assert.deepEqual(unheld.found.map(({ found, count }) => [found, count]), [[false, 0]], 'a service no station holds has no range');
    });

    it('keeps each station\'s row beside it with its services emptied, and a page through another index carries none of them', async (t) => {
      const { ctx, workspace: ws } = await withStations(t);
      const stations = await stationsOf(ctx, ws);
      const emptied = (station: Station): Station => ({ ...station, byService: new SortedMap(undefined, stringOrder) });
      const read = async (index: string) => (await indexPages(ctx, ws, index)).pages.flatMap((page) => decodeRowWindow(page));
      const lean = await read('by_service_rows');
      assert.deepEqual(lean.map(({ ik, key }) => [ik, key]), [...stations.keys()].map((key) => [key, key]), 'a lean row a station, under its key');
      lean.forEach((entry) => {
        assert.ok(stationEqual(entry.value, emptied(stations.get(entry.key)!)), `${entry.key}'s lean row holds its services empty, the rest whole`);
      });
      const bySite = await read('by_site');
      assert.equal(bySite.length, stations.size, 'a station a site');
      bySite.forEach((entry) => {
        assert.ok(stationEqual(entry.value, emptied(stations.get(entry.key)!)), `by_site carries ${entry.key} with none of its services`);
      });
      assert.ok([...stations.values()].some((station) => station.byService.size > 0), 'the record\'s own rows keep their services');
    });

    it('is maintained through a patch, an edit and a reduce, each time its rebuild\'s byte for byte', async (t) => {
      const { ctx, workspace: ws } = await withStations(t);
      const opts = await ctx.opts();
      const seeded = await stationsOf(ctx, ws);
      assert.ok((await indexPages(ctx, ws, 'by_service')).segments >= 2, 'the entries index spans segments, each held to its rebuild\'s');
      await assertRebuilt(ctx, ws, 'the seed');

      // A patch: a station gone and one come; one's services changed — the first gone, the rest recounted, Priority come; and
      // one moved to another site, its services as they were.
      const next = new SortedMap(seeded, stringOrder);
      next.delete('s-1');
      const recounted = seeded.get('s-2')!;
      next.set('s-2', {
        ...recounted,
        byService: new SortedMap([
          ...[...recounted.byService].slice(1).map(([service, held]): [string, StationService] => [service, { ...held, parcels: held.parcels + 100n }]),
          ['Priority', { parcels: 1n, waiting: 1n }],
        ], stringOrder),
      });
      next.set('s-3', { ...seeded.get('s-3')!, site: 'East' });
      next.set('s-9999', {
        site: 'North', parcels: 3n,
        byService: new SortedMap<string, StationService>([['Priority', { parcels: 2n, waiting: 0n }], ['Standard', { parcels: 1n, waiting: 1n }]], stringOrder),
      });
      await writeStations(ctx, ws, encodeStationsPatch(diffFor(StationsType)(seeded, next)));
      await assertRebuilt(ctx, ws, 'the patch');

      // An edit: a station holding no service given one.
      assert.equal(seeded.get('s-6')!.byService.size, 0, 's-6 holds no service');
      const edited = await workspaceRecordMutate(ctx.config.baseUrl, ctx.repoName, ws, 'stations', 'set_service',
        { args: [encodeString('s-6'), encodeString('International'), encodeInt(9n)], actor: none, limits: none }, opts);
      assertMutationCommitted(edited, 'the edit');
      await assertRebuilt(ctx, ws, 'the edit');

      // A reduce: a station holding every service cleared of them.
      assert.equal(seeded.get('s-4')!.byService.size, STATION_SERVICES.length, 's-4 holds every service');
      const cleared = await workspaceRecordMutate(ctx.config.baseUrl, ctx.repoName, ws, 'stations', 'clear',
        { args: [encodeString('s-4')], actor: none, limits: none }, opts);
      assertMutationCommitted(cleared, 'the reduce');
      await assertRebuilt(ctx, ws, 'the reduce');

      const written = await stationsOf(ctx, ws);
      assert.ok(serviceEqual(written.get('s-6')!.byService.get('International')!, { parcels: 9n, waiting: 0n }), 's-6 holds International');
      assert.equal(written.get('s-4')!.byService.size, 0, 's-4 holds no service');
      assert.equal(written.get('s-3')!.site, 'East', 's-3 stands at East');
    });
  });
}
