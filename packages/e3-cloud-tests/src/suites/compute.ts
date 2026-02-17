/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
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

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { variant } from '@elaraai/east';
import { dataflowExecuteLaunch, dataflowExecutePoll } from '@elaraai/e3-api-client';
import { setCompute, getCompute } from '@elaraai/e3-admin-client';
import type { TestContext } from '@elaraai/e3-api-tests';
import type { ComputeSize } from '@elaraai/e3-admin-types';

const COMPUTE_SIZES: Array<{ name: string; size: ComputeSize | null }> = [
  { name: 'serverless', size: null },
  { name: 'small',  size: variant('small', null) },
  { name: 'medium', size: variant('medium', null) },
  { name: 'large',  size: variant('large', null) },
  { name: 'xlarge', size: variant('xlarge', null) },
];

/**
 * Build a DataflowResult from execution state events.
 * Mirrors the internal buildDataflowResult in e3-api-client.
 */
function buildResult(state: { status: { type: string }; events: Array<{ type: string; value: Record<string, unknown> }>; summary: { type: string; value?: Record<string, unknown> } }) {
  type TaskResult = { name: string; cached: boolean; state: { type: string; value?: unknown }; duration: number };
  const tasks: TaskResult[] = [];
  for (const event of state.events) {
    switch (event.type) {
      case 'complete':
        tasks.push({ name: event.value.task as string, cached: false, state: variant('success', null), duration: event.value.duration as number });
        break;
      case 'cached':
        tasks.push({ name: event.value.task as string, cached: true, state: variant('success', null), duration: 0 });
        break;
      case 'failed':
        tasks.push({ name: event.value.task as string, cached: false, state: variant('failed', { exitCode: event.value.exitCode as bigint }), duration: event.value.duration as number });
        break;
      case 'error':
        tasks.push({ name: event.value.task as string, cached: false, state: variant('error', { message: event.value.message as string }), duration: 0 });
        break;
      case 'input_unavailable':
        tasks.push({ name: event.value.task as string, cached: false, state: variant('skipped', null), duration: 0 });
        break;
    }
  }
  const summary = state.summary.type === 'some' ? state.summary.value! : {
    executed: BigInt(tasks.filter(t => !t.cached && t.state.type === 'success').length),
    cached: BigInt(tasks.filter(t => t.cached).length),
    failed: BigInt(tasks.filter(t => t.state.type === 'failed' || t.state.type === 'error').length),
    skipped: BigInt(tasks.filter(t => t.state.type === 'skipped').length),
  };
  return {
    success: state.status.type === 'completed',
    executed: summary.executed as bigint,
    cached: summary.cached as bigint,
    failed: summary.failed as bigint,
    skipped: summary.skipped as bigint,
    tasks,
  };
}

/**
 * Helper to execute a dataflow with token refresh on each poll.
 *
 * Uses launch + manual polling instead of dataflowExecute() to avoid
 * token expiry during long-running Fargate executions (~4 min cold start).
 */
async function executeAndLog(
  name: string,
  ctx: TestContext,
  workspace: string,
  taskName: string,
  timeoutMs: number,
) {
  console.log(`[${name}] Starting dataflow execution...`);

  const startTime = Date.now();
  const launchOpts = await ctx.opts();
  await dataflowExecuteLaunch(
    ctx.config.baseUrl, ctx.repoName, workspace,
    { force: true }, launchOpts
  );

  // Poll with fresh token on each iteration to avoid expiry
  while (Date.now() - startTime < timeoutMs) {
    const pollOpts = await ctx.opts();
    const state = await dataflowExecutePoll(
      ctx.config.baseUrl, ctx.repoName, workspace, {}, pollOpts
    );
    if (state.status.type === 'completed' || state.status.type === 'failed' || state.status.type === 'aborted') {
      const result = buildResult(state as Parameters<typeof buildResult>[0]);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[${name}] Dataflow completed in ${elapsed}s — success=${result.success}, executed=${result.executed}, failed=${result.failed}, cached=${result.cached}`);
      for (const t of result.tasks) {
        console.log(`[${name}]   task '${t.name}': state=${t.state.type}, cached=${t.cached}`);
        if (t.state.type === 'failed') {
          console.log(`[${name}]     exitCode=${(t.state as { value: { exitCode: bigint } }).value.exitCode}`);
        } else if (t.state.type === 'error') {
          console.log(`[${name}]     message=${(t.state as { value: { message: string } }).value.message}`);
        }
      }
      return { result, elapsed };
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  throw new Error(`Dataflow timed out after ${timeoutMs}ms`);
}

/**
 * Register compute execution tests.
 *
 * Uses `TestContext` from e3-api-tests which provides package deployment
 * helpers (createPackage, importPackage, createWorkspace, deployPackage).
 *
 * The serverless test runs first as a baseline — if it fails, the issue is
 * with the test package, not Fargate infrastructure.
 *
 * @param getContext - Function that returns the current test context
 */
export function computeTests(getContext: () => TestContext): void {
  void describe('Compute Execution', () => {
    for (const { name, size } of COMPUTE_SIZES) {
      const isFargate = size !== null;
      const timeout = isFargate ? 300_000 : 60_000;

      void describe(`${name} compute`, { timeout }, () => {
        const WORKSPACE = `compute-${name}`;
        const TASK_NAME = 'compute';

        void beforeEach(async () => {
          const ctx = getContext();

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
        });

        void it(`executes task on ${name}`, async () => {
          const ctx = getContext();

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

          const { result } = await executeAndLog(name, ctx, WORKSPACE, TASK_NAME, timeout);

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
