/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Unit tests for task-config-routes.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { variant, NullType } from '@elaraai/east';
import {
  ComputeSizeType,
  ComputeConfigMapType,
  TaskTimeoutType,
  TimeoutConfigMapType,
  TaskConfigsType,
  DEFAULT_TIMEOUT_SERVERLESS,
  DEFAULT_TIMEOUT_FARGATE,
  type ComputeSize,
  type TaskTimeout,
} from '@elaraai/e3-cloud-types';
import { InMemoryStorage } from '@elaraai/e3-core';
import { InMemoryTaskConfigStore } from '../testing/in-memory.js';
import { createTaskConfigRoutes } from './task-config-routes.js';
import { mountApp, fetchRoute, decodeResponse, encodeRequestBody } from './test-helpers.js';

const REPO = 'test-repo';
const WS = 'test-ws';
const BASE = `/api/repos/${REPO}/workspaces/${WS}/task-configs`;
const identity = { sub: 'user-1', email: 'user@test.com', isAdmin: true };

describe('task-config-routes', () => {
  let taskConfigStore: InMemoryTaskConfigStore;
  let storage: InMemoryStorage;
  let app: ReturnType<typeof mountApp>;

  beforeEach(() => {
    taskConfigStore = new InMemoryTaskConfigStore();
    storage = new InMemoryStorage();
    const routeApp = createTaskConfigRoutes(taskConfigStore, storage.locks);
    app = mountApp(routeApp, `/api/repos/:repo/workspaces/:ws/task-configs`);
  });

  // ── GET / ──────────────────────────────────────────────

  it('GET / — returns empty compute and timeout maps initially', async () => {
    const res = await fetchRoute(app, 'GET', BASE, { identity });
    assert.equal(res.status, 200);
    const body = await decodeResponse(res, TaskConfigsType);
    assert.equal(body.type, 'success');
    if (body.type === 'success') {
      assert.equal(body.value.compute.size, 0);
      assert.equal(body.value.timeout.size, 0);
    }
  });

  it('GET / — returns populated maps after setting values', async () => {
    await taskConfigStore.putCompute(REPO, WS, 'task-a', variant('small', null));
    await taskConfigStore.putTimeout(REPO, WS, 'task-b', { minutes: 30n });

    const res = await fetchRoute(app, 'GET', BASE, { identity });
    const body = await decodeResponse(res, TaskConfigsType);
    assert.equal(body.type, 'success');
    if (body.type === 'success') {
      assert.equal(body.value.compute.size, 1);
      assert.deepEqual(body.value.compute.get('task-a'), variant('small', null));
      assert.equal(body.value.timeout.size, 1);
      assert.deepEqual(body.value.timeout.get('task-b'), { minutes: 30n });
    }
  });

  // ── GET /compute ───────────────────────────────────────

  it('GET /compute — lists compute configs', async () => {
    await taskConfigStore.putCompute(REPO, WS, 'task-x', variant('medium', null));

    const res = await fetchRoute(app, 'GET', `${BASE}/compute`, { identity });
    const body = await decodeResponse(res, ComputeConfigMapType);
    assert.equal(body.type, 'success');
    if (body.type === 'success') {
      assert.equal(body.value.size, 1);
      assert.deepEqual(body.value.get('task-x'), variant('medium', null));
    }
  });

  // ── GET /compute/:task ─────────────────────────────────

  it('GET /compute/:task — returns serverless default when no config', async () => {
    const res = await fetchRoute(app, 'GET', `${BASE}/compute/my-task`, { identity });
    const body = await decodeResponse(res, ComputeSizeType);
    assert.equal(body.type, 'success');
    if (body.type === 'success') {
      assert.deepEqual(body.value, variant('serverless', null));
    }
  });

  it('GET /compute/:task — returns configured size after PUT', async () => {
    await taskConfigStore.putCompute(REPO, WS, 'my-task', variant('large', null));

    const res = await fetchRoute(app, 'GET', `${BASE}/compute/my-task`, { identity });
    const body = await decodeResponse(res, ComputeSizeType);
    assert.equal(body.type, 'success');
    if (body.type === 'success') {
      assert.deepEqual(body.value, variant('large', null));
    }
  });

  // ── GET /timeout ───────────────────────────────────────

  it('GET /timeout — lists timeout configs', async () => {
    await taskConfigStore.putTimeout(REPO, WS, 'task-t', { minutes: 45n });

    const res = await fetchRoute(app, 'GET', `${BASE}/timeout`, { identity });
    const body = await decodeResponse(res, TimeoutConfigMapType);
    assert.equal(body.type, 'success');
    if (body.type === 'success') {
      assert.equal(body.value.size, 1);
      assert.deepEqual(body.value.get('task-t'), { minutes: 45n });
    }
  });

  // ── GET /timeout/:task ─────────────────────────────────

  it('GET /timeout/:task — returns serverless default (15min) when no config', async () => {
    const res = await fetchRoute(app, 'GET', `${BASE}/timeout/my-task`, { identity });
    const body = await decodeResponse(res, TaskTimeoutType);
    assert.equal(body.type, 'success');
    if (body.type === 'success') {
      assert.equal(body.value.minutes, BigInt(DEFAULT_TIMEOUT_SERVERLESS));
    }
  });

  it('GET /timeout/:task — returns Fargate default (24h) when compute is non-serverless', async () => {
    await taskConfigStore.putCompute(REPO, WS, 'my-task', variant('small', null));

    const res = await fetchRoute(app, 'GET', `${BASE}/timeout/my-task`, { identity });
    const body = await decodeResponse(res, TaskTimeoutType);
    assert.equal(body.type, 'success');
    if (body.type === 'success') {
      assert.equal(body.value.minutes, BigInt(DEFAULT_TIMEOUT_FARGATE));
    }
  });

  it('GET /timeout/:task — returns configured timeout after PUT', async () => {
    await taskConfigStore.putTimeout(REPO, WS, 'my-task', { minutes: 120n });

    const res = await fetchRoute(app, 'GET', `${BASE}/timeout/my-task`, { identity });
    const body = await decodeResponse(res, TaskTimeoutType);
    assert.equal(body.type, 'success');
    if (body.type === 'success') {
      assert.equal(body.value.minutes, 120n);
    }
  });

  // ── PUT /compute/:task ─────────────────────────────────

  it('PUT /compute/:task — sets compute to small', async () => {
    const bodyBytes = encodeRequestBody(ComputeSizeType, variant('small', null));
    const res = await fetchRoute(app, 'PUT', `${BASE}/compute/my-task`, { identity, body: bodyBytes });
    const body = await decodeResponse(res, ComputeSizeType);
    assert.equal(body.type, 'success');

    // Verify via store
    const stored = await taskConfigStore.getCompute(REPO, WS, 'my-task');
    assert.deepEqual(stored, variant('small', null));
  });

  it('PUT /compute/:task — setting serverless deletes the config', async () => {
    await taskConfigStore.putCompute(REPO, WS, 'my-task', variant('large', null));

    const bodyBytes = encodeRequestBody(ComputeSizeType, variant('serverless', null));
    await fetchRoute(app, 'PUT', `${BASE}/compute/my-task`, { identity, body: bodyBytes });

    const stored = await taskConfigStore.getCompute(REPO, WS, 'my-task');
    assert.equal(stored, null);
  });

  // ── PUT /timeout/:task ─────────────────────────────────

  it('PUT /timeout/:task — sets timeout to 30min', async () => {
    const bodyBytes = encodeRequestBody(TaskTimeoutType, { minutes: 30n });
    const res = await fetchRoute(app, 'PUT', `${BASE}/timeout/my-task`, { identity, body: bodyBytes });
    const body = await decodeResponse(res, TaskTimeoutType);
    assert.equal(body.type, 'success');

    const stored = await taskConfigStore.getTimeout(REPO, WS, 'my-task');
    assert.deepEqual(stored, { minutes: 30n });
  });

  it('PUT /timeout/:task — rejects timeout below minimum', async () => {
    const bodyBytes = encodeRequestBody(TaskTimeoutType, { minutes: 0n });
    const res = await fetchRoute(app, 'PUT', `${BASE}/timeout/my-task`, { identity, body: bodyBytes });
    const body = await decodeResponse(res, TaskTimeoutType);
    assert.equal(body.type, 'error');
  });

  it('PUT /timeout/:task — rejects timeout above maximum', async () => {
    const bodyBytes = encodeRequestBody(TaskTimeoutType, { minutes: 99999n });
    const res = await fetchRoute(app, 'PUT', `${BASE}/timeout/my-task`, { identity, body: bodyBytes });
    const body = await decodeResponse(res, TaskTimeoutType);
    assert.equal(body.type, 'error');
  });

  // ── DELETE /compute/:task ──────────────────────────────

  it('DELETE /compute/:task — removes compute config', async () => {
    await taskConfigStore.putCompute(REPO, WS, 'my-task', variant('small', null));

    const res = await fetchRoute(app, 'DELETE', `${BASE}/compute/my-task`, { identity });
    const body = await decodeResponse(res, NullType);
    assert.equal(body.type, 'success');

    const stored = await taskConfigStore.getCompute(REPO, WS, 'my-task');
    assert.equal(stored, null);
  });

  it('DELETE /compute/:task — succeeds even if not set', async () => {
    const res = await fetchRoute(app, 'DELETE', `${BASE}/compute/nonexistent`, { identity });
    const body = await decodeResponse(res, NullType);
    assert.equal(body.type, 'success');
  });

  it('DELETE /compute/:task — returns error when workspace is locked by deploy', async () => {
    // Acquire exclusive lock to simulate deploy holding workspace lock
    await storage.locks.acquire(REPO, WS, variant('deployment', null));

    const res = await fetchRoute(app, 'DELETE', `${BASE}/compute/my-task`, { identity });
    const body = await decodeResponse(res, NullType);
    assert.equal(body.type, 'error');
  });

  // ── DELETE /timeout/:task ──────────────────────────────

  it('DELETE /timeout/:task — removes timeout config', async () => {
    await taskConfigStore.putTimeout(REPO, WS, 'my-task', { minutes: 60n });

    const res = await fetchRoute(app, 'DELETE', `${BASE}/timeout/my-task`, { identity });
    const body = await decodeResponse(res, NullType);
    assert.equal(body.type, 'success');

    const stored = await taskConfigStore.getTimeout(REPO, WS, 'my-task');
    assert.equal(stored, null);
  });

  // ── POST /compute (batch) ─────────────────────────────

  it('POST /compute — batch sets multiple compute configs', async () => {
    const configs: Map<string, ComputeSize> = new Map();
    configs.set('task-a', variant('small', null));
    configs.set('task-b', variant('medium', null));
    const bodyBytes = encodeRequestBody(ComputeConfigMapType, configs as any);
    const res = await fetchRoute(app, 'POST', `${BASE}/compute`, { identity, body: bodyBytes });
    const body = await decodeResponse(res, ComputeConfigMapType);
    assert.equal(body.type, 'success');
    if (body.type === 'success') {
      assert.equal(body.value.size, 2);
    }
  });

  // ── POST /timeout (batch) ─────────────────────────────

  it('POST /timeout — batch sets multiple timeout configs', async () => {
    const configs: Map<string, TaskTimeout> = new Map();
    configs.set('task-a', { minutes: 30n });
    configs.set('task-b', { minutes: 60n });
    const bodyBytes = encodeRequestBody(TimeoutConfigMapType, configs as any);
    const res = await fetchRoute(app, 'POST', `${BASE}/timeout`, { identity, body: bodyBytes });
    const body = await decodeResponse(res, TimeoutConfigMapType);
    assert.equal(body.type, 'success');
    if (body.type === 'success') {
      assert.equal(body.value.size, 2);
    }
  });

  // ── Lock contention regression tests ────────────────

  it('task config write coexists with dataflow shared lock', async () => {
    // Acquire shared lock on workspace (simulating running dataflow)
    const dfLock = await storage.locks.acquire(REPO, WS, variant('dataflow', null), { mode: 'shared' });
    assert.ok(dfLock, 'dataflow shared lock should be acquired');

    // Task config PUT should succeed (also shared on workspace)
    const bodyBytes = encodeRequestBody(ComputeSizeType, variant('small', null));
    const res = await fetchRoute(app, 'PUT', `${BASE}/compute/my-task`, { identity, body: bodyBytes });
    const body = await decodeResponse(res, ComputeSizeType);
    assert.equal(body.type, 'success');

    await dfLock!.release();
  });

  it('task config write blocked by exclusive deploy lock', async () => {
    // Acquire exclusive lock on workspace (simulating deploy)
    const deployLock = await storage.locks.acquire(REPO, WS, variant('deployment', null));
    assert.ok(deployLock, 'deploy exclusive lock should be acquired');

    // Task config PUT should fail (shared lock blocked by exclusive)
    const bodyBytes = encodeRequestBody(ComputeSizeType, variant('small', null));
    const res = await fetchRoute(app, 'PUT', `${BASE}/compute/my-task`, { identity, body: bodyBytes });
    const body = await decodeResponse(res, ComputeSizeType);
    assert.equal(body.type, 'error');

    await deployLock!.release();
  });
});
