/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Unit tests for repo-routes.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayType, StringType, NullType, variant, none } from '@elaraai/east';
import { InMemoryStorage } from '@elaraai/e3-core';
import {
  InMemoryRepoManager,
  InMemoryAclStore,
  InMemoryScheduleStore,
  InMemoryTaskConfigStore,
  InMemoryUserSettingsStore,
  InMemorySchedulerService,
  MockIdentityBackend,
} from '../testing/in-memory.js';
import { createRepoRoutes } from './repo-routes.js';
import { fetchRoute, decodeResponse } from './test-helpers.js';
import { Hono } from 'hono';

const admin = { sub: 'admin-1', email: 'admin@test.com', isAdmin: true };
const user = { sub: 'user-1', email: 'user@test.com', isAdmin: false };

describe('repo-routes', () => {
  let repoManager: InMemoryRepoManager;
  let aclStore: InMemoryAclStore;
  let scheduleStore: InMemoryScheduleStore;
  let taskConfigStore: InMemoryTaskConfigStore;
  let userSettingsStore: InMemoryUserSettingsStore;
  let schedulerService: InMemorySchedulerService;
  let identityBackend: MockIdentityBackend;
  let storage: InMemoryStorage;
  let app: Hono;

  beforeEach(() => {
    repoManager = new InMemoryRepoManager();
    aclStore = new InMemoryAclStore();
    scheduleStore = new InMemoryScheduleStore();
    taskConfigStore = new InMemoryTaskConfigStore();
    userSettingsStore = new InMemoryUserSettingsStore(() => true, () => false);
    schedulerService = new InMemorySchedulerService();
    identityBackend = new MockIdentityBackend();
    storage = new InMemoryStorage();

    const routeApp = createRepoRoutes({
      repoManager,
      aclStore,
      scheduleStore,
      taskConfigStore,
      userSettingsStore,
      schedulerService,
      repoStore: storage.repos,
      identityBackend,
    });
    // repo-routes registers at /api/repos internally
    app = new Hono();
    app.route('/', routeApp);
  });

  // ── GET /api/repos ─────────────────────────────────────

  it('GET /api/repos — admin sees all repos', async () => {
    await repoManager.createRepo('repo-a');
    await repoManager.createRepo('repo-b');

    const res = await fetchRoute(app, 'GET', '/api/repos', { identity: admin });
    const body = await decodeResponse(res, ArrayType(StringType));
    assert.equal(body.type, 'success');
    if (body.type === 'success') {
      assert.deepEqual(body.value.sort(), ['repo-a', 'repo-b']);
    }
  });

  it('GET /api/repos — regular user sees only ACL repos', async () => {
    await repoManager.createRepo('repo-a');
    await repoManager.createRepo('repo-b');
    await aclStore.addUser('repo-a', {
      userId: user.sub,
      email: user.email!,
      name: none,
      role: variant('member', null),
      addedBy: admin.sub,
      addedAt: new Date().toISOString(),
    });

    const res = await fetchRoute(app, 'GET', '/api/repos', { identity: user });
    const body = await decodeResponse(res, ArrayType(StringType));
    assert.equal(body.type, 'success');
    if (body.type === 'success') {
      assert.deepEqual(body.value, ['repo-a']);
    }
  });

  it('GET /api/repos — unauthenticated user sees empty array', async () => {
    await repoManager.createRepo('repo-a');

    const res = await fetchRoute(app, 'GET', '/api/repos');
    const body = await decodeResponse(res, ArrayType(StringType));
    assert.equal(body.type, 'success');
    if (body.type === 'success') {
      assert.deepEqual(body.value, []);
    }
  });

  // ── PUT /api/repos/:repo ──────────────────────────────

  it('PUT /api/repos/:repo — creates repo and adds creator as owner', async () => {
    const res = await fetchRoute(app, 'PUT', '/api/repos/new-repo', { identity: admin });
    assert.equal(res.status, 201);
    const body = await decodeResponse(res, StringType);
    assert.equal(body.type, 'success');

    // Verify repo was created
    const meta = await repoManager.getRepoMetadata('new-repo');
    assert.equal(meta?.status, 'active');

    // Verify ACL entry
    const role = await aclStore.getRole('new-repo', admin.sub);
    assert.deepEqual(role, variant('owner', null));
  });

  it('PUT /api/repos/:repo — rejects invalid repo name', async () => {
    const res = await fetchRoute(app, 'PUT', '/api/repos/bad%20name!', { identity: admin });
    const body = await decodeResponse(res, StringType);
    assert.equal(body.type, 'error');
  });

  it('PUT /api/repos/:repo — rejects duplicate repo', async () => {
    await repoManager.createRepo('existing');

    const res = await fetchRoute(app, 'PUT', '/api/repos/existing', { identity: admin });
    const body = await decodeResponse(res, StringType);
    assert.equal(body.type, 'error');
  });

  // ── DELETE /api/repos/:repo ───────────────────────────

  it('DELETE /api/repos/:repo — deletes active repo', async () => {
    await repoManager.createRepo('doomed');
    await aclStore.addUser('doomed', {
      userId: admin.sub,
      email: admin.email!,
      name: none,
      role: variant('owner', null),
      addedBy: admin.sub,
      addedAt: new Date().toISOString(),
    });
    await scheduleStore.put('doomed', 'ws1', {
      repo: 'doomed',
      workspace: 'ws1',
      cronExpression: '0 2 * * *',
      timezone: 'UTC',
      forceTasks: [],
      enabled: true,
      description: none,
      schedulerName: 'sched-1',
      createdBy: admin.sub,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await taskConfigStore.putCompute('doomed', 'ws1', 'task-1', variant('small', null));

    const res = await fetchRoute(app, 'DELETE', '/api/repos/doomed', { identity: admin });
    const body = await decodeResponse(res, NullType);
    assert.equal(body.type, 'success');

    // Verify scheduler called
    assert.equal(schedulerService.deletedSchedules.length, 1);
    assert.equal(schedulerService.deletedSchedules[0], 'sched-1');

    // Verify ACLs deleted
    const users = await aclStore.listUsers('doomed');
    assert.equal(users.length, 0);
  });

  it('DELETE /api/repos/:repo — returns 404 for missing repo', async () => {
    const res = await fetchRoute(app, 'DELETE', '/api/repos/nonexistent', { identity: admin });
    const body = await decodeResponse(res, NullType);
    assert.equal(body.type, 'error');
  });

  it('DELETE /api/repos/:repo — idempotent for already-deleting repo', async () => {
    await repoManager.createRepo('doomed');
    await repoManager.setRepoStatus('doomed', 'active', 'deleting');

    const res = await fetchRoute(app, 'DELETE', '/api/repos/doomed', { identity: admin });
    const body = await decodeResponse(res, NullType);
    assert.equal(body.type, 'success');
  });

  it('DELETE /api/repos/:repo — rejects repo in creating state', async () => {
    await repoManager.createRepo('new-repo');
    // Manually set to 'creating' state
    await repoManager.setRepoStatus('new-repo', 'active', 'creating');

    const res = await fetchRoute(app, 'DELETE', '/api/repos/new-repo', { identity: admin });
    const body = await decodeResponse(res, NullType);
    assert.equal(body.type, 'error');
  });
});
