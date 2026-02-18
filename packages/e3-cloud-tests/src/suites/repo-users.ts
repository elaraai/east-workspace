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
import { repoUsers, addUser, removeUser } from '@elaraai/e3-cloud-client';
import { repoCreate } from '@elaraai/e3-api-client';
import type { AdminTestContext } from '../context.js';
import { expectError } from '../helpers.js';

/**
 * Register repository user management tests.
 *
 * @param getContext - Function that returns the current test context
 */
export function repoUsersTests(getContext: () => AdminTestContext): void {
  void describe('Repository User Management', () => {
    void beforeEach(async () => {
      const ctx = getContext();
      await repoCreate(ctx.config.baseUrl, ctx.repoName, await ctx.opts('owner'));
    });

    void describe('GET /repos/{repo}/users', () => {
      void it('owner can list users', async () => {
        const ctx = getContext();
        const ownerUser = await ctx.getTestUser('owner');

        const users = await repoUsers(ctx.config.baseUrl, ctx.repoName, await ctx.opts('owner'));

        assert.ok(Array.isArray(users));
        assert.ok(users.length >= 1);

        const owner = users.find(u => u.userId === ownerUser.sub);
        assert.ok(owner, 'Owner should be in user list');
        assert.strictEqual(owner.role.type, 'owner');
      });

      void it('member can list users', async () => {
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
        const users = await repoUsers(ctx.config.baseUrl, ctx.repoName, await ctx.opts('member'));

        assert.ok(Array.isArray(users));
        assert.ok(users.length >= 2);
      });

      void it('outsider cannot list users (403)', async () => {
        const ctx = getContext();

        await expectError(
          repoUsers(ctx.config.baseUrl, ctx.repoName, await ctx.opts('outsider')),
          'forbidden'
        );
      });
    });

    void describe('POST /repos/{repo}/users', () => {
      void it('owner can add new member', async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');

        const user = await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('member', null) },
          await ctx.opts('owner')
        );

        assert.strictEqual(user.email, memberUser.email);
        assert.strictEqual(user.role.type, 'member');
      });

      void it('owner can add new owner', async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');

        const user = await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('owner', null) },
          await ctx.opts('owner')
        );

        assert.strictEqual(user.role.type, 'owner');
      });

      void it('owner can promote member to owner', async () => {
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
        const user = await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('owner', null) },
          await ctx.opts('owner')
        );

        assert.strictEqual(user.role.type, 'owner');

        // Verify only one entry exists
        const users = await repoUsers(ctx.config.baseUrl, ctx.repoName, await ctx.opts('owner'));
        const memberEntries = users.filter(u => u.userId === memberUser.sub);
        assert.strictEqual(memberEntries.length, 1, 'Should have exactly one entry for member');
      });

      void it('member cannot add users (403)', async () => {
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

      void it('returns user_not_found for unknown email', async () => {
        const ctx = getContext();

        // First verify owner can list users (to confirm repo exists and owner has access)
        await repoUsers(ctx.config.baseUrl, ctx.repoName, await ctx.opts('owner'));

        await expectError(
          addUser(
            ctx.config.baseUrl,
            ctx.repoName,
            { email: 'nonexistent@example.com', role: variant('member', null) },
            await ctx.opts('owner')
          ),
          'user_not_found'
        );
      });

      void it('outsider cannot add users (403)', async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');

        await expectError(
          addUser(
            ctx.config.baseUrl,
            ctx.repoName,
            { email: memberUser.email, role: variant('member', null) },
            await ctx.opts('outsider')
          ),
          'forbidden'
        );
      });
    });

    void describe('DELETE /repos/{repo}/users/{userId}', () => {
      void it('owner can remove member', async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');

        // Add member
        await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('member', null) },
          await ctx.opts('owner')
        );

        // Remove member (no return value on success)
        await removeUser(
          ctx.config.baseUrl,
          ctx.repoName,
          memberUser.sub,
          await ctx.opts('owner')
        );

        // Verify removed
        const users = await repoUsers(ctx.config.baseUrl, ctx.repoName, await ctx.opts('owner'));
        const memberEntry = users.find(u => u.userId === memberUser.sub);
        assert.strictEqual(memberEntry, undefined, 'Member should be removed');
      });

      void it('owner can remove other owner (if not last)', async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');

        // Add second owner
        await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('owner', null) },
          await ctx.opts('owner')
        );

        // Original owner removes new owner (no return value on success)
        await removeUser(
          ctx.config.baseUrl,
          ctx.repoName,
          memberUser.sub,
          await ctx.opts('owner')
        );
      });

      void it('cannot remove last owner (400 last_owner)', async () => {
        const ctx = getContext();
        const ownerUser = await ctx.getTestUser('owner');

        // Try to remove self (only owner)
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

      void it('member cannot remove users (403)', async () => {
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

      void it('outsider cannot remove users (403)', async () => {
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
        await expectError(
          removeUser(
            ctx.config.baseUrl,
            ctx.repoName,
            memberUser.sub,
            await ctx.opts('outsider')
          ),
          'forbidden'
        );
      });
    });
  });
}
