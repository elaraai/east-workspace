/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The dataflow loop's contract over a backend: a run of a deployed workspace,
 * driven by the orchestrator with a mock runner, through nothing but the
 * backend's stores — its order, its outputs and its run record, the execution
 * cache, a failure, a change that lands mid-run, and a cancel.
 */

import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { East, IntegerType, decodeBeast2For, none, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { PackageObjectType } from '@elaraai/e3-types';
import { LocalOrchestrator } from '../execution/local-orchestrator.js';
import type { ExecutionHandle } from '../dataflow/orchestrator/interfaces.js';
import { InMemoryStateStore } from '../dataflow/state-store/InMemoryStateStore.js';
import { DataflowAbortedError } from '../errors.js';
import { inputsHash } from '../executions.js';
import { MockTaskRunner } from '../execution/MockTaskRunner.js';
import { packageImport } from '../package-files.js';
import { workspaceSetDataset } from '../trees.js';
import { workspaceCreate, workspaceGetPackage } from '../workspaces.js';
import { workspaceDeploy } from '../workspace-files.js';
import type { BackendSetup } from './setup.js';

/** A directory for a test's own files, removed when the test ends. */
function scratch(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'e3-contract-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Registers the dataflow loop's contract suite over a backend.
 *
 * @param setup - Makes a fresh backend and a repository in it for each test
 */
export function dataflowTests(setup: BackendSetup): void {
  describe('the dataflow loop', () => {
    it('runs a workspace\'s tasks in the order they depend on each other, writing each output and recording the run', async (t) => {
      const { storage, repo } = await setup(t);
      const sales = e3.input('sales', IntegerType, variant('value', 1n));
      const doubled = e3.task('doubled', [sales], East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)));
      const report = e3.task('report', [doubled.output], East.function([IntegerType], IntegerType, ($, x) => x.add(1n)));
      const zip = join(scratch(t), 'flow.zip');
      await e3.export(e3.package('flow', '1.0.0', sales, doubled, report), zip);
      await packageImport(storage, repo, zip);
      await workspaceCreate(storage, repo, 'ws');
      await workspaceDeploy(storage, repo, 'ws', 'flow', '1.0.0');
      const deployed = decodeBeast2For(PackageObjectType)(await storage.objects.read(repo, (await workspaceGetPackage(storage, repo, 'ws')).hash));

      const runner = new MockTaskRunner();
      runner.setResult(deployed.tasks.get('doubled')!, { state: 'success', cached: false, outputHash: 'doubled-out' });
      runner.setResult(deployed.tasks.get('report')!, { state: 'success', cached: false, outputHash: 'report-out' });
      const stateStore = new InMemoryStateStore();
      const orchestrator = new LocalOrchestrator(stateStore);
      const handle = await orchestrator.start(storage, repo, 'ws', { runner });
      const result = await orchestrator.wait(handle);

      assert.equal(result.success, true);
      assert.equal(result.executed, 2);
      assert.deepEqual(runner.getCalls().map(({ taskHash, inputHashes }) => [taskHash, inputHashes.length]),
        [[deployed.tasks.get('doubled')!, 1], [deployed.tasks.get('report')!, 1]], 'doubled, then report');
      assert.deepEqual(runner.getCalls()[1]!.inputHashes, ['doubled-out'], 'report reads what doubled wrote');
      const written = await storage.datasets.read(repo, 'ws', 'tasks/report/output');
      assert.ok(written?.type === 'value' && written.value.hash === 'report-out');

      assert.equal((await stateStore.read(repo, 'ws', handle.id))?.status, 'completed');
      const run = await storage.refs.dataflowRunGet(repo, 'ws', result.runId);
      assert.equal(run?.status.type, 'completed');
      assert.deepEqual([...run!.taskExecutions.keys()].sort(), ['doubled', 'report']);
    });

    it('serves a task from the execution cache when its latest attempt over its inputs succeeded', async (t) => {
      const { storage, repo } = await setup(t);
      const sales = e3.input('sales', IntegerType, variant('value', 1n));
      const doubled = e3.task('doubled', [sales], East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)));
      const zip = join(scratch(t), 'flow.zip');
      await e3.export(e3.package('flow', '1.0.0', sales, doubled), zip);
      await packageImport(storage, repo, zip);
      await workspaceCreate(storage, repo, 'ws');
      await workspaceDeploy(storage, repo, 'ws', 'flow', '1.0.0');
      const deployed = decodeBeast2For(PackageObjectType)(await storage.objects.read(repo, (await workspaceGetPackage(storage, repo, 'ws')).hash));
      const taskHash = deployed.tasks.get('doubled')!;

      const runner = new MockTaskRunner();
      runner.setResult(taskHash, { state: 'success', cached: false, outputHash: 'doubled-out' });
      const first = new LocalOrchestrator(new InMemoryStateStore());
      await first.wait(await first.start(storage, repo, 'ws', { runner }));
      const inputs = runner.getCalls()[0]!.inputHashes;

      // The success a runner records for the task over its inputs.
      const executionId = '0190a0b0-6666-7000-8000-000000000001';
      await storage.refs.executionWrite(repo, taskHash, inputsHash(inputs), executionId, variant('success', {
        executionId, inputHashes: inputs, outputHash: 'doubled-out', startedAt: new Date(), completedAt: new Date(),
        peakBytes: none, plan: none, unit: false,
      }));
      runner.clearCalls();
      const second = new LocalOrchestrator(new InMemoryStateStore());
      const result = await second.wait(await second.start(storage, repo, 'ws', { runner }));

      assert.equal(result.success, true);
      assert.deepEqual([result.executed, result.cached], [0, 1]);
      assert.deepEqual(runner.getCalls(), [], 'the runner was not asked');
      const run = await storage.refs.dataflowRunGet(repo, 'ws', result.runId);
      assert.equal(run?.taskExecutions.get('doubled')?.executionId, executionId, 'the run names the execution it was served from');
    });

    it('skips what depends on a task that failed, and records the run failed', async (t) => {
      const { storage, repo } = await setup(t);
      const sales = e3.input('sales', IntegerType, variant('value', 1n));
      const doubled = e3.task('doubled', [sales], East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)));
      const report = e3.task('report', [doubled.output], East.function([IntegerType], IntegerType, ($, x) => x.add(1n)));
      const zip = join(scratch(t), 'flow.zip');
      await e3.export(e3.package('flow', '1.0.0', sales, doubled, report), zip);
      await packageImport(storage, repo, zip);
      await workspaceCreate(storage, repo, 'ws');
      await workspaceDeploy(storage, repo, 'ws', 'flow', '1.0.0');
      const deployed = decodeBeast2For(PackageObjectType)(await storage.objects.read(repo, (await workspaceGetPackage(storage, repo, 'ws')).hash));

      const runner = new MockTaskRunner();
      runner.setResult(deployed.tasks.get('doubled')!, { state: 'failed', cached: false, exitCode: 1 });
      const orchestrator = new LocalOrchestrator(new InMemoryStateStore());
      const result = await orchestrator.wait(await orchestrator.start(storage, repo, 'ws', { runner }));

      assert.equal(result.success, false);
      assert.deepEqual([result.failed, result.skipped], [1, 1]);
      assert.equal(runner.getCalls().length, 1, 'report never ran');
      const run = await storage.refs.dataflowRunGet(repo, 'ws', result.runId);
      assert.ok(run?.status.type === 'failed' && run.status.value.failedTask === 'doubled');
    });

    it('runs a task again when an input it read is written while the run is in flight', async (t) => {
      const { storage, repo } = await setup(t);
      const sales = e3.input('sales', IntegerType, variant('value', 1n));
      const doubled = e3.task('doubled', [sales], East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)));
      const zip = join(scratch(t), 'flow.zip');
      await e3.export(e3.package('flow', '1.0.0', sales, doubled), zip);
      await packageImport(storage, repo, zip);
      await workspaceCreate(storage, repo, 'ws');
      await workspaceDeploy(storage, repo, 'ws', 'flow', '1.0.0');
      const deployed = decodeBeast2For(PackageObjectType)(await storage.objects.read(repo, (await workspaceGetPackage(storage, repo, 'ws')).hash));

      const runner = new MockTaskRunner();
      let calls = 0;
      runner.setResult(deployed.tasks.get('doubled')!, async () => {
        calls++;
        if (calls === 1) {
          await workspaceSetDataset(storage, repo, 'ws', [variant('field', 'inputs'), variant('field', 'sales')], 5n, IntegerType);
        }
        return { state: 'success', cached: false, outputHash: `doubled-v${calls}` };
      });
      const orchestrator = new LocalOrchestrator(new InMemoryStateStore());
      const result = await orchestrator.wait(await orchestrator.start(storage, repo, 'ws', { runner }));

      assert.equal(result.success, true);
      assert.equal(calls, 2, 'doubled ran again over the new input');
      assert.equal(result.reexecuted, 1);
      const written = await storage.datasets.read(repo, 'ws', 'tasks/doubled/output');
      assert.ok(written?.type === 'value' && written.value.hash === 'doubled-v2');
    });

    it('stops a run its orchestrator is asked to cancel, and records it cancelled', async (t) => {
      const { storage, repo } = await setup(t);
      const sales = e3.input('sales', IntegerType, variant('value', 1n));
      const doubled = e3.task('doubled', [sales], East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)));
      const zip = join(scratch(t), 'flow.zip');
      await e3.export(e3.package('flow', '1.0.0', sales, doubled), zip);
      await packageImport(storage, repo, zip);
      await workspaceCreate(storage, repo, 'ws');
      await workspaceDeploy(storage, repo, 'ws', 'flow', '1.0.0');
      const deployed = decodeBeast2For(PackageObjectType)(await storage.objects.read(repo, (await workspaceGetPackage(storage, repo, 'ws')).hash));

      const stateStore = new InMemoryStateStore();
      const orchestrator = new LocalOrchestrator(stateStore);
      const runner = new MockTaskRunner();
      let handle!: ExecutionHandle;
      runner.setResult(deployed.tasks.get('doubled')!, async () => {
        await orchestrator.cancel(handle);
        return { state: 'error', cached: false, error: 'cancelled: e3 stopped the runner because the run was aborted', cancelled: true };
      });
      handle = await orchestrator.start(storage, repo, 'ws', { runner });

      await assert.rejects(orchestrator.wait(handle), DataflowAbortedError);
      assert.equal((await stateStore.read(repo, 'ws', handle.id))?.status, 'cancelled');
      assert.equal((await storage.refs.dataflowRunGetLatest(repo, 'ws'))?.status.type, 'cancelled');
    });
  });
}
