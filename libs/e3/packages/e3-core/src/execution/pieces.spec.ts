/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The pieces of a split task: the rule that closes them, and the planner over
 * a real repository — each piece stored as the manifest the Writer writes for
 * its rows, so the pieces of an input concatenate back into its own manifest.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  ArrayType, DictType, IntegerType, StringType, StructType,
  SortedMap, compareFor, decodeBeast2For, some, none, variant,
} from '@elaraai/east';
import { decodeCollectionManifest } from '@elaraai/e3-types';
import { PIECE_SIZES, pieceBoundaries, pieceSizes, planPieces, type PieceSizes } from './pieces.js';
import { readDatasetWhole } from '../dataset-open.js';
import { storeCollection } from '../store-collection.js';
import { datasetWrite } from '../trees.js';
import { createTestRepo, removeTestRepo, encodeInSegmentsOf } from '../test-helpers.js';
import { LocalStorage } from '../storage/local/index.js';
import type { StorageBackend } from '../storage/interfaces.js';

/** Sizes that close a piece after every segment. */
const EVERY_SEGMENT: PieceSizes = { min: 1, target: 1, max: 1 };

describe('the piece rule', () => {
  /** Entries of `bytes` stored bytes each, every segment's SHA-256 starting `prefix`. */
  const entries = (count: number, bytes: number, prefix: string) =>
    Array.from({ length: count }, (_, i) => ({ hash: prefix + i.toString(16).padStart(64 - prefix.length, '0'), bytes: BigInt(bytes) }));

  it('closes a piece once it holds the most a piece holds, whatever its segments hash to', async () => {
    // 0xffffffff is under no threshold a 10-byte segment is weighed by: only
    // the size closes a piece.
    const starts = await pieceBoundaries(entries(20, 10, 'ffffffff'), { min: 16, target: 32, max: 64 });
    assert.deepEqual(starts, [{ seg: 0, offset: 0 }, { seg: 7, offset: 0 }, { seg: 14, offset: 0 }]);
  });

  it('never closes a piece before it holds the least a piece holds', async () => {
    // 0x00000000 is under every threshold: the least size alone decides.
    const starts = await pieceBoundaries(entries(10, 1, '00000000'), { min: 4, target: 16, max: 64 });
    assert.deepEqual(starts.map((start) => start.seg), [0, 4, 8]);
  });

  it('weighs a segment against the most a piece holds until the piece holds its middle size, and the least after', async () => {
    // A 1-byte segment closes a piece under 2^32/64 before the middle size and
    // under 2^32/4 after it; 0x10000000 is between the two.
    const starts = await pieceBoundaries(entries(40, 1, '10000000'), { min: 4, target: 16, max: 64 });
    assert.deepEqual(starts.map((start) => start.seg), [0, 16, 32]);
  });

  it('starts the next piece where the `by` group running into it ends, and walks on from there', async () => {
    // The group the piece closing before segment 2 ends in runs on to row 3 of
    // segment 4; the next piece starts there, and the walk takes up segment 4.
    const starts = await pieceBoundaries(entries(8, 1, '00000000'), EVERY_SEGMENT,
      (seg) => (seg === 2 ? { seg: 4, offset: 3 } : { seg, offset: 0 }));
    assert.deepEqual(starts, [
      { seg: 0, offset: 0 }, { seg: 1, offset: 0 }, { seg: 4, offset: 3 },
      { seg: 5, offset: 0 }, { seg: 6, offset: 0 }, { seg: 7, offset: 0 },
    ]);
    // A group that runs to the end leaves the last piece open.
    const open = await pieceBoundaries(entries(4, 1, '00000000'), EVERY_SEGMENT, (seg) => (seg >= 2 ? null : { seg, offset: 0 }));
    assert.deepEqual(open, [{ seg: 0, offset: 0 }, { seg: 1, offset: 0 }]);
  });

  it('moves only the pieces around an insertion', async () => {
    // Segments named by real SHA-256s, of a few stored bytes each.
    const segment = (id: string, bytes: number) => ({ hash: createHash('sha256').update(id).digest('hex'), bytes: BigInt(bytes) });
    const before = Array.from({ length: 4000 }, (_, i) => segment(`segment ${i}`, 3 + (i % 5)));
    const after = [...before.slice(0, 2000), ...Array.from({ length: 6 }, (_, i) => segment(`inserted ${i}`, 5)), ...before.slice(2000)];
    const sizes: PieceSizes = { min: 64, target: 256, max: 1024 };

    // Each piece as the segments it holds.
    const pieces = async (list: typeof before): Promise<string[]> => {
      const starts = (await pieceBoundaries(list, sizes)).map((start) => start.seg);
      return starts.map((start, p) => list.slice(start, starts[p + 1] ?? list.length).map((e) => e.hash).join());
    };
    const was = await pieces(before);
    const now = await pieces(after);
    assert.ok(was.length > 40, `the input spans many pieces, got ${was.length}`);
    const kept = new Set(was);
    const changed = now.filter((piece) => !kept.has(piece));
    assert.ok(changed.length <= 3, `${changed.length} of ${now.length} pieces changed around a 6-segment insertion`);
  });

  it('plans with the platform\'s sizes, and a test\'s through E3_TEST_PIECE_BYTES', () => {
    const saved = process.env.E3_TEST_PIECE_BYTES;
    try {
      delete process.env.E3_TEST_PIECE_BYTES;
      assert.deepEqual(pieceSizes(), PIECE_SIZES);
      assert.deepEqual(PIECE_SIZES, { min: 16 * 2 ** 20, target: 64 * 2 ** 20, max: 256 * 2 ** 20 });
      process.env.E3_TEST_PIECE_BYTES = '4096';
      assert.deepEqual(pieceSizes(), { min: 1024, target: 4096, max: 16384 });
      process.env.E3_TEST_PIECE_BYTES = '1 MiB';
      assert.throws(() => pieceSizes(), /E3_TEST_PIECE_BYTES is '1 MiB': it is a whole number of bytes, at least 4/);
    } finally {
      if (saved === undefined) delete process.env.E3_TEST_PIECE_BYTES;
      else process.env.E3_TEST_PIECE_BYTES = saved;
    }
  });
});

describe('planning the pieces of an input', () => {
  let repo: string;
  let storage: StorageBackend;

  beforeEach(() => {
    repo = createTestRepo();
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(repo);
  });

  const TableType = DictType(IntegerType, StringType);
  /** Rows `[from, to)`, each keyed by its number. */
  const table = (from: number, to: number): SortedMap<bigint, string> =>
    new SortedMap(Array.from({ length: to - from }, (_, i) => [BigInt(from + i), `row-${from + i}`] as [bigint, string]), compareFor(IntegerType));

  /** A stored collection's manifest entries. */
  const entriesOf = async (hash: string) => decodeCollectionManifest(await storage.objects.read(repo, hash)).entries;

  it('cuts a manifest into runs of its own segments, which concatenate back into it', async () => {
    const hash = await datasetWrite(storage, repo, table(0, 8000), TableType);
    const entries = await entriesOf(hash);
    assert.ok(entries.length >= 6, `the input spans several segments, got ${entries.length}`);

    const pieces = await planPieces(storage, repo,
      [{ path: [variant('field', 'sales')], partition: some({ by: [] }) }], [hash], EVERY_SEGMENT);
    assert.equal(pieces.length, entries.length);
    for (let p = 0; p < pieces.length; p++) {
      assert.deepEqual(await entriesOf(pieces[p]![0]!), [entries[p]], `piece ${p} names segment ${p} as it stands`);
    }
    assert.equal(await storeCollection(storage, repo, TableType, pieces.map(([piece]) => ({ stored: piece! }))), hash);
  });

  it('plans one piece, the inputs themselves, when the input fits in one', async () => {
    const hash = await datasetWrite(storage, repo, table(0, 8000), TableType);
    const rates = await datasetWrite(storage, repo, 7n, IntegerType);
    const pieces = await planPieces(storage, repo, [
      { path: [variant('field', 'rates')], partition: none },
      { path: [variant('field', 'sales')], partition: some({ by: [] }) },
    ], [rates, hash], PIECE_SIZES);
    assert.deepEqual(pieces, [[rates, hash]]);
  });

  it('passes an unmarked input to every piece whole', async () => {
    const hash = await datasetWrite(storage, repo, table(0, 8000), TableType);
    const rates = await datasetWrite(storage, repo, 7n, IntegerType);
    const pieces = await planPieces(storage, repo, [
      { path: [variant('field', 'sales')], partition: some({ by: [] }) },
      { path: [variant('field', 'rates')], partition: none },
    ], [hash, rates], EVERY_SEGMENT);
    assert.ok(pieces.length > 1);
    for (const piece of pieces) assert.equal(piece[1], rates);
  });

  it('cuts an input stored another way as the manifest the Writer writes for it', async () => {
    // Segments of 500 rows, which no rule cut: the door re-cuts them first.
    const value = table(0, 8000);
    const blob = await storage.objects.write(repo, encodeInSegmentsOf(TableType, 500)(value));
    const pieces = await planPieces(storage, repo,
      [{ path: [variant('field', 'sales')], partition: some({ by: [] }) }], [blob], EVERY_SEGMENT);
    const canonical = await datasetWrite(storage, repo, value, TableType);
    assert.equal(pieces.length, (await entriesOf(canonical)).length);
    assert.equal(await storeCollection(storage, repo, TableType, pieces.map(([piece]) => ({ stored: piece! }))), canonical);
  });

  it('cuts an Array by position', async () => {
    const values = Array.from({ length: 9000 }, (_, i) => BigInt((i * 7919) % 9000));
    const hash = await datasetWrite(storage, repo, values, ArrayType(IntegerType));
    const pieces = await planPieces(storage, repo,
      [{ path: [variant('field', 'events')], partition: some({ by: [] }) }], [hash], EVERY_SEGMENT);
    assert.equal(pieces.length, (await entriesOf(hash)).length);
    assert.equal(await storeCollection(storage, repo, ArrayType(IntegerType), pieces.map(([piece]) => ({ stored: piece! }))), hash);
  });

  it('ends a piece where its last `by` group ends, inside the segment', async () => {
    const KeyType = StructType({ group: IntegerType, id: IntegerType });
    type Key = { group: bigint; id: bigint };
    // 1500 rows a group, so groups end inside segments.
    const rows = new SortedMap<Key, string>(
      Array.from({ length: 9000 }, (_, i) => [{ group: BigInt(Math.floor(i / 1500)), id: BigInt(i) }, `row-${i}`] as [Key, string]),
      compareFor(KeyType));
    const type = DictType(KeyType, StringType);
    const hash = await datasetWrite(storage, repo, rows, type);
    const segmentsOfInput = new Set((await entriesOf(hash)).map((entry) => entry.hash));

    const pieces = await planPieces(storage, repo,
      [{ path: [variant('field', 'sales')], partition: some({ by: ['group'] }) }], [hash], EVERY_SEGMENT);
    assert.ok(pieces.length > 1, 'the input splits');
    const decode = decodeBeast2For(type);
    const groups: Set<bigint>[] = [];
    for (const [piece] of pieces) groups.push(new Set([...decode(await readDatasetWhole(storage, repo, piece!)).keys()].map((key) => key.group)));
    for (let p = 1; p < groups.length; p++) {
      for (const group of groups[p]!) assert.ok(!groups[p - 1]!.has(group), `group ${group} is split between pieces ${p - 1} and ${p}`);
    }
    // A piece that starts where a group ends inside a segment starts with
    // that segment's rest, re-cut.
    const firsts = await Promise.all(pieces.map(async ([piece]) => (await entriesOf(piece!))[0]!.hash));
    assert.ok(firsts.some((first) => !segmentsOfInput.has(first)), 'some piece starts inside a segment of the input');
    assert.equal(await storeCollection(storage, repo, type, pieces.map(([piece]) => ({ stored: piece! }))), hash);
  });

  it('splits a co-partitioned input at the keys the primary\'s pieces start at', async () => {
    const primary = await datasetWrite(storage, repo, table(0, 8000), TableType);
    // Another range and another geometry, so most splits fall inside its segments.
    const secondaryValue = table(1000, 6000);
    const secondary = await storage.objects.write(repo, encodeInSegmentsOf(TableType, 700)(secondaryValue));

    const pieces = await planPieces(storage, repo, [
      { path: [variant('field', 'sales')], partition: some({ by: [] }) },
      { path: [variant('field', 'returns')], partition: some({ by: [] }) },
    ], [primary, secondary], EVERY_SEGMENT);
    assert.ok(pieces.length > 2);
    const decode = decodeBeast2For(TableType);
    for (let p = 0; p < pieces.length; p++) {
      const first = [...decode(await readDatasetWhole(storage, repo, pieces[p]![0]!)).keys()][0]!;
      const next = pieces[p + 1] === undefined ? null : [...decode(await readDatasetWhole(storage, repo, pieces[p + 1]![0]!)).keys()][0]!;
      for (const key of decode(await readDatasetWhole(storage, repo, pieces[p]![1]!)).keys()) {
        assert.ok((p === 0 || key >= first) && (next === null || key < next), `key ${key} of the second input is in piece ${p}`);
      }
    }
    // Each of the second input's pieces is the manifest the Writer writes for
    // its rows, so they concatenate into the manifest of the whole.
    assert.equal(
      await storeCollection(storage, repo, TableType, pieces.map((piece) => ({ stored: piece[1]! }))),
      await datasetWrite(storage, repo, secondaryValue, TableType),
    );
  });

  it('splits co-partitioned inputs by their `by` fields', async () => {
    const WideKeyType = StructType({ sku: StringType, period: IntegerType, line: IntegerType });
    const SharedKeyType = StructType({ sku: StringType, period: IntegerType });
    type Shared = { sku: string; period: bigint };
    const skus = Array.from({ length: 30 }, (_, i) => `sku-${String(i).padStart(2, '0')}`);
    const groups: Shared[] = skus.flatMap((sku) => Array.from({ length: 10 }, (_, period) => ({ sku, period: BigInt(period) })));
    // 40 lines a group in the primary, one row a group in the second input.
    const primaryType = DictType(WideKeyType, IntegerType);
    const primaryValue = new SortedMap<Shared & { line: bigint }, bigint>(
      groups.flatMap((g) => Array.from({ length: 40 }, (_, line) => [{ ...g, line: BigInt(line) }, BigInt(line)] as [Shared & { line: bigint }, bigint])),
      compareFor(WideKeyType));
    const secondaryType = DictType(SharedKeyType, IntegerType);
    const secondaryValue = new SortedMap<Shared, bigint>(groups.map((g) => [g, g.period] as [Shared, bigint]), compareFor(SharedKeyType));
    const primary = await datasetWrite(storage, repo, primaryValue, primaryType);
    const secondary = await storage.objects.write(repo, encodeInSegmentsOf(secondaryType, 7)(secondaryValue));

    const pieces = await planPieces(storage, repo, [
      { path: [variant('field', 'lines')], partition: some({ by: ['sku', 'period'] }) },
      { path: [variant('field', 'plans')], partition: some({ by: ['sku', 'period'] }) },
    ], [primary, secondary], EVERY_SEGMENT);
    assert.ok(pieces.length > 2, `the primary splits, into ${pieces.length}`);
    const groupsOf = (keys: Iterable<Shared>): string[] => [...new Set([...keys].map((k) => `${k.sku}/${k.period}`))];
    const decodePrimary = decodeBeast2For(primaryType);
    const decodeSecondary = decodeBeast2For(secondaryType);
    for (const [first, second] of pieces) {
      assert.deepEqual(
        groupsOf(decodeSecondary(await readDatasetWhole(storage, repo, second!)).keys()),
        groupsOf(decodePrimary(await readDatasetWhole(storage, repo, first!)).keys()),
        'a piece holds the same groups of both inputs',
      );
    }
  });

  it('refuses inputs partitioned together that are cut by fields of other types', async () => {
    const primary = await datasetWrite(storage, repo, table(0, 8000), TableType);
    const other = await datasetWrite(storage, repo,
      new SortedMap([['a', 1n]], compareFor(StringType)), DictType(StringType, IntegerType));
    await assert.rejects(
      planPieces(storage, repo, [
        { path: [variant('field', 'sales')], partition: some({ by: [] }) },
        { path: [variant('field', 'names')], partition: some({ by: [] }) },
      ], [primary, other], EVERY_SEGMENT),
      /partitioned input 2 is cut by \(\.String\) and partitioned input 1 by \(\.Integer\): inputs partitioned together are cut by fields of the same types/,
    );
  });

  it('refuses a `by` naming a field the key does not have', async () => {
    const hash = await datasetWrite(storage, repo, table(0, 10), TableType);
    await assert.rejects(
      planPieces(storage, repo, [{ path: [variant('field', 'sales')], partition: some({ by: ['store'] }) }], [hash], EVERY_SEGMENT),
      /partitioned input 1: `by` names 'store', and its key has no such field/,
    );
  });
});
