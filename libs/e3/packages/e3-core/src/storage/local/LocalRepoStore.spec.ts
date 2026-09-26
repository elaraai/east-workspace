/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for LocalRepoStore.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { LocalRepoStore } from './LocalRepoStore.js';
import { LocalStorage } from './LocalBackend.js';
import { REPOSITORY_FILENAME, REPOSITORY_LAYOUT, readRepositoryRecord, repoInit } from './repository.js';
import {
  InvalidNameError,
  RepoNotFoundError,
  RepoAlreadyExistsError,
  RepoStatusConflictError,
} from '../../errors.js';
import { createTempDir, removeTempDir } from '../../test-helpers.js';

describe('LocalRepoStore', () => {
  let testDir: string;
  let storage: LocalStorage;
  let store: LocalRepoStore;

  beforeEach(() => {
    testDir = createTempDir();
    storage = new LocalStorage(testDir);
    store = storage.repos as LocalRepoStore;
  });

  afterEach(() => {
    removeTempDir(testDir);
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

    it('does not include invalid directories', async () => {
      await store.create('valid-repo');
      // Create an incomplete repo (missing workspaces dir)
      const invalidDir = join(testDir, 'invalid-repo');
      mkdirSync(invalidDir);
      mkdirSync(join(invalidDir, 'objects'));
      mkdirSync(join(invalidDir, 'packages'));
      mkdirSync(join(invalidDir, 'executions'));
      // Missing 'workspaces' directory

      const repos = await store.list();
      assert.deepStrictEqual(repos, ['valid-repo']);
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

    it('returns metadata for a repo repoInit created', async () => {
      assert.strictEqual(repoInit(join(testDir, 'cli-repo')).success, true);

      const metadata = await store.getMetadata('cli-repo');

      assert.ok(metadata);
      assert.strictEqual(metadata.name, 'cli-repo');
      assert.strictEqual(metadata.status.type, 'active');
      assert.strictEqual(metadata.statusChangedAt.getTime(), metadata.createdAt.getTime());
    });

    it('refuses a repo without a repository record, naming the fix', async () => {
      // The repo an older e3 left: the directories, and its metadata as JSON
      const olderDir = join(testDir, 'older-repo');
      mkdirSync(olderDir);
      mkdirSync(join(olderDir, 'objects'));
      mkdirSync(join(olderDir, 'packages'));
      mkdirSync(join(olderDir, 'executions'));
      mkdirSync(join(olderDir, 'workspaces'));
      writeFileSync(join(olderDir, '.e3-metadata.json'), '{"name":"older-repo","status":"active"}');

      await assert.rejects(store.getMetadata('older-repo'), {
        name: 'RepoLayoutError',
        message: `the repository at ${olderDir} has no repository record: an older e3 wrote it — ` +
          're-create it: deploy again and import its data again',
      });
    });

    it('refuses a repository name that is no one path segment, before it becomes a path', async () => {
      await assert.rejects(store.getMetadata('..'), InvalidNameError);
      await assert.rejects(store.create('../elsewhere'), InvalidNameError);
      await assert.rejects(store.remove('..'), InvalidNameError);
      await assert.rejects(store.deleteRefsBatch('a/b'), InvalidNameError);
      assert.strictEqual(existsSync(join(testDir, '..', 'elsewhere')), false);
    });
  });

  describe('create', () => {
    it('creates a new repo with active status', async () => {
      await store.create('my-repo');

      const metadata = await store.getMetadata('my-repo');
      assert.ok(metadata);
      assert.strictEqual(metadata.status.type, 'active');
    });

    it('creates all required directories', async () => {
      await store.create('my-repo');

      const repoDir = join(testDir, 'my-repo');
      assert.strictEqual(existsSync(join(repoDir, 'objects')), true);
      assert.strictEqual(existsSync(join(repoDir, 'packages')), true);
      assert.strictEqual(existsSync(join(repoDir, 'executions')), true);
      assert.strictEqual(existsSync(join(repoDir, 'workspaces')), true);
    });

    it('creates the repository record, in this e3\'s layout', async () => {
      await store.create('my-repo');

      const repoDir = join(testDir, 'my-repo');
      assert.strictEqual(existsSync(join(repoDir, REPOSITORY_FILENAME)), true);
      assert.strictEqual(existsSync(join(repoDir, '.e3-metadata.json')), false);

      const { layout, metadata } = readRepositoryRecord(repoDir);
      assert.strictEqual(layout, REPOSITORY_LAYOUT);
      assert.strictEqual(metadata.name, 'my-repo');
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
  });

  describe('remove', () => {
    it('removes a repo and its directory', async () => {
      await store.create('my-repo');
      await store.remove('my-repo');

      const exists = await store.exists('my-repo');
      assert.strictEqual(exists, false);

      const dirExists = existsSync(join(testDir, 'my-repo'));
      assert.strictEqual(dirExists, false);
    });

    it('does not throw for non-existent repo', async () => {
      await store.remove('nonexistent');
      // Should not throw
    });
  });

  describe('deleteRefsBatch', () => {
    it('deletes every record directory\'s contents', async () => {
      await store.create('my-repo');
      const repoDir = join(testDir, 'my-repo');

      // One record in each record directory
      const records = [
        join('packages', 'test-pkg', '1.0.0.beast2'),
        join('workspaces', 'main.beast2'),
        join('executions', 'a'.repeat(64), 'b'.repeat(64), 'plan.beast2'),
        join('dataflows', 'main', '0190a0b0-4444-7000-8000-000000000000.beast2'),
        join('adoptions', 'cc', `${'c'.repeat(62)}.beast2`),
        join('locks', 'main', 'exclusive.beast2'),
      ];
      for (const record of records) {
        mkdirSync(join(repoDir, record, '..'), { recursive: true });
        writeFileSync(join(repoDir, record), 'record');
      }

      const result = await store.deleteRefsBatch('my-repo');

      assert.strictEqual(result.status, 'done');
      assert.strictEqual(result.deleted, records.length);
      for (const record of records) {
        assert.strictEqual(existsSync(join(repoDir, record)), false, record);
      }
    });
  });

  describe('deleteObjectsBatch', () => {
    it('deletes objects directory contents', async () => {
      await store.create('my-repo');
      const repoDir = join(testDir, 'my-repo');

      // Create an object
      const objectDir = join(repoDir, 'objects', 'ab');
      mkdirSync(objectDir, { recursive: true });
      writeFileSync(join(objectDir, 'cd1234.beast2'), 'test data');

      const result = await store.deleteObjectsBatch('my-repo');

      assert.strictEqual(result.status, 'done');
      assert.ok(result.deleted >= 1);
    });
  });

  describe('GC primitives', () => {
    // GC primitives receive the full repo path (same as ObjectStore/RefStore),
    // not a repo name relative to reposDir.

    it('gcScanPackageRoots returns empty for empty repo', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');

      const result = await store.gcScanPackageRoots(repoPath);
      assert.deepStrictEqual(result.roots, []);
      assert.strictEqual(result.cursor, undefined);
    });

    it('gcScanWorkspaceRoots returns empty for empty repo', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');

      const result = await store.gcScanWorkspaceRoots(repoPath);
      assert.deepStrictEqual(result.roots, []);
    });

    it('gcScanExecutionRoots returns empty for empty repo', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');

      const result = await store.gcScanExecutionRoots(repoPath);
      assert.deepStrictEqual(result.roots, []);
    });

    it('gcScanObjects returns empty for empty repo', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');

      const result = await store.gcScanObjects(repoPath);
      assert.deepStrictEqual(result.objects, []);
      assert.strictEqual(result.cursor, undefined);
    });

    it('gcScanObjects enumerates objects', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');

      // Create a fake object file
      const objDir = join(repoPath, 'objects', 'ab');
      mkdirSync(objDir, { recursive: true });
      writeFileSync(join(objDir, 'cd' + '0'.repeat(60) + '.beast2'), 'data');

      const result = await store.gcScanObjects(repoPath);
      assert.strictEqual(result.objects.length, 1);
      assert.strictEqual(result.objects[0].hash, 'ab' + 'cd' + '0'.repeat(60));
    });

    it('gcDeleteObjects removes objects', async () => {
      await store.create('my-repo');
      const repoPath = join(testDir, 'my-repo');

      const hash = 'ab' + 'cd' + '0'.repeat(60);
      const objDir = join(repoPath, 'objects', 'ab');
      mkdirSync(objDir, { recursive: true });
      writeFileSync(join(objDir, 'cd' + '0'.repeat(60) + '.beast2'), 'data');

      await store.gcDeleteObjects(repoPath, [hash]);

      const result = await store.gcScanObjects(repoPath);
      assert.strictEqual(result.objects.length, 0);
    });
  });
});
