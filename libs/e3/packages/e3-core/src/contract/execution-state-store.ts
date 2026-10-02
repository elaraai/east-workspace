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
import { equalFor, none, printFor, some, variant } from '@elaraai/east';
import { DataflowExecutionStateType, E3_RELEASE } from '@elaraai/e3-types';
import type { ExecutionStateStore } from '../dataflow/state-store/interfaces.js';
import type { DataflowExecutionState } from '../dataflow/types.js';
import { uuidv7 } from '../uuid.js';

/** A running run's state of one pending task, `etl`, in workspace `ws`. */
function runningState(repo: string, id: string): DataflowExecutionState {
  return {
    release: E3_RELEASE, id, repo, workspace: 'ws', startedAt: new Date(), force: false, filter: none,
    graph: none, graphHash: none,
    tasks: new Map([['etl', {
      name: 'etl', status: 'pending', cached: none, outputHash: none, error: none, exitCode: none,
      startedAt: none, completedAt: none, duration: none, plan: none, execution: none,
    }]]),
    executed: 0n, cached: 0n, failed: 0n, skipped: 0n, status: 'running', completedAt: none, error: none,
    versionVectors: new Map(), inputSnapshot: new Map(), taskOutputPaths: [], reexecuted: 0n, events: [], eventSeq: 0n,
  };
}

/** Asserts a run's state is the one it ended with, whole. */
function assertEndedAs(read: DataflowExecutionState | null, ended: DataflowExecutionState | null, what: string): void {
  assert.ok(read !== null && ended !== null, `${what}: the store holds the run`);
  const print = printFor(DataflowExecutionStateType);
  assert.ok(equalFor(DataflowExecutionStateType)(read, ended), `${what}: ${print(read)}, not the state it ended with, ${print(ended)}`);
}

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

    it('updates a run\'s state whole, and keeps a run that has ended as it ended: every later write is dropped, whatever it writes', async (t) => {
      const { store, repo } = await setup(t);
      for (const ended of ['completed', 'failed', 'cancelled'] as const) {
        const id = uuidv7();
        const state = runningState(repo, id);
        await store.create(state);
        assert.equal(await store.update({ ...state, executed: 2n, cached: 1n }), 'applied');
        assert.equal((await store.read(repo, 'ws', id))?.executed, 2n);

        assert.equal(await store.updateStatus(repo, 'ws', id, ended, { error: `the run ${ended}` }), 'applied');
        const atEnd = await store.read(repo, 'ws', id);
        assert.equal(atEnd?.status, ended);

        // A run's loop may persist what it had in memory after its end has
        // landed, and another process may end a run that has ended: the run
        // keeps the state it ended with, and every write says it was dropped.
        assert.equal(await store.update({ ...state, executed: 3n }), 'dropped', `a running state over a ${ended} run`);
        assert.equal(await store.update({ ...state, status: ended, executed: 4n }), 'dropped', `a ${ended} state over a ${ended} run`);
        for (const status of ['running', 'completed', 'failed', 'cancelled'] as const) {
          assert.equal(await store.updateStatus(repo, 'ws', id, status, { error: 'later' }), 'dropped', `${status} over a ${ended} run`);
        }
        assert.equal(await store.updateTaskStatus(repo, 'ws', id, 'etl', 'completed', { cached: false, outputHash: 'c'.repeat(64) }), 'dropped',
          `a task's status in a ${ended} run`);
        assert.equal(await store.recordEvent(repo, 'ws', id, variant('task_started', { seq: 1n, timestamp: new Date(), task: 'etl' })), 'dropped',
          `an event of a ${ended} run`);
        assertEndedAs(await store.read(repo, 'ws', id), atEnd, `a ${ended} run`);
      }
    });

    it('keeps a run as its end left it when writes of it are made at once: the end lands, and nothing after it', async (t) => {
      const { store, repo } = await setup(t);
      for (const ended of ['completed', 'failed', 'cancelled'] as const) {
        // A run's whole states, written at once, one of them its end: what a
        // store shared by more than one writer sees.
        const id = uuidv7();
        const state = runningState(repo, id);
        await store.create(state);
        const end: DataflowExecutionState = { ...state, status: ended, executed: 100n, completedAt: some(new Date()) };
        const writes = Array.from({ length: 16 }, (_, i) => i === 8 ? end : { ...state, executed: BigInt(i) });
        const outcomes = await Promise.all(writes.map((write) => store.update(write)));
        assert.equal(outcomes[8], 'applied', `the ${ended} write lands`);
        assert.ok(outcomes.every((outcome) => outcome === 'applied' || outcome === 'dropped'), `${ended}: every write applied or dropped`);
        const read = await store.read(repo, 'ws', id);
        assert.equal(read?.status, ended, `${ended}: no write made with it took the run back`);
        assert.equal(read?.executed, 100n, `${ended}: the state its end carried, whole`);

        // Its status, set at once with whole states, a task's status and an
        // event: the run keeps the state its end left, whatever lands around
        // it.
        const other = uuidv7();
        const running = runningState(repo, other);
        await store.create(running);
        const mixed = await Promise.all([
          store.update({ ...running, executed: 1n }),
          store.recordEvent(repo, 'ws', other, variant('task_started', { seq: 1n, timestamp: new Date(), task: 'etl' })),
          store.updateStatus(repo, 'ws', other, ended, { error: `the run ${ended}` }),
          store.updateTaskStatus(repo, 'ws', other, 'etl', 'completed', { cached: false, outputHash: 'd'.repeat(64) }),
          store.update({ ...running, executed: 2n }),
        ]);
        assert.equal(mixed[2], 'applied', `the ${ended} status lands`);
        const atEnd = await store.read(repo, 'ws', other);
        assert.equal(atEnd?.status, ended);
        assert.equal(await store.update({ ...running, executed: 3n }), 'dropped', `a write once ${ended} is dropped`);
        assertEndedAs(await store.read(repo, 'ws', other), atEnd, `a ${ended} run after writes made with its end`);
      }
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
