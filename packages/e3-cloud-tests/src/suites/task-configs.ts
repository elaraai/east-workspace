/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Test suite for per-task compute and timeout configuration endpoints.
 *
 * Tests:
 * - GET /repos/{repo}/workspaces/{ws}/task-configs - Unified config view
 * - GET/PUT/POST/DELETE .../task-configs/compute - Compute size CRUD + batch
 * - GET/PUT/POST/DELETE .../task-configs/timeout - Timeout CRUD + batch
 * - Default values (serverless→15min, sized→1440min)
 * - Timeout validation (1–43200 minutes)
 * - Authorization (outsider forbidden, member allowed)
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { variant } from '@elaraai/east';
import {
  listCompute, getCompute, setCompute, setComputeBatch, removeCompute,
  listTimeout, getTimeout, setTimeout, setTimeoutBatch, removeTimeout,
  listTaskConfigs,
  addUser,
} from '@elaraai/e3-cloud-client';
import { repoCreate } from '@elaraai/e3-api-client';
import type { ComputeSize } from '@elaraai/e3-cloud-types';
import type { AdminTestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { expectError } from '../helpers.js';

const TEST_WORKSPACE = 'test-ws';
const TEST_TASK = 'my-task';

/**
 * Register task config management tests.
 *
 * @param setup - Factory that creates a fresh test context per test
 */
export function taskConfigTests(setup: TestSetup<AdminTestContext>): void {
  const withRepo: TestSetup<AdminTestContext> = async (t) => {
    const ctx = await setup(t);
    await repoCreate(ctx.config.baseUrl, ctx.repoName, await ctx.opts('owner'));
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

  void describe('Task Config Management', { concurrency: true }, () => {
    // ── Unified endpoint ──────────────────────────────────────────────────

    void describe('GET /task-configs', { concurrency: true }, () => {
      void it('owner gets empty configs', async (t) => {
        const ctx = await withRepo(t);
        const result = await listTaskConfigs(
          ctx.config.baseUrl,
          ctx.repoName,
          TEST_WORKSPACE,
          await ctx.opts('owner')
        );
        assert.ok(result.compute instanceof Map);
        assert.ok(result.timeout instanceof Map);
        assert.strictEqual(result.compute.size, 0);
        assert.strictEqual(result.timeout.size, 0);
      });

      void it('outsider gets forbidden', async (t) => {
        const ctx = await withRepo(t);
        await expectError(
          listTaskConfigs(
            ctx.config.baseUrl,
            ctx.repoName,
            TEST_WORKSPACE,
            await ctx.opts('outsider')
          ),
          'forbidden'
        );
      });
    });

    // ── Compute ───────────────────────────────────────────────────────────

    void describe('GET /task-configs/compute', { concurrency: true }, () => {
      void it('owner gets empty map', async (t) => {
        const ctx = await withRepo(t);
        const result = await listCompute(
          ctx.config.baseUrl,
          ctx.repoName,
          TEST_WORKSPACE,
          await ctx.opts('owner')
        );
        assert.ok(result instanceof Map);
        assert.strictEqual(result.size, 0);
      });

      void it('outsider gets forbidden', async (t) => {
        const ctx = await withRepo(t);
        await expectError(
          listCompute(
            ctx.config.baseUrl,
            ctx.repoName,
            TEST_WORKSPACE,
            await ctx.opts('outsider')
          ),
          'forbidden'
        );
      });
    });

    void describe('GET /task-configs/compute/:task', { concurrency: true }, () => {
      void it('returns serverless default for unconfigured task', async (t) => {
        const ctx = await withRepo(t);
        const result = await getCompute(
          ctx.config.baseUrl,
          ctx.repoName,
          TEST_WORKSPACE,
          TEST_TASK,
          await ctx.opts('owner')
        );
        assert.strictEqual(result.type, 'serverless');
      });

      void it('outsider gets forbidden', async (t) => {
        const ctx = await withRepo(t);
        await expectError(
          getCompute(
            ctx.config.baseUrl,
            ctx.repoName,
            TEST_WORKSPACE,
            TEST_TASK,
            await ctx.opts('outsider')
          ),
          'forbidden'
        );
      });
    });

    void describe('PUT /task-configs/compute/:task', { concurrency: true }, () => {
      void it('owner sets compute size', async (t) => {
        const ctx = await withRepo(t);
        const result = await setCompute(
          ctx.config.baseUrl,
          ctx.repoName,
          TEST_WORKSPACE,
          TEST_TASK,
          variant('medium', null),
          await ctx.opts('owner')
        );
        assert.strictEqual(result.type, 'medium');
      });

      void it('persists and is retrievable', async (t) => {
        const ctx = await withRepo(t);
        const opts = await ctx.opts('owner');
        await setCompute(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK,
          variant('large', null), opts
        );
        const result = await getCompute(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK, opts
        );
        assert.strictEqual(result.type, 'large');
      });

      void it('setting serverless resets to default', async (t) => {
        const ctx = await withRepo(t);
        const opts = await ctx.opts('owner');
        await setCompute(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK,
          variant('medium', null), opts
        );
        await setCompute(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK,
          variant('serverless', null), opts
        );
        const list = await listCompute(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, opts
        );
        assert.strictEqual(list.has(TEST_TASK), false);
      });

      void it('outsider gets forbidden', async (t) => {
        const ctx = await withRepo(t);
        await expectError(
          setCompute(
            ctx.config.baseUrl,
            ctx.repoName,
            TEST_WORKSPACE,
            TEST_TASK,
            variant('medium', null),
            await ctx.opts('outsider')
          ),
          'forbidden'
        );
      });
    });

    void describe('POST /task-configs/compute (batch)', { concurrency: true }, () => {
      void it('owner batch-sets multiple tasks', async (t) => {
        const ctx = await withRepo(t);
        const configs = new Map<string, ComputeSize>([
          ['task-a', variant('small', null)],
          ['task-b', variant('large', null)],
        ]);
        const result = await setComputeBatch(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE,
          configs, await ctx.opts('owner')
        );
        assert.ok(result instanceof Map);
        assert.strictEqual(result.get('task-a')?.type, 'small');
        assert.strictEqual(result.get('task-b')?.type, 'large');
      });

      void it('batch with serverless deletes existing', async (t) => {
        const ctx = await withRepo(t);
        const opts = await ctx.opts('owner');
        await setCompute(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK,
          variant('medium', null), opts
        );
        await setComputeBatch(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE,
          new Map([[TEST_TASK, variant('serverless', null)]]), opts
        );
        const list = await listCompute(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, opts
        );
        assert.strictEqual(list.has(TEST_TASK), false);
      });

      void it('outsider gets forbidden', async (t) => {
        const ctx = await withRepo(t);
        await expectError(
          setComputeBatch(
            ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE,
            new Map([[TEST_TASK, variant('medium', null)]]),
            await ctx.opts('outsider')
          ),
          'forbidden'
        );
      });
    });

    void describe('DELETE /task-configs/compute/:task', { concurrency: true }, () => {
      void it('owner deletes compute config', async (t) => {
        const ctx = await withRepo(t);
        const opts = await ctx.opts('owner');
        await setCompute(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK,
          variant('medium', null), opts
        );
        await removeCompute(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK, opts
        );
        const result = await getCompute(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK, opts
        );
        assert.strictEqual(result.type, 'serverless');
      });

      void it('idempotent delete succeeds', async (t) => {
        const ctx = await withRepo(t);
        // Should not throw — deleting a non-existent config is a no-op
        await removeCompute(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK,
          await ctx.opts('owner')
        );
      });

      void it('outsider gets forbidden', async (t) => {
        const ctx = await withRepo(t);
        await expectError(
          removeCompute(
            ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK,
            await ctx.opts('outsider')
          ),
          'forbidden'
        );
      });
    });

    // ── Timeout ───────────────────────────────────────────────────────────

    void describe('GET /task-configs/timeout', { concurrency: true }, () => {
      void it('owner gets empty map', async (t) => {
        const ctx = await withRepo(t);
        const result = await listTimeout(
          ctx.config.baseUrl,
          ctx.repoName,
          TEST_WORKSPACE,
          await ctx.opts('owner')
        );
        assert.ok(result instanceof Map);
        assert.strictEqual(result.size, 0);
      });

      void it('outsider gets forbidden', async (t) => {
        const ctx = await withRepo(t);
        await expectError(
          listTimeout(
            ctx.config.baseUrl,
            ctx.repoName,
            TEST_WORKSPACE,
            await ctx.opts('outsider')
          ),
          'forbidden'
        );
      });
    });

    void describe('GET /task-configs/timeout/:task', { concurrency: true }, () => {
      void it('returns 15-minute default for serverless task', async (t) => {
        const ctx = await withRepo(t);
        const result = await getTimeout(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK,
          await ctx.opts('owner')
        );
        assert.strictEqual(result.minutes, 15n);
      });

      void it('returns 1440-minute default for sized task', async (t) => {
        const ctx = await withRepo(t);
        const opts = await ctx.opts('owner');
        await setCompute(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK,
          variant('medium', null), opts
        );
        const result = await getTimeout(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK, opts
        );
        assert.strictEqual(result.minutes, 1440n);
      });

      void it('outsider gets forbidden', async (t) => {
        const ctx = await withRepo(t);
        await expectError(
          getTimeout(
            ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK,
            await ctx.opts('outsider')
          ),
          'forbidden'
        );
      });
    });

    void describe('PUT /task-configs/timeout/:task', { concurrency: true }, () => {
      void it('owner sets timeout', async (t) => {
        const ctx = await withRepo(t);
        const result = await setTimeout(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK,
          { minutes: 30n }, await ctx.opts('owner')
        );
        assert.strictEqual(result.minutes, 30n);
      });

      void it('persists and is retrievable', async (t) => {
        const ctx = await withRepo(t);
        const opts = await ctx.opts('owner');
        await setTimeout(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK,
          { minutes: 60n }, opts
        );
        const result = await getTimeout(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK, opts
        );
        assert.strictEqual(result.minutes, 60n);
      });

      void it('rejects timeout below minimum', async (t) => {
        const ctx = await withRepo(t);
        await expectError(
          setTimeout(
            ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK,
            { minutes: 0n }, await ctx.opts('owner')
          ),
          'internal'
        );
      });

      void it('rejects timeout above maximum', async (t) => {
        const ctx = await withRepo(t);
        await expectError(
          setTimeout(
            ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK,
            { minutes: 43201n }, await ctx.opts('owner')
          ),
          'internal'
        );
      });

      void it('outsider gets forbidden', async (t) => {
        const ctx = await withRepo(t);
        await expectError(
          setTimeout(
            ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK,
            { minutes: 30n }, await ctx.opts('outsider')
          ),
          'forbidden'
        );
      });
    });

    void describe('POST /task-configs/timeout (batch)', { concurrency: true }, () => {
      void it('owner batch-sets multiple tasks', async (t) => {
        const ctx = await withRepo(t);
        const configs = new Map([
          ['task-a', { minutes: 30n }],
          ['task-b', { minutes: 120n }],
        ]);
        const result = await setTimeoutBatch(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE,
          configs, await ctx.opts('owner')
        );
        assert.ok(result instanceof Map);
        assert.strictEqual(result.get('task-a')?.minutes, 30n);
        assert.strictEqual(result.get('task-b')?.minutes, 120n);
      });

      void it('rejects if any timeout invalid', async (t) => {
        const ctx = await withRepo(t);
        const opts = await ctx.opts('owner');
        const configs = new Map([
          ['task-a', { minutes: 30n }],
          ['task-b', { minutes: 0n }],
        ]);
        await expectError(
          setTimeoutBatch(
            ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, configs, opts
          ),
          'internal'
        );
        // Verify none persisted
        const list = await listTimeout(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, opts
        );
        assert.strictEqual(list.has('task-a'), false);
      });

      void it('outsider gets forbidden', async (t) => {
        const ctx = await withRepo(t);
        await expectError(
          setTimeoutBatch(
            ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE,
            new Map([[TEST_TASK, { minutes: 30n }]]),
            await ctx.opts('outsider')
          ),
          'forbidden'
        );
      });
    });

    void describe('DELETE /task-configs/timeout/:task', { concurrency: true }, () => {
      void it('owner deletes timeout config', async (t) => {
        const ctx = await withRepo(t);
        const opts = await ctx.opts('owner');
        await setTimeout(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK,
          { minutes: 60n }, opts
        );
        await removeTimeout(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK, opts
        );
        const result = await getTimeout(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK, opts
        );
        // Falls back to serverless default (15 min)
        assert.strictEqual(result.minutes, 15n);
      });

      void it('idempotent delete succeeds', async (t) => {
        const ctx = await withRepo(t);
        // Should not throw — deleting a non-existent config is a no-op
        await removeTimeout(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK,
          await ctx.opts('owner')
        );
      });

      void it('outsider gets forbidden', async (t) => {
        const ctx = await withRepo(t);
        await expectError(
          removeTimeout(
            ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK,
            await ctx.opts('outsider')
          ),
          'forbidden'
        );
      });
    });

    // ── Member access ─────────────────────────────────────────────────────

    void describe('Member access', { concurrency: true }, () => {
      void it('member can read compute configs', async (t) => {
        const ctx = await withMember(t);
        const result = await listCompute(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE,
          await ctx.opts('member')
        );
        assert.ok(result instanceof Map);
      });

      void it('member can set compute config', async (t) => {
        const ctx = await withMember(t);
        const result = await setCompute(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK,
          variant('small', null), await ctx.opts('member')
        );
        assert.strictEqual(result.type, 'small');
      });

      void it('member can read timeout configs', async (t) => {
        const ctx = await withMember(t);
        const result = await listTimeout(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE,
          await ctx.opts('member')
        );
        assert.ok(result instanceof Map);
      });

      void it('member can set timeout config', async (t) => {
        const ctx = await withMember(t);
        const result = await setTimeout(
          ctx.config.baseUrl, ctx.repoName, TEST_WORKSPACE, TEST_TASK,
          { minutes: 45n }, await ctx.opts('member')
        );
        assert.strictEqual(result.minutes, 45n);
      });
    });
  });
}
