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
  Budget, InMemoryStateStore, LocalOrchestrator, MockTaskRunner, stateToStatus, type DataflowOrchestrator,
} from '@elaraai/e3-core';
import { InMemoryStorage } from '@elaraai/e3-core/test';
import { BEAST2_CONTENT_TYPE, E3_RELEASE } from '@elaraai/e3-types';
import { createExecutionRoutes } from '../routes/executions.js';
import { createServer } from '../server.js';
import { DataflowBudgetType, DataflowExecutionStateType, DataflowRequestType, ResponseType } from '../types.js';

describe('dataflow routes', () => {
  it('start, poll and cancel a run through the orchestrator and the state store their host gives', async () => {
    // A host's own orchestrator, which records its run in the host's store.
    const stateStore = new InMemoryStateStore();
    const cancelled: string[] = [];
    const orchestrator: DataflowOrchestrator = {
      start: async (_storage, repo, workspace) => {
        await stateStore.create({
          release: E3_RELEASE, id: 'run-1', repo, workspace, startedAt: new Date(Date.now() - 1000), force: false, filter: none,
          graph: none, graphHash: none, tasks: new Map(), executed: 0n, cached: 0n, failed: 0n, skipped: 0n, status: 'running',
          completedAt: none, error: none, versionVectors: new Map(), inputSnapshot: new Map(), taskOutputPaths: [], reexecuted: 0n,
          events: [], eventSeq: 0n,
        });
        return { id: 'run-1', repo, workspace };
      },
      wait: () => new Promise(() => {}),
      getStatus: async (handle) => ({
        ...stateToStatus((await stateStore.read(handle.repo, handle.workspace, handle.id))!),
        waiting: [{ task: 'train', unit: none, needs: 1024n, since: new Date(0).toISOString() }],
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

    assert.equal((await post('', encodeBeast2For(DataflowRequestType)({ force: false, filter: none }))).type, 'success');
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
      body: encodeBeast2For(DataflowRequestType)({ force: false, filter: none }),
    });
    assert.equal(response.status, 202);
    assert.equal(decodeBeast2For(ResponseType(NullType))(new Uint8Array(await response.arrayBuffer())).type, 'success');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(waits, 0);
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
