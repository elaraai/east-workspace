/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A dataset's batch reads (#1351): several key searches of one collection in
 * one request (`findKeys`), the rows of several keys of a record (the rows
 * form) — or of the keys some runs of another record's index name (#1393) —
 * and the entries of several runs of an index (the runs form).
 *
 * Each is held to the reads it batches, which every server answers already: a
 * search to `find`, a row to a search by its key and a one-row page, a row by
 * runs to a read by the keys the runs' entries name, a run's entries to the
 * pages of its rows by offset — at one content hash, and refused 409 at
 * another, as a pinned page is. What a batch costs a server — each segment
 * read once — is measured in e3-api-server's own specs; this suite pins what a
 * client sees.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ArrayType, IntegerType, NullType, OptionType, StringType, decodeBeast2For, encodeBeast2For, equalFor, none, printFor, some, variant,
  type ValueTypeOf,
} from '@elaraai/east';
import { datasetRowsType, indexWindowType } from '@elaraai/e3-types';
import {
  ApiError,
  DatasetHashMismatchError,
  RunsHashMismatchError,
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
import { createBatchReadsPackageZip, ItemGroupKeyType, ItemNoteRowType, ItemRowType, ItemsType } from '../fixtures.js';

const PKG = 'batch-reads-pkg';
const VERSION = '1.0.0';
const WS = 'batch-reads-ws';
const itemsPath = [variant('field', 'records'), variant('field', 'items')];
const notesPath = [variant('field', 'records'), variant('field', 'item_notes')];

/** How many items the record holds: more than a page's 10,000 entries, so a
 *  read of every run of the index is cut and read on. */
const ROWS = 12_000n;

const encodeInt = encodeBeast2For(IntegerType);
const GroupWindowType = indexWindowType(StringType, ItemGroupKeyType, NullType, ItemRowType);
const decodeGroupWindow = decodeBeast2For(GroupWindowType);
const decodeRows = decodeBeast2For(datasetRowsType(StringType, ItemRowType));
const decodeItems = decodeBeast2For(ItemsType);
const NoteRowsType = datasetRowsType(StringType, ItemNoteRowType);
const decodeNoteRows = decodeBeast2For(NoteRowsType) as
  (bytes: Uint8Array) => { key: string; row: ValueTypeOf<OptionType<typeof ItemNoteRowType>>; position: bigint }[];
/** The keys of the entries of a window of the items' `by_group` index, in order. */
const keysOfWindow = (bytes: Uint8Array): string[] => (decodeGroupWindow(bytes) as { key: string }[]).map((entry) => entry.key);
const noteRowsEqual = equalFor(NoteRowsType);
const keysEqual = equalFor(ArrayType(StringType));
const printKey = printFor(StringType);
const rowEqual = equalFor(OptionType(ItemRowType));
const windowEqual = equalFor(GroupWindowType);

/** The runs named, less the first `taken` of their entries: what a read cut at a page's bounds asks again. */
function runsAfter(runs: readonly (readonly [number, number])[], taken: number): [number, number][] {
  const rest: [number, number][] = [];
  let skip = taken;
  for (const [row, count] of runs) {
    if (skip >= count) { skip -= count; continue; }
    rest.push([row + skip, count - skip]);
    skip = 0;
  }
  return rest;
}

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

  /** The notes seeded on every third of the {@link ROWS} items, and the content hash the notes record holds. */
  const withNotes = async (ctx: TestContext): Promise<string> => {
    const opts = await ctx.opts();
    const seeded = await workspaceRecordMutate(
      ctx.config.baseUrl, ctx.repoName, WS, 'item_notes', 'seed_notes',
      { args: [encodeInt(ROWS)], actor: none, limits: none }, opts,
    );
    assertMutationCommitted(seeded, 'seeding the notes');
    const status = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, WS, notesPath, opts);
    assert.ok(status.hash.type === 'some', 'the notes record holds a state');
    return status.hash.value;
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

    it('the rows form by runs answers as a read by the keys the runs\' entries name does, pinned to both records apart', async (t) => {
      const { ctx, hash } = await withItems(t);
      const opts = await ctx.opts();
      const notesHash = await withNotes(ctx);
      const notes = [ctx.config.baseUrl, ctx.repoName, WS, notesPath] as const;
      const runs: [number, number][] = [[10, 40], [2399, 2], [7200, 25], [11_990, 10]];
      const keysOf = { path: itemsPath, index: 'by_group', runs, hash };

      const read = await datasetGetRows(...notes, { keysOf, hash: notesHash }, opts);
      assert.equal(read.hash, notesHash, 'the answer is of the notes pinned');
      assert.equal(read.count, 77);
      assert.equal(read.runEntries, 77);
      assert.equal(BigInt(read.totalElements), ROWS / 3n, 'a note on every third item');
      // The keys the runs' entries name, and a read of the notes by them.
      const named = keysOfWindow((await datasetGetRuns(ctx.config.baseUrl, ctx.repoName, WS, itemsPath, { runs, hash, index: 'by_group' }, opts)).data);
      const byKeys = await datasetGetRows(...notes, { keys: named.map((key) => printKey(key)), hash: notesHash }, opts);
      const answers = decodeNoteRows(read.data);
      assert.ok(noteRowsEqual(answers, decodeNoteRows(byKeys.data)), 'each entry\'s key, its note or none, and its position, in the runs\' order');
      assert.ok(answers.some((answer) => answer.row.type === 'some') && answers.some((answer) => answer.row.type === 'none'),
        'the runs name items with notes and items without');

      await assert.rejects(() => datasetGetRows(...notes, { keysOf, hash: '0'.repeat(64) }, opts), (err: unknown) => {
        assert.ok(err instanceof DatasetHashMismatchError, `expected the notes' pin refused, got ${String(err)}`);
        assert.equal(err.currentHash, notesHash, 'the refusal names the content the notes hold');
        return true;
      });
      await assert.rejects(() => datasetGetRows(...notes, { keysOf: { ...keysOf, hash: '0'.repeat(64) }, hash: notesHash }, opts), (err: unknown) => {
        assert.ok(err instanceof RunsHashMismatchError, `expected the runs' pin refused, got ${String(err)}`);
        assert.equal(err.currentHash, hash, 'the refusal names the content the items hold');
        return true;
      });
      for (const [refused, why] of [
        [{ ...keysOf, runs: [[11_999, 2]] as [number, number][] }, 'runs past the index'],
        [{ ...keysOf, runs: [[10, 5], [12, 5]] as [number, number][] }, 'overlapping runs'],
        [{ ...keysOf, index: 'by_nothing' }, 'an index the items do not hold'],
      ] as const) {
        await assert.rejects(() => datasetGetRows(...notes, { keysOf: refused, hash: notesHash }, opts), (err: unknown) => {
          assert.ok(err instanceof ApiError && !(err instanceof DatasetHashMismatchError) && !(err instanceof RunsHashMismatchError),
            `${why} are refused, got ${String(err)}`);
          return true;
        });
      }
    });

    it('the rows form by runs cuts an answer at a page\'s bounds, and the rest reads on to every entry\'s key', async (t) => {
      const { ctx, hash } = await withItems(t);
      const opts = await ctx.opts();
      const notesHash = await withNotes(ctx);
      // Every run of the index: its five groups, 12,000 entries in all.
      let rest: [number, number][] = [[0, 2400], [2400, 2400], [4800, 2400], [7200, 2400], [9600, 2400]];
      const answers = [];
      let reads = 0;
      while (rest.length > 0) {
        const read = await datasetGetRows(ctx.config.baseUrl, ctx.repoName, WS, notesPath,
          { keysOf: { path: itemsPath, index: 'by_group', runs: rest, hash }, hash: notesHash }, opts);
        reads++;
        assert.ok(read.count > 0 && read.count <= 10_000, `an answer holds at most 10,000 entries, held ${read.count}`);
        assert.equal(read.runEntries, rest.reduce((sum, [, count]) => sum + count, 0), 'it says how many the runs hold');
        answers.push(...decodeNoteRows(read.data));
        rest = runsAfter(rest, read.count);
      }
      assert.ok(reads >= 2, 'twelve thousand entries are more than one answer holds');
      const keys = [];
      for (let offset = 0; offset < Number(ROWS); offset += 5000) {
        const page = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, WS, itemsPath, { offset, limit: 5000, index: 'by_group', hash }, opts);
        keys.push(...keysOfWindow(page.data));
      }
      assert.ok(keysEqual(answers.map((answer) => answer.key), keys), 'read on, the answers hold every entry\'s key, in the index\'s order');
      assert.equal(answers.filter((answer) => answer.row.type === 'some').length, Number(ROWS / 3n), 'and every note');
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
        rest = runsAfter(rest, read.count);
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
