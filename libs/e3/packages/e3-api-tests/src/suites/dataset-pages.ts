/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Paged dataset read test suite (`?page=true`).
 *
 * Element windows are exact for every collection kind — Array in stream
 * order, Set/Dict in East sort order over the merged value. Segment windows
 * need an indexed blob (large collections are stored segmented server-side).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ArrayType,
  DictType,
  IntegerType,
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

      // Above the segmentation threshold, so the server stores this indexed.
      const rows = makeRows(2500);
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, encodeBeast2For(RowsType)(rows), opts);

      // A window spanning the 1000-element segment boundary.
      const page = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, { offset: 900, limit: 200 }, opts);
      assert.equal(page.totalElements, 2500);
      assert.equal(page.totalExact, true);
      assert.equal(page.offset, 900);
      assert.equal(page.count, 200);
      assert.ok(page.segmentCount >= 2, `large array should be stored segmented, got ${page.segmentCount} segments`);
      assert.ok(page.hash.length === 64, 'source content hash rides on the page');
      const decoded = decodeBeast2For(RowsType)(page.data);
      assert.ok(equalFor(RowsType)(decoded, rows.slice(900, 1100)), 'page equals the expected slice');

      // Tail clamp: a window past the end returns the available tail.
      const tail = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, { offset: 2400, limit: 1000 }, opts);
      assert.equal(tail.count, 100);
      assert.ok(equalFor(RowsType)(decodeBeast2For(RowsType)(tail.data), rows.slice(2400)), 'tail page equals the expected slice');
    });

    it('segment windows return one writer batch of an indexed blob', async (t) => {
      const ctx = await withTablePackage(t);
      const opts = await ctx.opts();

      const rows = makeRows(2500);
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, encodeBeast2For(RowsType)(rows), opts);

      const seg = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, { segment: 1 }, opts);
      assert.equal(seg.offset, 1000, 'segment 1 starts after segment 0');
      assert.equal(seg.count, 1000);
      assert.ok(equalFor(RowsType)(decodeBeast2For(RowsType)(seg.data), rows.slice(1000, 2000)));

      await rejectsWithDetail(
        () => datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, { segment: 99 }, opts),
        /out of range/
      );
    });

    it('small (un-indexed) collections page via the fallback, exactly', async (t) => {
      const ctx = await withTablePackage(t);
      const opts = await ctx.opts();

      // Below the segmentation threshold: stored whole-value, no index.
      const rows = makeRows(50);
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, encodeBeast2For(RowsType)(rows), opts);

      const page = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, { offset: 10, limit: 20 }, opts);
      assert.equal(page.totalElements, 50);
      assert.equal(page.segmentCount, 0, 'no index on a small blob');
      assert.ok(equalFor(RowsType)(decodeBeast2For(RowsType)(page.data), rows.slice(10, 30)));

      // Segment addressing needs an index.
      await rejectsWithDetail(
        () => datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', rowsPath, { segment: 0 }, opts),
        /no segment index/
      );
    });

    it('dict element windows come back in East key order', async (t) => {
      const ctx = await withTablePackage(t);
      const opts = await ctx.opts();

      // Insert keys in reverse so wire order differs from sort order.
      const entries = Array.from({ length: 100 }, (_, i) => [`k${String(i).padStart(3, '0')}`, BigInt(i)] as [string, bigint]);
      const lookup = new Map([...entries].reverse());
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'pages-ws', lookupPath, encodeBeast2For(LookupType)(lookup), opts);

      const page = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, 'pages-ws', lookupPath, { offset: 10, limit: 5 }, opts);
      assert.equal(page.totalElements, 100);
      assert.equal(page.totalExact, true);
      const decoded = decodeBeast2For(LookupType)(page.data) as Map<string, bigint>;
      assert.deepEqual([...decoded.keys()], ['k010', 'k011', 'k012', 'k013', 'k014'], 'window is sorted by key');
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
