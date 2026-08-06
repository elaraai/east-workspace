/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * datasetWrite encoding policy: collection-rooted values are ALWAYS stored
 * segmented + indexed (pageable by the `?page=true` dataset API), at every
 * size — one uniform encoding per logical value. Non-collection roots keep
 * the whole-value encode.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  ArrayType,
  DictType,
  IntegerType,
  StringType,
  StructType,
  decodeBeast2For,
  encodeBeast2For,
  equalFor,
  openBeast2PagesFor,
} from '@elaraai/east';
import { LocalStorage } from './storage/local/LocalBackend.js';
import { datasetWrite } from './trees.js';
import { createTestRepo, removeTestRepo } from './test-helpers.js';

describe('datasetWrite segmentation', () => {
  let repoPath: string;
  const storage = new LocalStorage();

  beforeEach(() => {
    repoPath = createTestRepo();
  });

  afterEach(() => {
    removeTestRepo(repoPath);
  });

  it('stores small collections segmented + indexed too — pageable at every size', async () => {
    const AT = ArrayType(IntegerType);
    const value = [1n, 2n, 3n];
    const hash = await datasetWrite(storage, repoPath, value, AT);
    const stored = await storage.objects.read(repoPath, hash);
    const pages = openBeast2PagesFor(AT)(stored);
    assert.strictEqual(pages.segmentCount, 1);
    assert.strictEqual(pages.elementCount, 3);
    assert.ok(equalFor(AT)(pages.slice(0, 3), value));
    assert.ok(equalFor(AT)(decodeBeast2For(AT)(stored), value), 'whole decode equals input');
  });

  it('stores empty collections indexed with zero segments', async () => {
    const AT = ArrayType(IntegerType);
    const hash = await datasetWrite(storage, repoPath, [], AT);
    const stored = await storage.objects.read(repoPath, hash);
    const pages = openBeast2PagesFor(AT)(stored);
    assert.strictEqual(pages.segmentCount, 0);
    assert.strictEqual(pages.elementCount, 0);
    assert.deepStrictEqual(decodeBeast2For(AT)(stored), []);
  });

  it('keeps non-collection values on the whole-value encode', async () => {
    const value = 'x'.repeat(100_000);
    const hash = await datasetWrite(storage, repoPath, value, StringType);
    const stored = await storage.objects.read(repoPath, hash);
    assert.deepStrictEqual(Array.from(stored), Array.from(encodeBeast2For(StringType)(value)));
  });

  it('stores large arrays segmented, indexed, and decode-equal', async () => {
    const Row = StructType({ id: IntegerType, name: StringType });
    const AT = ArrayType(Row);
    const value = Array.from({ length: 2500 }, (_, i) => ({ id: BigInt(i), name: `row-${i % 97}` }));
    const hash = await datasetWrite(storage, repoPath, value, AT);
    const stored = await storage.objects.read(repoPath, hash);

    const pages = openBeast2PagesFor(AT)(stored);
    assert.strictEqual(pages.segmentCount, 3);
    assert.strictEqual(pages.elementCount, 2500);
    assert.ok(pages.selfContained);
    assert.ok(equalFor(AT)(pages.slice(900, 200), value.slice(900, 1100)), 'window spans segments');
    assert.ok(equalFor(AT)(decodeBeast2For(AT)(stored), value), 'whole decode equals input');
  });

  it('stores large dicts segmented and concatenation-equal', async () => {
    const DT = DictType(StringType, IntegerType);
    const value = new Map(Array.from({ length: 1500 }, (_, i) => [`k${String(i).padStart(4, '0')}`, BigInt(i)] as [string, bigint]));
    const hash = await datasetWrite(storage, repoPath, value, DT);
    const stored = await storage.objects.read(repoPath, hash);

    const pages = openBeast2PagesFor(DT)(stored);
    assert.strictEqual(pages.segmentCount, 2);
    assert.strictEqual([...pages.counts].reduce((a, b) => a + b, 0), 1500);
    assert.ok(equalFor(DT)(decodeBeast2For(DT)(stored), value), 'whole decode equals input');
  });
});
