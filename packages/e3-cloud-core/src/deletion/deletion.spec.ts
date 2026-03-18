/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Unit tests for deletion step handlers.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { variant } from '@elaraai/east';
import { InMemoryStorage } from '@elaraai/e3-core';
import { InMemoryRepoManager } from '../testing/in-memory.js';
import { handleCheckWorkspaces } from './check-workspaces.js';
import { handleDeleteRefsBatch } from './delete-refs-batch.js';
import { handleDeleteS3Objects } from './delete-s3-objects.js';
import { handleSetDeleting, handleRollbackDelete, handleRemoveRepo } from './set-delete-status.js';
import type { ObjectCleanupStore } from './delete-s3-objects.js';

const REPO = 'test-repo';

describe('deletion step handlers', () => {
  let storage: InMemoryStorage;
  let repoManager: InMemoryRepoManager;

  beforeEach(() => {
    storage = new InMemoryStorage();
    repoManager = new InMemoryRepoManager();
  });

  // ── handleCheckWorkspaces ─────────────────────────────

  it('checkWorkspaces — returns false for empty repo', async () => {
    const result = await handleCheckWorkspaces(
      { listWorkspaces: () => Promise.resolve([]) },
      { repo: REPO },
    );
    assert.equal(result.hasWorkspaces, false);
    assert.equal(result.count, 0);
  });

  it('checkWorkspaces — returns true with count for repo with workspaces', async () => {
    const result = await handleCheckWorkspaces(
      { listWorkspaces: () => Promise.resolve(['ws1', 'ws2']) },
      { repo: REPO },
    );
    assert.equal(result.hasWorkspaces, true);
    assert.equal(result.count, 2);
  });

  // ── handleDeleteRefsBatch ─────────────────────────────

  it('deleteRefsBatch — returns done when no more items', async () => {
    await repoManager.createRepo(REPO);
    const result = await handleDeleteRefsBatch(
      { repoStore: storage.repos },
      { repo: REPO },
    );
    assert.equal(result.status, 'done');
    assert.equal(result.cursor, undefined);
  });

  // ── handleDeleteS3Objects ─────────────────────────────

  it('deleteS3Objects — returns done when no continuation token', async () => {
    const mockStore: ObjectCleanupStore = {
      async deleteObjectsBatch() {
        return { deleted: 0, continuationToken: undefined };
      },
    };
    const result = await handleDeleteS3Objects(
      { objectCleanupStore: mockStore },
      { repo: REPO },
    );
    assert.equal(result.status, 'done');
    assert.equal(result.deleted, 0);
  });

  it('deleteS3Objects — returns continue with token', async () => {
    const mockStore: ObjectCleanupStore = {
      async deleteObjectsBatch() {
        return { deleted: 5, continuationToken: 'next-page' };
      },
    };
    const result = await handleDeleteS3Objects(
      { objectCleanupStore: mockStore },
      { repo: REPO },
    );
    assert.equal(result.status, 'continue');
    assert.equal(result.continuationToken, 'next-page');
    assert.equal(result.deleted, 5);
  });

  // ── handleSetDeleting ──────────────────────────────────

  it('setDeleting — transitions to_delete to deleting', async () => {
    await repoManager.createRepo(REPO);
    await repoManager.setRepoStatus(REPO, 'active', 'to_delete');

    const result = await handleSetDeleting(
      { repoManager, repoStore: storage.repos },
      { repo: REPO },
    );
    assert.equal(result.success, true);
    assert.equal(result.status, 'deleting');

    const metadata = await repoManager.getRepoMetadata(REPO);
    assert.equal(metadata?.status, 'deleting');
  });

  it('setDeleting — fails for active repo', async () => {
    await repoManager.createRepo(REPO);

    const result = await handleSetDeleting(
      { repoManager, repoStore: storage.repos },
      { repo: REPO },
    );
    assert.equal(result.success, false);
  });

  // ── handleRollbackDelete ──────────────────────────────

  it('rollbackDelete — succeeds for to_delete repo', async () => {
    await repoManager.createRepo(REPO);
    await repoManager.setRepoStatus(REPO, 'active', 'to_delete');

    const result = await handleRollbackDelete(
      { repoManager, repoStore: storage.repos },
      { repo: REPO },
    );
    assert.equal(result.success, true);
    assert.equal(result.status, 'active');

    const metadata = await repoManager.getRepoMetadata(REPO);
    assert.equal(metadata?.status, 'active');
  });

  it('rollbackDelete — returns failure for repo not in to_delete state', async () => {
    await repoManager.createRepo(REPO);
    // repo is 'active', not 'to_delete'

    const result = await handleRollbackDelete(
      { repoManager, repoStore: storage.repos },
      { repo: REPO },
    );
    assert.equal(result.success, false);
  });

  it('rollbackDelete — refuses to rollback from deleting (point of no return)', async () => {
    await repoManager.createRepo(REPO);
    await repoManager.setRepoStatus(REPO, 'active', 'to_delete');
    await repoManager.setRepoStatus(REPO, 'to_delete', 'deleting');

    const result = await handleRollbackDelete(
      { repoManager, repoStore: storage.repos },
      { repo: REPO },
    );
    assert.equal(result.success, false);
    assert.equal(result.status, 'deleting');
    assert.ok(result.error?.includes('point of no return'));

    // Status should remain 'deleting'
    const metadata = await repoManager.getRepoMetadata(REPO);
    assert.equal(metadata?.status, 'deleting');
  });

  // ── handleRemoveRepo ──────────────────────────────────

  it('removeRepo — removes repo metadata', async () => {
    await repoManager.createRepo(REPO);

    const result = await handleRemoveRepo(
      { repoManager, repoStore: storage.repos },
      { repo: REPO },
    );
    assert.equal(result.success, true);
    assert.equal(result.status, 'removed');

    const metadata = await repoManager.getRepoMetadata(REPO);
    assert.equal(metadata, null);
  });
});
