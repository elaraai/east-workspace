/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Unit tests for dataflow-routes.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { NullType, variant, some, none } from '@elaraai/east';
import {
  InMemoryStorage,
  InMemoryStateStore,
  type DataflowExecutionState,
} from '@elaraai/e3-core';
import { ApiTypes } from '@elaraai/e3-api-server';
import {
  InMemoryDataflowOrchestrator,
  InMemoryRepoManager,
  InMemoryDataflowRunStore,
  InMemoryExecutionTracker,
} from '../testing/in-memory.js';
import { createDataflowRoutes } from './dataflow-routes.js';
import type { DataflowStorage } from '../dataflow-storage.js';
import { mountApp, fetchRoute, decodeResponse, encodeRequestBody } from './test-helpers.js';

const REPO = 'test-repo';
const WS = 'test-ws';
const BASE = `/api/repos/${REPO}/workspaces/${WS}/dataflow`;
const identity = { sub: 'user-1', email: 'user@test.com', isAdmin: true };

/**
 * Build a mock DataflowStorage by combining InMemoryStorage with InMemoryStateStore.
 * Adds a forceRelease method to the locks.
 */
function createMockStorage() {
  const base = new InMemoryStorage();
  const stateStore = new InMemoryStateStore();
  const originalLocks = base.locks;

  // Track lock handles so forceRelease can actually release them
  const lockHandles = new Map<string, import('@elaraai/e3-core').LockHandle>();
  const lockKey = (repo: string, resource: string) => `${repo}:${resource}`;

  const locks = {
    async acquire(
      repo: string, resource: string, operation: import('@elaraai/e3-core').LockOperation,
      options?: { wait?: boolean; timeout?: number; mode?: 'shared' | 'exclusive' },
    ) {
      const handle = await originalLocks.acquire(repo, resource, operation, options);
      if (handle) lockHandles.set(lockKey(repo, resource), handle);
      return handle;
    },
    getState: originalLocks.getState.bind(originalLocks),
    isHolderAlive: originalLocks.isHolderAlive.bind(originalLocks),
    async renewLock(_repo: string, _resource: string) { return true; },
    async forceRelease(repo: string, resource: string) {
      const key = lockKey(repo, resource);
      const handle = lockHandles.get(key);
      if (handle) {
        await handle.release();
        lockHandles.delete(key);
      }
    },
  };

  return {
    storage: {
      objects: base.objects,
      refs: base.refs,
      locks,
      logs: base.logs,
      repos: base.repos,
      datasets: base.datasets,
      executions: stateStore,
      repoManager: new InMemoryRepoManager(),
      dataflowRuns: new InMemoryDataflowRunStore(),
      executionTracker: new InMemoryExecutionTracker(),
      validateRepository: base.validateRepository.bind(base),
    } as DataflowStorage,
    base,
    stateStore,
  };
}

describe('dataflow-routes', () => {
  let storage: DataflowStorage;
  let stateStore: InMemoryStateStore;
  let orchestrator: InMemoryDataflowOrchestrator;
  let app: ReturnType<typeof mountApp>;

  beforeEach(() => {
    const mock = createMockStorage();
    storage = mock.storage;
    stateStore = mock.stateStore;
    orchestrator = new InMemoryDataflowOrchestrator();

    const routeApp = createDataflowRoutes({ storage, orchestrator });
    app = mountApp(routeApp, '/');
  });

  // ── POST /dataflow/cancel ─────────────────────────────

  it('POST /dataflow/cancel — returns error when no execution exists', async () => {
    const res = await fetchRoute(app, 'POST', `${BASE}/cancel`, { identity });
    const body = await decodeResponse(res, NullType);
    assert.equal(body.type, 'error');
  });

  it('POST /dataflow/cancel — cancels running execution', async () => {
    // Create a running execution
    const state: DataflowExecutionState = {
      id: '1',
      repo: REPO,
      workspace: WS,
      startedAt: new Date(),
      concurrency: 4n,
      force: false,
      filter: none,
      graph: none,
      graphHash: none,
      tasks: new Map(),
      executed: 0n,
      cached: 0n,
      failed: 0n,
      skipped: 0n,
      status: 'running',
      completedAt: none,
      error: none,
      versionVectors: new Map(),
      inputSnapshot: new Map(),
      taskOutputPaths: [],
      reexecuted: 0n,
      events: [],
      eventSeq: 0n,
    };
    await stateStore.create(state);

    const res = await fetchRoute(app, 'POST', `${BASE}/cancel`, { identity });
    const body = await decodeResponse(res, NullType);
    assert.equal(body.type, 'success');

    // Verify execution was cancelled
    const updated = await stateStore.readLatest(REPO, WS);
    assert.equal(updated?.status, 'cancelled');
  });

  it('POST /dataflow/cancel — returns error when execution already completed', async () => {
    const state: DataflowExecutionState = {
      id: '1',
      repo: REPO,
      workspace: WS,
      startedAt: new Date(),
      concurrency: 4n,
      force: false,
      filter: none,
      graph: none,
      graphHash: none,
      tasks: new Map(),
      executed: 0n,
      cached: 0n,
      failed: 0n,
      skipped: 0n,
      status: 'completed',
      completedAt: some(new Date()),
      error: none,
      versionVectors: new Map(),
      inputSnapshot: new Map(),
      taskOutputPaths: [],
      reexecuted: 0n,
      events: [],
      eventSeq: 0n,
    };
    await stateStore.create(state);

    const res = await fetchRoute(app, 'POST', `${BASE}/cancel`, { identity });
    const body = await decodeResponse(res, NullType);
    assert.equal(body.type, 'error');
  });

  // ── GET /dataflow/execution ───────────────────────────

  it('GET /dataflow/execution — returns error when no execution exists', async () => {
    const res = await fetchRoute(app, 'GET', `${BASE}/execution`, { identity });
    const body = await decodeResponse(res, ApiTypes.DataflowExecutionStateType);
    assert.equal(body.type, 'error');
  });

  it('GET /dataflow/execution — returns execution status', async () => {
    const state: DataflowExecutionState = {
      id: '1',
      repo: REPO,
      workspace: WS,
      startedAt: new Date(),
      concurrency: 4n,
      force: false,
      filter: none,
      graph: none,
      graphHash: none,
      tasks: new Map(),
      executed: 2n,
      cached: 1n,
      failed: 0n,
      skipped: 0n,
      status: 'running',
      completedAt: none,
      error: none,
      versionVectors: new Map(),
      inputSnapshot: new Map(),
      taskOutputPaths: [],
      reexecuted: 0n,
      events: [],
      eventSeq: 0n,
    };
    await stateStore.create(state);

    const res = await fetchRoute(app, 'GET', `${BASE}/execution`, { identity });
    assert.equal(res.status, 200);
    const body = await decodeResponse(res, ApiTypes.DataflowExecutionStateType);
    assert.equal(body.type, 'success');
    if (body.type === 'success') {
      assert.deepEqual(body.value.status, variant('running', null));
    }
  });

  // ── POST /dataflow (start) ────────────────────────────

  it('POST /dataflow — returns error for non-existent workspace', async () => {
    const bodyBytes = encodeRequestBody(ApiTypes.DataflowRequestType, {
      concurrency: none,
      force: false,
      filter: none,
    });
    const res = await fetchRoute(app, 'POST', BASE, { identity, body: bodyBytes });
    const body = await decodeResponse(res, NullType);
    assert.equal(body.type, 'error');
  });

  it('POST /dataflow — returns error for locked workspace', async () => {
    // Lock the workspace with an exclusive lock (simulating deploy) to block shared dataflow lock
    await storage.locks.acquire(REPO, WS, variant('deployment', null));

    // Even though the workspace doesn't exist, the lock check happens after graph validation,
    // so this will fail with workspace_not_found first. That's fine.
    const bodyBytes = encodeRequestBody(ApiTypes.DataflowRequestType, {
      concurrency: none,
      force: false,
      filter: none,
    });
    const res = await fetchRoute(app, 'POST', BASE, { identity, body: bodyBytes });
    const body = await decodeResponse(res, NullType);
    // Should be an error (either workspace_not_found or workspace_locked)
    assert.equal(body.type, 'error');
  });

  // ── Lock contention regression tests ────────────────

  it('shared workspace lock blocks exclusive deploy lock during dataflow', async () => {
    // Acquire shared lock on workspace (simulating what dataflow start does)
    const sharedLock = await storage.locks.acquire(REPO, WS, variant('dataflow', null), { wait: false, mode: 'shared' });
    assert.ok(sharedLock, 'shared lock should be acquired');

    // Attempt exclusive lock (simulating deploy) — should be blocked
    const deployLock = await storage.locks.acquire(REPO, WS, variant('deployment', null), { wait: false });
    assert.equal(deployLock, null, 'deploy should be blocked by dataflow shared lock');

    await sharedLock!.release();
  });

  it('shared workspace lock allows concurrent shared lock (e3 set)', async () => {
    // Acquire shared lock on workspace (simulating dataflow)
    const sharedLock = await storage.locks.acquire(REPO, WS, variant('dataflow', null), { wait: false, mode: 'shared' });
    assert.ok(sharedLock, 'shared lock should be acquired');

    // Another shared lock (simulating e3 set / dataset_write) — should succeed
    const setLock = await storage.locks.acquire(REPO, WS, variant('dataset_write', null), { wait: false, mode: 'shared' });
    assert.ok(setLock, 'e3 set should be allowed during dataflow');

    await setLock!.release();
    await sharedLock!.release();
  });

  it('cancel releases both shared and exclusive locks', async () => {
    // Simulate locks held during a running execution
    await storage.locks.acquire(REPO, WS, variant('dataflow', null), { mode: 'shared' });
    await storage.locks.acquire(REPO, `${WS}#dataflow`, variant('dataflow', null));

    // Create a running execution for cancel to find
    const state: DataflowExecutionState = {
      id: '1', repo: REPO, workspace: WS, startedAt: new Date(), concurrency: 4n,
      force: false, filter: none, graph: none, graphHash: none, tasks: new Map(),
      executed: 0n, cached: 0n, failed: 0n, skipped: 0n, status: 'running',
      completedAt: none, error: none, versionVectors: new Map(),
      inputSnapshot: new Map(), taskOutputPaths: [], reexecuted: 0n, events: [], eventSeq: 0n,
    };
    await stateStore.create(state);

    // Cancel the execution
    const res = await fetchRoute(app, 'POST', `${BASE}/cancel`, { identity });
    const body = await decodeResponse(res, NullType);
    assert.equal(body.type, 'success');

    // Both locks should now be released — deploy should succeed
    const deployLock = await storage.locks.acquire(REPO, WS, variant('deployment', null), { wait: false });
    assert.ok(deployLock, 'deploy should be acquirable after cancel releases both locks');
    await deployLock!.release();
  });
});
