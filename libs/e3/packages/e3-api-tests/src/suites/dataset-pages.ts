/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Paged dataset read test suite (`?page=true`).
 *
 * Element windows are exact for every collection kind — Array in stream
 * order, Set/Dict in the canonical East key order, which v5 blobs hold on
 * the wire (sorted, disjoint segments). Collection datasets are stored as
 * segment objects under a manifest at every size, so segment addressing
 * always works — and, for a Set or Dict, the boundaries are a pure function
 * of the value, which is what the layout tests at the end of this suite hold
 * the server to.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ArrayType,
  DictType,
  IntegerType,
  SEGMENT_MAX_COUNT,
  StringType,
  StructType,
  decodeBeast2For,
  encodeBeast2For,
  equalFor,
  variant,
} from '@elaraai/east';
import {
  ApiError,
  packageImport,
  workspaceCreate,
  workspaceDeploy,
  datasetGet,
  datasetGetPage,
  datasetGetStatus,
  datasetSet,
} from '@elaraai/e3-api-client';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { createTablePackageZip } from '../fixtures.js';

const RowType = StructType({ id: IntegerType, name: StringType });
const RowsType = ArrayType(RowType);
const LookupType = DictType(StringType, IntegerType);

const rowsPath = [variant('field', 'inputs'), variant('field', 'rows')];
const lookupPath = [variant('field', 'inputs'), variant('field', 'lookup')];
const labelPath = [variant('field', 'inputs'), variant('field', 'label')];

function makeRows(n: number): { id: bigint; name: string }[] {
  return Array.from({ length: n }, (_, i) => ({ id: BigInt(i), name: `row-${i % 97}` }));
}

/** Asserts `fn` rejects with an {@link ApiError} whose server-side detail
 *  text matches `detail` (the client keeps the error type in `message` and
 *  the human text in `details`). */
async function rejectsWithDetail(fn: () => Promise<unknown>, detail: RegExp): Promise<void> {
  await assert.rejects(fn, (err: unknown) => {
    assert.ok(err instanceof ApiError, `expected ApiError, got ${String(err)}`);
    assert.match(String(err.details ?? ''), detail, `error type ${err.code}`);
    return true;
  });
}

/**
 * Register paged dataset read tests.
 *
 * @param setup - Factory that creates a fresh test context per test
 */
export function datasetPageTests(setup: TestSetup<TestContext>): void {
  const withTablePackage: TestSetup<TestContext> = async (t) => {
    const ctx = await setup(t);
    const opts = await ctx.opts();

    const zipPath = await createTablePackageZip(ctx.tempDir, 'pages-pkg', '1.0.0');
    const packageZip = readFileSync(zipPath);
    await packageImport(ctx.config.baseUrl, ctx.repoName, packageZip, opts);

    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, 'pages-ws', opts);
    await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, 'pages-ws', 'pages-pkg@1.0.0', opts);

    return ctx;
  };

  describe('dataset pages', { concurrency: false }, () => {
    it('element windows over a large array are exact across segment boundaries', async (t) => {
      const ctx = await withTablePackage(t);
      const opts = await ctx.opts();

      // More rows than a segment may hold, so the value spans segments
      // wherever the cut rule places them.
      const rows = makeRows(SEGMENT_MAX_COUNT + 1000);
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, encodeBeast2For(RowsType)(rows), opts);

      // A window spanning the boundary between segments 0 and 1.
      const first = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, { segment: 0 }, opts);
      const from = first.count - 100;
      const page = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, { offset: from, limit: 200 }, opts);
      assert.equal(page.totalElements, rows.length);
      assert.equal(page.totalExact, true);
      assert.equal(page.offset, from);
      assert.equal(page.count, 200);
      assert.ok(page.segmentCount >= 2, `large array should be stored segmented, got ${page.segmentCount} segments`);
      assert.ok(page.hash.length === 64, 'source content hash rides on the page');
      const decoded = decodeBeast2For(RowsType)(page.data);
      assert.ok(equalFor(RowsType)(decoded, rows.slice(from, from + 200)), 'page equals the expected slice');

      // Tail clamp: a window past the end returns the available tail.
      const tail = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, { offset: rows.length - 100, limit: 1000 }, opts);
      assert.equal(tail.count, 100);
      assert.ok(equalFor(RowsType)(decodeBeast2For(RowsType)(tail.data), rows.slice(rows.length - 100)), 'tail page equals the expected slice');
    });

    it('segment windows return one segment of an indexed blob', async (t) => {
      const ctx = await withTablePackage(t);
      const opts = await ctx.opts();

      const rows = makeRows(SEGMENT_MAX_COUNT + 1000);
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, encodeBeast2For(RowsType)(rows), opts);

      const first = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, { segment: 0 }, opts);
      assert.equal(first.offset, 0);
      const seg = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, { segment: 1 }, opts);
      assert.equal(seg.offset, first.count, 'segment 1 starts where segment 0 ends');
      assert.ok(seg.count > 0);
      assert.ok(equalFor(RowsType)(decodeBeast2For(RowsType)(seg.data), rows.slice(seg.offset, seg.offset + seg.count)));

      await rejectsWithDetail(
        () => datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, { segment: 99 }, opts),
        /out of range/
      );
    });

    it('small collections are stored indexed too and page exactly', async (t) => {
      const ctx = await withTablePackage(t);
      const opts = await ctx.opts();

      // Collection datasets are indexed at every size — one uniform encoding.
      const rows = makeRows(50);
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, encodeBeast2For(RowsType)(rows), opts);

      const page = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, { offset: 10, limit: 20 }, opts);
      assert.equal(page.totalElements, 50);
      assert.equal(page.segmentCount, 1, 'small blobs carry a one-segment index');
      assert.ok(equalFor(RowsType)(decodeBeast2For(RowsType)(page.data), rows.slice(10, 30)));

      // Segment addressing works at every size.
      const seg = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, { segment: 0 }, opts);
      assert.equal(seg.count, 50);
      assert.ok(equalFor(RowsType)(decodeBeast2For(RowsType)(seg.data), rows));
    });

    it('dict element windows come back in East key order', async (t) => {
      const ctx = await withTablePackage(t);
      const opts = await ctx.opts();

      // Insert keys in reverse — the encoder canonicalizes, so the stored
      // wire is sorted regardless of the source container's iteration order.
      const entries = Array.from({ length: 100 }, (_, i) => [`k${String(i).padStart(3, '0')}`, BigInt(i)] as [string, bigint]);
      const lookup = new Map([...entries].reverse());
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'pages-ws', lookupPath, encodeBeast2For(LookupType)(lookup), opts);

      const page = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', lookupPath, { offset: 10, limit: 5 }, opts);
      assert.equal(page.totalElements, 100);
      assert.equal(page.totalExact, true);
      const decoded = decodeBeast2For(LookupType)(page.data) as Map<string, bigint>;
      assert.deepEqual([...decoded.keys()], ['k010', 'k011', 'k012', 'k013', 'k014'], 'window is sorted by key');
    });

    it('large dict windows page via the segment index in canonical key order', async (t) => {
      const ctx = await withTablePackage(t);
      const opts = await ctx.opts();

      // Stored segmented + indexed, so windows decode only the touched
      // segments via the verified fences.
      const count = SEGMENT_MAX_COUNT + 1000;
      const entries = Array.from({ length: count }, (_, i) => [`k${String(i).padStart(5, '0')}`, BigInt(i)] as [string, bigint]);
      const lookup = new Map([...entries].reverse());
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'pages-ws', lookupPath, encodeBeast2For(LookupType)(lookup), opts);

      // Segment windows of a dict report exact totals too.
      const seg = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', lookupPath, { segment: 0 }, opts);
      assert.equal(seg.totalElements, count);
      assert.equal(seg.totalExact, true);

      const from = seg.count - 5;
      const page = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', lookupPath, { offset: from, limit: 10 }, opts);
      assert.equal(page.totalElements, count);
      assert.equal(page.totalExact, true, 'segment counts are exact for Dict blobs');
      assert.ok(page.segmentCount >= 2, `large dict should be stored segmented, got ${page.segmentCount} segments`);
      assert.equal(page.offset, from);
      assert.equal(page.count, 10);
      const decoded = decodeBeast2For(LookupType)(page.data) as Map<string, bigint>;
      assert.deepEqual(
        [...decoded.entries()],
        entries.slice(from, from + 10),
        'window crosses the segment boundary in canonical key order');
    });

    it('a dict segments the same whatever history produced it', async (t) => {
      const ctx = await withTablePackage(t);
      const opts = await ctx.opts();

      // The property the segment-object layout rests on: the boundaries of a
      // Set or Dict come from its keys, so two equal values are stored as the
      // same segment objects under the same manifest — whatever was written
      // before them. Without it a state shares nothing with its predecessor
      // and every write costs the whole value again.
      const entries = Array.from({ length: 3000 }, (_, i) => [`k${String(i).padStart(5, '0')}`, BigInt(i)] as [string, bigint]);
      const ascending = new Map(entries);
      const descending = new Map([...entries].reverse());

      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'pages-ws', lookupPath, encodeBeast2For(LookupType)(ascending), opts);
      const first = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, 'pages-ws', lookupPath, opts);

      // A different value in between, so nothing can be answered from a cache
      // of the last write.
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'pages-ws', lookupPath,
        encodeBeast2For(LookupType)(new Map(entries.slice(0, 500))), opts);
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'pages-ws', lookupPath, encodeBeast2For(LookupType)(descending), opts);
      const second = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, 'pages-ws', lookupPath, opts);

      assert.equal(second.hash.type, 'some');
      assert.deepEqual(second.hash, first.hash, 'equal values must be stored identically');
      assert.deepEqual(second.segments, first.segments);
      assert.deepEqual(second.size, first.size);
    });

    it('a one-row change re-cuts one segment and leaves the rest', async (t) => {
      const ctx = await withTablePackage(t);
      const opts = await ctx.opts();

      /** Every segment window in order: where it starts, its size, its rows. */
      const segmentWindows = async (): Promise<{ offset: number; count: number; rows: Map<string, bigint> }[]> => {
        const status = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, 'pages-ws', lookupPath, opts);
        const windows: { offset: number; count: number; rows: Map<string, bigint> }[] = [];
        for (let i = 0; i < Number(status.segments.type === 'some' ? status.segments.value : 0n); i++) {
          const page = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', lookupPath, { segment: i }, opts);
          windows.push({ offset: page.offset, count: page.count, rows: decodeBeast2For(LookupType)(page.data) as Map<string, bigint> });
        }
        return windows;
      };

      const entries = Array.from({ length: 3000 }, (_, i) => [`k${String(i).padStart(5, '0')}`, BigInt(i)] as [string, bigint]);
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'pages-ws', lookupPath, encodeBeast2For(LookupType)(entries.reduce((m, [k, v]) => m.set(k, v), new Map<string, bigint>())), opts);
      const before = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, 'pages-ws', lookupPath, opts);
      const windowsBefore = await segmentWindows();
      assert.ok(windowsBefore.length >= 2, `the value spans segments, got ${windowsBefore.length}`);

      const edited = new Map(entries);
      edited.set('k01500', 999999n);
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'pages-ws', lookupPath, encodeBeast2For(LookupType)(edited), opts);
      const after = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, 'pages-ws', lookupPath, opts);
      const windowsAfter = await segmentWindows();

      assert.notDeepEqual(after.hash, before.hash, 'the value changed, so its address must');
      assert.deepEqual(
        windowsAfter.map((w) => [w.offset, w.count]),
        windowsBefore.map((w) => [w.offset, w.count]),
        'one changed row must not move a boundary');
      const changed = windowsAfter.filter((w, i) => !equalFor(LookupType)(w.rows, windowsBefore[i]!.rows));
      assert.equal(changed.length, 1, 'only the segment holding the row is re-cut');
      assert.ok(changed[0]!.rows.has('k01500'), 'and it is the one holding the row');

      // ...and the change is visible where it was made, with its neighbours
      // untouched.
      const page = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', lookupPath, { offset: 1499, limit: 3 }, opts);
      const decoded = decodeBeast2For(LookupType)(page.data) as Map<string, bigint>;
      assert.deepEqual([...decoded.entries()], [['k01499', 1499n], ['k01500', 999999n], ['k01501', 1501n]]);
    });

    it('a whole read of a manifest-backed dataset decodes to the value it was given', async (t) => {
      const ctx = await withTablePackage(t);
      const opts = await ctx.opts();

      // The manifest round trip: the segments splice back into one blob that
      // decodes equal to the whole encode of the same value.
      const entries = Array.from({ length: 3000 }, (_, i) => [`k${String(i).padStart(5, '0')}`, BigInt(i)] as [string, bigint]);
      const lookup = new Map(entries);
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'pages-ws', lookupPath, encodeBeast2For(LookupType)(lookup), opts);

      const whole = await datasetGet(ctx.config.baseUrl, ctx.repoName, 'pages-ws', lookupPath, opts);
      const decoded = decodeBeast2For(LookupType)(whole.data) as Map<string, bigint>;
      assert.equal(decoded.size, 3000);
      assert.deepEqual([...decoded.entries()], entries);

      const status = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, 'pages-ws', lookupPath, opts);
      assert.equal(status.rows.type, 'some');
      assert.equal(status.rows.type === 'some' ? status.rows.value : 0n, 3000n,
        'the status geometry comes from the manifest, with nothing decoded');
    });

    it('non-collection datasets and bad windows are refused', async (t) => {
      const ctx = await withTablePackage(t);
      const opts = await ctx.opts();

      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'pages-ws', labelPath, encodeBeast2For(StringType)('hello'), opts);
      await rejectsWithDetail(
        () => datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', labelPath, { offset: 0, limit: 10 }, opts),
        /Array, Set or Dict/
      );

      const rows = makeRows(10);
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, encodeBeast2For(RowsType)(rows), opts);
      await rejectsWithDetail(
        () => datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, { offset: -1, limit: 10 }, opts),
        /non-negative/
      );
      await rejectsWithDetail(
        () => datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, { offset: 0, limit: 0 }, opts),
        /positive/
      );
    });

    it('hash-pinned windows are immutable-cacheable; stale pins are refused', async (t) => {
      const ctx = await withTablePackage(t);
      const opts = await ctx.opts();

      const rows = makeRows(50);
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, encodeBeast2For(RowsType)(rows), opts);
      const status = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, opts);
      assert.equal(status.hash.type, 'some');
      const hash = status.hash.type === 'some' ? status.hash.value : '';

      // Matching pin through the client: same page, plus the pin round-trips.
      const page = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, { offset: 0, limit: 10, hash }, opts);
      assert.ok(equalFor(RowsType)(decodeBeast2For(RowsType)(page.data), rows.slice(0, 10)));
      assert.equal(page.hash, hash);
      // The page is self-describing about the WHOLE dataset: totalBytes is
      // what the value costs in the store — every segment object plus the
      // manifest naming them, the same number status reports — not the page's
      // own bytes.
      assert.equal(BigInt(page.totalBytes), status.size.type === 'some' ? status.size.value : -1n);
      assert.ok(page.totalBytes > page.data.length, 'whole-blob bytes exceed one page');

      // Header semantics via raw fetch: pinned ⇒ immutable, unpinned ⇒
      // no-store, stale pin ⇒ 409 carrying the current hash — a hash-keyed
      // URL never answers with different bytes, so HTTP caches stay sound.
      const base = `${ctx.config.baseUrl}/api/repos/${encodeURIComponent(ctx.repoName)}/workspaces/pages-ws/datasets/inputs/rows?page=true&offset=0&limit=10`;
      const pinned = await fetch(`${base}&hash=${hash}`);
      assert.equal(pinned.status, 200);
      assert.match(pinned.headers.get('Cache-Control') ?? '', /immutable/);

      const unpinned = await fetch(base);
      assert.equal(unpinned.status, 200);
      assert.equal(unpinned.headers.get('Cache-Control'), 'no-store');

      const stale = await fetch(`${base}&hash=${'0'.repeat(64)}`);
      assert.equal(stale.status, 409);
      assert.equal(stale.headers.get('X-Content-SHA256'), hash);
      assert.equal(stale.headers.get('Cache-Control'), 'no-store');
    });

    it('the requested limit is clamped and the actual count reported', async (t) => {
      const ctx = await withTablePackage(t);
      const opts = await ctx.opts();

      const rows = makeRows(30);
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, encodeBeast2For(RowsType)(rows), opts);

      const page = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, { offset: 0, limit: 10_000 }, opts);
      assert.equal(page.count, 30, 'count reports what actually came back');
      assert.ok(equalFor(RowsType)(decodeBeast2For(RowsType)(page.data), rows));
    });
  });
}
