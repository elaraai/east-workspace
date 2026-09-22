/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * datasetWrite encoding policy: collection-rooted values are ALWAYS stored as
 * segment objects under a manifest (pageable by the `?page=true` dataset API),
 * at every size — one uniform encoding per logical value. Non-collection roots
 * keep the whole-value encode.
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
import { DatasetSegments, readDatasetWhole } from './dataset-open.js';
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
    const segments = await DatasetSegments.open(storage, repoPath, hash);
    assert.strictEqual(segments.segmentCount, 1);
    assert.strictEqual(segments.elementCount, 3);
    assert.ok(equalFor(AT)(openBeast2PagesFor(AT)(await segments.span(0, 1)).slice(0, 3), value));
    assert.ok(equalFor(AT)(decodeBeast2For(AT)(await readDatasetWhole(storage, repoPath, hash)), value), 'whole decode equals input');
  });

  it('stores empty collections indexed with zero segments', async () => {
    const AT = ArrayType(IntegerType);
    const hash = await datasetWrite(storage, repoPath, [], AT);
    const segments = await DatasetSegments.open(storage, repoPath, hash);
    assert.strictEqual(segments.segmentCount, 0);
    assert.strictEqual(segments.elementCount, 0);
    assert.deepStrictEqual(decodeBeast2For(AT)(await readDatasetWhole(storage, repoPath, hash)), []);
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
    const segments = await DatasetSegments.open(storage, repoPath, hash);

    assert.strictEqual(segments.segmentCount, 3);
    assert.strictEqual(segments.elementCount, 2500);
    // A window spanning segments is spliced from the segment objects it
    // touches and decodes as one blob.
    const window = openBeast2PagesFor(AT)(await segments.span(0, segments.segmentCount));
    assert.ok(equalFor(AT)(window.slice(900, 200), value.slice(900, 1100)), 'window spans segments');
    assert.ok(equalFor(AT)(decodeBeast2For(AT)(await readDatasetWhole(storage, repoPath, hash)), value), 'whole decode equals input');
  });

  it('stores large dicts segmented and concatenation-equal', async () => {
    const DT = DictType(StringType, IntegerType);
    const value = new Map(Array.from({ length: 1500 }, (_, i) => [`k${String(i).padStart(4, '0')}`, BigInt(i)] as [string, bigint]));
    const hash = await datasetWrite(storage, repoPath, value, DT);
    const segments = await DatasetSegments.open(storage, repoPath, hash);

    // Where the segments fall is the boundary rule's decision, not this
    // test's; what must hold is that every element is in exactly one of them.
    assert.ok(segments.segmentCount >= 1);
    assert.strictEqual(segments.elementCount, 1500);
    assert.ok(equalFor(DT)(decodeBeast2For(DT)(await readDatasetWhole(storage, repoPath, hash)), value), 'whole decode equals input');
  });
});
