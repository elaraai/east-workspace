/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The shape of a merge fan-in: how partials group into components by key
 * range, and the shape of the tree that merges each.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DictType, IntegerType, SortedMap, compareFor } from '@elaraai/east';
import { MERGE_TREE_FANIN, mergeComponents, mergeTreeGroups, mergeTreeLevels } from './steps.js';
import { createTestRepo, removeTestRepo, encodeInSegmentsOf } from '../test-helpers.js';
import { LocalStorage } from '../storage/local/index.js';
import type { StorageBackend } from '../storage/interfaces.js';

const OutType = DictType(IntegerType, IntegerType);
type Out = SortedMap<bigint, bigint>;
const intCmp = compareFor(IntegerType) as (a: unknown, b: unknown) => number;

/** A Dict holding `keys`, each valued `value`. */
function dict(keys: readonly number[], value = 1n): Out {
  return new SortedMap(keys.map((k) => [BigInt(k), value] as [bigint, bigint]), intCmp);
}

/** `[from, to)` as an array of numbers. */
const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, i) => from + i);

describe('the merge fan-in', () => {
  let repo: string;
  let storage: StorageBackend;

  beforeEach(() => {
    repo = createTestRepo();
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(repo);
  });

  async function store(value: Out, batchSize = 4): Promise<string> {
    return storage.objects.write(repo, encodeInSegmentsOf(OutType, batchSize)(value));
  }

  it('groups partials whose key ranges overlap into components, in key order', async () => {
    const partials = [
      await store(dict(range(20, 30))),   // 0: alone
      await store(dict(range(0, 10))),    // 1: overlaps 2
      await store(dict([])),              // 2: empty — in no component
      await store(dict(range(5, 15))),    // 3: overlaps 1
      await store(dict(range(14, 17))),   // 4: first key equals 3's last key — joins
      await store(dict([40])),            // 5: alone
    ];
    const { typeValue, components } = await mergeComponents(storage, repo, partials);
    assert.equal(typeValue.type, 'Dict');
    assert.deepEqual(components, [
      { first: 0n, partitions: [1, 3, 4] },
      { first: 20n, partitions: [0] },
      { first: 40n, partitions: [5] },
    ]);

    const empty = await mergeComponents(storage, repo, [partials[2]!, partials[2]!]);
    assert.deepEqual(empty.components, []);
  });

  it('groups each level into consecutive runs of the fan-in, a run of one passing through', () => {
    assert.equal(MERGE_TREE_FANIN, 32);
    assert.deepEqual(mergeTreeGroups(range(0, 65)).map((g) => g.length), [32, 32, 1]);
    assert.deepEqual(mergeTreeGroups(range(0, 32)).map((g) => g.length), [32]);
    assert.deepEqual(mergeTreeGroups(range(0, 5), 2).map((g) => g.length), [2, 2, 1]);
    assert.equal(mergeTreeLevels([]), 0);
    assert.equal(mergeTreeLevels([1, 1]), 0);
    assert.equal(mergeTreeLevels([2]), 1);
    assert.equal(mergeTreeLevels([32]), 1);
    assert.equal(mergeTreeLevels([1, 33]), 2);
    assert.equal(mergeTreeLevels([1024]), 2);
    assert.equal(mergeTreeLevels([1025, 3]), 3);
    assert.equal(mergeTreeLevels([10], 2), 4);
  });
});
