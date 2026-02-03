/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/**
 * Unit tests for authorization business logic.
 *
 * Uses InMemoryAclStore for fast, isolated testing without cloud dependencies.
 */

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { variant, none } from '@elaraai/east';
import type { RepoUser } from '@elaraai/e3-admin-types';
import { hasAccess, isLastOwner, canRemoveUser } from './authz.js';
import { InMemoryAclStore } from './testing/in-memory.js';

/**
 * Create a test RepoUser with sensible defaults.
 */
function createTestUser(
  userId: string,
  role: 'owner' | 'member',
  email = `${userId}@test.example.com`
): RepoUser {
  return {
    userId,
    email,
    name: none,
    role: variant(role, null),
    addedBy: 'test-setup',
    addedAt: new Date().toISOString(),
  };
}

describe('hasAccess', () => {
  let store: InMemoryAclStore;
  const repo = 'test-repo';

  beforeEach(() => {
    store = new InMemoryAclStore();
  });

  it('admin bypasses all ACL checks', async () => {
    // Admin has access even with no ACL entries
    const result = await hasAccess(store, repo, 'admin-user', 'owner', true);
    assert.strictEqual(result, true);
  });

  it('admin bypasses checks even for unknown repos', async () => {
    const result = await hasAccess(store, 'nonexistent-repo', 'admin-user', 'owner', true);
    assert.strictEqual(result, true);
  });

  it('owner has access when owner required', async () => {
    await store.addUser(repo, createTestUser('owner-1', 'owner'));

    const result = await hasAccess(store, repo, 'owner-1', 'owner', false);
    assert.strictEqual(result, true);
  });

  it('owner has access when member required', async () => {
    await store.addUser(repo, createTestUser('owner-1', 'owner'));

    const result = await hasAccess(store, repo, 'owner-1', 'member', false);
    assert.strictEqual(result, true);
  });

  it('member has access when member required', async () => {
    await store.addUser(repo, createTestUser('member-1', 'member'));

    const result = await hasAccess(store, repo, 'member-1', 'member', false);
    assert.strictEqual(result, true);
  });

  it('member denied when owner required', async () => {
    await store.addUser(repo, createTestUser('member-1', 'member'));

    const result = await hasAccess(store, repo, 'member-1', 'owner', false);
    assert.strictEqual(result, false);
  });

  it('unknown user denied', async () => {
    // No ACL entries - user should be denied
    const result = await hasAccess(store, repo, 'unknown-user', 'member', false);
    assert.strictEqual(result, false);
  });

  it('user denied on different repo', async () => {
    await store.addUser(repo, createTestUser('owner-1', 'owner'));

    // User has access to test-repo but not other-repo
    const result = await hasAccess(store, 'other-repo', 'owner-1', 'member', false);
    assert.strictEqual(result, false);
  });
});

describe('isLastOwner', () => {
  let store: InMemoryAclStore;
  const repo = 'test-repo';

  beforeEach(() => {
    store = new InMemoryAclStore();
  });

  it('returns true when user is only owner', async () => {
    await store.addUser(repo, createTestUser('owner-1', 'owner'));

    const result = await isLastOwner(store, repo, 'owner-1');
    assert.strictEqual(result, true);
  });

  it('returns true with single owner and members', async () => {
    await store.addUser(repo, createTestUser('owner-1', 'owner'));
    await store.addUser(repo, createTestUser('member-1', 'member'));
    await store.addUser(repo, createTestUser('member-2', 'member'));

    const result = await isLastOwner(store, repo, 'owner-1');
    assert.strictEqual(result, true);
  });

  it('returns false when multiple owners exist', async () => {
    await store.addUser(repo, createTestUser('owner-1', 'owner'));
    await store.addUser(repo, createTestUser('owner-2', 'owner'));

    const result = await isLastOwner(store, repo, 'owner-1');
    assert.strictEqual(result, false);
  });

  it('returns false for member (not owner)', async () => {
    await store.addUser(repo, createTestUser('owner-1', 'owner'));
    await store.addUser(repo, createTestUser('member-1', 'member'));

    const result = await isLastOwner(store, repo, 'member-1');
    assert.strictEqual(result, false);
  });

  it('returns false for unknown user', async () => {
    await store.addUser(repo, createTestUser('owner-1', 'owner'));

    const result = await isLastOwner(store, repo, 'unknown-user');
    assert.strictEqual(result, false);
  });

  it('returns false for empty repo', async () => {
    const result = await isLastOwner(store, repo, 'any-user');
    assert.strictEqual(result, false);
  });
});

describe('canRemoveUser', () => {
  let store: InMemoryAclStore;
  const repo = 'test-repo';

  beforeEach(() => {
    store = new InMemoryAclStore();
  });

  it('owner can remove member', async () => {
    await store.addUser(repo, createTestUser('owner-1', 'owner'));
    await store.addUser(repo, createTestUser('member-1', 'member'));

    const result = await canRemoveUser(store, repo, 'owner-1', 'member-1', false);
    assert.strictEqual(result.ok, true);
  });

  it('owner can remove other owner (if not last)', async () => {
    await store.addUser(repo, createTestUser('owner-1', 'owner'));
    await store.addUser(repo, createTestUser('owner-2', 'owner'));

    const result = await canRemoveUser(store, repo, 'owner-1', 'owner-2', false);
    assert.strictEqual(result.ok, true);
  });

  it('cannot remove last owner (returns last_owner error)', async () => {
    await store.addUser(repo, createTestUser('owner-1', 'owner'));
    await store.addUser(repo, createTestUser('member-1', 'member'));

    const result = await canRemoveUser(store, repo, 'owner-1', 'owner-1', false);
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.code.type, 'last_owner');
      assert.match(result.message, /last owner/i);
    }
  });

  it('owner cannot remove themselves if last owner', async () => {
    await store.addUser(repo, createTestUser('owner-1', 'owner'));

    const result = await canRemoveUser(store, repo, 'owner-1', 'owner-1', false);
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.code.type, 'last_owner');
    }
  });

  it('member cannot remove users (returns forbidden)', async () => {
    await store.addUser(repo, createTestUser('owner-1', 'owner'));
    await store.addUser(repo, createTestUser('member-1', 'member'));
    await store.addUser(repo, createTestUser('member-2', 'member'));

    const result = await canRemoveUser(store, repo, 'member-1', 'member-2', false);
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.code.type, 'forbidden');
      assert.match(result.message, /owner/i);
    }
  });

  it('admin can remove any user except last owner', async () => {
    await store.addUser(repo, createTestUser('owner-1', 'owner'));
    await store.addUser(repo, createTestUser('member-1', 'member'));

    // Admin can remove member
    const result1 = await canRemoveUser(store, repo, 'admin-user', 'member-1', true);
    assert.strictEqual(result1.ok, true);

    // Admin still cannot remove last owner
    const result2 = await canRemoveUser(store, repo, 'admin-user', 'owner-1', true);
    assert.strictEqual(result2.ok, false);
    if (!result2.ok) {
      assert.strictEqual(result2.code.type, 'last_owner');
    }
  });

  it('admin can remove owner if multiple owners exist', async () => {
    await store.addUser(repo, createTestUser('owner-1', 'owner'));
    await store.addUser(repo, createTestUser('owner-2', 'owner'));

    const result = await canRemoveUser(store, repo, 'admin-user', 'owner-1', true);
    assert.strictEqual(result.ok, true);
  });

  it('unknown actor gets forbidden error', async () => {
    await store.addUser(repo, createTestUser('owner-1', 'owner'));
    await store.addUser(repo, createTestUser('member-1', 'member'));

    const result = await canRemoveUser(store, repo, 'unknown-user', 'member-1', false);
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.code.type, 'forbidden');
    }
  });
});
