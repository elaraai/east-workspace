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
import { DictType, East, IntegerType, SortedMap, compareFor, decodeBeast2For, equalFor, none, printFor, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { DataflowForceType, PackageObjectType, dataflowForce } from '@elaraai/e3-types';
import { LocalOrchestrator } from '../execution/local-orchestrator.js';
import type { ExecutionHandle } from '../dataflow/orchestrator/interfaces.js';
import { InMemoryStateStore } from '../dataflow/state-store/InMemoryStateStore.js';
import type { ExecutionStateStore } from '../dataflow/state-store/interfaces.js';
import { DataflowAbortedError, DataflowError, TaskNotFoundError } from '../errors.js';
import { inputsHash } from '../executions.js';
import { MockTaskRunner } from '../execution/MockTaskRunner.js';
import { packageImport } from '../package-files.js';
import { workspaceSetDataset } from '../trees.js';
import { uuidv7 } from '../uuid.js';
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
 * Deploys a chain of three tasks over one input to workspace `ws`: `extract`,
 * `model` over what `extract` writes, and `report` over what `model` writes.
 *
 * @returns Each task's hash
 */
async function deployChain(t: TestContext, { storage, repo }: BackendContext): Promise<{ extract: string; model: string; report: string }> {
  const sales = e3.input('sales', IntegerType, variant('value', 1n));
  const add = East.function([IntegerType], IntegerType, ($, x) => x.add(1n));
  const extract = e3.task('extract', [sales], add);
  const model = e3.task('model', [extract.output], add);
  const report = e3.task('report', [model.output], add);
  const zip = join(scratch(t), 'chain.zip');
  await e3.export(e3.package('chain', '1.0.0', sales, extract, model, report), zip);
  await packageImport(storage, repo, zip);
  await workspaceCreate(storage, repo, 'ws');
  await workspaceDeploy(storage, repo, 'ws', 'chain', '1.0.0');
  const deployed = decodeBeast2For(PackageObjectType)(await storage.objects.read(repo, (await workspaceGetPackage(storage, repo, 'ws')).hash));
  return { extract: deployed.tasks.get('extract')!, model: deployed.tasks.get('model')!, report: deployed.tasks.get('report')! };
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

    it('forces the tasks a run names and no other: what depends on one runs again when its output changes, and the rest is served from the cache', async (t) => {
      const context = await setup(t);
      const { storage, repo } = context;
      const { extract, model, report } = await deployChain(t, context);
      // `model` reads what changes outside e3, as a task a schedule forces
      // does: each run of it answers anew.
      const runner = new MockTaskRunner();
      let models = 0;
      runner.setResult(extract, { state: 'success', cached: false, outputHash: 'extract-out' });
      runner.setResult(model, () => ({ state: 'success', cached: false, outputHash: `model-v${++models}` }));
      runner.setResult(report, (inputs) => ({ state: 'success', cached: false, outputHash: `report-of-${inputs[0]}` }));
      const first = new LocalOrchestrator(stateStoreOf(context));
      await first.wait(await first.start(storage, repo, 'ws', { runner }));
      // Each attempt of the first run, recorded as a runner records a success:
      // the cache holds every task's output over its inputs.
      const outputs = new Map([[extract, 'extract-out'], [model, 'model-v1'], [report, 'report-of-model-v1']]);
      for (const { taskHash, inputHashes } of runner.getCalls()) {
        const executionId = uuidv7();
        await storage.refs.executionWrite(repo, taskHash, inputsHash(inputHashes), executionId, variant('success', {
          executionId, inputHashes, outputHash: outputs.get(taskHash)!, startedAt: new Date(), completedAt: new Date(),
          peakBytes: none, plan: none, unit: false,
        }));
      }
      runner.clearCalls();

      const stateStore = stateStoreOf(context);
      const second = new LocalOrchestrator(stateStore);
      const handle = await second.start(storage, repo, 'ws', { runner, force: ['model'] });
      const result = await second.wait(handle);

      assert.equal(result.success, true);
      assert.deepEqual([result.executed, result.cached], [2, 1]);
      assert.deepEqual(runner.getCalls().map(({ taskHash, options }) => [taskHash, options?.force]), [[model, true], [report, false]],
        'model is forced though the cache holds its output, and report runs over what it wrote; extract is served from the cache');
      const written = await storage.datasets.read(repo, 'ws', 'tasks/report/output');
      assert.ok(written?.type === 'value' && written.value.hash === 'report-of-model-v2');
      const state = await stateStore.read(repo, 'ws', handle.id);
      assert.ok(state !== null, 'the store holds the run');
      assert.ok(equalFor(DataflowForceType)(state.force, dataflowForce(['model'])),
        `the run's state names the tasks it forces, not ${printFor(DataflowForceType)(state.force)}`);
    });

    it('refuses, before anything runs, a run that forces a task the graph does not have, or one its filter leaves out', async (t) => {
      const context = await setup(t);
      const { storage, repo } = context;
      const { extract, model } = await deployChain(t, context);
      const runner = new MockTaskRunner();
      const orchestrator = new LocalOrchestrator(stateStoreOf(context));

      await assert.rejects(orchestrator.start(storage, repo, 'ws', { runner, force: ['model', 'forecast'] }), (err: unknown) => {
        assert.ok(err instanceof TaskNotFoundError, `a TaskNotFoundError, not ${String(err)}`);
        assert.equal(err.task, 'forecast');
        return true;
      });
      await assert.rejects(orchestrator.start(storage, repo, 'ws', { runner, force: ['extract', 'report'], filter: 'model' }), (err: unknown) => {
        assert.ok(err instanceof DataflowError, `a DataflowError, not ${String(err)}`);
        assert.equal(err.message,
          'the run forces \'report\', which the filter \'model\' leaves out: a filtered run runs \'model\' and the tasks it depends on, and no other');
        return true;
      });
      assert.deepEqual(runner.getCalls(), [], 'nothing ran');
      assert.equal(await storage.refs.dataflowRunGetLatest(repo, 'ws'), null, 'and no run was recorded');

      // The workspace is free: a run forcing a task its filter runs goes ahead.
      runner.setResult(extract, { state: 'success', cached: false, outputHash: 'extract-out' });
      runner.setResult(model, { state: 'success', cached: false, outputHash: 'model-out' });
      const result = await orchestrator.wait(await orchestrator.start(storage, repo, 'ws', { runner, force: ['extract'], filter: 'model' }));
      assert.equal(result.success, true);
      assert.deepEqual(runner.getCalls().map(({ taskHash, options }) => [taskHash, options?.force]), [[extract, true], [model, false]]);
    });

    it('forces the same tasks once a run that yielded is resumed', async (t) => {
      const context = await setup(t);
      const { storage, repo } = context;
      const { extract, model, report } = await deployChain(t, context);
      const runner = new MockTaskRunner();
      runner.setResult(extract, { state: 'success', cached: false, outputHash: 'extract-out' });
      runner.setResult(report, { state: 'success', cached: false, outputHash: 'report-out' });
      // model holds until released, so the run yields with it in flight; the
      // resumed run launches it again.
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      let settled!: () => void;
      const abandoned = new Promise<void>((resolve) => { settled = resolve; });
      runner.setResult(model, async () => {
        await held;
        settled();
        return { state: 'success', cached: false, outputHash: 'model-out' };
      });
      const stateStore = stateStoreOf(context);
      const orchestrator = new LocalOrchestrator(stateStore);
      // The run yields once extract has run, as a host near its time limit asks.
      let yielding = false;
      const handle = await orchestrator.start(storage, repo, 'ws', {
        runner,
        force: ['model'],
        shouldYield: () => yielding,
        onTaskComplete: ({ name }) => { if (name === 'extract') yielding = true; },
      });
      assert.equal((await orchestrator.wait(handle)).yielded, true);
      assert.deepEqual(runner.getCalls().map(({ taskHash, options }) => [taskHash, options?.force]), [[extract, false], [model, true]],
        'the run yielded with model, which it forces, in flight');
      const yielded = await stateStore.read(repo, 'ws', handle.id);
      assert.ok(yielded !== null && equalFor(DataflowForceType)(yielded.force, dataflowForce(['model'])),
        'the state the run yielded with names the tasks it forces');
      release();
      await abandoned;
      runner.clearCalls();

      const resumed = await orchestrator.resume(storage, repo, 'ws', handle.id, { runner });
      assert.equal((await orchestrator.wait(resumed)).success, true);
      assert.deepEqual(runner.getCalls().map(({ taskHash, options }) => [taskHash, options?.force]), [[model, true], [report, false]],
        'resumed, the run forces model, as it was started to');
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
