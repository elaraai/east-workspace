/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The repository store's contract: a repository's lifecycle — created with its
 * record, its status set by compare-and-swap, and removed whole — over any
 * backend that keeps several repositories.
 */

import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { none, variant } from '@elaraai/east';
import { E3_RELEASE } from '@elaraai/e3-types';
import { RepoAlreadyExistsError, RepoNotFoundError, RepoStatusConflictError } from '../errors.js';
import { REPOSITORY_UPGRADES, repositoryOpen } from '../repository-record.js';
import { uuidv7 } from '../uuid.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { MALFORMED_HASHES, MALFORMED_IDS, MALFORMED_NAMES, hashRefusal, idRefusal, nameRefusal } from './malformed.js';

const TASK = 'a'.repeat(64);
const INPUTS = 'b'.repeat(64);
const HASH = 'c'.repeat(64);

/**
 * A backend that keeps several repositories, under test.
 */
export interface RepositoriesContext {
  /** The backend under test, whose `RepoStore` keeps its repositories */
  readonly storage: StorageBackend;
  /**
   * The identifier the stores other than the `RepoStore` take for a
   * repository, from the name its lifecycle takes: a local repository's path,
   * say.
   */
  readonly repoOf: (name: string) => string;
}

/**
 * Makes a fresh backend that keeps several repositories, none of them yet, for
 * one test, and registers its cleanup with `t.after`.
 */
export type RepositoriesSetup = (t: TestContext) => Promise<RepositoriesContext>;

/**
 * Registers the repository store's contract suite over a backend.
 *
 * @param setup - Makes a fresh backend, with no repository, for each test
 */
export function repoStoreTests(setup: RepositoriesSetup): void {
  describe('the repository store', () => {
    it('creates a repository, which opens naming this release and every upgrade this e3 knows', async (t) => {
      const { storage, repoOf } = await setup(t);
      await storage.repos.create('alpha');
      assert.equal(await storage.repos.exists('alpha'), true);
      assert.deepEqual(await storage.repos.list(), ['alpha']);
      const metadata = await storage.repos.getMetadata('alpha');
      assert.equal(metadata?.name, 'alpha');
      assert.equal(metadata?.status.type, 'active');

      const record = await repositoryOpen(storage, repoOf('alpha'));
      assert.equal(record.release, E3_RELEASE);
      assert.deepEqual(record.upgrades, [...storage.upgrades, ...REPOSITORY_UPGRADES].map(({ name }) => ({ name, release: E3_RELEASE })));
      await assert.rejects(storage.repos.create('alpha'), RepoAlreadyExistsError);
    });

    it('knows no repository it has not created', async (t) => {
      const { storage } = await setup(t);
      assert.equal(await storage.repos.exists('none'), false);
      assert.equal(await storage.repos.getMetadata('none'), null);
      assert.deepEqual(await storage.repos.list(), []);
      await assert.rejects(storage.repos.setStatus('none', 'deleting'), RepoNotFoundError);
    });

    it('sets a repository\'s status, from the status it is expected to have when one is', async (t) => {
      const { storage } = await setup(t);
      await storage.repos.create('alpha');
      await storage.repos.setStatus('alpha', 'deleting', 'active');
      assert.equal((await storage.repos.getMetadata('alpha'))?.status.type, 'deleting');
      await assert.rejects(storage.repos.setStatus('alpha', 'active', ['active', 'gc']), RepoStatusConflictError);
      assert.equal((await storage.repos.getMetadata('alpha'))?.status.type, 'deleting', 'a refused change changes nothing');
      await storage.repos.setStatus('alpha', 'active');
      assert.equal((await storage.repos.getMetadata('alpha'))?.status.type, 'active');
    });

    it('removes a repository whole, so one created again of its name holds nothing of it', async (t) => {
      const { storage, repoOf } = await setup(t);
      await storage.repos.create('alpha');
      await storage.repos.create('beta');
      const repo = repoOf('alpha');
      const id = uuidv7();
      await storage.objects.write(repo, new TextEncoder().encode('an object'));
      await storage.refs.packageWrite(repo, 'pkg', '1.0.0', HASH);
      await storage.refs.workspaceWrite(repo, 'ws', new Uint8Array([1]));
      await storage.refs.executionWrite(repo, TASK, INPUTS, id, variant('failed', {
        executionId: id, inputHashes: [], startedAt: new Date(), completedAt: new Date(), exitCode: 1n, peakBytes: none, unit: false,
      }));
      await storage.refs.adoptionWrite(repo, HASH, HASH);
      await storage.datasets.write(repo, 'ws', 'inputs/sales', variant('unassigned', null));
      await storage.logs.append(repo, TASK, INPUTS, id, 'stdout', 'a log');
      await storage.refs.packageWrite(repoOf('beta'), 'kept', '1.0.0', HASH);

      // Removed as the API removes one: marked, its records and objects deleted
      // a batch at a time, and then the repository itself.
      await storage.repos.setStatus('alpha', 'deleting', 'active');
      for (let cursor: string | undefined; ;) {
        const batch = await storage.repos.deleteRefsBatch('alpha', cursor);
        if (batch.status === 'done') break;
        cursor = batch.cursor;
      }
      for (let cursor: string | undefined; ;) {
        const batch = await storage.repos.deleteObjectsBatch('alpha', cursor);
        if (batch.status === 'done') break;
        cursor = batch.cursor;
      }
      await storage.repos.remove('alpha');
      assert.equal(await storage.repos.exists('alpha'), false);
      assert.deepEqual(await storage.repos.list(), ['beta']);

      await storage.repos.create('alpha');
      assert.equal(await storage.objects.count(repo), 0);
      assert.deepEqual(await storage.refs.packageList(repo), []);
      assert.deepEqual(await storage.refs.workspaceList(repo), []);
      assert.deepEqual(await storage.refs.executionList(repo), []);
      assert.equal(await storage.refs.adoptionRead(repo, HASH), null);
      assert.deepEqual(await storage.datasets.list(repo, 'ws'), []);
      assert.equal((await storage.logs.read(repo, TASK, INPUTS, id, 'stdout')).totalSize, 0);
      assert.deepEqual(await storage.refs.packageList(repoOf('beta')), [{ name: 'kept', version: '1.0.0' }], 'another repository keeps its own');
    });

    it('refuses a repository\'s name that cannot be one path segment, naming it, before it reads or writes anything', async (t) => {
      const { storage } = await setup(t);
      for (const name of MALFORMED_NAMES['repository']) {
        const refused = nameRefusal('repository', name);
        await assert.rejects(storage.repos.exists(name), refused);
        await assert.rejects(storage.repos.getMetadata(name), refused);
        await assert.rejects(storage.repos.create(name), refused);
        await assert.rejects(storage.repos.setStatus(name, 'deleting'), refused);
        await assert.rejects(storage.repos.remove(name), refused);
        await assert.rejects(storage.repos.deleteRefsBatch(name), refused);
        await assert.rejects(storage.repos.deleteObjectsBatch(name), refused);
      }
      assert.deepEqual(await storage.repos.list(), [], 'no repository is created');
    });

    it('refuses gc an object\'s hash or a run\'s id that is not of its form, naming it, before it reads or writes anything', async (t) => {
      const { storage, repoOf } = await setup(t);
      await storage.repos.create('alpha');
      const repo = repoOf('alpha');
      const start = Date.now();
      const held = await storage.objects.write(repo, new TextEncoder().encode('an object'));
      const noted = await storage.objects.write(repo, new TextEncoder().encode('a noted object'));
      assert.deepEqual(await storage.repos.gcNoteUnreachable(repo, [noted], start), [start]);

      for (const malformed of MALFORMED_HASHES) {
        const refused = hashRefusal('object hash', malformed);
        // A batch naming one does nothing of the rest
        await assert.rejects(storage.repos.gcNoteUnreachable(repo, [held, malformed], start), refused);
        await assert.rejects(storage.repos.gcClearUnreachable(repo, [noted, malformed]), refused);
        await assert.rejects(storage.repos.gcDeleteObjects(repo, [held, malformed]), refused);
        await assert.rejects(storage.repos.gcDeleteUnreachable(repo, malformed, start), refused);
      }
      assert.deepEqual((await storage.objects.list(repo)).sort(), [held, noted].sort(), 'nothing is deleted');
      assert.deepEqual(await storage.repos.gcNoteUnreachable(repo, [held, noted], start + 1), [start + 1, start],
        'nothing is noted, and no note cleared');

      for (const malformed of MALFORMED_IDS) {
        const refused = idRefusal('gc run id', malformed);
        await assert.rejects(storage.repos.gcRunWrite(repo, malformed, 'roots', new Uint8Array([1])), refused);
        await assert.rejects(storage.repos.gcRunRead(repo, malformed, 'roots'), refused);
        await assert.rejects(storage.repos.gcRunDelete(repo, malformed), refused);
      }
    });
  });
}
