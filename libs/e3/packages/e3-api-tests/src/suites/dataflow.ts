/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Dataflow execution test suite.
 *
 * Tests: start, execute (blocking), poll for completion, logs, and failures.
 * A failing task fails in East, which every server runs: it is recorded
 * `failed`, exit code 1, with its message in its stderr log. One case runs a
 * command, a custom task's, which a server that runs no commands records
 * `error` ({@link TestContext.commands}).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { IntegerType, StringType, encodeBeast2For, decodeBeast2For, isValueOf, lessFor, variant } from '@elaraai/east';
import { TaskLogChunkType } from '@elaraai/e3-types';
import {
  packageImport,
  workspaceCreate,
  workspaceDeploy,
  workspaceStatus,
  dataflowExecuteLaunch,
  dataflowExecute,
  dataflowExecutePoll,
  dataflowEventsRemain,
  dataflowCancel,
  dataflowGraph,
  datasetSet,
  datasetGet,
  taskLogs,
  taskExecutionList,
  ApiError,
} from '@elaraai/e3-api-client';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import {
  LOGGED_LINES,
  createPackageZip,
  createDiamondPackageZip,
  createFailingPackageZip,
  createLoggingPackageZip,
  createCommandPackageZip,
  createSlowPackageZip,
  createParallelMixedPackageZip,
  createFailingDiamondPackageZip,
  createWideParallelPackageZip,
  createSlowDiamondPackageZip,
} from '../fixtures.js';
import { assertDataflowSucceeded, describeDataflowResult } from '../assertions.js';
import { waitFor } from '../cli.js';
import type { ExecutionListItem, ExecutionStateOptions, LogOptions, RequestOptions } from '@elaraai/e3-api-client';

/**
 * Asserts a call is refused `bad_request`, with the message the server gives.
 *
 * @param call - The refused call
 * @param message - The server's message, whole
 */
async function rejectsBadRequest(call: Promise<unknown>, message: string): Promise<void> {
  await assert.rejects(call, (err: unknown) => {
    assert.ok(err instanceof ApiError, `Expected ApiError, got ${String(err)}`);
    assert.strictEqual(err.code, 'bad_request');
    assert.strictEqual(err.details, message);
    return true;
  });
}

/** Helper: import package, create workspace, deploy */
function withDeployed(
  setup: TestSetup<TestContext>,
  createZip: (tempDir: string, name: string, version: string, ...args: never[]) => Promise<string>,
  pkgName: string,
  wsName: string,
): TestSetup<TestContext> {
  return async (t) => {
    const ctx = await setup(t);
    const opts = await ctx.opts();

    const zipPath = await createZip(ctx.tempDir, pkgName, '1.0.0');
    const packageZip = readFileSync(zipPath);
    await packageImport(ctx.config.baseUrl, ctx.repoName, packageZip, opts);

    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, wsName, opts);
    await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, wsName, `${pkgName}@1.0.0`, opts);

    return ctx;
  };
}

/**
 * Register dataflow execution tests.
 *
 * @param setup - Factory that creates a fresh test context per test
 */

/**
 * Poll until the workspace's current execution reports `running`.
 *
 * Replaces fixed 500ms waits: on a loaded CI runner the orchestrator may
 * not have started within a fixed window (flaky lock assertions), while on
 * a fast machine the fixed wait was pure dead time.
 */
async function waitForRunning(
  baseUrl: string,
  repoName: string,
  workspace: string,
  opts: RequestOptions
): Promise<void> {
  await waitFor(async () => {
    try {
      const state = await dataflowExecutePoll(baseUrl, repoName, workspace, {}, opts);
      return state.status.type === 'running';
    } catch {
      return false; // execution record not created yet
    }
  }, 30000);
}

export function dataflowTests(setup: TestSetup<TestContext>): void {
  const withSimpleExec = withDeployed(setup, createPackageZip, 'exec-pkg', 'exec-ws');
  const withDiamond = withDeployed(setup, createDiamondPackageZip, 'diamond-pkg', 'diamond-ws');
  const withFailing = withDeployed(setup, createFailingPackageZip, 'fail-pkg', 'fail-ws');
  const withCommand = withDeployed(setup, createCommandPackageZip, 'cmd-pkg', 'cmd-ws');
  const withMixed = withDeployed(setup, createParallelMixedPackageZip, 'mixed-pkg', 'mixed-ws');
  const withFailingDiamond = withDeployed(setup, createFailingDiamondPackageZip, 'fdiamond-pkg', 'fdiamond-ws');
  const withWideParallel: TestSetup<TestContext> = async (t) => {
    const ctx = await setup(t);
    const opts = await ctx.opts();
    const zipPath = await createWideParallelPackageZip(ctx.tempDir, 'wide-pkg', '1.0.0', 6);
    const packageZip = readFileSync(zipPath);
    await packageImport(ctx.config.baseUrl, ctx.repoName, packageZip, opts);
    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, 'wide-ws', opts);
    await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, 'wide-ws', 'wide-pkg@1.0.0', opts);
    return ctx;
  };
  const withSlow: TestSetup<TestContext> = async (t) => {
    const ctx = await setup(t);
    const opts = await ctx.opts();
    const zipPath = await createSlowPackageZip(ctx.tempDir, 'slow-pkg', '1.0.0', 30);
    const packageZip = readFileSync(zipPath);
    await packageImport(ctx.config.baseUrl, ctx.repoName, packageZip, opts);
    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, 'slow-ws', opts);
    await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, 'slow-ws', 'slow-pkg@1.0.0', opts);
    return ctx;
  };
  const withSlowDiamond: TestSetup<TestContext> = async (t) => {
    const ctx = await setup(t);
    const opts = await ctx.opts();
    const zipPath = await createSlowDiamondPackageZip(ctx.tempDir, 'sdiamond-pkg', '1.0.0', 3);
    const packageZip = readFileSync(zipPath);
    await packageImport(ctx.config.baseUrl, ctx.repoName, packageZip, opts);
    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, 'sdiamond-ws', opts);
    await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, 'sdiamond-ws', 'sdiamond-pkg@1.0.0', opts);
    return ctx;
  };
  const withNoExec = withDeployed(setup, createPackageZip, 'noexec-pkg', 'noexec-ws');
  const withCache = withDeployed(setup, createPackageZip, 'cache-pkg', 'cache-ws');
  const withFilter = withDeployed(setup, createDiamondPackageZip, 'filter-pkg', 'filter-ws');
  const withForced = withDeployed(setup, createDiamondPackageZip, 'forced-pkg', 'forced-ws');
  const withGraph = withDeployed(setup, createDiamondPackageZip, 'graph-pkg', 'graph-ws');
  const withLogPag = withDeployed(setup, createLoggingPackageZip, 'logpag-pkg', 'logpag-ws');
  const withEvtPag = withDeployed(setup, createDiamondPackageZip, 'evtpag-pkg', 'evtpag-ws');

  describe('dataflow', { concurrency: false }, () => {
    describe('simple execution', { concurrency: false }, () => {
      it('dataflowExecute runs tasks and returns result (blocking)', async (t) => {
        const ctx = await withSimpleExec(t);
        const opts = await ctx.opts();

        const result = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'exec-ws', { force: true }, opts);

        // Verify execution result
        assertDataflowSucceeded(result);
        assert.strictEqual(result.executed, 1n);
        assert.strictEqual(result.failed, 0n);
        assert.strictEqual(result.tasks.length, 1);
        assert.strictEqual(result.tasks[0].name, 'compute');
        assert.strictEqual(result.tasks[0].state.type, 'success');

        // Verify workspace status reflects completion
        const status = await workspaceStatus(ctx.config.baseUrl, ctx.repoName, 'exec-ws', opts);
        const task = status.tasks[0];
        assert.strictEqual(task.name, 'compute');
        assert.strictEqual(task.status.type, 'up-to-date');

        const outputDataset = status.datasets.find(d => d.path === '.tasks.compute.output');
        assert.ok(outputDataset, 'Output dataset .tasks.compute.output should exist');
        assert.strictEqual(outputDataset.status.type, 'up-to-date');
      });

      it('taskExecutionList lists a task\'s runs the latest first, a page at a time, each naming its execution', async (t) => {
        const ctx = await withSimpleExec(t);
        const opts = await ctx.opts();
        const list = (page: { limit?: number; before?: string } = {}) =>
          taskExecutionList(ctx.config.baseUrl, ctx.repoName, 'exec-ws', 'compute', opts, page);

        // Three forced runs of the same inputs: three runs under one inputs hash.
        for (let run = 0; run < 3; run++) {
          assertDataflowSucceeded(await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'exec-ws', { force: true }, opts));
        }

        const every = await list();
        assert.strictEqual(every.length, 3, 'every run is listed');
        assert.ok(every.every(e => e.inputsHash === every[0].inputsHash && e.status.type === 'success'), 'all runs share the inputs hash');
        const ids = every.map(e => e.executionId);
        assert.strictEqual(new Set(ids).size, ids.length, 'each run names its own execution');
        assert.deepStrictEqual(ids, [...ids].sort().reverse(), 'the latest first');

        // A page at a time, each from before the last run of the page before
        const first = await list({ limit: 2 });
        assert.deepStrictEqual(first.map(e => e.executionId), ids.slice(0, 2));
        const next = await list({ limit: 2, before: first[1].executionId });
        assert.deepStrictEqual(next.map(e => e.executionId), ids.slice(2), 'the next page holds the runs before it');
        assert.deepStrictEqual(await list({ before: ids[2] }), [], 'and the page after it is empty');
      });

      it('refuses a page of a task\'s runs whose limit is not a positive integer, or whose cursor is no execution\'s id', async (t) => {
        const ctx = await withSimpleExec(t);
        const opts = await ctx.opts();
        const list = (page: { limit?: number; before?: string }) =>
          taskExecutionList(ctx.config.baseUrl, ctx.repoName, 'exec-ws', 'compute', opts, page);

        await rejectsBadRequest(list({ limit: 0 }), 'limit must be a positive integer, got "0"');
        await rejectsBadRequest(list({ limit: 1.5 }), 'limit must be a positive integer, got "1.5"');
        await assert.rejects(list({ before: 'not-an-id' }), (err: unknown) => {
          assert.ok(err instanceof ApiError, `Expected ApiError, got ${String(err)}`);
          assert.strictEqual(err.code, 'invalid_name');
          assert.strictEqual((err.details as { kind?: string } | undefined)?.kind, 'execution id');
          return true;
        });
      });

      it('dataflowExecuteLaunch triggers execution (non-blocking)', async (t) => {
        const ctx = await withSimpleExec(t);
        const opts = await ctx.opts();

        // Should return immediately
        await dataflowExecuteLaunch(ctx.config.baseUrl, ctx.repoName, 'exec-ws', { force: true }, opts);

        // Poll until execution completes
        const maxWait = 60000;
        const startTime = Date.now();
        let status = await workspaceStatus(ctx.config.baseUrl, ctx.repoName, 'exec-ws', opts);

        while (Date.now() - startTime < maxWait) {
          status = await workspaceStatus(ctx.config.baseUrl, ctx.repoName, 'exec-ws', opts);
          const { upToDate } = status.summary.tasks;
          // Done when task is up-to-date
          if (upToDate === 1n) {
            break;
          }
          await new Promise(r => setTimeout(r, 100));
        }

        // Verify execution completed
        assert.strictEqual(status.tasks[0].status.type, 'up-to-date');
      });

      it('dataflowExecutePoll returns execution state', async (t) => {
        const ctx = await withSimpleExec(t);
        const opts = await ctx.opts();

        // Start execution
        await dataflowExecuteLaunch(ctx.config.baseUrl, ctx.repoName, 'exec-ws', { force: true }, opts);

        // Poll execution state until complete
        const maxWait = 60000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
          const state = await dataflowExecutePoll(ctx.config.baseUrl, ctx.repoName, 'exec-ws', {}, opts);

          if (state.status.type === 'completed') {
            assert.ok(state.summary, 'completed execution should have summary');
            assert.strictEqual(state.summary.type, 'some');
            if (state.summary.type === 'some') {
              assert.strictEqual(state.summary.value.executed, 1n);
              assert.strictEqual(state.summary.value.failed, 0n);
            }
            return; // Test passed
          }

          if (state.status.type === 'failed') {
            assert.fail('Execution should not have failed');
          }

          await new Promise(r => setTimeout(r, 100));
        }

        assert.fail('Execution did not complete in time');
      });

      it('taskLogs returns logs after execution', async (t) => {
        const ctx = await withSimpleExec(t);
        const opts = await ctx.opts();

        // Execute first
        await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'exec-ws', { force: true }, opts);

        // Get logs
        const logs = await taskLogs(ctx.config.baseUrl, ctx.repoName, 'exec-ws', 'compute', { stream: 'stdout' }, opts);

        // A chunk of its log, which may be empty for a simple task
        assert.ok(isValueOf(logs, TaskLogChunkType), 'a TaskLogChunk');
      });

      it('taskLogs names the execution it reads, and whether it has ended, and reads the one a request names', async (t) => {
        const ctx = await withLogPag(t);
        const opts = await ctx.opts();
        const read = (logOptions: LogOptions = {}) =>
          taskLogs(ctx.config.baseUrl, ctx.repoName, 'logpag-ws', 'log', { stream: 'stdout', ...logOptions }, opts);
        const latest = async () => (await taskExecutionList(ctx.config.baseUrl, ctx.repoName, 'logpag-ws', 'log', opts, { limit: 1 }))[0];

        // A run's log names the run, which has ended
        assertDataflowSucceeded(await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'logpag-ws', { force: true }, opts));
        const first = await latest();
        const logs = await read();
        assert.deepStrictEqual([logs.inputsHash, logs.executionId, logs.ended], [first.inputsHash, first.executionId, true]);

        // Another run is the task's current execution, and a request naming
        // the first still reads the first
        assertDataflowSucceeded(await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'logpag-ws', { force: true }, opts));
        const second = await latest();
        assert.notStrictEqual(second.executionId, first.executionId, 'the run is another execution');
        assert.strictEqual((await read()).executionId, second.executionId);
        const named = await read({ offset: 5, execution: { inputsHash: first.inputsHash, executionId: first.executionId } });
        assert.deepStrictEqual([named.executionId, named.data], [first.executionId, LOGGED_LINES.slice(5)]);

        // An execution the task does not record is none
        await assert.rejects(read({ execution: { inputsHash: first.inputsHash, executionId: '0190a0b0-4444-7000-8000-000000000000' } }), (err: unknown) => {
          assert.ok(err instanceof ApiError, `Expected ApiError, got ${String(err)}`);
          assert.strictEqual(err.code, 'execution_not_found');
          return true;
        });
      });
    });

    describe('diamond dependency execution', { concurrency: false }, () => {
      it('executes diamond dependency graph correctly', async (t) => {
        const ctx = await withDiamond(t);
        const opts = await ctx.opts();

        const result = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'diamond-ws', { force: true }, opts);

        // Should execute all three tasks
        assertDataflowSucceeded(result);
        assert.strictEqual(result.executed, 3n);
        assert.strictEqual(result.failed, 0n);
        assert.strictEqual(result.tasks.length, 3);

        // Verify all tasks succeeded
        for (const task of result.tasks) {
          assert.strictEqual(task.state.type, 'success', `Task ${task.name} should succeed`);
        }
      });

      it('diamond dependency graph produces the correct branch + join outputs', async (t) => {
        const ctx = await withDiamond(t);
        const opts = await ctx.opts();

        const result = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'diamond-ws', { force: true }, opts);
        assertDataflowSucceeded(result);

        // Read the actual computed values, not just task status. The structure
        // checks above pass even if a backend produces wrong-but-well-typed
        // numbers or writes a stale output ref (the exact failure mode the
        // cloud loop-orchestrator hit: correct data, wrong status — and its
        // inverse, which nothing else here guards). a=10, b=5 →
        // left=a+b=15, right=a*b=50, merge=left+right=65.
        const decode = decodeBeast2For(IntegerType);
        const read = async (task: string) => {
          const path = [variant('field', 'tasks'), variant('field', task), variant('field', 'output')];
          const { data } = await datasetGet(ctx.config.baseUrl, ctx.repoName, 'diamond-ws', path, opts);
          return decode(data);
        };

        assert.strictEqual(await read('left'), 15n, 'left should be a + b = 15');
        assert.strictEqual(await read('right'), 50n, 'right should be a * b = 50');
        assert.strictEqual(await read('merge'), 65n, 'merge should be (a+b) + (a*b) = 65');
      });

      it('tracks events during execution', async (t) => {
        const ctx = await withDiamond(t);
        const opts = await ctx.opts();

        // Start execution
        await dataflowExecuteLaunch(ctx.config.baseUrl, ctx.repoName, 'diamond-ws', { force: true }, opts);

        // Poll and collect events, each poll from the cursor the last gave
        const events: unknown[] = [];
        let since = 0n;
        const maxWait = 60000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
          const state = await dataflowExecutePoll(
            ctx.config.baseUrl,
            ctx.repoName,
            'diamond-ws',
            { since },
            opts
          );

          // Collect new events
          events.push(...state.events);
          since = state.nextSeq;

          // The run's end is its last word once no event of it is left
          if ((state.status.type === 'completed' || state.status.type === 'failed') && !dataflowEventsRemain(state)) {
            break;
          }

          await new Promise(r => setTimeout(r, 100));
        }

        // Should have events for all tasks (start + complete for each)
        // Diamond has 3 tasks: left, right, merge
        // Expect at least 3 complete events
        const completeEvents = events.filter((e: unknown) =>
          typeof e === 'object' && e !== null && 'type' in e && (e as { type: string }).type === 'complete'
        );
        assert.ok(completeEvents.length >= 3, `Expected at least 3 complete events, got ${completeEvents.length}`);
      });
    });

    describe('failed execution', { concurrency: false }, () => {
      it('dataflowExecute returns failure result when task fails', async (t) => {
        const ctx = await withFailing(t);
        const opts = await ctx.opts();

        const result = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'fail-ws', { force: true }, opts);

        // Execution should report failure
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.failed, 1n);
        assert.strictEqual(result.executed, 0n);
        assert.strictEqual(result.tasks.length, 1);
        assert.strictEqual(result.tasks[0].name, 'failing');
        // The body's own failure: its runner records it, and exits 1
        assert.deepStrictEqual(result.tasks[0].state, variant('failed', { exitCode: 1n }));
      });

      it('dataflowExecutePoll shows failed status after task failure', async (t) => {
        const ctx = await withFailing(t);
        const opts = await ctx.opts();

        // Start execution
        await dataflowExecuteLaunch(ctx.config.baseUrl, ctx.repoName, 'fail-ws', { force: true }, opts);

        // Poll until execution completes
        const maxWait = 60000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
          const state = await dataflowExecutePoll(ctx.config.baseUrl, ctx.repoName, 'fail-ws', {}, opts);

          if (state.status.type === 'failed') {
            // Verify we have summary with failure count
            assert.strictEqual(state.summary.type, 'some');
            if (state.summary.type === 'some') {
              assert.strictEqual(state.summary.value.failed, 1n);
            }
            return; // Test passed
          }

          if (state.status.type === 'completed') {
            assert.fail('Execution should have failed, not completed');
          }

          await new Promise(r => setTimeout(r, 100));
        }

        assert.fail('Execution did not complete in time');
      });

      it('can restart execution after failure', async (t) => {
        const ctx = await withFailing(t);
        const opts = await ctx.opts();

        // First execution - should fail
        const result1 = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'fail-ws', { force: true }, opts);
        assert.strictEqual(result1.success, false);

        // Second execution - should also run (not blocked by previous failure)
        const result2 = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'fail-ws', { force: true }, opts);
        assert.strictEqual(result2.success, false);
        assert.strictEqual(result2.failed, 1n);
      });
    });

    // The suites' one command: a custom task's. Every other task is East,
    // which every server runs; a server that runs no commands — e3 in a page —
    // records the task error, saying so.
    describe('command task', { concurrency: false }, () => {
      it('records a failing command failed, or error on a server that runs no commands', async (t) => {
        const ctx = await withCommand(t);
        const opts = await ctx.opts();

        const result = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'cmd-ws', { force: true }, opts);

        assert.strictEqual(result.success, false);
        assert.strictEqual(result.failed, 1n);
        assert.strictEqual(result.executed, 0n);
        assert.strictEqual(result.tasks.length, 1);
        const task = result.tasks[0];
        assert.strictEqual(task.name, 'command');
        if (ctx.commands) {
          // The command ran, and exited 1
          assert.deepStrictEqual(task.state, variant('failed', { exitCode: 1n }), describeDataflowResult(result));
        } else {
          // Nothing ran, and the server says why
          if (task.state.type !== 'error') {
            assert.fail(`expected the command task recorded error on a server that runs no commands\n${describeDataflowResult(result)}`);
          }
          assert.match(task.state.value.message, /runs no commands/);
        }
      });
    });

    describe('parallel task failures', { concurrency: false }, () => {
      describe('mixed success/failure', { concurrency: false }, () => {
        it('parallel tasks with mixed success/failure complete without stalling', async (t) => {
          const ctx = await withMixed(t);
          const opts = await ctx.opts();

          const result = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'mixed-ws', { force: true }, opts);

          // Dataflow should complete (not stall) and report failure
          assert.strictEqual(result.success, false);
          assert.strictEqual(result.failed, 1n);

          // The failing task must be reported: its body's failure, exit code 1
          const failC = result.tasks.find(t => t.name === 'fail_c');
          assert.ok(failC, 'fail_c task should be in results');
          assert.deepStrictEqual(failC.state, variant('failed', { exitCode: 1n }));

          // Tasks that did execute should have succeeded
          for (const task of result.tasks) {
            if (task.name !== 'fail_c') {
              assert.strictEqual(task.state.type, 'success', `Task ${task.name} should succeed`);
            }
          }
        });

        it('failed task logs are accessible', async (t) => {
          const ctx = await withMixed(t);
          const opts = await ctx.opts();

          // Execute first to generate logs
          await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'mixed-ws', { force: true }, opts);

          // taskLogs for failed task should NOT throw
          const logs = await taskLogs(ctx.config.baseUrl, ctx.repoName, 'mixed-ws', 'fail_c', { stream: 'stderr' }, opts);

          assert.ok(isValueOf(logs, TaskLogChunkType), 'a TaskLogChunk');
          // Its stderr holds the failure's message, which its body made from
          // its input as it ran
          assert.match(logs.data, /fail_c fails, given 3/);
        });

        it('workspace status reflects failed tasks correctly', async (t) => {
          const ctx = await withMixed(t);
          const opts = await ctx.opts();

          await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'mixed-ws', { force: true }, opts);

          const status = await workspaceStatus(ctx.config.baseUrl, ctx.repoName, 'mixed-ws', opts);

          // Failed task should show 'failed' status, not stuck as 'in-progress',
          // with the exit code its runner gave its body's failure
          const failedTask = status.tasks.find(t => t.name === 'fail_c');
          assert.ok(failedTask, 'fail_c task should be in workspace status');
          if (failedTask.status.type !== 'failed') {
            assert.fail(`Failed task should have failed status, got ${failedTask.status.type}`);
          }
          assert.strictEqual(failedTask.status.value.exitCode, 1n);

          // No task should be stuck as 'in-progress'
          for (const task of status.tasks) {
            assert.notStrictEqual(task.status.type, 'in-progress', `Task ${task.name} should not be stuck in-progress`);
          }
        });
      });

      describe('diamond with upstream failure', { concurrency: false }, () => {
        it('diamond with upstream failure skips dependents', async (t) => {
          const ctx = await withFailingDiamond(t);
          const opts = await ctx.opts();

          const result = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'fdiamond-ws', { force: true }, opts);

          assert.strictEqual(result.success, false);
          assert.strictEqual(result.failed, 1n);
          assert.ok(result.skipped >= 1n, `Expected at least 1 skipped task, got ${result.skipped}`);

          // Verify individual task states
          const leftTask = result.tasks.find(t => t.name === 'left');
          const rightTask = result.tasks.find(t => t.name === 'right');
          const mergeTask = result.tasks.find(t => t.name === 'merge');

          assert.ok(leftTask, 'left task should be in results');
          assert.ok(rightTask, 'right task should be in results');
          assert.ok(mergeTask, 'merge task should be in results');

          assert.strictEqual(leftTask.state.type, 'success');
          assert.deepStrictEqual(rightTask.state, variant('failed', { exitCode: 1n }));
          assert.strictEqual(mergeTask.state.type, 'skipped');
        });

        it('taskLogs returns execution_not_found for skipped task', async (t) => {
          const ctx = await withFailingDiamond(t);
          const opts = await ctx.opts();

          // Execute — merge will be skipped because right fails
          await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'fdiamond-ws', { force: true }, opts);

          try {
            await taskLogs(ctx.config.baseUrl, ctx.repoName, 'fdiamond-ws', 'merge', { stream: 'stdout' }, opts);
            assert.fail('Should have thrown an ApiError');
          } catch (err) {
            assert.ok(err instanceof ApiError, `Expected ApiError, got ${err}`);
            assert.strictEqual(err.code, 'execution_not_found');
          }
        });
      });

      describe('wide parallel execution', { concurrency: false }, () => {
        it('wide parallel execution completes correctly', async (t) => {
          const ctx = await withWideParallel(t);
          const opts = await ctx.opts();

          const result = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'wide-ws', { force: true }, opts);

          assertDataflowSucceeded(result);
          assert.strictEqual(result.executed, 6n);
          assert.strictEqual(result.failed, 0n);

          // All tasks should succeed
          for (const task of result.tasks) {
            assert.strictEqual(task.state.type, 'success', `Task ${task.name} should succeed`);
          }
        });
      });
    });

    // Concurrent execution tests must remain serial within their describe
    // because they test locking behavior with timing-sensitive operations
    describe('concurrent execution', () => {
      it('rejects second dataflowExecuteLaunch while execution is running', async (t) => {
        const ctx = await withSlow(t);
        const opts = await ctx.opts();

        // Start first execution (non-blocking)
        await dataflowExecuteLaunch(ctx.config.baseUrl, ctx.repoName, 'slow-ws', { force: true }, opts);

        // Wait until the execution is actually running (holds the lock)
        await waitForRunning(ctx.config.baseUrl, ctx.repoName, 'slow-ws', opts);

        // Try to start second execution - should fail with lock error
        try {
          await dataflowExecuteLaunch(ctx.config.baseUrl, ctx.repoName, 'slow-ws', { force: true }, opts);
          assert.fail('Second dataflowExecuteLaunch should have thrown an error');
        } catch (err) {
          // Should get a lock error
          assert.ok(err instanceof Error);
          const message = err.message.toLowerCase();
          assert.ok(
            message.includes('lock') || message.includes('running') || message.includes('busy'),
            `Expected lock-related error, got: ${err.message}`
          );
        }
      });

      it('rejects dataflowExecute while execution is running', async (t) => {
        const ctx = await withSlow(t);
        const opts = await ctx.opts();

        // Start first execution (non-blocking)
        await dataflowExecuteLaunch(ctx.config.baseUrl, ctx.repoName, 'slow-ws', { force: true }, opts);

        // Wait until the execution is actually running (holds the lock)
        await waitForRunning(ctx.config.baseUrl, ctx.repoName, 'slow-ws', opts);

        // Try blocking execute - should fail with lock error
        try {
          await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'slow-ws', { force: true }, opts);
          assert.fail('dataflowExecute should have thrown an error');
        } catch (err) {
          assert.ok(err instanceof Error);
          const message = err.message.toLowerCase();
          assert.ok(
            message.includes('lock') || message.includes('running') || message.includes('busy'),
            `Expected lock-related error, got: ${err.message}`
          );
        }
      });

      it('dataflowCancel stops a running execution', async (t) => {
        const ctx = await withSlow(t);
        const opts = await ctx.opts();

        // Start slow execution
        await dataflowExecuteLaunch(ctx.config.baseUrl, ctx.repoName, 'slow-ws', { force: true }, opts);

        // Wait until the execution is actually running
        await waitForRunning(ctx.config.baseUrl, ctx.repoName, 'slow-ws', opts);

        // Cancel it
        await dataflowCancel(ctx.config.baseUrl, ctx.repoName, 'slow-ws', opts);

        // The cancel response does not synchronise with the orchestrator's
        // state write — poll for the terminal state instead of reading once
        // (a single immediate read raced it and saw 'running' on slow CI).
        // If this ever times out, that's a real bug: a cancel delivered
        // right after start (possibly before the first task spawn) was not
        // honoured.
        let finalStatus = '';
        await waitFor(async () => {
          const state = await dataflowExecutePoll(ctx.config.baseUrl, ctx.repoName, 'slow-ws', {}, opts);
          finalStatus = state.status.type;
          return finalStatus !== 'running';
        }, 60000);
        assert.strictEqual(finalStatus, 'aborted');
      });

      it('serves why a cancelled run\'s task stopped, in the task\'s history and its status', async (t) => {
        const ctx = await withSlow(t);
        const opts = await ctx.opts();
        const history = () => taskExecutionList(ctx.config.baseUrl, ctx.repoName, 'slow-ws', 'slow', opts);

        await dataflowExecuteLaunch(ctx.config.baseUrl, ctx.repoName, 'slow-ws', { force: true }, opts);
        // The task's attempt is recorded running before the cancel, so the
        // cancel stops that attempt. Its log says it has not ended.
        await waitFor(async () => (await history()).some((item) => item.status.type === 'running'), 60000);
        const live = await taskLogs(ctx.config.baseUrl, ctx.repoName, 'slow-ws', 'slow', { stream: 'stderr' }, opts);
        assert.strictEqual(live.ended, false, 'the log of an execution still running has not ended');
        await dataflowCancel(ctx.config.baseUrl, ctx.repoName, 'slow-ws', opts);

        const cancelled = (items: ExecutionListItem[]) => items.find((item) => item.status.type === 'cancelled');
        await waitFor(async () => cancelled(await history()) !== undefined, 60000);
        const stopped = cancelled(await history());
        if (stopped?.reason.type !== 'some') assert.fail('a cancelled attempt says why it stopped');
        assert.strictEqual(stopped.reason.value.kind.type, 'aborted');
        assert.notStrictEqual(stopped.reason.value.message, '', 'in words, as its log\'s last line does');
        const ended = await taskLogs(ctx.config.baseUrl, ctx.repoName, 'slow-ws', 'slow', {
          stream: 'stderr', execution: { inputsHash: live.inputsHash, executionId: live.executionId },
        }, opts);
        assert.strictEqual(ended.ended, true, 'and once it is cancelled, it has');

        // The task reads ready, naming why its latest attempt stopped.
        const task = (await workspaceStatus(ctx.config.baseUrl, ctx.repoName, 'slow-ws', opts)).tasks.find((each) => each.name === 'slow');
        assert.ok(task !== undefined, 'the task is in the status');
        assert.strictEqual(task.status.type, 'ready');
        if (task.stopped.type !== 'some') assert.fail('the status names why the task\'s attempt stopped');
        assert.strictEqual(task.stopped.value.kind.type, 'aborted');
      });

      it('dataflowCancel returns error when no execution is running', async (t) => {
        const ctx = await withSlow(t);
        const opts = await ctx.opts();

        // Nothing is running to cancel: the server says so, as the request
        // meeting the workspace's state rather than a fault of its own
        await assert.rejects(dataflowCancel(ctx.config.baseUrl, ctx.repoName, 'slow-ws', opts), (err: unknown) => {
          assert.ok(err instanceof ApiError, `Expected ApiError, got ${String(err)}`);
          assert.strictEqual(err.code, 'dataflow_error');
          assert.strictEqual((err.details as { message?: string } | undefined)?.message, 'No active execution for this workspace');
          return true;
        });
      });
    });

    // Concurrent set during execution - tests that datasetSet is not blocked by dataflowExecuteLaunch
    describe('concurrent set during execution', () => {
      it('datasetSet succeeds while dataflow is running', async (t) => {
        const ctx = await withSlow(t);
        const opts = await ctx.opts();

        // Start slow execution (30s sleep task)
        await dataflowExecuteLaunch(ctx.config.baseUrl, ctx.repoName, 'slow-ws', { force: true }, opts);

        // Wait until the execution is actually running (holds the lock)
        await waitForRunning(ctx.config.baseUrl, ctx.repoName, 'slow-ws', opts);

        // datasetSet should succeed concurrently — not blocked by the dataflow lock
        const encode = encodeBeast2For(StringType);
        const inputPath = [
          variant('field', 'inputs'),
          variant('field', 'value'),
        ];

        // This should NOT throw a lock error
        await datasetSet(ctx.config.baseUrl, ctx.repoName, 'slow-ws', inputPath, encode('updated'), opts);

        // Cancel the slow execution so the test doesn't wait 30s
        await dataflowCancel(ctx.config.baseUrl, ctx.repoName, 'slow-ws', opts);
      });

      it('set input during execution then re-execute reflects new value', async (t) => {
        const ctx = await setup(t);
        const opts = await ctx.opts();

        // Use compute package: input "value" (Integer, default 10n), task "compute" (value * 2)
        const zipPath = await createPackageZip(ctx.tempDir, 'conc-pkg', '1.0.0');
        const packageZip = readFileSync(zipPath);
        await packageImport(ctx.config.baseUrl, ctx.repoName, packageZip, opts);

        await workspaceCreate(ctx.config.baseUrl, ctx.repoName, 'conc-ws', opts);
        await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, 'conc-ws', 'conc-pkg@1.0.0', opts);

        // First execution with default input (10n) → output should be 20n
        const result1 = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'conc-ws', { force: true }, opts);
        assertDataflowSucceeded(result1, "first execute");

        // Change input to 7n
        const encode = encodeBeast2For(IntegerType);
        const decode = decodeBeast2For(IntegerType);
        const inputPath = [variant('field', 'inputs'), variant('field', 'value')];
        await datasetSet(ctx.config.baseUrl, ctx.repoName, 'conc-ws', inputPath, encode(7n), opts);

        // Re-execute — task should run (input changed, cache miss)
        const result2 = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'conc-ws', { force: false }, opts);
        assertDataflowSucceeded(result2, "re-execute after input change");
        assert.ok(result2.executed > 0n, `Expected task to re-execute, got executed=${result2.executed}`);

        // Output should be 14n (7 * 2)
        const outputPath = [variant('field', 'tasks'), variant('field', 'compute'), variant('field', 'output')];
        const { data: output } = await datasetGet(ctx.config.baseUrl, ctx.repoName, 'conc-ws', outputPath, opts);
        assert.strictEqual(decode(output), 14n);
      });

      it('diamond DAG maintains version vector consistency when input changes during execution', async (t) => {
        // Diamond: x → left(x*2), right(x*3), merge(left+right) = x*5
        // Left and right sleep 3s so we can change x while they run.
        // If VVs are consistent, merge output is always divisible by 5.
        // The VV bug causes mixed versions: e.g. left uses old x, right uses new x.
        const ctx = await withSlowDiamond(t);
        const opts = await ctx.opts();

        const encode = encodeBeast2For(IntegerType);
        const decode = decodeBeast2For(IntegerType);
        const inputPath = [variant('field', 'inputs'), variant('field', 'x')];
        const mergePath = [variant('field', 'tasks'), variant('field', 'merge'), variant('field', 'output')];

        // Start execution (non-blocking) — x defaults to 1
        await dataflowExecuteLaunch(ctx.config.baseUrl, ctx.repoName, 'sdiamond-ws', { force: true }, opts);

        // Wait for the test's TRUE precondition before changing the input:
        // at least one task has actually STARTED (a `start` event exists),
        // not merely "the execution is running" — on slow runners (Windows
        // CI) tasks take seconds to spawn after the run begins, and a set
        // that lands before any task starts isn't a mid-flight change at
        // all. The 3s task sleeps bound how late the set can land.
        await waitFor(async () => {
          const state = await dataflowExecutePoll(ctx.config.baseUrl, ctx.repoName, 'sdiamond-ws', {}, opts);
          return state.events.some((e) => e.type === 'start');
        }, 60000);
        await datasetSet(ctx.config.baseUrl, ctx.repoName, 'sdiamond-ws', inputPath, encode(19n), opts);

        // Wait for the reactive re-execution to reach a fixpoint AND the merge
        // output to be assigned. The mid-flight input change schedules a
        // re-execution, so a terminal status can briefly precede merge's ref
        // being rewritten; read the dataset inside the wait and tolerate the
        // transient `dataset_unassigned` instead of reading once and racing it.
        let mergeValue: bigint | undefined;
        await waitFor(async () => {
          const state = await dataflowExecutePoll(ctx.config.baseUrl, ctx.repoName, 'sdiamond-ws', {}, opts);
          if (state.status.type !== 'completed' && state.status.type !== 'failed' && state.status.type !== 'aborted') {
            return false;
          }
          try {
            const { data: mergeData } = await datasetGet(ctx.config.baseUrl, ctx.repoName, 'sdiamond-ws', mergePath, opts);
            mergeValue = decode(mergeData);
            return true;
          } catch (err) {
            // Re-execution still in flight — merge's ref isn't rewritten yet.
            if (err instanceof ApiError && err.code === 'dataset_unassigned') return false;
            throw err;
          }
        // 180s: two generations of 3s-sleep branches + joins, where a cold
        // Windows CI runner spends seconds per east-node spawn (60s measured
        // 61.9s — thin margin, not a hang).
        }, 180000, 500);

        // merge must be x*5 for some consistent x (waitFor throws if it never settles)
        assert.strictEqual(
          mergeValue! % 5n,
          0n,
          `Diamond consistency violated: merge=${mergeValue} is not divisible by 5 ` +
          `(expected x*5 for consistent x, got mixed versions)`
        );
      });
    });

    describe('execution not found', { concurrency: false }, () => {
      it('taskLogs returns execution_not_found for never-executed task', async (t) => {
        const ctx = await withNoExec(t);
        const opts = await ctx.opts();

        try {
          await taskLogs(ctx.config.baseUrl, ctx.repoName, 'noexec-ws', 'compute', { stream: 'stdout' }, opts);
          assert.fail('Should have thrown an ApiError');
        } catch (err) {
          assert.ok(err instanceof ApiError, `Expected ApiError, got ${err}`);
          assert.strictEqual(err.code, 'execution_not_found');
        }
      });

      it('taskLogs returns task_not_found for non-existent task', async (t) => {
        const ctx = await withNoExec(t);
        const opts = await ctx.opts();

        try {
          await taskLogs(ctx.config.baseUrl, ctx.repoName, 'noexec-ws', 'no_such_task', { stream: 'stdout' }, opts);
          assert.fail('Should have thrown an ApiError');
        } catch (err) {
          assert.ok(err instanceof ApiError, `Expected ApiError, got ${err}`);
          assert.strictEqual(err.code, 'task_not_found');
        }
      });

      it('taskLogs returns workspace_not_found for non-existent workspace', async (t) => {
        const ctx = await withNoExec(t);
        const opts = await ctx.opts();

        try {
          await taskLogs(ctx.config.baseUrl, ctx.repoName, 'no_such_ws', 'compute', { stream: 'stdout' }, opts);
          assert.fail('Should have thrown an ApiError');
        } catch (err) {
          assert.ok(err instanceof ApiError, `Expected ApiError, got ${err}`);
          assert.strictEqual(err.code, 'workspace_not_found');
        }
      });
    });

    describe('workspace error handling', { concurrency: false }, () => {
      it('dataflowExecute returns error for non-existent workspace', async (t) => {
        const ctx = await setup(t);
        const opts = await ctx.opts();

        try {
          await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'no_such_ws', { force: true }, opts);
          assert.fail('Should have thrown an ApiError');
        } catch (err) {
          assert.ok(err instanceof ApiError, `Expected ApiError, got ${err}`);
          assert.ok(
            err.code === 'workspace_not_found' || err.code === 'workspace_not_deployed',
            `Expected workspace_not_found or workspace_not_deployed, got ${err.code}`
          );
        }
      });

      it('dataflowGraph returns error for non-existent workspace', async (t) => {
        const ctx = await setup(t);
        const opts = await ctx.opts();

        try {
          await dataflowGraph(ctx.config.baseUrl, ctx.repoName, 'no_such_ws', opts);
          assert.fail('Should have thrown an ApiError');
        } catch (err) {
          assert.ok(err instanceof ApiError, `Expected ApiError, got ${err}`);
          assert.ok(
            err.code === 'workspace_not_found' || err.code === 'workspace_not_deployed',
            `Expected workspace_not_found or workspace_not_deployed, got ${err.code}`
          );
        }
      });

      it('workspaceStatus returns error for non-existent workspace', async (t) => {
        const ctx = await setup(t);
        const opts = await ctx.opts();

        try {
          await workspaceStatus(ctx.config.baseUrl, ctx.repoName, 'no_such_ws', opts);
          assert.fail('Should have thrown an ApiError');
        } catch (err) {
          assert.ok(err instanceof ApiError, `Expected ApiError, got ${err}`);
          assert.ok(
            err.code === 'workspace_not_found' || err.code === 'workspace_not_deployed',
            `Expected workspace_not_found or workspace_not_deployed, got ${err.code}`
          );
        }
      });
    });

    describe('cache behavior', { concurrency: false }, () => {
      it('second execution uses cached results', async (t) => {
        const ctx = await withCache(t);
        const opts = await ctx.opts();

        // First execution - should execute the task
        const result1 = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'cache-ws', { force: false }, opts);
        assertDataflowSucceeded(result1, "first execute");
        assert.strictEqual(result1.executed, 1n);

        // Second execution without force - should use cache
        const result2 = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'cache-ws', { force: false }, opts);
        assertDataflowSucceeded(result2, "cached re-execute");
        assert.ok(result2.cached > 0n, `Expected cached > 0, got ${result2.cached}`);
        assert.strictEqual(result2.executed, 0n);
      });

      it('force bypasses cache', async (t) => {
        const ctx = await withCache(t);
        const opts = await ctx.opts();

        // First execution
        await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'cache-ws', { force: false }, opts);

        // Force execution - should re-execute despite cache
        const result = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'cache-ws', { force: true }, opts);
        assertDataflowSucceeded(result, "forced re-execute");
        assert.ok(result.executed > 0n, `Expected executed > 0, got ${result.executed}`);
      });
    });

    describe('task filter', { concurrency: false }, () => {
      it('filter runs only the specified task', async (t) => {
        const ctx = await withFilter(t);
        const opts = await ctx.opts();

        const result = await dataflowExecute(
          ctx.config.baseUrl, ctx.repoName, 'filter-ws',
          { force: true, filter: 'left' },
          opts
        );

        assertDataflowSucceeded(result);

        // Only the filtered task should have executed
        const executedTasks = result.tasks.filter(t => t.state.type === 'success' && !t.cached);
        assert.strictEqual(executedTasks.length, 1, `Expected 1 executed task, got ${executedTasks.length}`);
        assert.strictEqual(executedTasks[0].name, 'left');
      });

      it('filter with non-existent task returns error', async (t) => {
        const ctx = await withFilter(t);
        const opts = await ctx.opts();

        try {
          await dataflowExecute(
            ctx.config.baseUrl, ctx.repoName, 'filter-ws',
            { force: true, filter: 'no_such_task' },
            opts
          );
          assert.fail('Should have thrown an ApiError');
        } catch (err) {
          assert.ok(err instanceof ApiError, `Expected ApiError, got ${err}`);
          assert.strictEqual(err.code, 'task_not_found');
        }
      });
    });

    // A run forces every task, none, or the tasks it names. The diamond's left
    // and right read the inputs, and merge reads both.
    describe('forcing named tasks', { concurrency: false }, () => {
      it('re-runs the tasks a run names, and serves the rest from the cache while their inputs hold', async (t) => {
        const ctx = await withForced(t);
        const opts = await ctx.opts();
        assertDataflowSucceeded(await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'forced-ws', {}, opts), 'first run');

        const result = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'forced-ws', { force: ['left'] }, opts);
        assertDataflowSucceeded(result, 'forced run');
        // left runs again and writes what it wrote before, so merge, which
        // reads it, is served from the cache as right is.
        assert.deepStrictEqual(
          ['left', 'right', 'merge'].map((name) => [name, result.tasks.find((task) => task.name === name)?.cached]),
          [['left', false], ['right', true], ['merge', true]],
          describeDataflowResult(result),
        );
      });

      it('refuses a start forcing a task the graph lacks, or one the filter leaves out, before anything runs', async (t) => {
        const ctx = await withForced(t);
        const opts = await ctx.opts();

        await assert.rejects(dataflowExecuteLaunch(ctx.config.baseUrl, ctx.repoName, 'forced-ws', { force: ['left', 'no_such_task'] }, opts), (err: unknown) => {
          assert.ok(err instanceof ApiError, `Expected ApiError, got ${String(err)}`);
          assert.strictEqual(err.code, 'task_not_found');
          assert.strictEqual((err.details as { task?: string } | undefined)?.task, 'no_such_task');
          return true;
        });
        await assert.rejects(dataflowExecuteLaunch(ctx.config.baseUrl, ctx.repoName, 'forced-ws', { force: ['right'], filter: 'left' }, opts), (err: unknown) => {
          assert.ok(err instanceof ApiError, `Expected ApiError, got ${String(err)}`);
          assert.strictEqual(err.code, 'dataflow_error');
          assert.strictEqual(
            (err.details as { message?: string } | undefined)?.message,
            "the run forces 'right', which the filter 'left' leaves out: a filtered run runs 'left' and the tasks it depends on, and no other",
          );
          return true;
        });

        // Neither started a run.
        await assert.rejects(dataflowExecutePoll(ctx.config.baseUrl, ctx.repoName, 'forced-ws', {}, opts), (err: unknown) => {
          assert.ok(err instanceof ApiError, `Expected ApiError, got ${String(err)}`);
          assert.strictEqual(err.code, 'execution_not_found');
          return true;
        });
      });
    });

    describe('dependency graph', { concurrency: false }, () => {
      it('dataflowGraph returns correct structure', async (t) => {
        const ctx = await withGraph(t);
        const opts = await ctx.opts();

        const graph = await dataflowGraph(ctx.config.baseUrl, ctx.repoName, 'graph-ws', opts);

        // Should have 3 tasks: left, right, merge
        assert.strictEqual(graph.tasks.length, 3);

        const left = graph.tasks.find(t => t.name === 'left');
        const right = graph.tasks.find(t => t.name === 'right');
        const merge = graph.tasks.find(t => t.name === 'merge');

        assert.ok(left, 'left task should be in graph');
        assert.ok(right, 'right task should be in graph');
        assert.ok(merge, 'merge task should be in graph');

        // left and right have no dependencies
        assert.deepStrictEqual(left.dependsOn, []);
        assert.deepStrictEqual(right.dependsOn, []);

        // merge depends on both left and right
        assert.ok(merge.dependsOn.includes('left'), 'merge should depend on left');
        assert.ok(merge.dependsOn.includes('right'), 'merge should depend on right');
        assert.strictEqual(merge.dependsOn.length, 2);
      });
    });

    describe('log pagination', { concurrency: false }, () => {
      it('taskLogs supports offset and limit', async (t) => {
        const ctx = await withLogPag(t);
        const opts = await ctx.opts();
        const read = (logOptions: { offset?: number; limit?: number }) =>
          taskLogs(ctx.config.baseUrl, ctx.repoName, 'logpag-ws', 'log', { stream: 'stdout', ...logOptions }, opts);
        const total = BigInt(LOGGED_LINES.length);

        // The task writes three known lines to its stdout
        assertDataflowSucceeded(await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'logpag-ws', { force: true }, opts));

        // The whole log
        const full = await read({});
        assert.strictEqual(full.data, LOGGED_LINES);
        assert.strictEqual(full.offset, 0n);
        assert.strictEqual(full.size, total);
        assert.strictEqual(full.totalSize, total);
        assert.strictEqual(full.complete, true);

        // Its first 5 bytes: a limit cuts it, short of its end
        const head = await read({ offset: 0, limit: 5 });
        assert.strictEqual(head.data, 'line ');
        assert.strictEqual(head.offset, 0n);
        assert.strictEqual(head.size, 5n);
        assert.strictEqual(head.totalSize, total);
        assert.strictEqual(head.complete, false);

        // A window from byte 5: an offset and a limit together
        const middle = await read({ offset: 5, limit: 9 });
        assert.strictEqual(middle.data, '0\nline 1\n');
        assert.strictEqual(middle.offset, 5n);
        assert.strictEqual(middle.size, 9n);
        assert.strictEqual(middle.complete, false);

        // From byte 14 to its end: an offset alone
        const tail = await read({ offset: 14 });
        assert.strictEqual(tail.data, 'line 2\n');
        assert.strictEqual(tail.offset, 14n);
        assert.strictEqual(tail.size, 7n);
        assert.strictEqual(tail.complete, true);

        // A window of no bytes is a window: it reports the log's size, which
        // is how e3's CLI learns it
        const probe = await read({ offset: 0, limit: 0 });
        assert.strictEqual(probe.data, '');
        assert.strictEqual(probe.size, 0n);
        assert.strictEqual(probe.totalSize, total);
      });

      it('refuses a malformed window or stream with bad_request, before it reads a log', async (t) => {
        const ctx = await withLogPag(t);
        const opts = await ctx.opts();
        assertDataflowSucceeded(await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'logpag-ws', { force: true }, opts));

        // Through the client, which sends a number as it prints
        const windows: [LogOptions, string][] = [
          [{ offset: NaN }, 'offset must be a non-negative integer, got "NaN"'],
          [{ offset: -1 }, 'offset must be a non-negative integer, got "-1"'],
          [{ offset: 1.5 }, 'offset must be a non-negative integer, got "1.5"'],
          [{ limit: NaN }, 'limit must be a non-negative integer, got "NaN"'],
          [{ limit: -1 }, 'limit must be a non-negative integer, got "-1"'],
        ];
        for (const [window, message] of windows) {
          await rejectsBadRequest(
            taskLogs(ctx.config.baseUrl, ctx.repoName, 'logpag-ws', 'log', { stream: 'stdout', ...window }, opts),
            message,
          );
        }

        // As a request spells them: a word; a number past those a number holds
        // exactly; a stream other than the two a log has, a way out of the
        // execution among them; and a window for a task there is no log of,
        // refused before the server looks for one
        const logs = `${ctx.config.baseUrl}/api/repos/${encodeURIComponent(ctx.repoName)}/workspaces/logpag-ws/dataflow/logs`;
        const headers: Record<string, string> = opts.token ? { 'Authorization': `Bearer ${opts.token}` } : {};
        const requests: [string, string][] = [
          ['log?offset=abc', 'offset must be a non-negative integer, got "abc"'],
          ['log?limit=abc', 'limit must be a non-negative integer, got "abc"'],
          ['log?offset=99999999999999999999', 'offset must be at most 9007199254740991, got "99999999999999999999"'],
          ['log?stream=stdin', 'stream must be stdout or stderr, got "stdin"'],
          [`log?stream=${encodeURIComponent('../../stdout')}`, 'stream must be stdout or stderr, got "../../stdout"'],
          ['no_such_task?offset=-1', 'offset must be a non-negative integer, got "-1"'],
          [`log?inputs=${'a'.repeat(64)}`, 'inputs and execution name an execution together: give both, or neither'],
          ['log?execution=0190a0b0-4444-7000-8000-000000000000', 'inputs and execution name an execution together: give both, or neither'],
        ];
        for (const [request, message] of requests) {
          const response = await ctx.fetch(`${logs}/${request}`, { headers });
          assert.strictEqual(response.status, 400, request);
          assert.deepStrictEqual(await response.json(), { error: { type: 'bad_request', message } }, request);
        }
      });
    });

    describe('event pagination', { concurrency: false }, () => {
      it('dataflowExecutePoll serves the events past its cursor, at most its limit, and the cursor past them', async (t) => {
        const ctx = await withEvtPag(t);
        const opts = await ctx.opts();
        const poll = (stateOptions: ExecutionStateOptions) => dataflowExecutePoll(ctx.config.baseUrl, ctx.repoName, 'evtpag-ws', stateOptions, opts);

        // Execute and wait for completion
        await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'evtpag-ws', { force: true }, opts);

        const before = lessFor(IntegerType);

        // Every event, and the cursor past the last
        const all = await poll({});
        assert.ok(all.events.length >= 3, `Expected at least 3 events, got ${all.events.length}`);
        assert.ok(before(0n, all.nextSeq), 'the cursor moved past the events');

        // A page of one, and the next from its cursor: the events in order
        const page1 = await poll({ limit: 1 });
        const page2 = await poll({ since: page1.nextSeq, limit: 1 });
        assert.deepStrictEqual([...page1.events, ...page2.events], all.events.slice(0, 2), 'the first two events, in order');
        assert.ok(before(page1.nextSeq, page2.nextSeq), 'each cursor past the events served');

        // A poll that has every event is served none, and its cursor stays
        const caughtUp = await poll({ since: all.nextSeq });
        assert.deepStrictEqual([caughtUp.events, caughtUp.nextSeq], [[], all.nextSeq]);
        assert.strictEqual(caughtUp.status.type, 'completed', 'with the run\'s state');

        // Where the run's events end: a poll of every event reaches its last,
        // and a page of one leaves events for the next
        assert.strictEqual(all.lastSeq, all.nextSeq, 'a poll of every event is at the run\'s last');
        assert.deepStrictEqual([dataflowEventsRemain(all), dataflowEventsRemain(page1), dataflowEventsRemain(caughtUp)], [false, true, false]);

        // Each poll names the run, and another run is another id
        assert.deepStrictEqual([page1.runId, page2.runId, caughtUp.runId], [all.runId, all.runId, all.runId]);
        assertDataflowSucceeded(await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'evtpag-ws', { force: true }, opts));
        assert.notStrictEqual((await poll({ limit: 0 })).runId, all.runId, 'the next run is another');
      });

      it('refuses a malformed cursor or limit with bad_request; a poll of no events carries the run\'s state', async (t) => {
        const ctx = await withEvtPag(t);
        const opts = await ctx.opts();
        assertDataflowSucceeded(await dataflowExecute(ctx.config.baseUrl, ctx.repoName, 'evtpag-ws', { force: true }, opts));

        // Through the client, which sends a limit as it prints
        const windows: [ExecutionStateOptions, string][] = [
          [{ limit: NaN }, 'limit must be a non-negative integer, got "NaN"'],
          [{ limit: -1 }, 'limit must be a non-negative integer, got "-1"'],
          [{ limit: 1.5 }, 'limit must be a non-negative integer, got "1.5"'],
          [{ since: -1n }, 'since must be a non-negative integer, got "-1"'],
        ];
        for (const [window, message] of windows) {
          await rejectsBadRequest(dataflowExecutePoll(ctx.config.baseUrl, ctx.repoName, 'evtpag-ws', window, opts), message);
        }

        // As a request spells them: a word, and a number past those a number
        // holds exactly
        const execution = `${ctx.config.baseUrl}/api/repos/${encodeURIComponent(ctx.repoName)}/workspaces/evtpag-ws/dataflow/execution`;
        const headers: Record<string, string> = opts.token ? { 'Authorization': `Bearer ${opts.token}` } : {};
        const requests: [string, string][] = [
          ['since=abc', 'since must be a non-negative integer, got "abc"'],
          ['since=1.5', 'since must be a non-negative integer, got "1.5"'],
          ['since=99999999999999999999', 'since must be at most 9007199254740991, got "99999999999999999999"'],
        ];
        for (const [query, message] of requests) {
          const response = await ctx.fetch(`${execution}?${query}`, { headers });
          assert.strictEqual(response.status, 400, query);
          assert.deepStrictEqual(await response.json(), { error: { type: 'bad_request', message } }, query);
        }

        const none = await dataflowExecutePoll(ctx.config.baseUrl, ctx.repoName, 'evtpag-ws', { limit: 0 }, opts);
        assert.strictEqual(none.status.type, 'completed');
        assert.deepStrictEqual([none.events, none.nextSeq], [[], 0n], 'no events, and the cursor where it was');
        assert.ok(dataflowEventsRemain(none), 'and where the run\'s events end, past the cursor');
      });
    });
  });
}
