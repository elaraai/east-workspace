/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Unit tests for gc-routes.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryRepoManager } from '@elaraai/e3-cloud-core/testing';
import { ApiTypes } from '@elaraai/e3-api-server';
import { createGcRoutes } from './gc-routes.js';
import { fetchRoute, decodeResponse } from './test-helpers.js';
import { Hono } from 'hono';

const GC_ARN = 'arn:aws:states:us-east-1:123456789:stateMachine:gc-machine';
const identity = { sub: 'admin-1', email: 'admin@test.com', isAdmin: true };

/**
 * Mock SFN client that records send() calls and returns configurable results.
 */
class MockSFNClient {
  calls: Array<{ constructor: string; input: any }> = [];
  describeResult: any = null;
  describeError: any = null;

  async send(command: any) {
    const constructorName = command.constructor?.name ?? 'Unknown';
    this.calls.push({ constructor: constructorName, input: command.input });

    if (constructorName === 'StartExecutionCommand') {
      return { executionArn: `${GC_ARN}:execution:${command.input?.name}` };
    }

    if (constructorName === 'DescribeExecutionCommand') {
      if (this.describeError) throw this.describeError;
      return this.describeResult;
    }

    return {};
  }

  clear() {
    this.calls = [];
    this.describeResult = null;
    this.describeError = null;
  }
}

describe('gc-routes', () => {
  let repoManager: InMemoryRepoManager;
  let sfn: MockSFNClient;
  let app: Hono;

  beforeEach(() => {
    repoManager = new InMemoryRepoManager();
    sfn = new MockSFNClient();

    const routeApp = createGcRoutes({
      repoManager,
      sfn: sfn as any,
      gcStateMachineArn: GC_ARN,
    });
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

    // Verify SFN was called
    const startCalls = sfn.calls.filter(c => c.constructor === 'StartExecutionCommand');
    assert.equal(startCalls.length, 1);
    assert.equal(JSON.parse(startCalls[0].input.input).repo, 'my-repo');
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

  it('POST /gc — returns error when no gcStateMachineArn configured', async () => {
    const routeApp = createGcRoutes({
      repoManager,
      sfn: sfn as any,
      gcStateMachineArn: undefined,
    });
    const noArnApp = new Hono();
    noArnApp.route('/', routeApp);

    await repoManager.createRepo('my-repo');

    const res = await fetchRoute(noArnApp, 'POST', '/api/repos/my-repo/gc', { identity });
    const body = await decodeResponse(res, ApiTypes.GcStartResultType);
    assert.equal(body.type, 'error');
  });

  // ── GET /api/repos/:repo/gc/:executionId ──────────────

  it('GET /gc/:executionId — returns running status', async () => {
    sfn.describeResult = { status: 'RUNNING' };

    const res = await fetchRoute(app, 'GET', '/api/repos/my-repo/gc/gc-my-repo-123', { identity });
    const body = await decodeResponse(res, ApiTypes.GcStatusResultType);
    assert.equal(body.type, 'success');
    if (body.type === 'success') {
      assert.equal(body.value.status.type, 'running');
    }
  });

  it('GET /gc/:executionId — returns succeeded with stats', async () => {
    sfn.describeResult = {
      status: 'SUCCEEDED',
      output: JSON.stringify({
        success: true,
        stats: {
          deletedObjects: 10,
          retainedObjects: 50,
          skippedYoung: 5,
          bytesFreed: 1024,
        },
      }),
    };

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

  it('GET /gc/:executionId — returns failed when GC skipped (success:false)', async () => {
    sfn.describeResult = {
      status: 'SUCCEEDED',
      output: JSON.stringify({
        success: false,
        status: 'deleting',
      }),
    };

    const res = await fetchRoute(app, 'GET', '/api/repos/my-repo/gc/gc-my-repo-123', { identity });
    const body = await decodeResponse(res, ApiTypes.GcStatusResultType);
    assert.equal(body.type, 'success');
    if (body.type === 'success') {
      assert.equal(body.value.status.type, 'failed');
      assert.equal(body.value.error.type, 'some');
    }
  });

  it('GET /gc/:executionId — returns failed for SFN FAILED status', async () => {
    sfn.describeResult = {
      status: 'FAILED',
      error: 'States.TaskFailed',
      cause: 'Lambda function error',
    };

    const res = await fetchRoute(app, 'GET', '/api/repos/my-repo/gc/gc-my-repo-123', { identity });
    const body = await decodeResponse(res, ApiTypes.GcStatusResultType);
    assert.equal(body.type, 'success');
    if (body.type === 'success') {
      assert.equal(body.value.status.type, 'failed');
      assert.equal(body.value.error.type, 'some');
    }
  });

  it('GET /gc/:executionId — returns error for ExecutionDoesNotExist', async () => {
    const err = new Error('Execution does not exist');
    (err as any).name = 'ExecutionDoesNotExist';
    sfn.describeError = err;

    const res = await fetchRoute(app, 'GET', '/api/repos/my-repo/gc/gc-my-repo-123', { identity });
    const body = await decodeResponse(res, ApiTypes.GcStatusResultType);
    assert.equal(body.type, 'error');
  });
});
