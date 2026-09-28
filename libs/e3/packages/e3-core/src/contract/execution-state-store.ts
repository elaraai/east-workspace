/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The execution state store's contract: what any backend's store of a
 * dataflow run's state does — the state an orchestrator persists, a poll reads
 * and a cancel ends, whichever process answers.
 */

import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { none, some, variant } from '@elaraai/east';
import { E3_RELEASE } from '@elaraai/e3-types';
import type { ExecutionStateStore } from '../dataflow/state-store/interfaces.js';
import type { DataflowExecutionState } from '../dataflow/types.js';
import { uuidv7 } from '../uuid.js';

/**
 * A state store under test, and the repository its runs are of.
 */
export interface ExecutionStateStoreContext {
  /** The store under test */
  readonly store: ExecutionStateStore;
  /** The identifier of the repository the runs are of */
  readonly repo: string;
}

/**
 * Makes a fresh, empty state store for one test, and registers its cleanup
 * with `t.after`.
 */
export type ExecutionStateStoreSetup = (t: TestContext) => Promise<ExecutionStateStoreContext>;

/**
 * Registers the execution state store's contract suite over a store.
 *
 * @param setup - Makes a fresh, empty store for each test
 */
export function executionStateStoreTests(setup: ExecutionStateStoreSetup): void {
  describe('the execution state store', () => {
    it('creates a run\'s state, which a read by its id and the workspace\'s latest return, and refuses to create it twice', async (t) => {
      const { store, repo } = await setup(t);
      const id = uuidv7();
      const state: DataflowExecutionState = {
        release: E3_RELEASE, id, repo, workspace: 'ws', startedAt: new Date('2026-09-28T00:00:00.000Z'), force: false, filter: none,
        graph: some({ tasks: [{ name: 'etl', hash: 'a'.repeat(64), inputs: ['.inputs.sales'], output: '.tasks.etl.output', dependsOn: [] }] }),
        graphHash: none,
        tasks: new Map([['etl', {
          name: 'etl', status: 'pending', cached: none, outputHash: none, error: none, exitCode: none,
          startedAt: none, completedAt: none, duration: none, plan: none, execution: none,
        }]]),
        executed: 0n, cached: 0n, failed: 0n, skipped: 0n, status: 'running', completedAt: none, error: none,
        versionVectors: new Map([['.inputs.sales', new Map([['.inputs.sales', 'b'.repeat(64)]])]]),
        inputSnapshot: new Map([['.inputs.sales', 'b'.repeat(64)]]), taskOutputPaths: ['.tasks.etl.output'], reexecuted: 0n,
        events: [], eventSeq: 0n,
      };
      await store.create(state);

      const read = await store.read(repo, 'ws', id);
      assert.equal(read?.id, id);
      assert.equal(read?.tasks.get('etl')?.status, 'pending');
      assert.equal((await store.readLatest(repo, 'ws'))?.id, id);
      await assert.rejects(store.create(state));
    });

    it('reads no run it was not given: another id, another workspace\'s, another repository\'s', async (t) => {
      const { store, repo } = await setup(t);
      assert.equal(await store.readLatest(repo, 'ws'), null);
      const id = uuidv7();
      await store.create({
        release: E3_RELEASE, id, repo, workspace: 'ws', startedAt: new Date(), force: false, filter: none,
        graph: none, graphHash: none, tasks: new Map(), executed: 0n, cached: 0n, failed: 0n, skipped: 0n,
        status: 'running', completedAt: none, error: none, versionVectors: new Map(), inputSnapshot: new Map(),
        taskOutputPaths: [], reexecuted: 0n, events: [], eventSeq: 0n,
      });
      assert.equal(await store.read(repo, 'ws', uuidv7()), null);
      assert.equal(await store.read(repo, 'other', id), null);
      assert.equal(await store.readLatest(repo, 'other'), null);
      assert.equal(await store.read(`${repo}-other`, 'ws', id), null);
    });

    it('takes a later run for the workspace\'s latest', async (t) => {
      const { store, repo } = await setup(t);
      const first = uuidv7();
      await new Promise((resolve) => setTimeout(resolve, 2));
      const second = uuidv7();
      const earlier: DataflowExecutionState = {
        release: E3_RELEASE, id: first, repo, workspace: 'ws', startedAt: new Date(), force: false, filter: none,
        graph: none, graphHash: none, tasks: new Map(), executed: 1n, cached: 0n, failed: 0n, skipped: 0n,
        status: 'completed', completedAt: some(new Date()), error: none, versionVectors: new Map(), inputSnapshot: new Map(),
        taskOutputPaths: [], reexecuted: 0n, events: [], eventSeq: 0n,
      };
      await store.create(earlier);
      await store.create({ ...earlier, id: second, status: 'running', completedAt: none, executed: 0n });
      const latest = await store.readLatest(repo, 'ws');
      assert.equal(latest?.id, second);
      assert.equal(latest?.status, 'running');
    });

    it('updates a run\'s state whole, but never a cancelled run\'s back from cancelled', async (t) => {
      const { store, repo } = await setup(t);
      const id = uuidv7();
      const state: DataflowExecutionState = {
        release: E3_RELEASE, id, repo, workspace: 'ws', startedAt: new Date(), force: false, filter: none,
        graph: none, graphHash: none, tasks: new Map(), executed: 0n, cached: 0n, failed: 0n, skipped: 0n,
        status: 'running', completedAt: none, error: none, versionVectors: new Map(), inputSnapshot: new Map(),
        taskOutputPaths: [], reexecuted: 0n, events: [], eventSeq: 0n,
      };
      await store.create(state);
      await store.update({ ...state, executed: 2n, cached: 1n });
      assert.equal((await store.read(repo, 'ws', id))?.executed, 2n);

      await store.updateStatus(repo, 'ws', id, 'cancelled', { error: 'Execution was cancelled' });
      // A run's loop may persist what it had in memory after a cancel has
      // landed: the run stays cancelled.
      await store.update({ ...state, executed: 3n });
      const cancelled = await store.read(repo, 'ws', id);
      assert.equal(cancelled?.status, 'cancelled');
      assert.equal(cancelled?.executed, 2n);
      await store.update({ ...state, status: 'cancelled', executed: 4n });
      assert.equal((await store.read(repo, 'ws', id))?.executed, 4n, 'a cancelled state replaces a cancelled one');
    });

    it('sets a run\'s status, ending it unless it is running, with its error and its summary', async (t) => {
      const { store, repo } = await setup(t);
      const id = uuidv7();
      await store.create({
        release: E3_RELEASE, id, repo, workspace: 'ws', startedAt: new Date(), force: false, filter: none,
        graph: none, graphHash: none, tasks: new Map(), executed: 0n, cached: 0n, failed: 0n, skipped: 0n,
        status: 'running', completedAt: none, error: none, versionVectors: new Map(), inputSnapshot: new Map(),
        taskOutputPaths: [], reexecuted: 0n, events: [], eventSeq: 0n,
      });
      await store.updateStatus(repo, 'ws', id, 'failed', { error: 'etl failed', summary: { executed: 3, cached: 2, failed: 1, skipped: 4 } });

      const ended = await store.read(repo, 'ws', id);
      assert.equal(ended?.status, 'failed');
      assert.equal(ended?.completedAt.type, 'some');
      assert.deepEqual(ended?.error, some('etl failed'));
      assert.deepEqual([ended?.executed, ended?.cached, ended?.failed, ended?.skipped], [3n, 2n, 1n, 4n]);
      await assert.rejects(store.updateStatus(repo, 'ws', uuidv7(), 'completed'), 'a run it does not hold');
    });

    it('sets a task\'s status with what it finished with, and counts it in the run\'s summary', async (t) => {
      const { store, repo } = await setup(t);
      const id = uuidv7();
      await store.create({
        release: E3_RELEASE, id, repo, workspace: 'ws', startedAt: new Date(), force: false, filter: none,
        graph: none, graphHash: none,
        tasks: new Map([
          ['ran', {
            name: 'ran', status: 'in_progress', cached: none, outputHash: none, error: none, exitCode: none,
            startedAt: some(new Date()), completedAt: none, duration: none, plan: none, execution: none,
          }],
          ['served', {
            name: 'served', status: 'ready', cached: none, outputHash: none, error: none, exitCode: none,
            startedAt: none, completedAt: none, duration: none, plan: none, execution: none,
          }],
          ['broke', {
            name: 'broke', status: 'in_progress', cached: none, outputHash: none, error: none, exitCode: none,
            startedAt: some(new Date()), completedAt: none, duration: none, plan: none, execution: none,
          }],
        ]),
        executed: 0n, cached: 0n, failed: 0n, skipped: 0n, status: 'running', completedAt: none, error: none,
        versionVectors: new Map(), inputSnapshot: new Map(), taskOutputPaths: [], reexecuted: 0n, events: [], eventSeq: 0n,
      });
      await store.updateTaskStatus(repo, 'ws', id, 'ran', 'completed', { cached: false, outputHash: 'c'.repeat(64), duration: 120 });
      await store.updateTaskStatus(repo, 'ws', id, 'served', 'completed', { cached: true, outputHash: 'd'.repeat(64) });
      await store.updateTaskStatus(repo, 'ws', id, 'broke', 'failed', { error: 'exit code 2', exitCode: 2, duration: 30 });

      const state = await store.read(repo, 'ws', id);
      const ran = state?.tasks.get('ran');
      assert.equal(ran?.status, 'completed');
      assert.deepEqual([ran?.cached, ran?.outputHash, ran?.duration], [some(false), some('c'.repeat(64)), some(120n)]);
      assert.equal(ran?.completedAt.type, 'some');
      const broke = state?.tasks.get('broke');
      assert.deepEqual([broke?.status, broke?.error, broke?.exitCode], ['failed', some('exit code 2'), some(2n)]);
      assert.deepEqual([state?.executed, state?.cached, state?.failed], [1n, 1n, 1n], 'each counted as it finished');

      await assert.rejects(store.updateTaskStatus(repo, 'ws', id, 'unknown', 'completed'), 'a task the run does not have');
      await assert.rejects(store.updateTaskStatus(repo, 'ws', uuidv7(), 'ran', 'completed'), 'a run it does not hold');
    });

    it('records a run\'s events, and reads those after a sequence number', async (t) => {
      const { store, repo } = await setup(t);
      const id = uuidv7();
      await store.create({
        release: E3_RELEASE, id, repo, workspace: 'ws', startedAt: new Date(), force: false, filter: none,
        graph: none, graphHash: none, tasks: new Map(), executed: 0n, cached: 0n, failed: 0n, skipped: 0n,
        status: 'running', completedAt: none, error: none, versionVectors: new Map(), inputSnapshot: new Map(),
        taskOutputPaths: [], reexecuted: 0n, events: [], eventSeq: 0n,
      });
      await store.recordEvent(repo, 'ws', id, variant('execution_started', { seq: 1n, timestamp: new Date(), executionId: id, totalTasks: 1n }));
      await store.recordEvent(repo, 'ws', id, variant('task_started', { seq: 2n, timestamp: new Date(), task: 'etl' }));
      await store.recordEvent(repo, 'ws', id, variant('task_ready', { seq: 3n, timestamp: new Date(), task: 'report' }));

      const since = await store.getEventsSince(repo, 'ws', id, 1);
      assert.deepEqual(since.map((event) => [event.type, event.value.seq]), [['task_started', 2n], ['task_ready', 3n]]);
      assert.equal((await store.read(repo, 'ws', id))?.events.length, 3, 'the events are the run\'s state\'s');
      assert.deepEqual(await store.getEventsSince(repo, 'ws', uuidv7(), 0), [], 'a run it does not hold has none');
    });

    it('deletes a run\'s state by its id, and no other run\'s', async (t) => {
      const { store, repo } = await setup(t);
      const id = uuidv7();
      await store.create({
        release: E3_RELEASE, id, repo, workspace: 'ws', startedAt: new Date(), force: false, filter: none,
        graph: none, graphHash: none, tasks: new Map(), executed: 0n, cached: 0n, failed: 0n, skipped: 0n,
        status: 'completed', completedAt: some(new Date()), error: none, versionVectors: new Map(), inputSnapshot: new Map(),
        taskOutputPaths: [], reexecuted: 0n, events: [], eventSeq: 0n,
      });
      await store.delete(repo, 'ws', uuidv7());
      assert.equal((await store.read(repo, 'ws', id))?.id, id, 'deleting another id leaves the run');
      await store.delete(repo, 'ws', id);
      assert.equal(await store.read(repo, 'ws', id), null);
      assert.equal(await store.readLatest(repo, 'ws'), null);
    });

    it('answers a read with a state it does not share: a change to one read never reaches the next', async (t) => {
      const { store, repo } = await setup(t);
      const id = uuidv7();
      await store.create({
        release: E3_RELEASE, id, repo, workspace: 'ws', startedAt: new Date(), force: false, filter: none,
        graph: none, graphHash: none,
        tasks: new Map([['etl', {
          name: 'etl', status: 'pending', cached: none, outputHash: none, error: none, exitCode: none,
          startedAt: none, completedAt: none, duration: none, plan: none, execution: none,
        }]]),
        executed: 0n, cached: 0n, failed: 0n, skipped: 0n, status: 'running', completedAt: none, error: none,
        versionVectors: new Map([['.x', new Map([['.x', 'hash-1']])]]), inputSnapshot: new Map([['.input', 'hash-1']]),
        taskOutputPaths: ['.output'], reexecuted: 0n, events: [], eventSeq: 0n,
      });

      const changed = (await store.read(repo, 'ws', id))!;
      changed.versionVectors.get('.x')!.set('.y', 'leaked');
      changed.inputSnapshot.set('.leaked', 'bad');
      changed.taskOutputPaths.push('.leaked');
      (changed.tasks.get('etl') as { status: string }).status = 'completed';

      const again = (await store.read(repo, 'ws', id))!;
      assert.equal(again.versionVectors.get('.x')!.has('.y'), false);
      assert.equal(again.inputSnapshot.has('.leaked'), false);
      assert.deepEqual(again.taskOutputPaths, ['.output']);
      assert.equal(again.tasks.get('etl')?.status, 'pending');
    });
  });
}
