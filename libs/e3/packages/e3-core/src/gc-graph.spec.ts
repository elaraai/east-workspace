/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The re-reference of an object graph a caller roots without writing it
 * (`touchReachable`), where a read right after an object's touch falls in the
 * moment a local delete that raced the touch has the object aside.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { IntegerType, NullType, StringType, StructType, VariantType, encodeBeast2For, variant } from '@elaraai/east';
import { ObjectNotFoundError } from './errors.js';
import { touchReachable } from './gc-graph.js';
import { LocalStorage } from './storage/local/index.js';
import type { StorageBackend } from './storage/interfaces.js';
import { createTestRepo, removeTestRepo } from './test-helpers.js';

/** A tree of one dataset, as gc finds a tree: every field a dataset ref. */
const TreeType = StructType({
  out: VariantType({ unassigned: NullType, null: NullType, value: StringType, tree: StringType }),
});

describe('touchReachable', () => {
  let testRepo: string;
  let storage: StorageBackend;

  beforeEach(() => {
    testRepo = createTestRepo();
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(testRepo);
  });

  /**
   * `storage`, where each kind of read of `hash` — of its head, and whole —
   * finds nothing its first `misses` times, and every read of it is counted.
   */
  function missing(hash: string, misses: number): { storage: StorageBackend; reads: { head: number; whole: number } } {
    const reads = { head: 0, whole: 0 };
    const inner = storage;
    const objects = Object.create(inner.objects, {
      readRange: {
        value: (repo: string, read: string, offset: number, length: number): Promise<Uint8Array> =>
          read === hash && reads.head++ < misses ? Promise.reject(new ObjectNotFoundError(read)) : inner.objects.readRange(repo, read, offset, length),
      },
      read: {
        value: (repo: string, read: string): Promise<Uint8Array> =>
          read === hash && reads.whole++ < misses ? Promise.reject(new ObjectNotFoundError(read)) : inner.objects.read(repo, read),
      },
    }) as StorageBackend['objects'];
    return {
      storage: {
        upgrades: inner.upgrades,
        objects,
        refs: inner.refs,
        locks: inner.locks,
        logs: inner.logs,
        repos: inner.repos,
        datasets: inner.datasets,
        runStates: (repo) => inner.runStates(repo),
        validateRepository: (repo) => inner.validateRepository(repo),
      },
      reads,
    };
  }

  it('looks once more at an object that reads as gone right after its touch found it, as a delete that raced the touch leaves it', async () => {
    const value = await storage.objects.write(testRepo, encodeBeast2For(IntegerType)(5n));
    const tree = await storage.objects.write(testRepo, encodeBeast2For(TreeType)({ out: variant('value', value) }));
    const raced = missing(tree, 1);

    assert.strictEqual(await touchReachable(raced.storage, testRepo, [tree]), true, 'the graph is whole');
    assert.deepStrictEqual(raced.reads, { head: 2, whole: 2 }, 'each read that found nothing looked once more');
  });

  it('answers false for an object still gone when it looks once more', async () => {
    const value = await storage.objects.write(testRepo, encodeBeast2For(IntegerType)(5n));
    const gone = missing(value, Infinity);

    assert.strictEqual(await touchReachable(gone.storage, testRepo, [value]), false);
    assert.deepStrictEqual(gone.reads, { head: 2, whole: 0 }, 'it looked twice, and no more');
  });
});
