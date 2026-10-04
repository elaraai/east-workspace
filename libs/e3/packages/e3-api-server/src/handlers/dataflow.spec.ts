/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The dataflow routes run, poll and cancel a dataflow through the seams their
 * host gives — its orchestrator, and the state store the orchestrator writes —
 * as e3-cloud mounts them over its own; and they serve the budget the host's
 * runner holds. And a server's budget settings that do not resolve refuse the
 * server.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { NullType, OptionType, decodeBeast2For, encodeBeast2For, none, some, variant } from '@elaraai/east';
import {
  Budget, InMemoryStateStore, LocalOrchestrator, MockTaskRunner, stateToStatus,
  type DataflowExecutionState, type DataflowOrchestrator, type ExecutionStateStore,
} from '@elaraai/e3-core';
import { InMemoryStorage } from '@elaraai/e3-core/test';
import { BEAST2_CONTENT_TYPE, E3_RELEASE, dataflowForce } from '@elaraai/e3-types';
import { createExecutionRoutes } from '../routes/executions.js';
import { createServer } from '../server.js';
import { DataflowBudgetType, DataflowExecutionStateType, DataflowRequestType, ResponseType } from '../types.js';

/** A run's state, of no tasks, in workspace `main` of `test-repo`. */
function runState(id: string, status: 'running' | 'completed' | 'failed' | 'cancelled'): DataflowExecutionState {
  return {
    release: E3_RELEASE, id, repo: 'test-repo', workspace: 'main', startedAt: new Date(Date.now() - 1000), force: dataflowForce(false), filter: none,
    graph: none, graphHash: none, tasks: new Map(), executed: 0n, cached: 0n, failed: 0n, skipped: 0n, status,
    completedAt: none, error: none, versionVectors: new Map(), inputSnapshot: new Map(), taskOutputPaths: [], reexecuted: 0n,
    events: [], eventSeq: 0n,
  };
}

/**
 * A state store that records the reads made of it, as a poll makes them: of
 * the whole state, of a run's summary, and of its events.
 */
function countingStore(inner: ExecutionStateStore): { store: ExecutionStateStore; reads: string[] } {
  const reads: string[] = [];
  const store: ExecutionStateStore = {
    create: (state) => inner.create(state),
    read: (repo, workspace, id) => {
      reads.push('read');
      return inner.read(repo, workspace, id);
    },
    readLatest: (repo, workspace) => {
      reads.push('readLatest');
      return inner.readLatest(repo, workspace);
    },
    readLatestSummary: (repo, workspace) => {
      reads.push('readLatestSummary');
      return inner.readLatestSummary(repo, workspace);
    },
    update: (state) => inner.update(state),
    updateTaskStatus: (repo, workspace, id, task, status, details) => inner.updateTaskStatus(repo, workspace, id, task, status, details),
    updateStatus: (repo, workspace, id, status, details) => inner.updateStatus(repo, workspace, id, status, details),
    recordEvent: (repo, workspace, id, event) => inner.recordEvent(repo, workspace, id, event),
    getEventsSince: (repo, workspace, id, since) => {
      reads.push('getEventsSince');
      return inner.getEventsSince(repo, workspace, id, since);
    },
    delete: (repo, workspace, id) => inner.delete(repo, workspace, id),
    readStored: (repo) => inner.readStored(repo),
  };
  return { store, reads };
}

describe('dataflow routes', () => {
  it('start, poll and cancel a run through the orchestrator and the state store their host gives', async () => {
    // A host's own orchestrator, which records its run in the host's store.
    const stateStore = new InMemoryStateStore();
    const cancelled: string[] = [];
    const orchestrator: DataflowOrchestrator = {
      start: async (_storage, repo, workspace) => {
        await stateStore.create({
          release: E3_RELEASE, id: 'run-1', repo, workspace, startedAt: new Date(Date.now() - 1000), force: dataflowForce(false), filter: none,
          graph: none, graphHash: none, tasks: new Map(), executed: 0n, cached: 0n, failed: 0n, skipped: 0n, status: 'running',
          completedAt: none, error: none, versionVectors: new Map(), inputSnapshot: new Map(), taskOutputPaths: [], reexecuted: 0n,
          events: [], eventSeq: 0n,
        });
        return { id: 'run-1', repo, workspace };
      },
      wait: () => new Promise(() => {}),
      getStatus: async (handle) => stateToStatus((await stateStore.read(handle.repo, handle.workspace, handle.id))!),
      getProgress: () => Promise.resolve({
        waiting: [{ task: 'train', unit: none, needs: 1024n, since: new Date(0).toISOString() }],
        splits: [],
      }),
      cancel: async (handle) => {
        cancelled.push(handle.id);
        await stateStore.updateStatus(handle.repo, handle.workspace, handle.id, 'cancelled');
      },
      getEvents: async () => [],
    };
    const app = new Hono();
    app.route('/api/repos/:repo/workspaces/:ws/dataflow', createExecutionRoutes(new InMemoryStorage(), () => 'test-repo', {
      getRunner: () => new MockTaskRunner(),
      getOrchestrator: () => orchestrator,
      getStateStore: () => stateStore,
    }));
    const decodeNull = decodeBeast2For(ResponseType(NullType));
    const decodeState = decodeBeast2For(ResponseType(DataflowExecutionStateType));
    const post = async (path: string, body?: Uint8Array) => decodeNull(new Uint8Array(await (await app.request(`/api/repos/r/workspaces/main/dataflow${path}`, {
      method: 'POST',
      headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
      ...(body !== undefined && { body }),
    })).arrayBuffer()));
    const poll = async () => decodeState(new Uint8Array(await (await app.request('/api/repos/r/workspaces/main/dataflow/execution')).arrayBuffer()));

    assert.equal((await post('', encodeBeast2For(DataflowRequestType)({ force: dataflowForce(false), filter: none }))).type, 'success');
    const running = await poll();
    if (running.type !== 'success') assert.fail(`the poll was refused: ${running.value.type}`);
    assert.equal(running.value.status.type, 'running');
    assert.deepEqual(running.value.waiting.map((wait) => wait.task), ['train'], 'the orchestrator running the run answers its waits');

    assert.equal((await post('/cancel')).type, 'success');
    assert.deepEqual(cancelled, ['run-1'], 'the host\'s orchestrator cancels the run its state names');
    const ended = await poll();
    if (ended.type !== 'success') assert.fail(`the poll was refused: ${ended.value.type}`);
    assert.equal(ended.value.status.type, 'aborted');

    const again = await post('/cancel');
    assert.equal(again.type, 'error', 'no run is running');
  });

  it('start a run and leave nothing of it in the request\'s host: the orchestrator\'s wait is never called', async () => {
    // A host whose runs execute elsewhere: its wait lasts as long as the run,
    // so a route that called it would hold the host for the whole run.
    let waits = 0;
    const orchestrator: DataflowOrchestrator = {
      start: async (_storage, repo, workspace) => ({ id: 'run-1', repo, workspace }),
      wait: () => {
        waits++;
        throw new Error('the route waited on a run another host executes');
      },
      getStatus: () => Promise.reject(new Error('not polled')),
      getProgress: () => Promise.reject(new Error('not polled')),
      cancel: async () => {},
      getEvents: async () => [],
    };
    const app = new Hono();
    app.route('/api/repos/:repo/workspaces/:ws/dataflow', createExecutionRoutes(new InMemoryStorage(), () => 'test-repo', {
      getRunner: () => new MockTaskRunner(),
      getOrchestrator: () => orchestrator,
      getStateStore: () => new InMemoryStateStore(),
    }));

    const response = await app.request('/api/repos/r/workspaces/main/dataflow', {
      method: 'POST',
      headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
      body: encodeBeast2For(DataflowRequestType)({ force: dataflowForce(false), filter: none }),
    });
    assert.equal(response.status, 202);
    assert.equal(decodeBeast2For(ResponseType(NullType))(new Uint8Array(await response.arrayBuffer())).type, 'success');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(waits, 0);
  });

  it('poll a run by its cursor: the API\'s events past it, at most a limit, and the cursor past them, reading the run\'s summary and no more than its new events', async () => {
    const { store, reads } = countingStore(new InMemoryStateStore());
    const at = new Date(0);
    // Seven events, three the API does not show: the run's start and end, and
    // a task made ready
    await store.create({
      ...runState('run-1', 'failed'),
      completedAt: some(at),
      events: [
        variant('execution_started', { seq: 1n, timestamp: at, executionId: 'run-1', totalTasks: 2n }),
        variant('task_started', { seq: 2n, timestamp: at, task: 'etl' }),
        variant('task_completed', { seq: 3n, timestamp: at, task: 'etl', cached: false, outputHash: 'a'.repeat(64), duration: 5n, peakBytes: none }),
        variant('task_ready', { seq: 4n, timestamp: at, task: 'report' }),
        variant('task_started', { seq: 5n, timestamp: at, task: 'report' }),
        variant('task_failed', { seq: 6n, timestamp: at, task: 'report', error: none, exitCode: some(1n), duration: 7n }),
        variant('execution_completed', { seq: 7n, timestamp: at, success: false, executed: 1n, cached: 0n, failed: 1n, skipped: 0n, duration: 12n }),
      ],
      eventSeq: 7n,
    });
    const app = new Hono();
    app.route('/api/repos/:repo/workspaces/:ws/dataflow', createExecutionRoutes(new InMemoryStorage(), () => 'test-repo', {
      getRunner: () => new MockTaskRunner(),
      getOrchestrator: () => new LocalOrchestrator(store),
      getStateStore: () => store,
    }));
    const decodeState = decodeBeast2For(ResponseType(DataflowExecutionStateType));
    const poll = async (query: string) => {
      reads.length = 0;
      const answer = decodeState(new Uint8Array(await (await app.request(`/api/repos/r/workspaces/main/dataflow/execution${query}`)).arrayBuffer()));
      if (answer.type !== 'success') assert.fail(`the poll ${query} was refused: ${answer.value.type}`);
      return { events: answer.value.events.map((event) => `${event.type} ${event.value.task}`), nextSeq: answer.value.nextSeq, reads: [...reads] };
    };

    assert.deepEqual(await poll(''), {
      events: ['start etl', 'complete etl', 'start report', 'failed report'], nextSeq: 7n, reads: ['readLatestSummary', 'getEventsSince'],
    });
    assert.deepEqual(await poll('?since=7'), { events: [], nextSeq: 7n, reads: ['readLatestSummary'] }, 'a poll that has every event reads none');
    assert.deepEqual(await poll('?limit=0'), { events: [], nextSeq: 0n, reads: ['readLatestSummary'] }, 'nor does one that asks for none');
    assert.deepEqual(await poll('?limit=1'), { events: ['start etl'], nextSeq: 2n, reads: ['readLatestSummary', 'getEventsSince'] });
    assert.deepEqual(await poll('?since=2&limit=2'), {
      events: ['complete etl', 'start report'], nextSeq: 5n, reads: ['readLatestSummary', 'getEventsSince'],
    }, 'the cursor moves past an event the API does not show between two it serves');
    assert.deepEqual(await poll('?since=5'), { events: ['failed report'], nextSeq: 7n, reads: ['readLatestSummary', 'getEventsSince'] });

    const refused = await app.request('/api/repos/r/workspaces/main/dataflow/execution?since=-1');
    assert.equal(refused.status, 400);
    assert.deepEqual(await refused.json(), { error: { type: 'bad_request', message: 'since must be a non-negative integer, got "-1"' } });
  });

  it('poll a run of more events than a poll is served: at most 1,000, however many it asks for, with the run\'s id and its last event, which say what a poll left', async () => {
    const store = new InMemoryStateStore();
    const at = new Date(0);
    await store.create({
      ...runState('run-1', 'completed'),
      completedAt: some(at),
      events: Array.from({ length: 1_500 }, (_, i) => variant('task_started', { seq: BigInt(i + 1), timestamp: at, task: `t${i + 1}` })),
      eventSeq: 1_500n,
    });
    const app = new Hono();
    app.route('/api/repos/:repo/workspaces/:ws/dataflow', createExecutionRoutes(new InMemoryStorage(), () => 'test-repo', {
      getRunner: () => new MockTaskRunner(),
      getOrchestrator: () => new LocalOrchestrator(store),
      getStateStore: () => store,
    }));
    const decodeState = decodeBeast2For(ResponseType(DataflowExecutionStateType));
    const poll = async (query: string) => {
      const answer = decodeState(new Uint8Array(await (await app.request(`/api/repos/r/workspaces/main/dataflow/execution${query}`)).arrayBuffer()));
      if (answer.type !== 'success') assert.fail(`the poll ${query} was refused: ${answer.value.type}`);
      const { runId, events, nextSeq, lastSeq } = answer.value;
      return { runId, served: events.length, first: events[0]?.value.task ?? null, nextSeq, lastSeq };
    };

    assert.deepEqual(await poll(''), { runId: 'run-1', served: 1_000, first: 't1', nextSeq: 1_000n, lastSeq: 1_500n }, 'a poll that names no limit');
    assert.deepEqual(await poll('?limit=5000'), { runId: 'run-1', served: 1_000, first: 't1', nextSeq: 1_000n, lastSeq: 1_500n }, 'one that names a larger');
    assert.deepEqual(await poll('?since=1000'), { runId: 'run-1', served: 500, first: 't1001', nextSeq: 1_500n, lastSeq: 1_500n }, 'the rest, from the cursor it left');
    assert.deepEqual(await poll('?limit=0'), { runId: 'run-1', served: 0, first: null, nextSeq: 0n, lastSeq: 1_500n }, 'a poll of no events sees where the run\'s events end');
  });

  it('poll a run up to the last event its summary names: one the run records after the summary is read is the next poll\'s', async () => {
    const inner = new InMemoryStateStore();
    const at = new Date(0);
    await inner.create({ ...runState('run-1', 'running'), events: [variant('task_started', { seq: 1n, timestamp: at, task: 'etl' })], eventSeq: 1n });
    // The run records its next event between the poll's read of its summary
    // and its read of the events.
    let races = true;
    const store: ExecutionStateStore = {
      ...countingStore(inner).store,
      getEventsSince: async (repo, workspace, id, since) => {
        if (races) {
          races = false;
          await inner.recordEvent(repo, workspace, id, variant('task_started', { seq: 2n, timestamp: at, task: 'report' }));
        }
        return inner.getEventsSince(repo, workspace, id, since);
      },
    };
    const app = new Hono();
    app.route('/api/repos/:repo/workspaces/:ws/dataflow', createExecutionRoutes(new InMemoryStorage(), () => 'test-repo', {
      getRunner: () => new MockTaskRunner(),
      getOrchestrator: () => new LocalOrchestrator(store),
      getStateStore: () => store,
    }));
    const decodeState = decodeBeast2For(ResponseType(DataflowExecutionStateType));
    const poll = async (query: string) => {
      const answer = decodeState(new Uint8Array(await (await app.request(`/api/repos/r/workspaces/main/dataflow/execution${query}`)).arrayBuffer()));
      if (answer.type !== 'success') assert.fail(`the poll ${query} was refused: ${answer.value.type}`);
      return [answer.value.events.map((event) => `${event.type} ${event.value.task}`), answer.value.nextSeq, answer.value.lastSeq];
    };

    assert.deepEqual(await poll(''), [['start etl'], 1n, 1n], 'the events its summary names, and no later one');
    assert.deepEqual(await poll('?since=1'), [['start report'], 2n, 2n], 'the next poll serves it');
  });

  it('poll a run another host runs without reading its state for the waits and progress, which only that host holds', async () => {
    const { store, reads } = countingStore(new InMemoryStateStore());
    await store.create(runState('run-1', 'running'));
    const app = new Hono();
    // This host's orchestrator, over the store the run is kept in, runs none
    // of the runs it is asked of.
    app.route('/api/repos/:repo/workspaces/:ws/dataflow', createExecutionRoutes(new InMemoryStorage(), () => 'test-repo', {
      getRunner: () => new MockTaskRunner(),
      getOrchestrator: () => new LocalOrchestrator(store),
      getStateStore: () => store,
    }));
    const answer = decodeBeast2For(ResponseType(DataflowExecutionStateType))(
      new Uint8Array(await (await app.request('/api/repos/r/workspaces/main/dataflow/execution')).arrayBuffer()));
    if (answer.type !== 'success') assert.fail(`the poll was refused: ${answer.value.type}`);
    assert.equal(answer.value.status.type, 'running');
    assert.deepEqual([answer.value.waiting, answer.value.splits], [[], []]);
    assert.deepEqual(reads, ['readLatestSummary'], 'the run\'s summary alone: it has no events past the cursor');
  });

  it('serve the budget a run gets, with what its runners hold now, and none when mounted without one', async () => {
    const decode = decodeBeast2For(ResponseType(OptionType(DataflowBudgetType)));
    const budgetOf = async (app: Hono) =>
      decode(new Uint8Array(await (await app.request('/api/repos/r/workspaces/main/dataflow/budget')).arrayBuffer()));
    const seams = {
      getRunner: () => new MockTaskRunner(),
      getOrchestrator: () => new LocalOrchestrator(),
      getStateStore: () => new InMemoryStateStore(),
    };

    const budget = new Budget({ cores: 3, memory: 4 * 1024 ** 3 });
    const held = await budget.acquire({ memory: 1024 ** 3 });
    const withBudget = new Hono();
    withBudget.route('/api/repos/:repo/workspaces/:ws/dataflow', createExecutionRoutes(new InMemoryStorage(), () => 'test-repo', {
      ...seams,
      width: budget.cores,
      budget,
    }));
    assert.deepEqual(await budgetOf(withBudget), variant('success', some({ cores: 3n, memory: 4n * 1024n ** 3n, coresInUse: 1n, memoryInUse: 1024n ** 3n })));
    held.release();

    const without = new Hono();
    without.route('/api/repos/:repo/workspaces/:ws/dataflow', createExecutionRoutes(new InMemoryStorage(), () => 'test-repo', seams));
    assert.deepEqual(await budgetOf(without), variant('success', none));
  });
});

describe('the server budget', () => {
  it('refuses settings that do not resolve, naming the flag', async () => {
    await assert.rejects(
      createServer({ singleRepoPath: '/nonexistent', budget: { jobs: '0' } }),
      { name: 'RangeError', message: "--jobs must be a positive integer, got '0'" },
    );
    await assert.rejects(
      createServer({ singleRepoPath: '/nonexistent', budget: { memory: 'lots' } }),
      { name: 'RangeError', message: "--memory must be a size in bytes, or with a K, M, G or T suffix (binary units, as 8G), got 'lots'" },
    );
  });
});
