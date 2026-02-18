/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/**
 * Test suite for schedule management endpoints.
 *
 * Tests:
 * - GET /repos/{repo}/workspaces/{ws}/schedule - Get schedule
 * - PUT /repos/{repo}/workspaces/{ws}/schedule - Create/update schedule
 * - DELETE /repos/{repo}/workspaces/{ws}/schedule - Delete schedule
 * - GET /repos/{repo}/schedules - List schedules
 *
 * Note: Full CRUD happy-path requires a deployed workspace.
 * These tests cover auth enforcement and error paths which work without one.
 */

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { none, variant } from '@elaraai/east';
import {
  getSchedule,
  setSchedule,
  removeSchedule,
  listSchedules,
  addUser,
} from '@elaraai/e3-cloud-client';
import { repoCreate } from '@elaraai/e3-api-client';
import type { AdminTestContext } from '../context.js';
import { expectError } from '../helpers.js';

const TEST_WORKSPACE = 'test-ws';

/**
 * Register schedule management tests.
 *
 * @param getContext - Function that returns the current test context
 */
export function scheduleTests(getContext: () => AdminTestContext): void {
  void describe('Schedule Management', () => {
    void beforeEach(async () => {
      const ctx = getContext();
      await repoCreate(ctx.config.baseUrl, ctx.repoName, await ctx.opts('owner'));
    });

    void describe('GET /repos/{repo}/workspaces/{ws}/schedule', () => {
      void it('owner gets null for non-existent schedule', async () => {
        const ctx = getContext();
        const result = await getSchedule(
          ctx.config.baseUrl,
          ctx.repoName,
          TEST_WORKSPACE,
          await ctx.opts('owner')
        );
        assert.strictEqual(result, null);
      });

      void it('outsider gets forbidden', async () => {
        const ctx = getContext();
        await expectError(
          getSchedule(
            ctx.config.baseUrl,
            ctx.repoName,
            TEST_WORKSPACE,
            await ctx.opts('outsider')
          ),
          'forbidden'
        );
      });
    });

    void describe('PUT /repos/{repo}/workspaces/{ws}/schedule', () => {
      void it('outsider gets forbidden', async () => {
        const ctx = getContext();
        await expectError(
          setSchedule(
            ctx.config.baseUrl,
            ctx.repoName,
            TEST_WORKSPACE,
            {
              cronExpression: '0 2 * * *',
              timezone: none,
              forceTasks: [],
              enabled: true,
              description: none,
            },
            await ctx.opts('outsider')
          ),
          'forbidden'
        );
      });

      void it('member gets internal error for non-existent workspace', async () => {
        const ctx = getContext();
        const memberUser = await ctx.getTestUser('member');

        // Add member to repo first
        await addUser(
          ctx.config.baseUrl,
          ctx.repoName,
          { email: memberUser.email, role: variant('member', null) },
          await ctx.opts('owner')
        );

        await expectError(
          setSchedule(
            ctx.config.baseUrl,
            ctx.repoName,
            TEST_WORKSPACE,
            {
              cronExpression: '0 2 * * *',
              timezone: none,
              forceTasks: [],
              enabled: true,
              description: none,
            },
            await ctx.opts('member')
          ),
          'internal'
        );
      });
    });

    void describe('DELETE /repos/{repo}/workspaces/{ws}/schedule', () => {
      void it('idempotent delete succeeds on non-existent schedule', async () => {
        const ctx = getContext();
        // Should not throw — deleting a non-existent schedule is a no-op
        await removeSchedule(
          ctx.config.baseUrl,
          ctx.repoName,
          TEST_WORKSPACE,
          await ctx.opts('owner')
        );
      });

      void it('outsider gets forbidden', async () => {
        const ctx = getContext();
        await expectError(
          removeSchedule(
            ctx.config.baseUrl,
            ctx.repoName,
            TEST_WORKSPACE,
            await ctx.opts('outsider')
          ),
          'forbidden'
        );
      });
    });

    void describe('GET /repos/{repo}/schedules', () => {
      void it('owner gets empty list', async () => {
        const ctx = getContext();
        const schedules = await listSchedules(
          ctx.config.baseUrl,
          ctx.repoName,
          await ctx.opts('owner')
        );
        assert.ok(Array.isArray(schedules));
        assert.strictEqual(schedules.length, 0);
      });

      void it('outsider gets forbidden', async () => {
        const ctx = getContext();
        await expectError(
          listSchedules(
            ctx.config.baseUrl,
            ctx.repoName,
            await ctx.opts('outsider')
          ),
          'forbidden'
        );
      });
    });
  });
}
