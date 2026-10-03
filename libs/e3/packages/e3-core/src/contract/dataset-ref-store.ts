/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The dataset ref store's contract: what any backend's per-dataset refs do,
 * the compare-and-swap reactive dataflow relies on among it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { equalFor, variant } from '@elaraai/east';
import { DatasetRefType, type DatasetRef } from '@elaraai/e3-types';
import { DatasetRefConflictError } from '../errors.js';
import { MALFORMED_NAMES, nameRefusal } from './malformed.js';
import type { BackendSetup } from './setup.js';

const HASH = 'c'.repeat(64);
const OTHER_HASH = 'd'.repeat(64);
const SALES = 'inputs/sales';

/**
 * Registers the dataset ref store's contract suite over a backend.
 *
 * @param setup - Makes a fresh backend and a repository in it for each test
 */
export function datasetRefStoreTests(setup: BackendSetup): void {
  describe('the dataset ref store', () => {
    it('keeps a dataset\'s ref by its path, lists a workspace\'s, and removes them', async (t) => {
      const { storage, repo } = await setup(t);
      assert.equal(await storage.datasets.read(repo, 'ws', SALES), null);
      const sales: DatasetRef = variant('value', { hash: HASH, versions: new Map([[SALES, HASH]]) });
      await storage.datasets.write(repo, 'ws', SALES, sales);
      await storage.datasets.write(repo, 'ws', 'tasks/etl/output', variant('null', { versions: new Map([[SALES, HASH]]) }));
      await storage.datasets.write(repo, 'other', SALES, variant('unassigned', null));

      const read = await storage.datasets.read(repo, 'ws', SALES);
      assert.ok(read !== null && equalFor(DatasetRefType)(read, sales));
      assert.deepEqual((await storage.datasets.list(repo, 'ws')).sort(), [SALES, 'tasks/etl/output']);

      await storage.datasets.remove(repo, 'ws', SALES);
      assert.equal(await storage.datasets.read(repo, 'ws', SALES), null);
      await storage.datasets.removeAll(repo, 'ws');
      assert.deepEqual(await storage.datasets.list(repo, 'ws'), []);
      assert.deepEqual(await storage.datasets.list(repo, 'other'), [SALES], 'another workspace\'s are its own');
    });

    it('writes a ref over only the revision it was read at, each write minting a revision of its own', async (t) => {
      const { storage, repo } = await setup(t);
      const first: DatasetRef = variant('value', { hash: HASH, versions: new Map([[SALES, HASH]]) });
      const second: DatasetRef = variant('value', { hash: OTHER_HASH, versions: new Map([[SALES, OTHER_HASH]]) });
      const equal = equalFor(DatasetRefType);
      const created = await storage.datasets.writeIf(repo, 'ws', SALES, first, null);
      await assert.rejects(storage.datasets.writeIf(repo, 'ws', SALES, second, null), DatasetRefConflictError,
        'a write expecting no ref finds one');
      const versioned = await storage.datasets.readVersioned(repo, 'ws', SALES);
      assert.equal(versioned?.revision, created.revision);
      assert.ok(versioned !== null && equal(versioned.ref, first));

      // The same ref written again is another revision, so no writer holding
      // the earlier one takes it for unchanged.
      const again = await storage.datasets.writeIf(repo, 'ws', SALES, first, created.revision);
      assert.notEqual(again.revision, created.revision);
      await assert.rejects(storage.datasets.writeIf(repo, 'ws', SALES, second, created.revision), DatasetRefConflictError);
      const kept = await storage.datasets.read(repo, 'ws', SALES);
      assert.ok(kept !== null && equal(kept, first), 'a refused write leaves the ref as it was');

      // An unconditional write moves the revision on too, each to one of its
      // own, however alike the refs it writes.
      await storage.datasets.write(repo, 'ws', SALES, second);
      await assert.rejects(storage.datasets.writeIf(repo, 'ws', SALES, first, again.revision), DatasetRefConflictError);
      const unconditional = await storage.datasets.readVersioned(repo, 'ws', SALES);
      assert.ok(unconditional !== null);
      await storage.datasets.write(repo, 'ws', SALES, second);
      await assert.rejects(storage.datasets.writeIf(repo, 'ws', SALES, first, unconditional.revision), DatasetRefConflictError,
        'the same ref written again is another revision');
      assert.equal(await storage.datasets.readVersioned(repo, 'ws', 'inputs/none'), null);
    });

    it('refuses a workspace\'s name that cannot be one path segment, naming it, before it reads or writes anything', async (t) => {
      const { storage, repo } = await setup(t);
      const ref: DatasetRef = variant('unassigned', null);
      for (const ws of MALFORMED_NAMES['workspace']) {
        const refused = nameRefusal('workspace', ws);
        await assert.rejects(storage.datasets.read(repo, ws, SALES), refused);
        await assert.rejects(storage.datasets.write(repo, ws, SALES, ref), refused);
        await assert.rejects(storage.datasets.readVersioned(repo, ws, SALES), refused);
        await assert.rejects(storage.datasets.writeIf(repo, ws, SALES, ref, null), refused);
        await assert.rejects(storage.datasets.list(repo, ws), refused);
        await assert.rejects(storage.datasets.remove(repo, ws, SALES), refused);
        await assert.rejects(storage.datasets.removeAll(repo, ws), refused);
      }
    });
  });
}
