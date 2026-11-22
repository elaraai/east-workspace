/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The segments the API process keeps (`segments.ts`): a segment is kept as the
 * bytes its rows are in, and a search and a read decode the rows they answer
 * with; a row whose value does not decode is refused where it is read, as the
 * segment's fault, and a search past it answers; and a key is found, or
 * placed, by bisection.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DictType, IntegerType, SetType, StringType, SortedMap, compareFor, encodeBeast2SegmentsFor, toEastTypeValue, type EastType,
} from '@elaraai/east';
import { InMemoryStorage, encodeInSegmentsOf, storeSegmentsOf } from '@elaraai/e3-core/test';
import { decodeCollectionManifest, encodeCollectionManifest } from '@elaraai/e3-types';
import { cachedSegments } from './dataset-reads.js';
import { getValuePage } from './datasets.js';
import { SegmentCorruptError, comparators, decodedSegmentStats, decodedSegments, firstWhere, rowUnder } from './segments.js';

const REPO = 'segments-kept';

/** A storage holding `blob`'s segments under a manifest, and the manifest's hash. */
async function stored(blob: Uint8Array): Promise<{ storage: InMemoryStorage; hash: string }> {
  const storage = new InMemoryStorage();
  await storage.repos.create(REPO);
  return { storage, hash: await storeSegmentsOf(storage, REPO, blob) };
}

const HalvesType = DictType(IntegerType, IntegerType);

/** The first `n` even numbers, each holding its half: every odd number falls between two keys. */
function halvesOf(n: number): Map<bigint, bigint> {
  const halves = new Map<bigint, bigint>();
  for (let half = 0n; half < BigInt(n); half++) halves.set(2n * half, half);
  return halves;
}

describe('a segment the API process keeps', () => {
  it('is kept as the bytes its rows are in and where each starts, whatever is read of it', async () => {
    const { storage, hash } = await stored(encodeInSegmentsOf(HalvesType, 97)(halvesOf(500)));
    const segments = await cachedSegments(storage, REPO, hash);
    const before = decodedSegmentStats();
    const first = (await decodedSegments(storage, REPO, segments, [0])).get(0)!;
    const kept = decodedSegmentStats();
    assert.equal(kept.decodes - before.decodes, 1);
    // 97 rows: their count, a byte; each key, a byte to 62 and two from 64; each value, a byte to 63 and two from 64;
    // and where each row starts and the last ends, four bytes each.
    assert.equal(kept.weight - before.weight, 1 + (32 + 65 * 2) + (64 + 33 * 2) + 4 * 98);

    assert.equal(first.count, 97);
    assert.deepEqual([first.key(0), first.key(96), first.element(50)], [0n, 192n, [100n, 50n]]);
    assert.ok(first.element(50) !== first.element(50), 'a row is decoded anew for each read');
    const again = (await decodedSegments(storage, REPO, segments, [0, 0])).get(0)!;
    const after = decodedSegmentStats();
    assert.ok(again === first, 'the kept segment serves the next read');
    assert.deepEqual([after.decodes - kept.decodes, after.weight - kept.weight, after.hits - kept.hits], [0, 0, 1], 'and the rows read of it weigh nothing more');
  });

  it('holds a Set\'s segment whole, its elements its keys', async () => {
    const Evens = SetType(IntegerType);
    const { storage, hash } = await stored(encodeInSegmentsOf(Evens, 40)(new Set(halvesOf(100).keys())));
    const segments = await cachedSegments(storage, REPO, hash);
    const second = (await decodedSegments(storage, REPO, segments, [1])).get(1)!;
    assert.deepEqual([second.count, second.key(0), second.element(39)], [40, 80n, 158n]);
  });

  it('finds a key\'s pair by bisection, or the row the key would take', async () => {
    const { storage, hash } = await stored(encodeInSegmentsOf(HalvesType, 97)(halvesOf(500)));
    const segments = await cachedSegments(storage, REPO, hash);
    const second = (await decodedSegments(storage, REPO, segments, [1])).get(1)!;
    const cmp = comparators(toEastTypeValue(IntegerType));
    assert.deepEqual(rowUnder(second, cmp, 200n), { at: 3, pair: [200n, 100n] });
    assert.deepEqual(rowUnder(second, cmp, 201n), { at: 4, pair: undefined }, 'between two keys');
    assert.deepEqual(rowUnder(second, cmp, -1n), { at: 0, pair: undefined }, 'before the first');
    assert.deepEqual(rowUnder(second, cmp, 1000n), { at: 97, pair: undefined }, 'past the last');
    assert.deepEqual([firstWhere(0, () => true), firstWhere(5, () => false), firstWhere(5, (row) => row >= 2)], [0, 5, 2]);
  });
});

describe('a row whose value does not decode', () => {
  const Nested = DictType(StringType, DictType(IntegerType, StringType));

  /** A stored collection of three rows, the second's own keys out of order: the segment walks, and that row does not decode. */
  async function withUnorderedRow(): Promise<{ storage: InMemoryStorage; hash: string; type: EastType }> {
    const order = compareFor(IntegerType);
    const rows = new SortedMap<string, SortedMap<bigint, string>>([
      ['a', new SortedMap([[1n, 'only']], order)],
      ['b', new SortedMap([[1n, 'early'], [2n, 'late']], order)],
      ['c', new SortedMap([], order)],
    ], compareFor(StringType));
    // Uncompressed, so the row's bytes can be found and changed.
    const { storage, hash } = await stored(encodeBeast2SegmentsFor(Nested, { codec: 'none' })([rows] as never));
    const manifest = decodeCollectionManifest(await storage.objects.read(REPO, hash));
    const bytes = new Uint8Array(await storage.objects.read(REPO, manifest.entries[0]!.hash));
    // Row b's value: its first key, 1 (the byte 2), then a length and `early`. Written as 3 (the byte 6), it is past the key after it.
    const early = bytes.findIndex((_, at) => new TextDecoder().decode(bytes.subarray(at, at + 5)) === 'early');
    assert.deepEqual([bytes[early - 2], bytes[early - 1]], [2, 5]);
    bytes[early - 2] = 6;
    const changed = await storage.objects.write(REPO, bytes);
    const repointed = await storage.objects.write(REPO, encodeCollectionManifest({ ...manifest, entries: [{ ...manifest.entries[0]!, hash: changed }] }));
    return { storage, hash: repointed, type: Nested };
  }

  it('is the segment\'s fault where it is read, and no other row\'s', async () => {
    const { storage, hash } = await withUnorderedRow();
    const segments = await cachedSegments(storage, REPO, hash);
    const segment = (await decodedSegments(storage, REPO, segments, [0])).get(0)!;
    assert.deepEqual([segment.count, segment.key(1)], [3, 'b'], 'the segment walks, and a search reads its keys');
    assert.deepEqual((segment.element(0) as [string, Map<bigint, string>])[0], 'a');
    assert.throws(() => segment.element(1), (err: unknown) => err instanceof SegmentCorruptError && /Dict keys are not strictly ascending/.test(err.message));
    assert.deepEqual((segment.element(2) as [string, Map<bigint, string>])[0], 'c');
  });

  it('refuses the window that holds it as not canonical, and answers one that does not', async () => {
    const { storage, hash, type } = await withUnorderedRow();
    const typeValue = toEastTypeValue(type);
    const without = await getValuePage(storage, REPO, hash, typeValue, { offset: 0, limit: 1 });
    assert.equal(without.status, 200, await without.clone().text());
    const refused = await getValuePage(storage, REPO, hash, typeValue, { offset: 0, limit: 3 });
    const body = await refused.json() as { error: { type: string; message: string } };
    assert.deepEqual([refused.status, body.error.type], [400, 'dataset_not_canonical']);
    assert.match(body.error.message, /Dict keys are not strictly ascending/);
    const whole = await getValuePage(storage, REPO, hash, typeValue, { segment: 0 });
    assert.deepEqual([whole.status, (await whole.json() as { error: { type: string } }).error.type], [400, 'dataset_not_segmented']);
  });
});
