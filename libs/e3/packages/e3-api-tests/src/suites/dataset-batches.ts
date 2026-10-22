/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A dataset's batch reads (#1351): several key searches of one collection in
 * one request (`findKeys`), the rows of several keys of a record (the rows
 * form), and the entries of several runs of an index (the runs form).
 *
 * Each is held to the reads it batches, which every server answers already: a
 * search to `find`, a row to a search by its key and a one-row page, a run's
 * entries to the pages of its rows by offset — at one content hash, and
 * refused 409 at another, as a pinned page is. What a batch costs a server —
 * each segment read once — is measured in e3-api-server's own specs; this
 * suite pins what a client sees.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { IntegerType, NullType, OptionType, StringType, decodeBeast2For, encodeBeast2For, equalFor, none, some, variant } from '@elaraai/east';
import { datasetRowsType, indexWindowType } from '@elaraai/e3-types';
import {
  ApiError,
  DatasetHashMismatchError,
  packageImport,
  workspaceCreate,
  workspaceDeploy,
  workspaceRecordMutate,
  datasetFindKey,
  datasetFindKeys,
  datasetGetPage,
  datasetGetRows,
  datasetGetRuns,
  datasetGetStatus,
  type DatasetKeySearch,
} from '@elaraai/e3-api-client';

import { assertMutationCommitted } from '../assertions.js';
import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { createBatchReadsPackageZip, ItemGroupKeyType, ItemRowType, ItemsType } from '../fixtures.js';

const PKG = 'batch-reads-pkg';
const VERSION = '1.0.0';
const WS = 'batch-reads-ws';
const itemsPath = [variant('field', 'records'), variant('field', 'items')];

/** How many items the record holds: more than a page's 10,000 entries, so a
 *  read of every run of the index is cut and read on. */
const ROWS = 12_000n;

const encodeInt = encodeBeast2For(IntegerType);
const GroupWindowType = indexWindowType(StringType, ItemGroupKeyType, NullType, ItemRowType);
const decodeGroupWindow = decodeBeast2For(GroupWindowType);
const decodeRows = decodeBeast2For(datasetRowsType(StringType, ItemRowType));
const decodeItems = decodeBeast2For(ItemsType);
const rowEqual = equalFor(OptionType(ItemRowType));
const windowEqual = equalFor(GroupWindowType);

export function datasetBatchTests(setup: TestSetup<TestContext>): void {
  /** A deployed record of {@link ROWS} items, and the content hash it holds. */
  const withItems = async (t: Parameters<TestSetup<TestContext>>[0]): Promise<{ ctx: TestContext; hash: string }> => {
    const ctx = await setup(t);
    const opts = await ctx.opts();
    const zipPath = await createBatchReadsPackageZip(ctx.tempDir, PKG, VERSION);
    await packageImport(ctx.config.baseUrl, ctx.repoName, readFileSync(zipPath), opts);
    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, WS, opts);
    await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, WS, `${PKG}@${VERSION}`, opts);
    const seeded = await workspaceRecordMutate(
      ctx.config.baseUrl, ctx.repoName, WS, 'items', 'seed',
      { args: [encodeInt(ROWS)], actor: none, limits: none }, opts,
    );
    assertMutationCommitted(seeded, 'seeding');
    const status = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, WS, itemsPath, opts);
    assert.ok(status.hash.type === 'some', 'the record holds a state');
    return { ctx, hash: status.hash.value };
  };

  describe('dataset batch reads', { concurrency: false }, () => {
    it('findKeys answers each query as findKey does, at one hash, and refuses a stale hash as findKey does', async (t) => {
      const { ctx, hash } = await withItems(t);
      const opts = await ctx.opts();
      const base = [ctx.config.baseUrl, ctx.repoName, WS, itemsPath] as const;

      const byGroup: DatasetKeySearch[] = [
        { fields: ['"g3"'] },
        { key: '(group="g1", rank=6)' },
        { key: '(group="g1", rank=7)' },
        { prefix: 'g' },
        { prefix: 'h' },
        { from: ['"g2"', '100'], to: ['"g2"', '200'] },
        { from: ['"g4"'] },
      ];
      const batch = await datasetFindKeys(...base, { queries: byGroup, index: 'by_group', hash }, opts);
      assert.equal(batch.hash, hash, 'every answer is of the content pinned');
      const expected = [];
      for (const query of byGroup) {
        const { found, row, count } = await datasetFindKey(...base, { ...query, index: 'by_group', hash }, opts);
        expected.push({ found, row, count });
      }
      assert.deepEqual(batch.results, expected);
      assert.deepEqual(batch.results[0], { found: true, row: 7200, count: 2400 }, 'g3 is the fourth fifth of the index');

      const own: DatasetKeySearch[] = [{ key: '"item-42"' }, { key: '"item-42x"' }, { prefix: 'item-1' }];
      const ownBatch = await datasetFindKeys(...base, { queries: own }, opts);
      const ownExpected = [];
      for (const query of own) {
        const { found, row, count } = await datasetFindKey(...base, query, opts);
        ownExpected.push({ found, row, count });
      }
      assert.deepEqual(ownBatch.results, ownExpected);

      for (const read of [
        () => datasetFindKeys(...base, { queries: own, hash: '0'.repeat(64) }, opts),
        () => datasetFindKey(...base, { key: '"item-42"', hash: '0'.repeat(64) }, opts),
      ]) {
        await assert.rejects(read, (err: unknown) => {
          assert.ok(err instanceof DatasetHashMismatchError, `expected a refused pin, got ${String(err)}`);
          assert.equal(err.currentHash, hash, 'the refusal names the content the record holds');
          return true;
        });
      }
    });

    it('the rows form answers each key\'s row, its absence and its position as a by-key read does, at one hash', async (t) => {
      const { ctx, hash } = await withItems(t);
      const opts = await ctx.opts();
      const base = [ctx.config.baseUrl, ctx.repoName, WS, itemsPath] as const;
      const keys = ['item-11999', 'item-0', 'item-5000x', 'item-7', 'a', 'z', 'item-7'];

      const rows = await datasetGetRows(...base, { keys: keys.map((key) => JSON.stringify(key)), hash }, opts);
      assert.equal(rows.hash, hash);
      assert.equal(rows.count, keys.length, 'a few rows are well inside the budget');
      assert.equal(BigInt(rows.totalElements), ROWS);
      const answers = decodeRows(rows.data);
      assert.equal(answers.length, keys.length);
      for (const [i, key] of keys.entries()) {
        // A by-key read: a search by the key, then a one-row page at its row.
        const found = await datasetFindKey(...base, { key: JSON.stringify(key), hash }, opts);
        const answer = answers[i]!;
        assert.equal(answer.key, key, `key ${i} answers the key asked`);
        assert.equal(answer.position, BigInt(found.row), `key ${i}'s position is its search's row`);
        if (!found.found) {
          assert.ok(rowEqual(answer.row, none), `key ${i} is absent`);
          continue;
        }
        const page = await datasetGetPage(...base, { offset: found.row, limit: 1, hash }, opts);
        const held = [...decodeItems(page.data)];
        assert.equal(held.length, 1);
        assert.equal(held[0]![0], key);
        assert.ok(rowEqual(answer.row, some(held[0]![1])), `key ${i}'s row is the one-row page's`);
      }

      await assert.rejects(() => datasetGetRows(...base, { keys: ['"item-1"'], hash: '0'.repeat(64) }, opts), (err: unknown) => {
        assert.ok(err instanceof DatasetHashMismatchError, `expected a refused pin, got ${String(err)}`);
        assert.equal(err.currentHash, hash);
        return true;
      });
    });

    it('the runs form answers each run\'s entries as pages by offset do, joined or not, at one hash', async (t) => {
      const { ctx, hash } = await withItems(t);
      const opts = await ctx.opts();
      const base = [ctx.config.baseUrl, ctx.repoName, WS, itemsPath] as const;
      const runs: [number, number][] = [[10, 40], [2399, 2], [7200, 25], [11_990, 10]];
      for (const join of [false, true]) {
        const read = await datasetGetRuns(...base, { runs, hash, index: 'by_group', join }, opts);
        assert.equal(read.hash, hash);
        assert.equal(read.count, 77);
        assert.equal(read.runEntries, 77);
        assert.equal(BigInt(read.totalElements), ROWS, 'one entry per item');
        const expected = [];
        for (const [offset, limit] of runs) {
          const page = await datasetGetPage(...base, { offset, limit, index: 'by_group', join, hash }, opts);
          expected.push(...decodeGroupWindow(page.data));
        }
        assert.ok(windowEqual(decodeGroupWindow(read.data), expected), `the runs' entries, in order (join ${join})`);
      }

      await assert.rejects(() => datasetGetRuns(...base, { runs, hash: '0'.repeat(64), index: 'by_group' }, opts), (err: unknown) => {
        assert.ok(err instanceof DatasetHashMismatchError, `expected a refused pin, got ${String(err)}`);
        assert.equal(err.currentHash, hash);
        return true;
      });
      await assert.rejects(() => datasetGetRuns(...base, { runs: [[10, 5], [12, 5]], hash, index: 'by_group' }, opts), (err: unknown) => {
        assert.ok(err instanceof ApiError && err.code === 'bad_request', `overlapping runs are refused, got ${String(err)}`);
        return true;
      });
    });

    it('the runs form cuts an answer at a page\'s bounds, and the rest reads on to the same entries', async (t) => {
      const { ctx, hash } = await withItems(t);
      const opts = await ctx.opts();
      const base = [ctx.config.baseUrl, ctx.repoName, WS, itemsPath] as const;
      // Every run of the index: its five groups, 12,000 entries in all.
      const groups: [number, number][] = [[0, 2400], [2400, 2400], [4800, 2400], [7200, 2400], [9600, 2400]];
      const entries = [];
      let rest: [number, number][] = groups;
      let reads = 0;
      while (rest.length > 0) {
        const read = await datasetGetRuns(...base, { runs: rest, hash, index: 'by_group' }, opts);
        reads++;
        assert.ok(read.count > 0 && read.count <= 10_000, `a page holds at most 10,000 entries, held ${read.count}`);
        assert.equal(read.runEntries, rest.reduce((sum, [, count]) => sum + count, 0), 'it says how many the runs hold');
        entries.push(...decodeGroupWindow(read.data));
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
      assert.ok(reads >= 2, 'twelve thousand entries are more than one page holds');
      const pages = [];
      for (let offset = 0; offset < Number(ROWS); offset += 5000) {
        const page = await datasetGetPage(...base, { offset, limit: 5000, index: 'by_group', hash }, opts);
        pages.push(...decodeGroupWindow(page.data));
      }
      assert.equal(entries.length, Number(ROWS));
      assert.ok(windowEqual(entries, pages), 'read on, the runs hold every entry of the index, in its order');
    });
  });
}
