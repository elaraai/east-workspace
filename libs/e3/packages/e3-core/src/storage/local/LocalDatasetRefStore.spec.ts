/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for the DatasetRefStore compare-and-swap primitive (readVersioned /
 * writeIf) across both the local filesystem and in-memory implementations.
 *
 * The CAS is what closes the lost-update window in the blind `e3 set` path: a
 * caller reads a revision, decides on a new ref, and commits only if no
 * concurrent writer slipped in.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { variant } from '@elaraai/east';
import { LocalDatasetRefStore } from './LocalDatasetRefStore.js';
import { InMemoryStorage } from '../in-memory/InMemoryStorage.js';
import { DatasetRefConflictError } from '../../errors.js';
import type { DatasetRefStore } from '../interfaces.js';
import { createTestRepo, removeTestRepo } from '../../test-helpers.js';

interface Fixture {
  store: DatasetRefStore;
  repo: string;
  cleanup: () => void;
}

const backends: Record<string, () => Fixture> = {
  local: () => {
    const repo = createTestRepo();
    return { store: new LocalDatasetRefStore(), repo, cleanup: () => removeTestRepo(repo) };
  },
  'in-memory': () => {
    const storage = new InMemoryStorage();
    return { store: storage.datasets, repo: 'repo', cleanup: () => storage.clear() };
  },
};

for (const [name, make] of Object.entries(backends)) {
  describe(`DatasetRefStore CAS (${name})`, () => {
    const ws = 'main';
    const path = 'inputs/sales';
    let fx: Fixture;

    beforeEach(() => { fx = make(); });
    afterEach(() => { fx.cleanup(); });

    it('readVersioned returns null for an absent ref', async () => {
      assert.strictEqual(await fx.store.readVersioned(fx.repo, ws, path), null);
    });

    it('write then readVersioned yields the ref and a revision', async () => {
      await fx.store.write(fx.repo, ws, path, variant('value', { hash: 'a'.padEnd(64, '0'), versions: new Map() }));
      const result = await fx.store.readVersioned(fx.repo, ws, path);
      assert.ok(result);
      assert.deepStrictEqual(result.ref, variant('value', { hash: 'a'.padEnd(64, '0'), versions: new Map() }));
      assert.strictEqual(typeof result.revision, 'string');
      assert.ok(result.revision.length > 0);
    });

    it('writeIf with expected=null creates the ref iff it is absent', async () => {
      const { revision } = await fx.store.writeIf(fx.repo, ws, path, variant('value', { hash: 'a'.padEnd(64, '0'), versions: new Map() }), null);
      assert.ok(revision);

      // A second create-only write must now conflict.
      await assert.rejects(
        fx.store.writeIf(fx.repo, ws, path, variant('value', { hash: 'b'.padEnd(64, '0'), versions: new Map() }), null),
        DatasetRefConflictError
      );
      // …and must not have changed the stored value.
      const result = await fx.store.readVersioned(fx.repo, ws, path);
      assert.deepStrictEqual(result?.ref, variant('value', { hash: 'a'.padEnd(64, '0'), versions: new Map() }));
    });

    it('writeIf succeeds on a matching revision and rotates it', async () => {
      const first = await fx.store.writeIf(fx.repo, ws, path, variant('value', { hash: 'a'.padEnd(64, '0'), versions: new Map() }), null);
      const second = await fx.store.writeIf(fx.repo, ws, path, variant('value', { hash: 'b'.padEnd(64, '0'), versions: new Map() }), first.revision);
      assert.notStrictEqual(second.revision, first.revision);

      // The now-stale first revision must be rejected.
      await assert.rejects(
        fx.store.writeIf(fx.repo, ws, path, variant('value', { hash: 'c'.padEnd(64, '0'), versions: new Map() }), first.revision),
        DatasetRefConflictError
      );
      const result = await fx.store.readVersioned(fx.repo, ws, path);
      assert.deepStrictEqual(result?.ref, variant('value', { hash: 'b'.padEnd(64, '0'), versions: new Map() }));
    });

    it('two concurrent writeIf on one revision: exactly one wins', async () => {
      await fx.store.write(fx.repo, ws, path, variant('value', { hash: 'base'.padEnd(64, '0'), versions: new Map() }));
      const { revision } = (await fx.store.readVersioned(fx.repo, ws, path))!;

      const results = await Promise.allSettled([
        fx.store.writeIf(fx.repo, ws, path, variant('value', { hash: 'x'.padEnd(64, '0'), versions: new Map() }), revision),
        fx.store.writeIf(fx.repo, ws, path, variant('value', { hash: 'y'.padEnd(64, '0'), versions: new Map() }), revision),
      ]);

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');
      assert.strictEqual(fulfilled.length, 1, 'exactly one writer commits');
      assert.strictEqual(rejected.length, 1, 'the other observes a conflict');
      assert.ok((rejected[0] as PromiseRejectedResult).reason instanceof DatasetRefConflictError);
    });
  });
}
