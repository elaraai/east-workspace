/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { none, some } from '@elaraai/east';
import { type DataflowExecutionState } from '@elaraai/e3-core';
import { handleGetReady } from './get-ready.js';
import { createMockStorage, taskState, graphTask } from '../testing/step-helpers.js';

const REPO = 'test-repo';
const WS = 'test-ws';
const EXEC_ID = 1;
const EXEC_ID_STR = '0000000001';

function makeState(overrides: Partial<DataflowExecutionState> = {}): DataflowExecutionState {
  return {
    id: EXEC_ID_STR,
    repo: REPO,
    workspace: WS,
    startedAt: new Date(),
    concurrency: 4n,
    force: false,
    filter: none,
    graph: some({
      tasks: [
        graphTask('task-a'),
        graphTask('task-b', { dependsOn: ['task-a'] }),
      ],
    }),
    graphHash: none,
    tasks: new Map([
      taskState('task-a'),
      taskState('task-b'),
    ]),
    executed: 0n,
    cached: 0n,
    failed: 0n,
    skipped: 0n,
    status: 'running',
    completedAt: none,
    error: none,
    events: [],
    eventSeq: 0n,
    ...overrides,
  };
}

describe('get-ready', () => {
  let mock: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    mock = createMockStorage();
  });

  it('returns cancelled when execution not found', async () => {
    const result = await handleGetReady(mock.storage, {
      repo: REPO, workspace: WS, executionId: EXEC_ID,
    });

    assert.equal(result.cancelled, true);
    assert.deepEqual(result.readyTasks, []);
    assert.equal(result.allCompleted, true);
  });

  it('returns cancelled when execution status is cancelled', async () => {
    const state = makeState({ status: 'cancelled' });
    await mock.stateStore.create(state);

    const result = await handleGetReady(mock.storage, {
      repo: REPO, workspace: WS, executionId: EXEC_ID,
    });

    assert.equal(result.cancelled, true);
  });

  it('returns ready tasks with no dependencies', async () => {
    const state = makeState();
    await mock.stateStore.create(state);

    const result = await handleGetReady(mock.storage, {
      repo: REPO, workspace: WS, executionId: EXEC_ID,
    });

    assert.equal(result.cancelled, false);
    assert.ok(result.readyTasks.includes('task-a'));
    assert.ok(!result.readyTasks.includes('task-b'));
    assert.equal(result.allCompleted, false);
  });

  it('counts task statuses correctly', async () => {
    const state = makeState({
      tasks: new Map([
        taskState('task-a', { status: 'completed', cached: false, outputHash: 'h', duration: 1000n }),
        taskState('task-b', { status: 'failed', error: 'oops' }),
      ]),
    });
    await mock.stateStore.create(state);

    const result = await handleGetReady(mock.storage, {
      repo: REPO, workspace: WS, executionId: EXEC_ID,
    });

    assert.equal(result.completedCount, 1);
    assert.equal(result.failedCount, 1);
    assert.equal(result.skippedCount, 0);
    assert.equal(result.inProgressCount, 0);
  });
});
