/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/**
 * Test suite for repository user management endpoints.
 *
 * Tests:
 * - GET /repos/{repo}/users - List users
 * - POST /repos/{repo}/users - Add user
 * - DELETE /repos/{repo}/users/{userId} - Remove user
 */

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { variant } from '@elaraai/east';
import { repoUsers, addUser, removeUser, unwrap } from '@elaraai/e3-admin-client';
import type { AdminTestContext } from '../context.js';

/**
 * Create a test repository with the owner as the initial user.
 */
async function createTestRepo(ctx: AdminTestContext): Promise<void> {
  const token = await ctx.config.getToken('owner');
  const response = await fetch(`${ctx.config.baseUrl}/api/repos/${encodeURIComponent(ctx.repoName)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(`Failed to create test repo: ${response.status} ${await response.text()}`);
  }
}

/**
 * Register repository user management tests.
 *
 * @param getContext - Function that returns the current test context
 */
export function repoUsersTests(getContext: () => AdminTestContext): void {
  describe('Repository User Management', () => {
    beforeEach(async () => {
      const ctx = getContext();
      await createTestRepo(ctx);
    });

    describe('GET /repos/{repo}/users', () => {
      it('owner can list users', async () => {
        const ctx = getContext();
        const ownerUser = await ctx.getTestUser('owner');

        const response = await repoUsers(ctx.config.baseUrl, ctx.repoName, await ctx.opts('owner'));
        const users = unwrap(response);

        assert.ok(Array.isArray(users));
        assert.ok(users.length >= 1);

        const owner = users.find(u => u.userId === ownerUser.sub);
        assert.ok(owner, 'Owner should be in user list');
        assert.strictEqual(owner.role.type, 'owner');
      });

      it('member can list users', async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');

        // Add member first
        await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('member', null) },
          await ctx.opts('owner')
        );

        // Member should be able to list
        const response = await repoUsers(ctx.config.baseUrl, ctx.repoName, await ctx.opts('member'));
        const users = unwrap(response);

        assert.ok(Array.isArray(users));
        assert.ok(users.length >= 2);
      });

      it('outsider cannot list users (403)', async () => {
        const ctx = getContext();

        const response = await repoUsers(ctx.config.baseUrl, ctx.repoName, await ctx.opts('outsider'));

        assert.strictEqual(response.type, 'error');
        if (response.type === 'error') {
          assert.strictEqual(response.value.code, 'forbidden');
        }
      });
    });

    describe('POST /repos/{repo}/users', () => {
      it('owner can add new member', async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');

        const response = await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('member', null) },
          await ctx.opts('owner')
        );

        const user = unwrap(response);
        assert.strictEqual(user.email, memberUser.email);
        assert.strictEqual(user.role.type, 'member');
      });

      it('owner can add new owner', async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');

        const response = await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('owner', null) },
          await ctx.opts('owner')
        );

        const user = unwrap(response);
        assert.strictEqual(user.role.type, 'owner');
      });

      it('owner can promote member to owner', async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');

        // Add as member first
        await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('member', null) },
          await ctx.opts('owner')
        );

        // Promote to owner
        const response = await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('owner', null) },
          await ctx.opts('owner')
        );

        const user = unwrap(response);
        assert.strictEqual(user.role.type, 'owner');

        // Verify only one entry exists
        const listResponse = await repoUsers(ctx.config.baseUrl, ctx.repoName, await ctx.opts('owner'));
        const users = unwrap(listResponse);
        const memberEntries = users.filter(u => u.userId === memberUser.sub);
        assert.strictEqual(memberEntries.length, 1, 'Should have exactly one entry for member');
      });

      it('member cannot add users (403)', async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');
        const outsiderUser = await ctx.getTestUser('outsider');

        // Add member first
        await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('member', null) },
          await ctx.opts('owner')
        );

        // Member tries to add outsider
        const response = await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: outsiderUser.email, role: variant('member', null) },
          await ctx.opts('member')
        );

        assert.strictEqual(response.type, 'error');
        if (response.type === 'error') {
          assert.strictEqual(response.value.code, 'forbidden');
        }
      });

      it('returns user_not_found for unknown email', async () => {
        const ctx = getContext();
        console.log('[DEBUG] Test: returns user_not_found for unknown email');
        console.log('[DEBUG] baseUrl:', ctx.config.baseUrl);
        console.log('[DEBUG] repoName:', ctx.repoName);

        // First verify owner can list users (to confirm repo exists and owner has access)
        const listResponse = await repoUsers(ctx.config.baseUrl, ctx.repoName, await ctx.opts('owner'));
        console.log('[DEBUG] listUsers response.type:', listResponse.type);
        if (listResponse.type === 'error') {
          console.log('[DEBUG] listUsers error:', listResponse.value.code, listResponse.value.details);
        }

        const response = await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: 'nonexistent@example.com', role: variant('member', null) },
          await ctx.opts('owner')
        );

        console.log('[DEBUG] addUser response.type:', response.type);
        if (response.type === 'error') {
          console.log('[DEBUG] addUser error.code:', response.value.code);
          console.log('[DEBUG] addUser error.details:', response.value.details);
        }

        assert.strictEqual(response.type, 'error');
        if (response.type === 'error') {
          assert.strictEqual(response.value.code, 'user_not_found');
        }
      });

      it('outsider cannot add users (403)', async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');

        const response = await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('member', null) },
          await ctx.opts('outsider')
        );

        assert.strictEqual(response.type, 'error');
        if (response.type === 'error') {
          assert.strictEqual(response.value.code, 'forbidden');
        }
      });
    });

    describe('DELETE /repos/{repo}/users/{userId}', () => {
      it('owner can remove member', async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');

        // Add member
        await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('member', null) },
          await ctx.opts('owner')
        );

        // Remove member
        const response = await removeUser(
          ctx.config.baseUrl,
          ctx.repoName,
          memberUser.sub,
          await ctx.opts('owner')
        );

        assert.strictEqual(response.type, 'success');

        // Verify removed
        const listResponse = await repoUsers(ctx.config.baseUrl, ctx.repoName, await ctx.opts('owner'));
        const users = unwrap(listResponse);
        const memberEntry = users.find(u => u.userId === memberUser.sub);
        assert.strictEqual(memberEntry, undefined, 'Member should be removed');
      });

      it('owner can remove other owner (if not last)', async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');

        // Add second owner
        await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('owner', null) },
          await ctx.opts('owner')
        );

        // Original owner removes new owner
        const response = await removeUser(
          ctx.config.baseUrl,
          ctx.repoName,
          memberUser.sub,
          await ctx.opts('owner')
        );

        assert.strictEqual(response.type, 'success');
      });

      it('cannot remove last owner (400 last_owner)', async () => {
        const ctx = getContext();
        const ownerUser = await ctx.getTestUser('owner');

        // Try to remove self (only owner)
        const response = await removeUser(
          ctx.config.baseUrl,
          ctx.repoName,
          ownerUser.sub,
          await ctx.opts('owner')
        );

        assert.strictEqual(response.type, 'error');
        if (response.type === 'error') {
          assert.strictEqual(response.value.code, 'last_owner');
        }
      });

      it('member cannot remove users (403)', async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');
        const outsiderUser = await ctx.getTestUser('outsider');

        // Add member and outsider
        await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('member', null) },
          await ctx.opts('owner')
        );
        await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: outsiderUser.email, role: variant('member', null) },
          await ctx.opts('owner')
        );

        // Member tries to remove outsider
        const response = await removeUser(
          ctx.config.baseUrl,
          ctx.repoName,
          outsiderUser.sub,
          await ctx.opts('member')
        );

        assert.strictEqual(response.type, 'error');
        if (response.type === 'error') {
          assert.strictEqual(response.value.code, 'forbidden');
        }
      });

      it('outsider cannot remove users (403)', async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');

        // Add member
        await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('member', null) },
          await ctx.opts('owner')
        );

        // Outsider tries to remove member
        const response = await removeUser(
          ctx.config.baseUrl,
          ctx.repoName,
          memberUser.sub,
          await ctx.opts('outsider')
        );

        assert.strictEqual(response.type, 'error');
        if (response.type === 'error') {
          assert.strictEqual(response.value.code, 'forbidden');
        }
      });
    });
  });
}
