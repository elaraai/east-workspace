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
import { DictType, East, IntegerType, SortedMap, compareFor, decodeBeast2For, none, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { PackageObjectType } from '@elaraai/e3-types';
import { LocalOrchestrator } from '../execution/local-orchestrator.js';
import type { ExecutionHandle } from '../dataflow/orchestrator/interfaces.js';
import { InMemoryStateStore } from '../dataflow/state-store/InMemoryStateStore.js';
import type { ExecutionStateStore } from '../dataflow/state-store/interfaces.js';
import { DataflowAbortedError } from '../errors.js';
import { inputsHash } from '../executions.js';
import { MockTaskRunner } from '../execution/MockTaskRunner.js';
import { packageImport } from '../package-files.js';
import { workspaceSetDataset } from '../trees.js';
import { workspaceCreate, workspaceGetPackage } from '../workspaces.js';
import { workspaceDeploy } from '../workspace-files.js';
import type { BackendContext, BackendSetup } from './setup.js';

/** A directory for a test's own files, removed when the test ends. */
function scratch(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'e3-contract-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The store a case's runs keep their state in: the one the backend's setup
 *  gives, or one in memory. */
function stateStoreOf(context: BackendContext): ExecutionStateStore {
  return context.stateStore ?? new InMemoryStateStore();
}

/**
 * Registers the dataflow loop's contract suite over a backend.
 *
 * @param setup - Makes a fresh backend and a repository in it for each test,
 *   and the store the runs keep their state in, when the backend gives one
 */
export function dataflowTests(setup: BackendSetup): void {
  describe('the dataflow loop', () => {
    it('runs a workspace\'s tasks in the order they depend on each other, writing each output and recording the run', async (t) => {
      const context = await setup(t);
      const { storage, repo } = context;
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
      const stateStore = stateStoreOf(context);
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
      const context = await setup(t);
      const { storage, repo } = context;
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
      const first = new LocalOrchestrator(stateStoreOf(context));
      await first.wait(await first.start(storage, repo, 'ws', { runner }));
      const inputs = runner.getCalls()[0]!.inputHashes;

      // The success a runner records for the task over its inputs.
      const executionId = '0190a0b0-6666-7000-8000-000000000001';
      await storage.refs.executionWrite(repo, taskHash, inputsHash(inputs), executionId, variant('success', {
        executionId, inputHashes: inputs, outputHash: 'doubled-out', startedAt: new Date(), completedAt: new Date(),
        peakBytes: none, plan: none, unit: false,
      }));
      runner.clearCalls();
      const second = new LocalOrchestrator(stateStoreOf(context));
      const result = await second.wait(await second.start(storage, repo, 'ws', { runner }));

      assert.equal(result.success, true);
      assert.deepEqual([result.executed, result.cached], [0, 1]);
      assert.deepEqual(runner.getCalls(), [], 'the runner was not asked');
      const run = await storage.refs.dataflowRunGet(repo, 'ws', result.runId);
      assert.equal(run?.taskExecutions.get('doubled')?.executionId, executionId, 'the run names the execution it was served from');
    });

    it('skips what depends on a task that failed, and records the run failed', async (t) => {
      const context = await setup(t);
      const { storage, repo } = context;
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
      const orchestrator = new LocalOrchestrator(stateStoreOf(context));
      const result = await orchestrator.wait(await orchestrator.start(storage, repo, 'ws', { runner }));

      assert.equal(result.success, false);
      assert.deepEqual([result.failed, result.skipped], [1, 1]);
      assert.equal(runner.getCalls().length, 1, 'report never ran');
      const run = await storage.refs.dataflowRunGet(repo, 'ws', result.runId);
      assert.ok(run?.status.type === 'failed' && run.status.value.failedTask === 'doubled');
    });

    it('runs a task again when an input it read is written while the run is in flight', async (t) => {
      const context = await setup(t);
      const { storage, repo } = context;
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
      const orchestrator = new LocalOrchestrator(stateStoreOf(context));
      const result = await orchestrator.wait(await orchestrator.start(storage, repo, 'ws', { runner }));

      assert.equal(result.success, true);
      assert.equal(calls, 2, 'doubled ran again over the new input');
      assert.equal(result.reexecuted, 1);
      const written = await storage.datasets.read(repo, 'ws', 'tasks/doubled/output');
      assert.ok(written?.type === 'value' && written.value.hash === 'doubled-v2');
    });

    it('stops a run its orchestrator is asked to cancel, and records it cancelled', async (t) => {
      const context = await setup(t);
      const { storage, repo } = context;
      const sales = e3.input('sales', IntegerType, variant('value', 1n));
      const doubled = e3.task('doubled', [sales], East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)));
      const zip = join(scratch(t), 'flow.zip');
      await e3.export(e3.package('flow', '1.0.0', sales, doubled), zip);
      await packageImport(storage, repo, zip);
      await workspaceCreate(storage, repo, 'ws');
      await workspaceDeploy(storage, repo, 'ws', 'flow', '1.0.0');
      const deployed = decodeBeast2For(PackageObjectType)(await storage.objects.read(repo, (await workspaceGetPackage(storage, repo, 'ws')).hash));

      const stateStore = stateStoreOf(context);
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

    it('ends a run whose loop throws while a task runs only once that task has settled: failed for good, its record too, its locks held until then', async (t) => {
      const context = await setup(t);
      const { storage, repo } = context;
      // `first` runs while preparing `second`, whose input was never
      // assigned, throws out of the loop.
      const a = e3.input('a', IntegerType, variant('value', 1n));
      const b = e3.input('b', IntegerType);
      const add = East.function([IntegerType], IntegerType, ($, x) => x.add(1n));
      const zip = join(scratch(t), 'late.zip');
      await e3.export(e3.package('late', '1.0.0', a, b, e3.task('first', [a], add), e3.task('second', [b], add)), zip);
      await packageImport(storage, repo, zip);
      await workspaceCreate(storage, repo, 'ws');
      await workspaceDeploy(storage, repo, 'ws', 'late', '1.0.0');
      const deployed = decodeBeast2For(PackageObjectType)(await storage.objects.read(repo, (await workspaceGetPackage(storage, repo, 'ws')).hash));

      // `first` runs until the run stops it, as a runner does once the run's
      // signal aborts — or for two seconds, should nothing stop it.
      const runner = new MockTaskRunner();
      let lockedAtEnd: boolean | undefined;
      runner.setResult(deployed.tasks.get('first')!, async () => {
        const signal = runner.getCalls()[0]!.options!.signal!;
        await Promise.race([
          new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true })),
          new Promise((resolve) => setTimeout(resolve, 2_000)),
        ]);
        lockedAtEnd = (await storage.locks.getState(repo, 'ws#dataflow')) !== null;
        return { state: 'error', cached: false, error: 'cancelled: e3 stopped the runner because the run was aborted', cancelled: true };
      });
      const stateStore = stateStoreOf(context);
      const orchestrator = new LocalOrchestrator(stateStore);
      const handle = await orchestrator.start(storage, repo, 'ws', { runner });
      await assert.rejects(orchestrator.wait(handle), { message: 'Task \'second\' has unassigned input' });

      assert.equal(lockedAtEnd, true, 'the running task ended while the run still held its locks');
      assert.equal(await storage.locks.getState(repo, 'ws#dataflow'), null, 'the run let its locks go once it had ended');
      const ended = await stateStore.read(repo, 'ws', handle.id);
      assert.equal(ended?.status, 'failed');
      assert.deepEqual(ended?.error, some('Task \'second\' has unassigned input'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal((await stateStore.read(repo, 'ws', handle.id))?.status, 'failed', 'nothing the run launched wrote its state back');
      const run = await storage.refs.dataflowRunGet(repo, 'ws', handle.id);
      assert.ok(run?.status.type === 'failed' && run.status.value.error === 'Task \'second\' has unassigned input',
        'its record says it failed, and why');
      await assert.rejects(orchestrator.cancel(handle), /not found/, 'as for any run that has ended, there is nothing to cancel');
    });

    it('ends a split task the loop left between stages cancelled when the loop throws, and the run failed', async (t) => {
      const context = await setup(t);
      const { storage, repo } = context;
      // Pieces of 16 to 256 stored bytes, so the input is cut into many.
      const pieceBytes = process.env.E3_TEST_PIECE_BYTES;
      process.env.E3_TEST_PIECE_BYTES = '64';
      t.after(() => {
        if (pieceBytes === undefined) delete process.env.E3_TEST_PIECE_BYTES;
        else process.env.E3_TEST_PIECE_BYTES = pieceBytes;
      });
      // `total` is planned into pieces, then preparing `waits`, whose input was
      // never assigned, throws out of the loop before a unit has launched.
      const rows = e3.input('rows', DictType(IntegerType, IntegerType), variant('value', new SortedMap(
        Array.from({ length: 8000 }, (_, i) => [BigInt(i), BigInt(i)] as [bigint, bigint]), compareFor(IntegerType))));
      const total = e3.streamTask('total', {
        inputs: [e3.partition(rows)],
        output: e3.output.fold(IntegerType, { zero: 0n, combine: (_$, x, y) => x.add(y) }),
      }, ($, rows, emit) => {
        $.for(rows, ($, value) => {
          $(emit(value));
        });
      });
      const missing = e3.input('missing', IntegerType);
      const waits = e3.task('waits', [missing], East.function([IntegerType], IntegerType, ($, x) => x.add(1n)));
      const zip = join(scratch(t), 'split.zip');
      await e3.export(e3.package('split', '1.0.0', rows, total, missing, waits), zip);
      await packageImport(storage, repo, zip);
      await workspaceCreate(storage, repo, 'ws');
      await workspaceDeploy(storage, repo, 'ws', 'split', '1.0.0');
      const deployed = decodeBeast2For(PackageObjectType)(await storage.objects.read(repo, (await workspaceGetPackage(storage, repo, 'ws')).hash));
      const totalHash = deployed.tasks.get('total')!;
      const runner = new MockTaskRunner();
      runner.setUnitResult(totalHash, (unit) => ({ state: 'success', cached: false, outputHash: unit.merge === null ? 'piece' : 'sum' }));

      const stateStore = stateStoreOf(context);
      const orchestrator = new LocalOrchestrator(stateStore);
      const handle = await orchestrator.start(storage, repo, 'ws', { runner });
      await assert.rejects(orchestrator.wait(handle), { message: 'Task \'waits\' has unassigned input' });

      assert.deepEqual(runner.getUnitCalls(), [], 'no unit launched');
      const rowsRef = await storage.datasets.read(repo, 'ws', 'inputs/rows');
      assert.ok(rowsRef?.type === 'value');
      assert.equal((await storage.refs.executionGetLatest(repo, totalHash, inputsHash([rowsRef.value.hash])))?.type, 'cancelled',
        'the split task\'s own execution ended cancelled, not left running');
      const ended = await stateStore.read(repo, 'ws', handle.id);
      assert.equal(ended?.status, 'failed');
      assert.equal(ended?.tasks.get('total')?.status, 'pending', 'the task can run again');
    });
  });
}
