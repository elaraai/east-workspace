/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A run that stops after its cancel answers (#1286): its poll answers it
 * `stopping` while its store says a cancel was requested, or once it has ended
 * while it still holds the dataflow lock it took as it started, and a start or a
 * workspace's removal the workspace's lock refuses while a stopping run holds
 * it is answered `workspace_locked` with a `Retry-After` — one asked to stop
 * that has not, or one that has ended and still holds the dataflow lock it took
 * as it started. Any other holder's refusal names no wait.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { NullType, decodeBeast2For, encodeBeast2For, none, some, variant } from '@elaraai/east';
import {
  InMemoryStateStore, LocalOrchestrator, MockTaskRunner, WorkspaceLockError, workspaceCreate,
  type DataflowExecutionState, type DataflowOrchestrator, type ExecutionStateStore,
} from '@elaraai/e3-core';
import { InMemoryStorage } from '@elaraai/e3-core/test';
import { BEAST2_CONTENT_TYPE, E3_RELEASE, dataflowForce } from '@elaraai/e3-types';
import { deleteWorkspace } from './handlers/workspaces.js';
import { createExecutionRoutes } from './routes/executions.js';
import { heldByStoppingRun } from './stopping-run.js';
import { DataflowExecutionStateType, DataflowRequestType, ResponseType } from './types.js';

const REPO = 'test-repo';
const WS = 'main';

/** A run's state, of no tasks, in workspace `main`, which ended at `completedAt` if given. */
function runState(id: string, status: 'running' | 'completed' | 'cancelled', completedAt?: Date): DataflowExecutionState {
  return {
    release: E3_RELEASE, id, repo: REPO, workspace: WS, startedAt: new Date(Date.now() - 60_000), force: dataflowForce(false), filter: none,
    graph: none, graphHash: none, tasks: new Map(), executed: 0n, cached: 0n, failed: 0n, skipped: 0n, status,
    completedAt: completedAt === undefined ? none : some(completedAt), error: none, versionVectors: new Map(), inputSnapshot: new Map(),
    taskOutputPaths: [], reexecuted: 0n, events: [], eventSeq: 0n,
  };
}

/**
 * A store whose running runs a cancel was asked of, as a store of a server
 * whose tasks run elsewhere says, until they end.
 */
function cancelling(inner: ExecutionStateStore): ExecutionStateStore {
  return {
    create: (state) => inner.create(state),
    read: (repo, workspace, id) => inner.read(repo, workspace, id),
    readLatest: (repo, workspace) => inner.readLatest(repo, workspace),
    readLatestSummary: async (repo, workspace) => {
      const summary = await inner.readLatestSummary(repo, workspace);
      return summary === null ? null : { ...summary, cancelRequested: summary.status === 'running' };
    },
    update: (state) => inner.update(state),
    updateTaskStatus: (repo, workspace, id, task, status, details) => inner.updateTaskStatus(repo, workspace, id, task, status, details),
    updateStatus: (repo, workspace, id, status, details) => inner.updateStatus(repo, workspace, id, status, details),
    recordEvent: (repo, workspace, id, event) => inner.recordEvent(repo, workspace, id, event),
    getEventsSince: (repo, workspace, id, since, limit) => inner.getEventsSince(repo, workspace, id, since, limit),
    delete: (repo, workspace, id) => inner.delete(repo, workspace, id),
    readStored: (repo) => inner.readStored(repo),
  };
}

/** The dataflow lock a run takes as it starts, as a run holds it. */
async function holdDataflowLock(storage: InMemoryStorage): Promise<{ release(): Promise<void> }> {
  const lock = await storage.locks.acquire(REPO, `${WS}#dataflow`, variant('dataflow', null));
  if (lock === null) assert.fail('the dataflow lock was held');
  return lock;
}

describe('a run that is stopping (#1286)', () => {
  it('holds its workspace while it is asked to stop and has not, or has ended and still holds its dataflow lock', async () => {
    const storage = new InMemoryStorage();
    const store = new InMemoryStateStore();
    assert.equal(await heldByStoppingRun(storage, store, REPO, WS), false, 'no run');

    await store.create(runState('run-1', 'running'));
    assert.equal(await heldByStoppingRun(storage, store, REPO, WS), false, 'a run that runs');
    assert.equal(await heldByStoppingRun(storage, cancelling(store), REPO, WS), true, 'a run asked to stop');

    const lock = await holdDataflowLock(storage);
    await store.updateStatus(REPO, WS, 'run-1', 'cancelled');
    await store.create(runState('run-2', 'cancelled', new Date(Date.now() + 1_000)));
    assert.equal(await heldByStoppingRun(storage, store, REPO, WS), true, 'a run that has ended, its dataflow lock taken before its end still held');
    await lock.release();
    assert.equal(await heldByStoppingRun(storage, store, REPO, WS), false, 'a run that has let go');

    await store.create(runState('run-3', 'cancelled', new Date(Date.now() - 1_000)));
    const later = await holdDataflowLock(storage);
    assert.equal(await heldByStoppingRun(storage, store, REPO, WS), false, 'a dataflow lock taken after the run ended is another\'s');
    await later.release();
  });

  it('is polled as stopping until it has stopped', async () => {
    const inner = new InMemoryStateStore();
    await inner.create(runState('run-1', 'running'));
    const app = new Hono();
    const store = cancelling(inner);
    app.route('/api/repos/:repo/workspaces/:ws/dataflow', createExecutionRoutes(new InMemoryStorage(), () => REPO, {
      getRunner: () => new MockTaskRunner(),
      getOrchestrator: () => new LocalOrchestrator(store),
      getStateStore: () => store,
    }));
    const poll = async () => {
      const answer = decodeBeast2For(ResponseType(DataflowExecutionStateType))(
        new Uint8Array(await (await app.request(`/api/repos/r/workspaces/${WS}/dataflow/execution?limit=0`)).arrayBuffer()));
      if (answer.type !== 'success') assert.fail(`the poll was refused: ${answer.value.type}`);
      return answer.value.status.type;
    };
    assert.equal(await poll(), 'stopping');
    await inner.updateStatus(REPO, WS, 'run-1', 'cancelled');
    assert.equal(await poll(), 'aborted');
  });

  it('is polled as stopping once it has ended until it lets its workspace go, and as ended after', async () => {
    const storage = new InMemoryStorage();
    const store = new InMemoryStateStore();
    const app = new Hono();
    app.route('/api/repos/:repo/workspaces/:ws/dataflow', createExecutionRoutes(storage, () => REPO, {
      getRunner: () => new MockTaskRunner(),
      getOrchestrator: () => new LocalOrchestrator(store),
      getStateStore: () => store,
    }));
    const poll = async () => {
      const answer = decodeBeast2For(ResponseType(DataflowExecutionStateType))(
        new Uint8Array(await (await app.request(`/api/repos/r/workspaces/${WS}/dataflow/execution?limit=0`)).arrayBuffer()));
      if (answer.type !== 'success') assert.fail(`the poll was refused: ${answer.value.type}`);
      return { status: answer.value.status.type, ended: answer.value.summary.type === 'some' };
    };

    // A run that has recorded its end, and still holds the dataflow lock it
    // took as it started: a gc asked of now would be refused.
    const lock = await holdDataflowLock(storage);
    await store.create(runState('run-1', 'completed', new Date(Date.now() + 1_000)));
    assert.deepEqual(await poll(), { status: 'stopping', ended: true });
    await lock.release();
    assert.deepEqual(await poll(), { status: 'completed', ended: true });

    // A dataflow lock taken after a run ended is another's: the run has let go.
    await store.create(runState('run-2', 'cancelled', new Date(Date.now() - 1_000)));
    const later = await holdDataflowLock(storage);
    assert.deepEqual(await poll(), { status: 'aborted', ended: true });
    await later.release();
  });

  it('refuses a start with a Retry-After while it holds the workspace, and with none while a run that runs does', async () => {
    const inner = new InMemoryStateStore();
    await inner.create(runState('run-1', 'running'));
    const refusing: DataflowOrchestrator = {
      start: () => Promise.reject(new WorkspaceLockError(WS)),
      wait: () => new Promise(() => {}),
      getStatus: () => Promise.reject(new Error('not polled')),
      getProgress: () => Promise.reject(new Error('not polled')),
      cancel: async () => {},
      getEvents: async () => [],
    };
    const start = async (store: ExecutionStateStore) => {
      const app = new Hono();
      app.route('/api/repos/:repo/workspaces/:ws/dataflow', createExecutionRoutes(new InMemoryStorage(), () => REPO, {
        getRunner: () => new MockTaskRunner(),
        getOrchestrator: () => refusing,
        getStateStore: () => store,
      }));
      const response = await app.request(`/api/repos/r/workspaces/${WS}/dataflow`, {
        method: 'POST',
        headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
        body: encodeBeast2For(DataflowRequestType)({ force: dataflowForce(false), filter: none }),
      });
      const answer = decodeBeast2For(ResponseType(NullType))(new Uint8Array(await response.arrayBuffer()));
      return { refused: answer.type === 'error' ? answer.value.type : null, retryAfter: response.headers.get('retry-after') };
    };
    assert.deepEqual(await start(cancelling(inner)), { refused: 'workspace_locked', retryAfter: '1' });
    assert.deepEqual(await start(inner), { refused: 'workspace_locked', retryAfter: null });
  });

  it('refuses a workspace\'s removal with a Retry-After while it still holds the workspace, and with none for another holder', async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create(REPO);
    await workspaceCreate(storage, REPO, WS);
    const remove = async () => {
      const response = await deleteWorkspace(storage, REPO, WS);
      const answer = decodeBeast2For(ResponseType(NullType))(new Uint8Array(await response.arrayBuffer()));
      return { refused: answer.type === 'error' ? answer.value.type : null, retryAfter: response.headers.get('retry-after') };
    };

    // A deploy holds the workspace: no wait to name.
    const deploying = await storage.locks.acquire(REPO, WS, variant('deployment', null));
    assert.deepEqual(await remove(), { refused: 'workspace_locked', retryAfter: null });
    await deploying!.release();

    // A run that ended still holds the workspace, and the dataflow lock it took first.
    const run = await holdDataflowLock(storage);
    const shared = await storage.locks.acquire(REPO, WS, variant('dataflow', null), { mode: 'shared' });
    await storage.runStates(REPO).create(runState('run-1', 'cancelled', new Date(Date.now() + 1_000)));
    assert.deepEqual(await remove(), { refused: 'workspace_locked', retryAfter: '1' });

    await shared!.release();
    await run.release();
    assert.deepEqual(await remove(), { refused: null, retryAfter: null }, 'removed once the run has let go');
  });

  it('names a wait for a refusal the run lets go of its locks just after, before the server asks why', async () => {
    const answered = async (response: Response) => {
      const answer = decodeBeast2For(ResponseType(NullType))(new Uint8Array(await response.arrayBuffer()));
      return { refused: answer.type === 'error' ? answer.value.type : null, retryAfter: response.headers.get('retry-after') };
    };

    // A removal: the run that ended holds the workspace and its dataflow lock,
    // and lets go of both as the workspace's lock refuses the removal.
    const storage = new InMemoryStorage();
    await storage.repos.create(REPO);
    await workspaceCreate(storage, REPO, WS);
    const run = await holdDataflowLock(storage);
    const shared = await storage.locks.acquire(REPO, WS, variant('dataflow', null), { mode: 'shared' });
    await storage.runStates(REPO).create(runState('run-1', 'cancelled', new Date(Date.now() + 1_000)));
    const acquire = storage.locks.acquire.bind(storage.locks);
    mock.method(storage.locks, 'acquire', async (...args: Parameters<typeof acquire>) => {
      const lock = await acquire(...args);
      if (lock === null && args[1] === WS) {
        await shared!.release();
        await run.release();
      }
      return lock;
    });
    assert.deepEqual(await answered(await deleteWorkspace(storage, REPO, WS)), { refused: 'workspace_locked', retryAfter: '1' });

    // A start: the run lets go of its dataflow lock as the orchestrator is refused.
    const starting = new InMemoryStorage();
    const dataflowLock = await holdDataflowLock(starting);
    const store = new InMemoryStateStore();
    await store.create(runState('run-2', 'cancelled', new Date(Date.now() + 1_000)));
    const lettingGo: DataflowOrchestrator = {
      start: async () => {
        await dataflowLock.release();
        throw new WorkspaceLockError(WS);
      },
      wait: () => new Promise(() => {}),
      getStatus: () => Promise.reject(new Error('not polled')),
      getProgress: () => Promise.reject(new Error('not polled')),
      cancel: async () => {},
      getEvents: async () => [],
    };
    const app = new Hono();
    app.route('/api/repos/:repo/workspaces/:ws/dataflow', createExecutionRoutes(starting, () => REPO, {
      getRunner: () => new MockTaskRunner(),
      getOrchestrator: () => lettingGo,
      getStateStore: () => store,
    }));
    const response = await app.request(`/api/repos/r/workspaces/${WS}/dataflow`, {
      method: 'POST',
      headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
      body: encodeBeast2For(DataflowRequestType)({ force: dataflowForce(false), filter: none }),
    });
    assert.deepEqual(await answered(response), { refused: 'workspace_locked', retryAfter: '1' });
  });
});
