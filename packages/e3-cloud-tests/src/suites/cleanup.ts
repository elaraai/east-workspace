/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Test suite for cascade deletion and orphan cleanup of task configs and user settings.
 *
 * Tests three cleanup paths:
 * 1. Orphan cleanup on redeploy — deploying a different package removes configs
 *    for tasks no longer in the graph
 * 2. Workspace delete cascade — deleting a workspace removes all configs
 *    (compute, timeout, schedule, user settings)
 * 3. Configs survive same-package redeploy — non-orphaned configs and user settings
 *    are preserved
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { variant, none } from '@elaraai/east';
import { workspaceRemove } from '@elaraai/e3-api-client';
import { createMultiInputPackageZip } from '@elaraai/e3-api-tests';
import {
  listCompute, setCompute,
  listTimeout, setTimeout,
  getSchedule, setSchedule,
  getUserSettings, putUserSettings,
} from '@elaraai/e3-cloud-client';
import type { TestContext } from '@elaraai/e3-api-tests';
import type { TestSetup } from '../setup.js';

/**
 * Register config cleanup tests.
 *
 * Uses `TestContext` from e3-api-tests which provides package deployment
 * helpers. Each test manages its own workspace lifecycle.
 *
 * @param setup - Factory that creates a fresh test context per test
 */
export function cleanupTests(setup: TestSetup<TestContext>): void {
  void describe('Config Cleanup', { timeout: 60_000, concurrency: true }, () => {

    void it('removes orphaned configs on redeploy', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();

      // Import pkg-a (task: "compute") and pkg-b (task: "add")
      const pkgAZip = await ctx.createPackage('pkg-a', '1.0.0');
      await ctx.importPackage(pkgAZip);
      const pkgBZip = await createMultiInputPackageZip(ctx.tempDir, 'pkg-b', '1.0.0');
      await ctx.importPackage(pkgBZip);

      // Create workspace and deploy pkg-a
      const ws = 'cleanup-orphan';
      await ctx.createWorkspace(ws);
      await ctx.deployPackage(ws, 'pkg-a@1.0.0');

      // Set configs on the "compute" task
      await setCompute(ctx.config.baseUrl, ctx.repoName, ws, 'compute', variant('medium', null), opts);
      await setTimeout(ctx.config.baseUrl, ctx.repoName, ws, 'compute', { minutes: 120n }, opts);

      // Verify configs are set
      const computeBefore = await listCompute(ctx.config.baseUrl, ctx.repoName, ws, opts);
      assert.strictEqual(computeBefore.size, 1, 'compute config should exist before redeploy');
      const timeoutBefore = await listTimeout(ctx.config.baseUrl, ctx.repoName, ws, opts);
      assert.strictEqual(timeoutBefore.size, 1, 'timeout config should exist before redeploy');

      // Deploy pkg-b (task: "add" — no "compute" task)
      await ctx.deployPackage(ws, 'pkg-b@1.0.0');

      // Verify orphaned configs were cleaned up
      const computeAfter = await listCompute(ctx.config.baseUrl, ctx.repoName, ws, opts);
      assert.strictEqual(computeAfter.size, 0, 'orphaned compute config should be removed');
      const timeoutAfter = await listTimeout(ctx.config.baseUrl, ctx.repoName, ws, opts);
      assert.strictEqual(timeoutAfter.size, 0, 'orphaned timeout config should be removed');

      // Redeploy pkg-a — configs should NOT be resurrected
      await ctx.deployPackage(ws, 'pkg-a@1.0.0');

      const computeRedeploy = await listCompute(ctx.config.baseUrl, ctx.repoName, ws, opts);
      assert.strictEqual(computeRedeploy.size, 0, 'compute config should not be resurrected');
      const timeoutRedeploy = await listTimeout(ctx.config.baseUrl, ctx.repoName, ws, opts);
      assert.strictEqual(timeoutRedeploy.size, 0, 'timeout config should not be resurrected');
    });

    void it('removes all configs on workspace delete and recreate', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();

      // Import pkg-a and set up workspace
      const pkgZip = await ctx.createPackage('pkg-a', '1.0.0');
      await ctx.importPackage(pkgZip);

      const ws = 'ws-cleanup';
      await ctx.createWorkspace(ws);
      await ctx.deployPackage(ws, 'pkg-a@1.0.0');

      // Set compute, timeout, schedule, and user settings
      await setCompute(ctx.config.baseUrl, ctx.repoName, ws, 'compute', variant('large', null), opts);
      await setTimeout(ctx.config.baseUrl, ctx.repoName, ws, 'compute', { minutes: 60n }, opts);
      await setSchedule(ctx.config.baseUrl, ctx.repoName, ws, {
        cronExpression: '0 2 * * *',
        timezone: none,
        forceTasks: ['compute'],
        enabled: true,
        description: none,
      }, opts);
      await putUserSettings(ctx.config.baseUrl, ctx.repoName, ws,
        new TextEncoder().encode('my-prefs'), opts);

      // Verify all configs exist
      const computeBefore = await listCompute(ctx.config.baseUrl, ctx.repoName, ws, opts);
      assert.strictEqual(computeBefore.size, 1, 'compute config should exist');
      const timeoutBefore = await listTimeout(ctx.config.baseUrl, ctx.repoName, ws, opts);
      assert.strictEqual(timeoutBefore.size, 1, 'timeout config should exist');
      const scheduleBefore = await getSchedule(ctx.config.baseUrl, ctx.repoName, ws, opts);
      assert.notStrictEqual(scheduleBefore, null, 'schedule should exist');
      const settingsBefore = await getUserSettings(ctx.config.baseUrl, ctx.repoName, ws, opts);
      assert.ok(settingsBefore !== null, 'user settings should exist');

      // Delete workspace
      await workspaceRemove(ctx.config.baseUrl, ctx.repoName, ws, opts);

      // Recreate workspace with same name and deploy
      await ctx.createWorkspace(ws);
      await ctx.deployPackage(ws, 'pkg-a@1.0.0');

      // Verify all configs are gone
      const computeAfter = await listCompute(ctx.config.baseUrl, ctx.repoName, ws, opts);
      assert.strictEqual(computeAfter.size, 0, 'compute config should be removed after ws delete');
      const timeoutAfter = await listTimeout(ctx.config.baseUrl, ctx.repoName, ws, opts);
      assert.strictEqual(timeoutAfter.size, 0, 'timeout config should be removed after ws delete');
      const scheduleAfter = await getSchedule(ctx.config.baseUrl, ctx.repoName, ws, opts);
      assert.strictEqual(scheduleAfter, null, 'schedule should be removed after ws delete');
      const settingsAfter = await getUserSettings(ctx.config.baseUrl, ctx.repoName, ws, opts);
      assert.strictEqual(settingsAfter, null, 'user settings should be removed after ws delete');
    });

    void it('preserves configs when redeploying same package', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();

      // Import pkg-a and set up workspace
      const pkgZip = await ctx.createPackage('pkg-a', '1.0.0');
      await ctx.importPackage(pkgZip);

      const ws = 'cleanup-preserve';
      await ctx.createWorkspace(ws);
      await ctx.deployPackage(ws, 'pkg-a@1.0.0');

      // Set configs on the "compute" task and user settings
      await setCompute(ctx.config.baseUrl, ctx.repoName, ws, 'compute', variant('small', null), opts);
      await setTimeout(ctx.config.baseUrl, ctx.repoName, ws, 'compute', { minutes: 30n }, opts);
      const settingsPayload = new TextEncoder().encode('my-view-state');
      await putUserSettings(ctx.config.baseUrl, ctx.repoName, ws, settingsPayload, opts);

      // Redeploy same package
      await ctx.deployPackage(ws, 'pkg-a@1.0.0');

      // Verify configs survived
      const computeAfter = await listCompute(ctx.config.baseUrl, ctx.repoName, ws, opts);
      assert.strictEqual(computeAfter.size, 1, 'compute config should survive redeploy');
      assert.strictEqual(computeAfter.get('compute')?.type, 'small');
      const timeoutAfter = await listTimeout(ctx.config.baseUrl, ctx.repoName, ws, opts);
      assert.strictEqual(timeoutAfter.size, 1, 'timeout config should survive redeploy');
      assert.strictEqual(timeoutAfter.get('compute')?.minutes, 30n);
      const settingsAfter = await getUserSettings(ctx.config.baseUrl, ctx.repoName, ws, opts);
      assert.deepStrictEqual(settingsAfter, settingsPayload, 'user settings should survive redeploy');
    });
  });
}
