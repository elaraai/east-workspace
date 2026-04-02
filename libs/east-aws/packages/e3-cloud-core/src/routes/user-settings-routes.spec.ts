/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Unit tests for user-settings-routes.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryUserSettingsStore,
  MockIdentityBackend,
} from '../testing/in-memory.js';
import { createUserSettingsRoutes } from './user-settings-routes.js';
import { fetchRoute, mountApp } from './test-helpers.js';

const user1 = { sub: 'user-1', email: 'user1@test.com' };
const user2 = { sub: 'user-2', email: 'user2@test.com' };

describe('user-settings-routes', () => {
  let userSettingsStore: InMemoryUserSettingsStore;
  let identityBackend: MockIdentityBackend;
  let workspaceExists: boolean;
  let isLocked: boolean;

  beforeEach(() => {
    workspaceExists = true;
    isLocked = false;
    userSettingsStore = new InMemoryUserSettingsStore(
      () => workspaceExists,
      () => isLocked,
    );
    identityBackend = new MockIdentityBackend();
  });

  function createApp() {
    const routeApp = createUserSettingsRoutes(userSettingsStore, identityBackend);
    return mountApp(routeApp, '/api/repos/:repo/workspaces/:ws/user-settings');
  }

  // ── GET ─────────────────────────────────────────────────

  it('GET — returns 204 when no settings exist', async () => {
    const app = createApp();
    const res = await fetchRoute(app, 'GET', '/api/repos/test-repo/workspaces/main/user-settings', {
      identity: user1,
    });
    assert.equal(res.status, 204);
  });

  it('GET — returns 200 with binary data when settings exist', async () => {
    const data = new TextEncoder().encode('hello-settings');
    await userSettingsStore.put('test-repo', 'main', user1.sub, data);

    const app = createApp();
    const res = await fetchRoute(app, 'GET', '/api/repos/test-repo/workspaces/main/user-settings', {
      identity: user1,
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/octet-stream');

    const body = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual(body, data);
  });

  it('GET — returns 401 when not authenticated', async () => {
    const app = createApp();
    const res = await fetchRoute(app, 'GET', '/api/repos/test-repo/workspaces/main/user-settings');
    assert.equal(res.status, 401);
  });

  it('GET — users see only their own settings', async () => {
    const data1 = new TextEncoder().encode('user1-data');
    const data2 = new TextEncoder().encode('user2-data');
    await userSettingsStore.put('test-repo', 'main', user1.sub, data1);
    await userSettingsStore.put('test-repo', 'main', user2.sub, data2);

    const app = createApp();
    const res = await fetchRoute(app, 'GET', '/api/repos/test-repo/workspaces/main/user-settings', {
      identity: user1,
    });
    assert.equal(res.status, 200);
    const body = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual(body, data1);
  });

  // ── PUT ─────────────────────────────────────────────────

  it('PUT — saves settings and returns 204', async () => {
    const data = new TextEncoder().encode('my-settings');

    const app = createApp();
    const res = await fetchRoute(app, 'PUT', '/api/repos/test-repo/workspaces/main/user-settings', {
      identity: user1,
      body: data,
      contentType: 'application/octet-stream',
    });
    assert.equal(res.status, 204);

    const stored = await userSettingsStore.get('test-repo', 'main', user1.sub);
    assert.deepEqual(stored, data);
  });

  it('PUT — returns 404 when workspace does not exist', async () => {
    workspaceExists = false;

    const app = createApp();
    const res = await fetchRoute(app, 'PUT', '/api/repos/test-repo/workspaces/missing/user-settings', {
      identity: user1,
      body: new TextEncoder().encode('data'),
      contentType: 'application/octet-stream',
    });
    assert.equal(res.status, 404);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'not_found');
  });

  it('PUT — returns 409 when workspace is locked', async () => {
    isLocked = true;

    const app = createApp();
    const res = await fetchRoute(app, 'PUT', '/api/repos/test-repo/workspaces/main/user-settings', {
      identity: user1,
      body: new TextEncoder().encode('data'),
      contentType: 'application/octet-stream',
    });
    assert.equal(res.status, 409);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'conflict');
  });

  it('PUT — returns 413 when payload is too large', async () => {
    const largeData = new Uint8Array(350 * 1024 + 1);

    const app = createApp();
    const res = await fetchRoute(app, 'PUT', '/api/repos/test-repo/workspaces/main/user-settings', {
      identity: user1,
      body: largeData,
      contentType: 'application/octet-stream',
    });
    assert.equal(res.status, 413);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'payload_too_large');
  });

  it('PUT — returns 401 when not authenticated', async () => {
    const app = createApp();
    const res = await fetchRoute(app, 'PUT', '/api/repos/test-repo/workspaces/main/user-settings', {
      body: new TextEncoder().encode('data'),
      contentType: 'application/octet-stream',
    });
    assert.equal(res.status, 401);
  });

  // ── DELETE ──────────────────────────────────────────────

  it('DELETE — removes settings and returns 204', async () => {
    await userSettingsStore.put('test-repo', 'main', user1.sub, new TextEncoder().encode('data'));

    const app = createApp();
    const res = await fetchRoute(app, 'DELETE', '/api/repos/test-repo/workspaces/main/user-settings', {
      identity: user1,
    });
    assert.equal(res.status, 204);

    const stored = await userSettingsStore.get('test-repo', 'main', user1.sub);
    assert.equal(stored, null);
  });

  it('DELETE — returns 204 even when no settings exist', async () => {
    const app = createApp();
    const res = await fetchRoute(app, 'DELETE', '/api/repos/test-repo/workspaces/main/user-settings', {
      identity: user1,
    });
    assert.equal(res.status, 204);
  });

  it('DELETE — returns 401 when not authenticated', async () => {
    const app = createApp();
    const res = await fetchRoute(app, 'DELETE', '/api/repos/test-repo/workspaces/main/user-settings');
    assert.equal(res.status, 401);
  });

  // ── Bulk Deletion ───────────────────────────────────────

  it('deleteAllForWorkspace — removes all settings for a workspace', async () => {
    await userSettingsStore.put('repo', 'ws1', 'u1', new TextEncoder().encode('a'));
    await userSettingsStore.put('repo', 'ws1', 'u2', new TextEncoder().encode('b'));
    await userSettingsStore.put('repo', 'ws2', 'u1', new TextEncoder().encode('c'));

    await userSettingsStore.deleteAllForWorkspace('repo', 'ws1');

    assert.equal(await userSettingsStore.get('repo', 'ws1', 'u1'), null);
    assert.equal(await userSettingsStore.get('repo', 'ws1', 'u2'), null);
    assert.notEqual(await userSettingsStore.get('repo', 'ws2', 'u1'), null);
  });

  it('deleteAllForRepo — removes all settings for a repo', async () => {
    await userSettingsStore.put('repo', 'ws1', 'u1', new TextEncoder().encode('a'));
    await userSettingsStore.put('repo', 'ws2', 'u1', new TextEncoder().encode('b'));
    await userSettingsStore.put('other', 'ws1', 'u1', new TextEncoder().encode('c'));

    await userSettingsStore.deleteAllForRepo('repo');

    assert.equal(await userSettingsStore.get('repo', 'ws1', 'u1'), null);
    assert.equal(await userSettingsStore.get('repo', 'ws2', 'u1'), null);
    assert.notEqual(await userSettingsStore.get('other', 'ws1', 'u1'), null);
  });
});
