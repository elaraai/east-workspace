/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/**
 * Test suite for task failure propagation across compute tiers.
 *
 * Verifies that:
 * - Task failures on Fargate are reported correctly via SendTaskFailureCommand
 * - Dependent tasks are skipped when upstream tasks fail
 * - Mixed success/failure in parallel tasks works across compute tiers
 *
 * Serverless smoke test (~15s): quick sanity check that failure handling works.
 * Fargate tests (~4 min): thorough failure testing on `small` compute, run
 * concurrently across separate workspaces so cold starts (~150s) overlap.
 */

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { variant } from '@elaraai/east';
import { setCompute } from '@elaraai/e3-admin-client';
import {
  createFailingDiamondPackageZip,
  createParallelMixedPackageZip,
  type TestContext,
} from '@elaraai/e3-api-tests';

import { executeAndLog } from './compute-helpers.js';

const SMALL = variant('small', null);

/**
 * Deploy a package from a zip creator function.
 */
async function deployFixture(
  ctx: TestContext,
  workspace: string,
  createZip: (tempDir: string, name: string, version: string) => Promise<string>,
  pkgName: string,
): Promise<void> {
  const zipPath = await createZip(ctx.tempDir, pkgName, '1.0.0');
  await ctx.importPackage(zipPath);
  await ctx.createWorkspace(workspace);
  await ctx.deployPackage(workspace, `${pkgName}@1.0.0`);
}

/**
 * Set compute size for specific tasks in a workspace.
 */
async function setTaskCompute(
  ctx: TestContext,
  workspace: string,
  taskNames: string[],
): Promise<void> {
  const opts = await ctx.opts();
  for (const task of taskNames) {
    await setCompute(ctx.config.baseUrl, ctx.repoName, workspace, task, SMALL, opts);
  }
}

/**
 * Register compute failure tests.
 *
 * @param getContext - Function that returns the current test context
 */
export function computeFailureTests(getContext: () => TestContext): void {
  void describe('Compute Failure Handling', () => {

    // --- Serverless smoke test ---
    void describe('serverless failure (smoke)', { timeout: 60_000 }, () => {
      const WORKSPACE = 'fail-smoke-serverless';

      void beforeEach(async () => {
        const ctx = getContext();
        console.log('[smoke-serverless] Deploying failing diamond package...');
        await deployFixture(ctx, WORKSPACE, createFailingDiamondPackageZip, 'fail-diamond-smoke');
      });

      void it('diamond with upstream failure completes correctly', async () => {
        const ctx = getContext();
        const { result } = await executeAndLog('smoke-serverless', ctx, WORKSPACE, 60_000);

        assert.strictEqual(result.success, false, 'Dataflow should not succeed');
        assert.ok(result.failed >= 1n, 'At least one task should fail');

        const rightTask = result.tasks.find(t => t.name === 'right');
        assert.ok(rightTask, 'right task should be in results');
        assert.strictEqual(rightTask.state.type, 'failed', 'right task should fail');

        const mergeTask = result.tasks.find(t => t.name === 'merge');
        assert.ok(mergeTask, 'merge task should be in results');
        assert.strictEqual(mergeTask.state.type, 'skipped', 'merge task should be skipped');
      });
    });

    // --- Fargate failure tests (small) — run concurrently ---
    // Each test uses a separate workspace, so cold starts (~150s) overlap.
    // Total wall time ~4 min instead of ~12 min sequential.
    void describe('fargate failure (small)', { timeout: 600_000, concurrency: 3 }, () => {

      // Test A: Diamond with upstream failure on Fargate
      void it('diamond: right fails on Fargate, merge is skipped', { timeout: 600_000 }, async () => {
        const WORKSPACE = 'fail-diamond-small';
        const ctx = getContext();

        console.log('[diamond-small] Deploying failing diamond package...');
        await deployFixture(ctx, WORKSPACE, createFailingDiamondPackageZip, 'fail-diamond-small');

        console.log('[diamond-small] Setting right task to small compute...');
        await setTaskCompute(ctx, WORKSPACE, ['right']);

        console.log('[diamond-small] Executing dataflow...');
        const { result } = await executeAndLog('diamond-small', ctx, WORKSPACE, 600_000);

        assert.strictEqual(result.success, false, 'Dataflow should not succeed');

        const rightTask = result.tasks.find(t => t.name === 'right');
        assert.ok(rightTask, 'right task should be in results');
        assert.strictEqual(rightTask.state.type, 'failed', 'right task should fail on Fargate');

        const mergeTask = result.tasks.find(t => t.name === 'merge');
        assert.ok(mergeTask, 'merge task should be in results');
        assert.strictEqual(mergeTask.state.type, 'skipped', 'merge task should be skipped');

        const leftTask = result.tasks.find(t => t.name === 'left');
        assert.ok(leftTask, 'left task should be in results');
        assert.strictEqual(leftTask.state.type, 'success', 'left task should succeed');
      });

      // Test B: Mixed parallel success/failure
      void it('mixed: fail_c fails on Fargate while other tasks succeed', { timeout: 600_000 }, async () => {
        const WORKSPACE = 'fail-mixed-small';
        const ctx = getContext();

        console.log('[mixed-small] Deploying parallel mixed package...');
        await deployFixture(ctx, WORKSPACE, createParallelMixedPackageZip, 'fail-mixed-small');

        console.log('[mixed-small] Setting fail_c to small compute...');
        await setTaskCompute(ctx, WORKSPACE, ['fail_c']);

        console.log('[mixed-small] Executing dataflow...');
        const { result } = await executeAndLog('mixed-small', ctx, WORKSPACE, 600_000);

        assert.strictEqual(result.success, false, 'Dataflow should not succeed');
        assert.strictEqual(result.failed, 1n, 'Exactly one task should fail');

        const failTask = result.tasks.find(t => t.name === 'fail_c');
        assert.ok(failTask, 'fail_c task should be in results');
        assert.strictEqual(failTask.state.type, 'failed', 'fail_c should fail');
      });

      // Test C: All-Fargate diamond with failure
      void it('all-fargate: right fails, merge skipped, left succeeds', { timeout: 600_000 }, async () => {
        const WORKSPACE = 'fail-allfg-small';
        const ctx = getContext();

        console.log('[allfg-small] Deploying failing diamond package...');
        await deployFixture(ctx, WORKSPACE, createFailingDiamondPackageZip, 'fail-allfg-small');

        console.log('[allfg-small] Setting all tasks to small compute...');
        await setTaskCompute(ctx, WORKSPACE, ['left', 'right', 'merge']);

        console.log('[allfg-small] Executing dataflow...');
        const { result } = await executeAndLog('allfg-small', ctx, WORKSPACE, 600_000);

        assert.strictEqual(result.success, false, 'Dataflow should not succeed');

        const rightTask = result.tasks.find(t => t.name === 'right');
        assert.ok(rightTask, 'right task should be in results');
        assert.strictEqual(rightTask.state.type, 'failed', 'right task should fail');

        const mergeTask = result.tasks.find(t => t.name === 'merge');
        assert.ok(mergeTask, 'merge task should be in results');
        assert.strictEqual(mergeTask.state.type, 'skipped', 'merge task should be skipped');

        const leftTask = result.tasks.find(t => t.name === 'left');
        assert.ok(leftTask, 'left task should be in results');
        assert.strictEqual(leftTask.state.type, 'success', 'left task should succeed on Fargate');
      });
    });
  });
}
