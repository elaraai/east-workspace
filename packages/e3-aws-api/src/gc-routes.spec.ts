/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Unit tests for gc-routes.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryRepoManager, InMemoryGcOrchestrator } from '@elaraai/e3-cloud-core/testing';
import { ApiTypes } from '@elaraai/e3-api-server';
import { createGcRoutes } from './gc-routes.js';
import { fetchRoute, decodeResponse } from './test-helpers.js';
import { Hono } from 'hono';

const identity = { sub: 'admin-1', email: 'admin@test.com', isAdmin: true };

describe('gc-routes', () => {
  let repoManager: InMemoryRepoManager;
  let gc: InMemoryGcOrchestrator;
  let app: Hono;

  beforeEach(() => {
    repoManager = new InMemoryRepoManager();
    gc = new InMemoryGcOrchestrator();

    const routeApp = createGcRoutes({ repoManager, gc });
    app = new Hono();
    app.route('/', routeApp);
  });

  // ── POST /api/repos/:repo/gc ──────────────────────────

  it('POST /gc — starts GC for active repo', async () => {
    await repoManager.createRepo('my-repo');

    const res = await fetchRoute(app, 'POST', '/api/repos/my-repo/gc', { identity });
    assert.equal(res.status, 202);
    const body = await decodeResponse(res, ApiTypes.GcStartResultType);
    assert.equal(body.type, 'success');
    if (body.type === 'success') {
      assert.ok(body.value.executionId.startsWith('gc-my-repo-'));
    }

    // Verify orchestrator was called
    assert.equal(gc.calls.length, 1);
    assert.equal(gc.calls[0].repo, 'my-repo');
  });

  it('POST /gc — returns error for non-active repo state (gc)', async () => {
    await repoManager.createRepo('my-repo');
    await repoManager.setRepoStatus('my-repo', 'active', 'gc');

    const res = await fetchRoute(app, 'POST', '/api/repos/my-repo/gc', { identity });
    const body = await decodeResponse(res, ApiTypes.GcStartResultType);
    assert.equal(body.type, 'error');
  });

  it('POST /gc — returns error for missing repo', async () => {
    const res = await fetchRoute(app, 'POST', '/api/repos/nonexistent/gc', { identity });
    const body = await decodeResponse(res, ApiTypes.GcStartResultType);
    assert.equal(body.type, 'error');
  });

  it('POST /gc — returns error when gc orchestrator not configured', async () => {
    const routeApp = createGcRoutes({ repoManager, gc: undefined });
    const noGcApp = new Hono();
    noGcApp.route('/', routeApp);

    await repoManager.createRepo('my-repo');

    const res = await fetchRoute(noGcApp, 'POST', '/api/repos/my-repo/gc', { identity });
    const body = await decodeResponse(res, ApiTypes.GcStartResultType);
    assert.equal(body.type, 'error');
  });

  // ── GET /api/repos/:repo/gc/:executionId ──────────────

  it('GET /gc/:executionId — returns running status', async () => {
    gc.statusMap.set('gc-my-repo-123', { status: 'running' });

    const res = await fetchRoute(app, 'GET', '/api/repos/my-repo/gc/gc-my-repo-123', { identity });
    const body = await decodeResponse(res, ApiTypes.GcStatusResultType);
    assert.equal(body.type, 'success');
    if (body.type === 'success') {
      assert.equal(body.value.status.type, 'running');
    }
  });

  it('GET /gc/:executionId — returns succeeded with stats', async () => {
    gc.statusMap.set('gc-my-repo-123', {
      status: 'succeeded',
      stats: {
        deletedObjects: 10,
        retainedObjects: 50,
        skippedYoung: 5,
        bytesFreed: 1024,
      },
    });

    const res = await fetchRoute(app, 'GET', '/api/repos/my-repo/gc/gc-my-repo-123', { identity });
    const body = await decodeResponse(res, ApiTypes.GcStatusResultType);
    assert.equal(body.type, 'success');
    if (body.type === 'success') {
      assert.equal(body.value.status.type, 'succeeded');
      assert.equal(body.value.stats.type, 'some');
      if (body.value.stats.type === 'some') {
        assert.equal(body.value.stats.value.deletedObjects, 10n);
        assert.equal(body.value.stats.value.retainedObjects, 50n);
      }
    }
  });

  it('GET /gc/:executionId — returns failed status', async () => {
    gc.statusMap.set('gc-my-repo-123', {
      status: 'failed',
      error: "GC skipped - repo is in 'deleting' state",
    });

    const res = await fetchRoute(app, 'GET', '/api/repos/my-repo/gc/gc-my-repo-123', { identity });
    const body = await decodeResponse(res, ApiTypes.GcStatusResultType);
    assert.equal(body.type, 'success');
    if (body.type === 'success') {
      assert.equal(body.value.status.type, 'failed');
      assert.equal(body.value.error.type, 'some');
    }
  });

  it('GET /gc/:executionId — returns error for not_found execution', async () => {
    // statusMap has no entry for this executionId, so getGcStatus returns not_found
    const res = await fetchRoute(app, 'GET', '/api/repos/my-repo/gc/gc-my-repo-nonexistent', { identity });
    const body = await decodeResponse(res, ApiTypes.GcStatusResultType);
    assert.equal(body.type, 'error');
  });
});
