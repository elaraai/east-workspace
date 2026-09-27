/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The dataflow routes run a dataflow on the runner the server injects, which
 * holds its budget, and serve that budget: an embedder that runs dataflows
 * elsewhere, as e3-cloud does, mounts them without the dataflow option, and
 * they start none and serve no budget. And a server's budget settings that do
 * not resolve refuse the server.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { NullType, OptionType, decodeBeast2For, encodeBeast2For, none, some, variant } from '@elaraai/east';
import { Budget, MockTaskRunner } from '@elaraai/e3-core';
import { InMemoryStorage } from '@elaraai/e3-core/test';
import { BEAST2_CONTENT_TYPE } from '@elaraai/e3-types';
import { createExecutionRoutes } from '../routes/executions.js';
import { createServer } from '../server.js';
import { DataflowBudgetType, DataflowRequestType, ResponseType } from '../types.js';

describe('dataflow routes', () => {
  it('start no dataflow when mounted by a host that runs them elsewhere', async () => {
    const app = new Hono();
    app.route('/api/repos/:repo/workspaces/:ws/dataflow', createExecutionRoutes(new InMemoryStorage(), () => 'test-repo', () => new MockTaskRunner()));
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

  it('serve the budget a run gets, with what its runners hold now, and none when mounted without one', async () => {
    const decode = decodeBeast2For(ResponseType(OptionType(DataflowBudgetType)));
    const budgetOf = async (app: Hono) =>
      decode(new Uint8Array(await (await app.request('/api/repos/r/workspaces/main/dataflow/budget')).arrayBuffer()));

    const budget = new Budget({ cores: 3, memory: 4 * 1024 ** 3 });
    const held = await budget.acquire({ memory: 1024 ** 3 });
    const withBudget = new Hono();
    withBudget.route('/api/repos/:repo/workspaces/:ws/dataflow', createExecutionRoutes(new InMemoryStorage(), () => 'test-repo', () => new MockTaskRunner(), {
      width: budget.cores,
      budget,
    }));
    assert.deepEqual(await budgetOf(withBudget), variant('success', some({ cores: 3n, memory: 4n * 1024n ** 3n, coresInUse: 1n, memoryInUse: 1024n ** 3n })));
    held.release();

    const without = new Hono();
    without.route('/api/repos/:repo/workspaces/:ws/dataflow', createExecutionRoutes(new InMemoryStorage(), () => 'test-repo', () => new MockTaskRunner()));
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
