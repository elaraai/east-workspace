/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Test suite for compute execution across all compute tiers.
 *
 * Starts with a serverless (Lambda) baseline to verify the test package works,
 * then tests each Fargate size (small, medium, large, xlarge).
 *
 * Each test:
 * 1. Creates a package with a simple compute task
 * 2. Deploys it to a workspace
 * 3. Sets the compute size (or leaves as default for serverless)
 * 4. Runs the dataflow and verifies successful execution
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { variant } from '@elaraai/east';
import { setCompute, getCompute } from '@elaraai/e3-cloud-client';
import type { TestContext } from '@elaraai/e3-api-tests';
import type { ComputeSize } from '@elaraai/e3-cloud-types';
import type { TestSetup } from '../setup.js';

import { executeAndLog } from './compute-helpers.js';

const COMPUTE_SIZES: Array<{ name: string; size: ComputeSize | null }> = [
  { name: 'serverless', size: null },
  { name: 'small',  size: variant('small', null) },
  { name: 'medium', size: variant('medium', null) },
  { name: 'large',  size: variant('large', null) },
  { name: 'xlarge', size: variant('xlarge', null) },
];

/**
 * Register compute execution tests.
 *
 * Uses `TestContext` from e3-api-tests which provides package deployment
 * helpers (createPackage, importPackage, createWorkspace, deployPackage).
 *
 * The serverless test runs first as a baseline — if it fails, the issue is
 * with the test package, not Fargate infrastructure.
 *
 * @param setup - Factory that creates a fresh test context per test
 */
export function computeTests(setup: TestSetup<TestContext>): void {
  void describe('Compute Execution', { concurrency: true }, () => {
    for (const { name, size } of COMPUTE_SIZES) {
      const isFargate = size !== null;
      const timeout = isFargate ? 300_000 : 60_000;

      void describe(`${name} compute`, { timeout }, () => {
        const WORKSPACE = `compute-${name}`;
        const TASK_NAME = 'compute';

        void it(`executes task on ${name}`, { timeout }, async (t) => {
          const ctx = await setup(t);

          // Deploy a simple package with a compute task
          console.log(`[${name}] Creating and importing package...`);
          const zipPath = await ctx.createPackage('compute-pkg', '1.0.0');
          await ctx.importPackage(zipPath);

          console.log(`[${name}] Creating workspace '${WORKSPACE}'...`);
          await ctx.createWorkspace(WORKSPACE);

          console.log(`[${name}] Deploying package to workspace...`);
          await ctx.deployPackage(WORKSPACE, 'compute-pkg@1.0.0');

          // Set compute size for Fargate tiers (serverless is the default)
          if (size !== null) {
            const opts = await ctx.opts();
            console.log(`[${name}] Setting compute size to '${name}'...`);
            await setCompute(
              ctx.config.baseUrl, ctx.repoName, WORKSPACE,
              TASK_NAME, size, opts
            );
          }
          console.log(`[${name}] Setup complete.`);

          // Verify compute size
          if (size !== null) {
            const opts = await ctx.opts();
            const computeConfig = await getCompute(
              ctx.config.baseUrl, ctx.repoName, WORKSPACE,
              TASK_NAME, opts
            );
            assert.strictEqual(computeConfig.type, name);
            console.log(`[${name}] Compute size verified.`);
          }

          const { result } = await executeAndLog(name, ctx, WORKSPACE, timeout);

          assert.strictEqual(result.success, true, `Dataflow failed. Tasks: ${JSON.stringify(result.tasks, (_k, v) => typeof v === 'bigint' ? v.toString() : v)}`);
          assert.strictEqual(result.failed, 0n);
          assert.ok(result.executed >= 1n);

          const task = result.tasks.find(t => t.name === TASK_NAME);
          assert.ok(task, `Task '${TASK_NAME}' should be in results`);
          assert.strictEqual(task.state.type, 'success');
        });
      });
    }
  });
}
