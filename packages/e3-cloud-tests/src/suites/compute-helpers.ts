/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Shared helpers for compute test suites.
 */

import { variant } from '@elaraai/east';
import { dataflowExecuteLaunch, dataflowExecutePoll } from '@elaraai/e3-api-client';
import type { TestContext } from '@elaraai/e3-api-tests';

export type TaskResult = {
  name: string;
  cached: boolean;
  state: { type: string; value?: unknown };
  duration: number;
};

export type DataflowResult = {
  success: boolean;
  executed: bigint;
  cached: bigint;
  failed: bigint;
  skipped: bigint;
  tasks: TaskResult[];
};

/**
 * Build a DataflowResult from execution state events.
 * Mirrors the internal buildDataflowResult in e3-api-client.
 */
export function buildResult(state: { status: { type: string }; events: Array<{ type: string; value: Record<string, unknown> }>; summary: { type: string; value?: Record<string, unknown> } }): DataflowResult {
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
export async function executeAndLog(
  name: string,
  ctx: TestContext,
  workspace: string,
  timeoutMs: number,
): Promise<{ result: DataflowResult; elapsed: string }> {
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
