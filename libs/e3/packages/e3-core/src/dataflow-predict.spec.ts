/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A run's prediction, held to the run: each case predicts, then runs with the
 * same options and a runner that notes each task it executed. Every task
 * predicted answered is not executed and ends at the output predicted; every
 * task executed was predicted unanswered; and a task predicted unanswered
 * that the run did not execute sits below one that recomputed the output it
 * had, which each case names.
 */

import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { East, IntegerType, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { dataflowGetGraph, dataflowPredict, dataflowResolveInputHashes, type DataflowPrediction } from './dataflow.js';
import { keypathToRefPath } from './dataset-refs.js';
import { TaskNotFoundError } from './errors.js';
import { dataflowExecute } from './execution/local-orchestrator.js';
import { LocalTaskRunner } from './execution/LocalTaskRunner.js';
import type { TaskExecuteOptions, TaskResult } from './execution/interfaces.js';
import { inputsHash } from './executions.js';
import { packageImport } from './package-files.js';
import type { StorageBackend } from './storage/interfaces.js';
import { LocalStorage } from './storage/local/LocalBackend.js';
import { createTempDir, createTestRepo, removeTempDir, removeTestRepo } from './test-helpers.js';
import { workspaceSetDataset } from './trees.js';
import { uuidv7 } from './uuid.js';
import { workspaceCreate, workspaceDeploy } from './workspaces.js';

const add = East.function([IntegerType], IntegerType, ($, x) => x.add(1n));
const A = [variant('field', 'inputs'), variant('field', 'a')];

/** A local runner that notes each task it executed, rather than served. */
class Recording extends LocalTaskRunner {
  readonly executed: string[] = [];
  override async execute(storage: StorageBackend, taskHash: string, inputHashes: string[], options?: TaskExecuteOptions): Promise<TaskResult> {
    const result = await super.execute(storage, taskHash, inputHashes, options);
    if (!result.cached) this.executed.push(options?.taskName ?? taskHash);
    return result;
  }
}

/**
 * Deploys `a -> first -> second -> third`; `constant` over `a`, which gives
 * the same output whatever `a` is, and `after` over it; and `on_b` over an
 * input nothing sets, and `after_b` over it.
 */
async function deploy(t: TestContext): Promise<{ storage: StorageBackend; repo: string }> {
  const repo = createTestRepo();
  const dir = createTempDir();
  t.after(() => {
    removeTestRepo(repo);
    removeTempDir(dir);
  });
  const storage = new LocalStorage();
  const a = e3.input('a', IntegerType, variant('value', 1n));
  const first = e3.task('first', [a], add);
  const second = e3.task('second', [first.output], add);
  const constant = e3.task('constant', [a], East.function([IntegerType], IntegerType, ($, x) => x.multiply(0n)));
  const b = e3.input('b', IntegerType);
  const onB = e3.task('on_b', [b], add);
  const zip = join(dir, 'predict.zip');
  await e3.export(e3.package('predict', '1.0.0', a, first, second, e3.task('third', [second.output], add),
    constant, e3.task('after', [constant.output], add), b, onB, e3.task('after_b', [onB.output], add)), zip);
  await packageImport(storage, repo, zip);
  await workspaceCreate(storage, repo, 'ws');
  await workspaceDeploy(storage, repo, 'ws', 'predict', '1.0.0');
  return { storage, repo };
}

const sorted = (names: Iterable<string>): string[] => [...names].sort();

/** Predicts, runs with the same options, and holds the answered to the run. */
async function predictThenRun(storage: StorageBackend, repo: string, options: { force?: boolean | string[]; filter?: string } = {}): Promise<{ prediction: DataflowPrediction; executed: string[] }> {
  const prediction = await dataflowPredict(storage, repo, 'ws', options);
  const runner = new Recording(repo);
  const ran = await dataflowExecute(storage, repo, 'ws', { ...options, runner });
  assert.equal(ran.success, true);
  const graph = await dataflowGetGraph(storage, repo, 'ws');
  for (const [name, { outputHash }] of prediction.answered) {
    assert.ok(!runner.executed.includes(name), `${name}, predicted answered, was not executed`);
    const output = graph.tasks.find((task) => task.name === name)!.output;
    const ref = await storage.datasets.read(repo, 'ws', keypathToRefPath(output));
    assert.ok(ref?.type === 'value' && ref.value.hash === outputHash, `${name} ends at the output predicted`);
  }
  for (const name of runner.executed) assert.ok(prediction.unanswered.includes(name), `${name}, executed, was predicted unanswered`);
  return { prediction, executed: sorted(runner.executed) };
}

const WAITING = ['after_b', 'on_b'];

describe('dataflowPredict', () => {
  it('predicts every task unanswered before anything has run', async (t) => {
    const { storage, repo } = await deploy(t);
    const { prediction, executed } = await predictThenRun(storage, repo);
    assert.deepEqual(sorted(prediction.unanswered), ['after', 'constant', 'first', 'second', 'third']);
    assert.deepEqual(sorted(prediction.waiting), WAITING);
    assert.deepEqual(executed, sorted(prediction.unanswered));
  });

  it('predicts every task answered once everything has run', async (t) => {
    const { storage, repo } = await deploy(t);
    await predictThenRun(storage, repo);
    const { prediction, executed } = await predictThenRun(storage, repo);
    assert.deepEqual(sorted(prediction.answered.keys()), ['after', 'constant', 'first', 'second', 'third']);
    assert.deepEqual(executed, []);
  });

  it('predicts every task below a changed input unanswered, though its ref holds its old output', async (t) => {
    const { storage, repo } = await deploy(t);
    await predictThenRun(storage, repo);
    await workspaceSetDataset(storage, repo, 'ws', A, 2n, IntegerType);
    const { prediction, executed } = await predictThenRun(storage, repo);
    assert.deepEqual(sorted(prediction.unanswered), ['after', 'constant', 'first', 'second', 'third']);
    // `constant` recomputed the output it had, so the run answered `after`
    assert.deepEqual(executed, ['constant', 'first', 'second', 'third']);
  });

  it('predicts a reverted input answered, from executions whose outputs the refs no longer hold', async (t) => {
    const { storage, repo } = await deploy(t);
    await predictThenRun(storage, repo);
    await workspaceSetDataset(storage, repo, 'ws', A, 2n, IntegerType);
    await predictThenRun(storage, repo);
    await workspaceSetDataset(storage, repo, 'ws', A, 1n, IntegerType);
    const { prediction, executed } = await predictThenRun(storage, repo);
    assert.deepEqual(sorted(prediction.answered.keys()), ['after', 'constant', 'first', 'second', 'third']);
    assert.deepEqual(executed, []);
  });

  it('predicts a task unanswered whose latest attempt did not succeed, where the runner\'s probe serves no earlier success', async (t) => {
    const { storage, repo } = await deploy(t);
    await predictThenRun(storage, repo);
    await workspaceSetDataset(storage, repo, 'ws', A, 2n, IntegerType);
    await predictThenRun(storage, repo);
    await workspaceSetDataset(storage, repo, 'ws', A, 1n, IntegerType);
    // `first`'s latest attempt over `a` = 1 is one its host stopped
    const first = (await dataflowGetGraph(storage, repo, 'ws')).tasks.find((task) => task.name === 'first')!;
    const inputs = (await dataflowResolveInputHashes(storage, repo, 'ws', first)) as string[];
    const now = new Date();
    await storage.refs.executionWrite(repo, first.hash, inputsHash(inputs), uuidv7(), variant('interrupted', {
      executionId: uuidv7(), inputHashes: inputs, startedAt: now, completedAt: now, pid: 0n, unit: false,
      reason: { kind: variant('host', 'test.stopped'), message: 'stopped by the test' },
    }));
    const { prediction, executed } = await predictThenRun(storage, repo);
    assert.deepEqual(sorted(prediction.unanswered), ['first', 'second', 'third']);
    assert.deepEqual(sorted(prediction.answered.keys()), ['after', 'constant']);
    // `first` recomputed the output it had, so the run answered the two below it
    assert.deepEqual(executed, ['first']);
  });

  it('predicts what a run forces unanswered: every task, or those named and what depends on them', async (t) => {
    const { storage, repo } = await deploy(t);
    await predictThenRun(storage, repo);
    const all = await predictThenRun(storage, repo, { force: true });
    assert.deepEqual(sorted(all.prediction.unanswered), ['after', 'constant', 'first', 'second', 'third']);
    assert.deepEqual(all.executed, ['after', 'constant', 'first', 'second', 'third']);
    const named = await predictThenRun(storage, repo, { force: ['second'] });
    assert.deepEqual(sorted(named.prediction.unanswered), ['second', 'third']);
    assert.deepEqual(sorted(named.prediction.answered.keys()), ['after', 'constant', 'first']);
    // `second` recomputed the output it had, so the run answered `third`
    assert.deepEqual(named.executed, ['second']);
  });

  it('predicts a filtered run\'s dependency closure alone', async (t) => {
    const { storage, repo } = await deploy(t);
    const { prediction, executed } = await predictThenRun(storage, repo, { filter: 'second' });
    assert.deepEqual(sorted([...prediction.answered.keys(), ...prediction.unanswered, ...prediction.waiting]), ['first', 'second']);
    assert.deepEqual(executed, ['first', 'second']);
    await assert.rejects(dataflowPredict(storage, repo, 'ws', { filter: 'nothing' }), TaskNotFoundError);
    await assert.rejects(dataflowPredict(storage, repo, 'ws', { filter: 'second', force: ['third'] }), /leaves out/);
  });

  it('predicts a task over an unassigned input waiting, and the tasks below it', async (t) => {
    const { storage, repo } = await deploy(t);
    const { prediction } = await predictThenRun(storage, repo);
    assert.deepEqual(sorted(prediction.waiting), WAITING);
    assert.ok(!prediction.unanswered.some((name) => WAITING.includes(name)));
  });
});
