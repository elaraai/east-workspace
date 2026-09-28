/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for InMemoryRepoStore.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import type { InMemoryRepoStore } from './InMemoryRepoStore.js';
import { InMemoryStorage } from './InMemoryStorage.js';
import {
  RepoNotFoundError,
  RepoAlreadyExistsError,
  RepoStatusConflictError,
} from '../../errors.js';

describe('InMemoryRepoStore', () => {
  let storage: InMemoryStorage;
  let store: InMemoryRepoStore;

  beforeEach(() => {
    storage = new InMemoryStorage();
    store = storage.repos;
  });

  describe('list', () => {
    it('returns empty array initially', async () => {
      const repos = await store.list();
      assert.deepStrictEqual(repos, []);
    });

    it('returns all created repos', async () => {
      await store.create('repo1');
      await store.create('repo2');
      await store.create('repo3');

      const repos = await store.list();
      assert.deepStrictEqual(repos.sort(), ['repo1', 'repo2', 'repo3']);
    });
  });

  describe('exists', () => {
    it('returns false for non-existent repo', async () => {
      const exists = await store.exists('nonexistent');
      assert.strictEqual(exists, false);
    });

    it('returns true for existing repo', async () => {
      await store.create('my-repo');
      const exists = await store.exists('my-repo');
      assert.strictEqual(exists, true);
    });
  });

  describe('getMetadata', () => {
    it('returns null for non-existent repo', async () => {
      const metadata = await store.getMetadata('nonexistent');
      assert.strictEqual(metadata, null);
    });

    it('returns metadata for existing repo', async () => {
      await store.create('my-repo');
      const metadata = await store.getMetadata('my-repo');

      assert.ok(metadata);
      assert.strictEqual(metadata.name, 'my-repo');
      assert.strictEqual(metadata.status.type, 'active');
      assert.ok(metadata.createdAt);
      assert.ok(metadata.statusChangedAt);
    });
  });

  describe('create', () => {
    it('creates a new repo with active status', async () => {
      await store.create('my-repo');

      const metadata = await store.getMetadata('my-repo');
      assert.ok(metadata);
      assert.strictEqual(metadata.status.type, 'active');
    });

    it('throws RepoAlreadyExistsError if repo exists', async () => {
      await store.create('my-repo');

      await assert.rejects(
        () => store.create('my-repo'),
        RepoAlreadyExistsError
      );
    });
  });

  describe('setStatus', () => {
    it('updates status', async () => {
      await store.create('my-repo');
      await store.setStatus('my-repo', 'gc');

      const metadata = await store.getMetadata('my-repo');
      assert.ok(metadata);
      assert.strictEqual(metadata.status.type, 'gc');
    });

    it('updates statusChangedAt', async () => {
      await store.create('my-repo');
      const before = await store.getMetadata('my-repo');

      // Wait a tiny bit to ensure timestamps differ
      await new Promise(resolve => setTimeout(resolve, 10));

      await store.setStatus('my-repo', 'gc');
      const after = await store.getMetadata('my-repo');

      assert.ok(before && after);
      assert.notStrictEqual(before.statusChangedAt.getTime(), after.statusChangedAt.getTime());
    });

    it('throws RepoNotFoundError for non-existent repo', async () => {
      await assert.rejects(
        () => store.setStatus('nonexistent', 'gc'),
        RepoNotFoundError
      );
    });

    it('succeeds with correct expected status', async () => {
      await store.create('my-repo');
      await store.setStatus('my-repo', 'gc', 'active');

      const metadata = await store.getMetadata('my-repo');
      assert.ok(metadata);
      assert.strictEqual(metadata.status.type, 'gc');
    });

    it('throws RepoStatusConflictError with wrong expected status', async () => {
      await store.create('my-repo');

      await assert.rejects(
        () => store.setStatus('my-repo', 'gc', 'deleting'),
        RepoStatusConflictError
      );
    });

    it('succeeds with expected status array', async () => {
      await store.create('my-repo');
      await store.setStatus('my-repo', 'gc', ['active', 'creating']);

      const metadata = await store.getMetadata('my-repo');
      assert.ok(metadata);
      assert.strictEqual(metadata.status.type, 'gc');
    });

    it('throws RepoStatusConflictError with expected status array not matching', async () => {
      await store.create('my-repo');

      await assert.rejects(
        () => store.setStatus('my-repo', 'gc', ['creating', 'deleting']),
        RepoStatusConflictError
      );
    });
  });

  describe('remove', () => {
    it('removes a repo', async () => {
      await store.create('my-repo');
      await store.remove('my-repo');

      const exists = await store.exists('my-repo');
      assert.strictEqual(exists, false);
    });

    it('does not throw for non-existent repo', async () => {
      await store.remove('nonexistent');
      // Should not throw
    });
  });

  describe('deleteRefsBatch', () => {
    it('deletes every record of the repository in one batch, counting them', async () => {
      await store.create('my-repo');
      await storage.refs.packageWrite('my-repo', 'pkg', '1.0.0', 'a'.repeat(64));
      await storage.logs.append('my-repo', 'b'.repeat(64), 'c'.repeat(64), 'id', 'stdout', 'a log');
      const result = await store.deleteRefsBatch('my-repo');

      assert.strictEqual(result.status, 'done');
      assert.strictEqual(result.deleted, 3, 'its record, its package ref and its log');
      assert.strictEqual(await storage.refs.repositoryRead('my-repo'), null);
    });
  });

  describe('deleteObjectsBatch', () => {
    it('deletes every object of the repository in one batch, counting them', async () => {
      await store.create('my-repo');
      await storage.objects.write('my-repo', new Uint8Array([1]));
      await storage.objects.write('my-repo', new Uint8Array([2]));
      const result = await store.deleteObjectsBatch('my-repo');

      assert.strictEqual(result.status, 'done');
      assert.strictEqual(result.deleted, 2);
      assert.strictEqual(await storage.objects.count('my-repo'), 0);
    });
  });

  describe('gcScanPackageRoots', () => {
    it('finds no roots in an empty repository', async () => {
      await store.create('my-repo');
      const result = await store.gcScanPackageRoots('my-repo');
      assert.deepStrictEqual(result.roots, []);
      assert.strictEqual(result.cursor, undefined);
    });

    it('finds the object each package ref names', async () => {
      await store.create('my-repo');
      await storage.refs.packageWrite('my-repo', 'pkg', '1.0.0', 'a'.repeat(64));
      const result = await store.gcScanPackageRoots('my-repo');
      assert.deepStrictEqual(result.roots, ['a'.repeat(64)]);
    });
  });

  describe('gcScanWorkspaceRoots', () => {
    it('finds no roots in an empty repository', async () => {
      await store.create('my-repo');
      const result = await store.gcScanWorkspaceRoots('my-repo');
      assert.deepStrictEqual(result.roots, []);
    });
  });

  describe('gcScanExecutionRoots', () => {
    it('finds no roots in an empty repository', async () => {
      await store.create('my-repo');
      const result = await store.gcScanExecutionRoots('my-repo');
      assert.deepStrictEqual(result.roots, []);
    });
  });

  describe('gcScanObjects', () => {
    it('lists nothing in an empty repository', async () => {
      await store.create('my-repo');
      const result = await store.gcScanObjects('my-repo');
      assert.deepStrictEqual(result.objects, []);
      assert.strictEqual(result.cursor, undefined);
    });

    it('lists each object with its size and when it was written', async () => {
      await store.create('my-repo');
      const before = Date.now();
      const hash = await storage.objects.write('my-repo', new Uint8Array([1, 2, 3]));
      const [entry, ...rest] = (await store.gcScanObjects('my-repo')).objects;
      assert.ok(entry !== undefined);
      assert.deepStrictEqual(rest, []);
      assert.strictEqual(entry.hash, hash);
      assert.strictEqual(entry.size, 3);
      assert.ok(entry.lastModified >= before && entry.lastModified <= Date.now(), 'written just now');
    });
  });

  describe('gcDeleteObjects', () => {
    it('deletes the objects named, passing over one already gone', async () => {
      await store.create('my-repo');
      const kept = await storage.objects.write('my-repo', new Uint8Array([1]));
      const deleted = await storage.objects.write('my-repo', new Uint8Array([2]));
      await store.gcDeleteObjects('my-repo', [deleted, 'a'.repeat(64)]);
      assert.deepStrictEqual(await storage.objects.list('my-repo'), [kept]);
    });
  });

  describe('gcSweepBackend', () => {
    it('sweeps nothing: nothing is kept beside the objects and records', async () => {
      await store.create('my-repo');
      const result = await store.gcSweepBackend('my-repo', new Set(), { minAge: 0, dryRun: false });
      assert.deepStrictEqual(result, { deletedPartials: 0, skippedYoung: 0 });
    });
  });

  describe('clear', () => {
    it('removes all repos', async () => {
      await store.create('repo1');
      await store.create('repo2');

      store.clear();

      const repos = await store.list();
      assert.deepStrictEqual(repos, []);
    });
  });
});
