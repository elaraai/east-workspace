/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Partition fan-in by segment merge (issue #764).
 *
 * The mode's claim has two halves, and both are asserted here:
 *
 * - **Correctness under overlap.** Partials whose key ranges collide merge to
 *   the canonical value, each shared key resolved once by the task's function
 *   (or by union for a Set), and the result is pageable — its fences verify.
 * - **Cost under disjointness.** Partials that do not collide are assembled by
 *   byte copy: every part is a `span`, none is `rebuilt`, and the output is
 *   byte-identical to a splice of the same shards.
 *
 * The partials are built directly rather than run through a runner, so an
 * overlapping case — which no identity body can produce — is expressible.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DictType,
  IntegerType,
  SetType,
  SortedMap,
  SortedSet,
  StringType,
  compareFor,
  decodeBeast2For,
  encodeBeast2PagedFor,
  equalFor,
  openBeast2PagesFor,
  spliceBeast2,
} from '@elaraai/east';
import { PartitionBlob } from './partitionIo.js';
import { mergePartialsBySegments, mergeParts, type MergeResolve } from './partitionMerge.js';
import { createTestRepo, removeTestRepo } from '../test-helpers.js';
import { LocalStorage } from '../storage/local/index.js';
import type { StorageBackend } from '../storage/interfaces.js';

const OutType = DictType(IntegerType, StringType);
const KeysType = SetType(IntegerType);
const intCmp = compareFor(IntegerType) as (a: unknown, b: unknown) => number;

/** A Dict partial holding `keys`, each valued `${tag}-${key}`. */
function dictPartial(keys: readonly number[], tag: string): SortedMap<bigint, string> {
  return new SortedMap(keys.map((k) => [BigInt(k), `${tag}-${k}`] as [bigint, string]), intCmp);
}

/** `[from, to)` as an array of numbers. */
const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, i) => from + i);

describe('mergePartialsBySegments', () => {
  let repo: string;
  let storage: StorageBackend;

  beforeEach(() => {
    repo = createTestRepo();
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(repo);
  });

  /** Stores a Dict partial paged into segments of `batch` entries. */
  async function storeDict(value: SortedMap<bigint, string>, batch: number): Promise<PartitionBlob> {
    const bytes = encodeBeast2PagedFor(OutType, { batchSize: batch })(value);
    return PartitionBlob.open(storage, repo, await storage.objects.write(repo, bytes));
  }

  /** Collects a merge's parts, in order. */
  async function partsOf(partials: PartitionBlob[], resolve: MergeResolve | null, isDict = true): Promise<{ kind: string }[]> {
    const out: { kind: string }[] = [];
    for await (const part of mergeParts(partials, partials[0]!.extents.head, isDict, intCmp, resolve)) out.push(part);
    return out;
  }

  it('assembles disjoint partials by byte copy alone, identical to a splice', async () => {
    // What every re-key or per-entity aggregation produces: each partition's
    // keys sit wholly below the next partition's.
    const partialValues = [dictPartial(range(0, 100), 'p'), dictPartial(range(100, 250), 'p'), dictPartial(range(250, 300), 'p')];
    const partials = await Promise.all(partialValues.map((v) => storeDict(v, 25)));

    const parts = await partsOf(partials, (_k, a) => a);
    assert.ok(parts.length > 0);
    assert.ok(parts.every((p) => p.kind === 'span'), 'no segment was decoded and re-encoded');

    const hash = await mergePartialsBySegments(storage, repo, partials, (_k, a) => a);
    const spliced = spliceBeast2(partialValues.map((v) => encodeBeast2PagedFor(OutType, { batchSize: 25 })(v)));
    // Compared as plain byte arrays: the store hands back a Buffer, the splice
    // a Uint8Array, and a strict deep-equal compares prototypes too.
    assert.deepEqual(new Uint8Array(await storage.objects.read(repo, hash)), new Uint8Array(spliced), 'byte-identical to the splice');
  });

  it('merges overlapping partials, resolving each shared key exactly once', async () => {
    // Two partitions that both emit 40..60: only the segments around the
    // overlap may be rebuilt.
    const left = dictPartial(range(0, 60), 'L');
    const right = dictPartial(range(40, 100), 'R');
    const partials = [await storeDict(left, 10), await storeDict(right, 10)];

    const collisions: bigint[] = [];
    const resolve: MergeResolve = (key, a, b) => {
      collisions.push(key as bigint);
      return `${a as string}+${b as string}`;
    };
    const hash = await mergePartialsBySegments(storage, repo, partials, resolve);
    const blob = await storage.objects.read(repo, hash);
    const merged = decodeBeast2For(OutType)(blob) as SortedMap<bigint, string>;

    assert.equal(merged.size, 100);
    assert.deepEqual(collisions, range(40, 60).map(BigInt), 'every shared key resolved once, in key order');
    assert.equal(merged.get(10n), 'L-10');
    assert.equal(merged.get(45n), 'L-45+R-45');
    assert.equal(merged.get(90n), 'R-90');

    // Canonical and pageable: the pager verifies ascending fences, and a
    // keyed read agrees with the decode.
    const pages = openBeast2PagesFor(OutType)(blob);
    assert.equal(pages.elementCount, 100);
    assert.equal(pages.get(59n), 'L-59+R-59');
  });

  it('copies the segments the overlap does not reach', async () => {
    // One partial straddles another in the middle only: the head and the tail
    // of the wide partial are nobody else's, so they must stay spans.
    const wide = dictPartial(range(0, 200), 'W');
    const narrow = dictPartial([95, 96, 97], 'N');
    const partials = [await storeDict(wide, 20), await storeDict(narrow, 20)];

    const parts = await partsOf(partials, (_k, a) => a);
    const spans = parts.filter((p) => p.kind === 'span').length;
    const rebuilt = parts.filter((p) => p.kind === 'rebuilt').length;
    assert.ok(rebuilt >= 1, 'the collision is rebuilt');
    assert.ok(spans >= 8, `the untouched segments are copied (spans ${spans}, rebuilt ${rebuilt})`);

    const hash = await mergePartialsBySegments(storage, repo, partials, (_k, a) => a);
    const merged = decodeBeast2For(OutType)(await storage.objects.read(repo, hash)) as SortedMap<bigint, string>;
    assert.ok(equalFor(OutType)(merged, wide), 'take-left over a subset leaves the wide partial');
  });

  it('merges Set partials by union', async () => {
    const storeSet = async (keys: number[]): Promise<PartitionBlob> => {
      const bytes = encodeBeast2PagedFor(KeysType, { batchSize: 8 })(new SortedSet(keys.map(BigInt), intCmp));
      return PartitionBlob.open(storage, repo, await storage.objects.write(repo, bytes));
    };
    const partials = [await storeSet(range(0, 30)), await storeSet(range(20, 50)), await storeSet([5, 45, 60])];

    const hash = await mergePartialsBySegments(storage, repo, partials, null);
    const merged = decodeBeast2For(KeysType)(await storage.objects.read(repo, hash)) as SortedSet<bigint>;
    assert.deepEqual([...merged], [...range(0, 50), 60].map(BigInt));
  });

  it('handles empty partials among non-empty ones', async () => {
    const empty = await storeDict(dictPartial([], 'E'), 10);
    const full = await storeDict(dictPartial(range(0, 30), 'F'), 10);
    const hash = await mergePartialsBySegments(storage, repo, [empty, full, empty], (_k, a) => a);
    const merged = decodeBeast2For(OutType)(await storage.objects.read(repo, hash)) as SortedMap<bigint, string>;
    assert.equal(merged.size, 30);
  });

  it('refuses partials that do not share header bytes', async () => {
    // A different value type is a different type section: the splice rule.
    const other = DictType(IntegerType, IntegerType);
    const a = await storeDict(dictPartial(range(0, 10), 'A'), 5);
    const bytes = encodeBeast2PagedFor(other, { batchSize: 5 })(new SortedMap(range(10, 20).map((k) => [BigInt(k), 1n] as [bigint, bigint]), intCmp));
    const b = await PartitionBlob.open(storage, repo, await storage.objects.write(repo, bytes));

    await assert.rejects(() => mergePartialsBySegments(storage, repo, [a, b], (_k, x) => x), /differing header sections/);
  });
});
