/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
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
import { repoUsers, addUser, removeUser, ApiError } from '@elaraai/e3-cloud-client';
import { repoCreate } from '@elaraai/e3-api-client';
import type { AdminTestContext } from '../context.js';
import { expectError } from '../helpers.js';

/**
 * Register authorization tests.
 *
 * @param getContext - Function that returns the current test context
 */
export function authorizationTests(getContext: () => AdminTestContext): void {
  void describe('Authorization', () => {
    void beforeEach(async () => {
      const ctx = getContext();
      await repoCreate(ctx.config.baseUrl, ctx.repoName, await ctx.opts('owner'));
    });

    void describe('Outsider permissions', () => {
      void it('outsider cannot access any repo endpoint', async () => {
        const ctx = getContext();

        // Try to list users
        await expectError(
          repoUsers(ctx.config.baseUrl, ctx.repoName, await ctx.opts('outsider')),
          'forbidden'
        );
      });

      void it('outsider cannot access repo that does not exist', async () => {
        const ctx = getContext();

        // Could be forbidden (no access) or user_not_found depending on implementation
        try {
          await repoUsers(ctx.config.baseUrl, 'nonexistent-repo', await ctx.opts('outsider'));
          assert.fail('Expected error but operation succeeded');
        } catch (error) {
          assert.ok(error instanceof ApiError, `Expected ApiError, got ${error}`);
          assert.ok(
            error.code === 'forbidden' || error.code === 'user_not_found',
            `Expected 'forbidden' or 'user_not_found', got '${error.code}'`
          );
        }
      });
    });

    void describe('Member permissions', () => {
      void beforeEach(async () => {
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

      void it('member can read user list', async () => {
        const ctx = getContext();

        // Should succeed (no error thrown)
        const users = await repoUsers(ctx.config.baseUrl, ctx.repoName, await ctx.opts('member'));
        assert.ok(Array.isArray(users));
      });

      void it('member cannot add users', async () => {
        const ctx = getContext();
        const outsiderUser = await ctx.getTestUser('outsider');

        await expectError(
          addUser(
            ctx.config.baseUrl,
            ctx.repoName,
            { email: outsiderUser.email, role: variant('member', null) },
            await ctx.opts('member')
          ),
          'forbidden'
        );
      });

      void it('member cannot remove users', async () => {
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
        await expectError(
          removeUser(
            ctx.config.baseUrl,
            ctx.repoName,
            outsiderUser.sub,
            await ctx.opts('member')
          ),
          'forbidden'
        );
      });

      void it('member cannot remove themselves', async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');

        await expectError(
          removeUser(
            ctx.config.baseUrl,
            ctx.repoName,
            memberUser.sub,
            await ctx.opts('member')
          ),
          'forbidden'
        );
      });
    });

    void describe('Owner permissions', () => {
      void it('owner can perform all operations', async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');

        // Can list users (should not throw)
        const users = await repoUsers(ctx.config.baseUrl, ctx.repoName, await ctx.opts('owner'));
        assert.ok(Array.isArray(users));

        // Can add users (should not throw)
        const addedUser = await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('member', null) },
          await ctx.opts('owner')
        );
        assert.strictEqual(addedUser.email, memberUser.email);

        // Can remove users (should not throw)
        await removeUser(
          ctx.config.baseUrl,
          ctx.repoName,
          memberUser.sub,
          await ctx.opts('owner')
        );
      });

      void it('owner cannot remove themselves if last owner', async () => {
        const ctx = getContext();
        const ownerUser = await ctx.getTestUser('owner');

        await expectError(
          removeUser(
            ctx.config.baseUrl,
            ctx.repoName,
            ownerUser.sub,
            await ctx.opts('owner')
          ),
          'last_owner'
        );
      });

      void it('owner can remove themselves if another owner exists', async () => {
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

        // Original owner can now remove themselves (should not throw)
        await removeUser(
          ctx.config.baseUrl,
          ctx.repoName,
          ownerUser.sub,
          await ctx.opts('owner')
        );
      });
    });

    void describe('Admin permissions', () => {
      void it('admin bypasses all ACL checks', async () => {
        const ctx = getContext();

        // Admin can list users on any repo (even without ACL entry)
        const users = await repoUsers(ctx.config.baseUrl, ctx.repoName, await ctx.opts('admin'));
        assert.ok(Array.isArray(users));
      });

      void it('admin can add users to any repo', async () => {
        const ctx = getContext();
        const outsiderUser = await ctx.getTestUser('outsider');

        const user = await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: outsiderUser.email, role: variant('member', null) },
          await ctx.opts('admin')
        );

        assert.strictEqual(user.email, outsiderUser.email);
      });

      void it('admin can remove users from any repo', async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');

        // Add member
        await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('member', null) },
          await ctx.opts('owner')
        );

        // Admin removes member (should not throw)
        await removeUser(
          ctx.config.baseUrl,
          ctx.repoName,
          memberUser.sub,
          await ctx.opts('admin')
        );
      });

      void it('admin still cannot remove last owner', async () => {
        const ctx = getContext();
        const ownerUser = await ctx.getTestUser('owner');

        // Admin tries to remove last owner
        await expectError(
          removeUser(
            ctx.config.baseUrl,
            ctx.repoName,
            ownerUser.sub,
            await ctx.opts('admin')
          ),
          'last_owner'
        );
      });
    });

    void describe('Role transitions', () => {
      void it('promoting member to owner grants owner permissions', async () => {
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
        await expectError(
          addUser(
            ctx.config.baseUrl,
            ctx.repoName,
            { email: outsiderUser.email, role: variant('member', null) },
            await ctx.opts('member')
          ),
          'forbidden'
        );

        // Promote to owner
        await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('owner', null) },
          await ctx.opts('owner')
        );

        // Now member (promoted to owner) can add users (should not throw)
        const user = await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: outsiderUser.email, role: variant('member', null) },
          await ctx.opts('member')
        );
        assert.strictEqual(user.email, outsiderUser.email);
      });

      void it('demoting owner to member removes owner permissions', async () => {
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

        // Verify second owner can add users (should not throw)
        await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: outsiderUser.email, role: variant('member', null) },
          await ctx.opts('member')
        );

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
        await expectError(
          addUser(
            ctx.config.baseUrl,
            ctx.repoName,
            { email: outsiderUser.email, role: variant('member', null) },
            await ctx.opts('member')
          ),
          'forbidden'
        );
      });
    });
  });
}
