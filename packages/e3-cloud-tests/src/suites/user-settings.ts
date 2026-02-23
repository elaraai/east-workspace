/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Test suite for per-user per-workspace settings endpoints.
 *
 * Tests:
 * - GET /repos/{repo}/workspaces/{ws}/user-settings - 200 (binary) | 204 (empty)
 * - PUT /repos/{repo}/workspaces/{ws}/user-settings - 204 | 404 | 409 | 413
 * - DELETE /repos/{repo}/workspaces/{ws}/user-settings - 204
 * - User isolation (different users see different settings)
 * - Authorization (outsider forbidden)
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { variant } from '@elaraai/east';
import {
  getUserSettings,
  putUserSettings,
  deleteUserSettings,
  addUser,
} from '@elaraai/e3-cloud-client';
import { repoCreate, workspaceCreate } from '@elaraai/e3-api-client';
import type { AdminTestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { expectError } from '../helpers.js';

const TEST_WORKSPACE = 'test-ws';

/**
 * Register user settings management tests.
 *
 * @param setup - Factory that creates a fresh test context per test
 */
export function userSettingsTests(setup: TestSetup<AdminTestContext>): void {
  const withRepo: TestSetup<AdminTestContext> = async (t) => {
    const ctx = await setup(t);
    const opts = await ctx.opts('owner');
    await repoCreate(ctx.config.baseUrl, ctx.repoName, opts);
    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, opts);
    return ctx;
  };

  const withMember: TestSetup<AdminTestContext> = async (t) => {
    const ctx = await withRepo(t);
    const memberUser = await ctx.getTestUser('member');
    await addUser(
      ctx.config.baseUrl,
      ctx.repoName,
      { email: memberUser.email, role: variant('member', null) },
      await ctx.opts('owner')
    );
    return ctx;
  };

  void describe('User Settings', { concurrency: true }, () => {
    // ── GET ─────────────────────────────────────────────────────────────

    void describe('GET /user-settings', { concurrency: true }, () => {
      void it('returns null when no settings exist', async (t) => {
        const ctx = await withRepo(t);
        const result = await getUserSettings(
          ctx.config.baseUrl,
          ctx.repoName,
          TEST_WORKSPACE,
          await ctx.opts('owner')
        );
        assert.strictEqual(result, null);
      });

      void it('returns stored binary data after PUT', async (t) => {
        const ctx = await withRepo(t);
        const opts = await ctx.opts('owner');
        const payload = new TextEncoder().encode('test-settings-data');

        await putUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, payload, opts);
        const result = await getUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, opts);

        assert.ok(result instanceof Uint8Array);
        assert.deepStrictEqual(result, payload);
      });

      void it('outsider gets forbidden', async (t) => {
        const ctx = await withRepo(t);
        await expectError(
          getUserSettings(
            ctx.config.baseUrl,
            ctx.repoName,
            TEST_WORKSPACE,
            await ctx.opts('outsider')
          ),
          'forbidden'
        );
      });
    });

    // ── PUT ─────────────────────────────────────────────────────────────

    void describe('PUT /user-settings', { concurrency: true }, () => {
      void it('owner stores settings', async (t) => {
        const ctx = await withRepo(t);
        const payload = new TextEncoder().encode('owner-settings');

        // Should not throw
        await putUserSettings(
          ctx.config.baseUrl,
          ctx.repoName,
          TEST_WORKSPACE,
          payload,
          await ctx.opts('owner')
        );

        // Verify it was stored
        const result = await getUserSettings(
          ctx.config.baseUrl,
          ctx.repoName,
          TEST_WORKSPACE,
          await ctx.opts('owner')
        );
        assert.deepStrictEqual(result, payload);
      });

      void it('overwrites existing settings', async (t) => {
        const ctx = await withRepo(t);
        const opts = await ctx.opts('owner');

        const first = new TextEncoder().encode('first');
        const second = new TextEncoder().encode('second');

        await putUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, first, opts);
        await putUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, second, opts);

        const result = await getUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, opts);
        assert.deepStrictEqual(result, second);
      });

      void it('outsider gets forbidden', async (t) => {
        const ctx = await withRepo(t);
        await expectError(
          putUserSettings(
            ctx.config.baseUrl,
            ctx.repoName,
            TEST_WORKSPACE,
            new TextEncoder().encode('data'),
            await ctx.opts('outsider')
          ),
          'forbidden'
        );
      });
    });

    // ── DELETE ──────────────────────────────────────────────────────────

    void describe('DELETE /user-settings', { concurrency: true }, () => {
      void it('owner deletes settings', async (t) => {
        const ctx = await withRepo(t);
        const opts = await ctx.opts('owner');
        const payload = new TextEncoder().encode('to-delete');

        await putUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, payload, opts);
        await deleteUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, opts);

        const result = await getUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, opts);
        assert.strictEqual(result, null);
      });

      void it('idempotent delete succeeds', async (t) => {
        const ctx = await withRepo(t);
        // Should not throw — deleting non-existent settings is a no-op
        await deleteUserSettings(
          ctx.config.baseUrl,
          ctx.repoName,
          TEST_WORKSPACE,
          await ctx.opts('owner')
        );
      });

      void it('outsider gets forbidden', async (t) => {
        const ctx = await withRepo(t);
        await expectError(
          deleteUserSettings(
            ctx.config.baseUrl,
            ctx.repoName,
            TEST_WORKSPACE,
            await ctx.opts('outsider')
          ),
          'forbidden'
        );
      });
    });

    // ── User Isolation ─────────────────────────────────────────────────

    void describe('User isolation', { concurrency: true }, () => {
      void it('different users have independent settings', async (t) => {
        const ctx = await withMember(t);
        const ownerOpts = await ctx.opts('owner');
        const memberOpts = await ctx.opts('member');

        const ownerPayload = new TextEncoder().encode('owner-prefs');
        const memberPayload = new TextEncoder().encode('member-prefs');

        await putUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, ownerPayload, ownerOpts);
        await putUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, memberPayload, memberOpts);

        const ownerResult = await getUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, ownerOpts);
        const memberResult = await getUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, memberOpts);

        assert.deepStrictEqual(ownerResult, ownerPayload);
        assert.deepStrictEqual(memberResult, memberPayload);
      });

      void it('deleting one user settings does not affect another', async (t) => {
        const ctx = await withMember(t);
        const ownerOpts = await ctx.opts('owner');
        const memberOpts = await ctx.opts('member');

        const ownerPayload = new TextEncoder().encode('owner-data');
        const memberPayload = new TextEncoder().encode('member-data');

        await putUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, ownerPayload, ownerOpts);
        await putUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, memberPayload, memberOpts);

        await deleteUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, ownerOpts);

        const ownerResult = await getUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, ownerOpts);
        const memberResult = await getUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, memberOpts);

        assert.strictEqual(ownerResult, null);
        assert.deepStrictEqual(memberResult, memberPayload);
      });
    });

    // ── Member access ──────────────────────────────────────────────────

    void describe('Member access', { concurrency: true }, () => {
      void it('member can store and retrieve settings', async (t) => {
        const ctx = await withMember(t);
        const opts = await ctx.opts('member');
        const payload = new TextEncoder().encode('member-settings');

        await putUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, payload, opts);
        const result = await getUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, opts);

        assert.deepStrictEqual(result, payload);
      });

      void it('member can delete own settings', async (t) => {
        const ctx = await withMember(t);
        const opts = await ctx.opts('member');
        const payload = new TextEncoder().encode('to-delete');

        await putUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, payload, opts);
        await deleteUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, opts);

        const result = await getUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, opts);
        assert.strictEqual(result, null);
      });
    });

    // ── Binary payload ─────────────────────────────────────────────────

    void describe('Binary payload', { concurrency: true }, () => {
      void it('handles arbitrary binary data', async (t) => {
        const ctx = await withRepo(t);
        const opts = await ctx.opts('owner');

        // Create binary payload with non-UTF8 bytes
        const payload = new Uint8Array(256);
        for (let i = 0; i < 256; i++) payload[i] = i;

        await putUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, payload, opts);
        const result = await getUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, opts);

        assert.ok(result instanceof Uint8Array);
        assert.strictEqual(result.length, 256);
        assert.deepStrictEqual(result, payload);
      });

      void it('handles empty payload', async (t) => {
        const ctx = await withRepo(t);
        const opts = await ctx.opts('owner');

        const payload = new Uint8Array(0);
        await putUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, payload, opts);
        const result = await getUserSettings(ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, opts);

        assert.ok(result instanceof Uint8Array);
        assert.strictEqual(result.length, 0);
      });
    });
  });
}
