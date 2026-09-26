/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The dataflow routes run a dataflow on the runner the server injects, which
 * holds its budget: an embedder that runs dataflows elsewhere, as e3-cloud
 * does, mounts them without one, and they start none. And a server's budget
 * settings that do not resolve refuse the server.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { NullType, decodeBeast2For, encodeBeast2For, none } from '@elaraai/east';
import { InMemoryStorage } from '@elaraai/e3-core/test';
import { BEAST2_CONTENT_TYPE } from '@elaraai/e3-types';
import { createExecutionRoutes } from '../routes/executions.js';
import { createServer } from '../server.js';
import { DataflowRequestType, ResponseType } from '../types.js';

describe('dataflow routes', () => {
  it('start no dataflow when mounted without a runner', async () => {
    const app = new Hono();
    app.route('/api/repos/:repo/workspaces/:ws/dataflow', createExecutionRoutes(new InMemoryStorage(), () => 'test-repo'));
    const response = await app.request('/api/repos/r/workspaces/main/dataflow', {
      method: 'POST',
      headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
      body: encodeBeast2For(DataflowRequestType)({ force: false, filter: none }),
    });
    const result = decodeBeast2For(ResponseType(NullType))(new Uint8Array(await response.arrayBuffer())) as { type: string; value: unknown };
    assert.equal(result.type, 'error');
    const error = result.value as { type: string; value: { message: string } };
    assert.equal(error.type, 'internal');
    assert.equal(error.value.message, 'this server starts no dataflow: its host runs them');
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
