/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/**
 * Test suite for cross-cutting authorization scenarios.
 *
 * These tests verify that the permission model works correctly across
 * different user roles and repository operations.
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
 * Register authorization tests.
 *
 * @param getContext - Function that returns the current test context
 */
export function authorizationTests(getContext: () => AdminTestContext): void {
  describe('Authorization', () => {
    beforeEach(async () => {
      const ctx = getContext();
      await createTestRepo(ctx);
    });

    describe('Outsider permissions', () => {
      it('outsider cannot access any repo endpoint', async () => {
        const ctx = getContext();

        // Try to list users
        const listResponse = await repoUsers(ctx.config.baseUrl, ctx.repoName, await ctx.opts('outsider'));
        assert.strictEqual(listResponse.type, 'error');
        if (listResponse.type === 'error') {
          assert.strictEqual(listResponse.value.code, 'forbidden');
        }
      });

      it('outsider cannot access repo that does not exist', async () => {
        const ctx = getContext();

        const response = await repoUsers(ctx.config.baseUrl, 'nonexistent-repo', await ctx.opts('outsider'));
        assert.strictEqual(response.type, 'error');
        // Could be forbidden (no access) or not_found depending on implementation
        assert.ok(
          response.type === 'error' &&
          (response.value.code === 'forbidden' || response.value.code === 'user_not_found')
        );
      });
    });

    describe('Member permissions', () => {
      beforeEach(async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');

        // Add member to repo
        await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('member', null) },
          await ctx.opts('owner')
        );
      });

      it('member can read user list', async () => {
        const ctx = getContext();

        const response = await repoUsers(ctx.config.baseUrl, ctx.repoName, await ctx.opts('member'));
        assert.strictEqual(response.type, 'success');
      });

      it('member cannot add users', async () => {
        const ctx = getContext();
        const outsiderUser = await ctx.getTestUser('outsider');

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

      it('member cannot remove users', async () => {
        const ctx = getContext();
        const outsiderUser = await ctx.getTestUser('outsider');

        // Owner adds outsider
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

      it('member cannot remove themselves', async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');

        const response = await removeUser(
          ctx.config.baseUrl,
          ctx.repoName,
          memberUser.sub,
          await ctx.opts('member')
        );

        assert.strictEqual(response.type, 'error');
        if (response.type === 'error') {
          assert.strictEqual(response.value.code, 'forbidden');
        }
      });
    });

    describe('Owner permissions', () => {
      it('owner can perform all operations', async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');

        // Can list users
        const listResponse = await repoUsers(ctx.config.baseUrl, ctx.repoName, await ctx.opts('owner'));
        assert.strictEqual(listResponse.type, 'success');

        // Can add users
        const addResponse = await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('member', null) },
          await ctx.opts('owner')
        );
        assert.strictEqual(addResponse.type, 'success');

        // Can remove users
        const removeResponse = await removeUser(
          ctx.config.baseUrl,
          ctx.repoName,
          memberUser.sub,
          await ctx.opts('owner')
        );
        assert.strictEqual(removeResponse.type, 'success');
      });

      it('owner cannot remove themselves if last owner', async () => {
        const ctx = getContext();
        const ownerUser = await ctx.getTestUser('owner');

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

      it('owner can remove themselves if another owner exists', async () => {
        const ctx = getContext();
        const ownerUser = await ctx.getTestUser('owner');
        const memberUser = await ctx.getTestUser('member');

        // Add another owner
        await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('owner', null) },
          await ctx.opts('owner')
        );

        // Original owner can now remove themselves
        const response = await removeUser(
          ctx.config.baseUrl,
          ctx.repoName,
          ownerUser.sub,
          await ctx.opts('owner')
        );

        assert.strictEqual(response.type, 'success');
      });
    });

    describe('Admin permissions', () => {
      it('admin bypasses all ACL checks', async () => {
        const ctx = getContext();

        // Admin can list users on any repo (even without ACL entry)
        const response = await repoUsers(ctx.config.baseUrl, ctx.repoName, await ctx.opts('admin'));
        assert.strictEqual(response.type, 'success');
      });

      it('admin can add users to any repo', async () => {
        const ctx = getContext();
        const outsiderUser = await ctx.getTestUser('outsider');

        const response = await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: outsiderUser.email, role: variant('member', null) },
          await ctx.opts('admin')
        );

        assert.strictEqual(response.type, 'success');
      });

      it('admin can remove users from any repo', async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');

        // Add member
        await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('member', null) },
          await ctx.opts('owner')
        );

        // Admin removes member
        const response = await removeUser(
          ctx.config.baseUrl,
          ctx.repoName,
          memberUser.sub,
          await ctx.opts('admin')
        );

        assert.strictEqual(response.type, 'success');
      });

      it('admin still cannot remove last owner', async () => {
        const ctx = getContext();
        const ownerUser = await ctx.getTestUser('owner');

        // Admin tries to remove last owner
        const response = await removeUser(
          ctx.config.baseUrl,
          ctx.repoName,
          ownerUser.sub,
          await ctx.opts('admin')
        );

        assert.strictEqual(response.type, 'error');
        if (response.type === 'error') {
          assert.strictEqual(response.value.code, 'last_owner');
        }
      });
    });

    describe('Role transitions', () => {
      it('promoting member to owner grants owner permissions', async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');
        const outsiderUser = await ctx.getTestUser('outsider');

        // Add member
        await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('member', null) },
          await ctx.opts('owner')
        );

        // Verify member cannot add users
        let response = await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: outsiderUser.email, role: variant('member', null) },
          await ctx.opts('member')
        );
        assert.strictEqual(response.type, 'error');

        // Promote to owner
        await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('owner', null) },
          await ctx.opts('owner')
        );

        // Now member (promoted to owner) can add users
        response = await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: outsiderUser.email, role: variant('member', null) },
          await ctx.opts('member')
        );
        assert.strictEqual(response.type, 'success');
      });

      it('demoting owner to member removes owner permissions', async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');
        const outsiderUser = await ctx.getTestUser('outsider');

        // Add second owner
        await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('owner', null) },
          await ctx.opts('owner')
        );

        // Verify second owner can add users
        let response = await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: outsiderUser.email, role: variant('member', null) },
          await ctx.opts('member')
        );
        assert.strictEqual(response.type, 'success');

        // Remove outsider for next test
        await removeUser(ctx.config.baseUrl, ctx.repoName, outsiderUser.sub, await ctx.opts('owner'));

        // Demote to member
        await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('member', null) },
          await ctx.opts('owner')
        );

        // Now demoted user cannot add users
        response = await addUser(
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
    });
  });
}
