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
import * as fs from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { variant, encodeBeast2For } from '@elaraai/east';
import { DatasetRefType } from '@elaraai/e3-types';
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

    // Legacy ref files (written before the revision wrapper) are bare DatasetRef
    // bytes with no 0xFF magic; the local store must still read them and upgrade
    // them in place on the next conditional write. (Local-only: the in-memory
    // backend has no on-disk format.)
    if (name === 'local') {
      it('reads a legacy bare-DatasetRef file and upgrades it on the next writeIf', async () => {
        const legacyRef = variant('value', { hash: 'b'.padEnd(64, '0'), versions: new Map() });
        const refFile = join(fx.repo, 'workspaces', ws, 'data', `${path}.ref`);
        await fs.mkdir(dirname(refFile), { recursive: true });
        // Bare beast2 DatasetRef — deliberately no 0xFF revision magic byte.
        await fs.writeFile(refFile, encodeBeast2For(DatasetRefType)(legacyRef));

        const read = await fx.store.readVersioned(fx.repo, ws, path);
        assert.ok(read, 'legacy file decodes');
        assert.deepStrictEqual(read.ref, legacyRef);
        assert.ok(read.revision.length > 0, 'a stable revision is derived from the legacy bytes');

        // A conditional write against the derived revision succeeds and rotates it,
        // upgrading the file to the revisioned format.
        const next = variant('value', { hash: 'c'.padEnd(64, '0'), versions: new Map() });
        const { revision } = await fx.store.writeIf(fx.repo, ws, path, next, read.revision);
        assert.notStrictEqual(revision, read.revision);
        const after = await fx.store.readVersioned(fx.repo, ws, path);
        assert.deepStrictEqual(after!.ref, next);
      });
    }

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

    it('mints a distinct revision even when two writes store byte-identical refs (no ABA)', async () => {
      // A content-digest revision would be equal for identical bytes, letting a
      // later writeIf false-match a concurrently-overwritten ref (lost update).
      const ref = variant('value', { hash: 'a'.padEnd(64, '0'), versions: new Map() });
      const first = await fx.store.writeIf(fx.repo, ws, path, ref, null);
      const second = await fx.store.writeIf(fx.repo, ws, path, ref, first.revision); // identical ref bytes
      assert.notStrictEqual(second.revision, first.revision, 'revision is a unique token, not a content digest');
      // The now-stale first revision must be rejected.
      await assert.rejects(fx.store.writeIf(fx.repo, ws, path, ref, first.revision), DatasetRefConflictError);
    });
  });
}
