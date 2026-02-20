/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { none, some } from '@elaraai/east';
import { type DataflowExecutionState } from '@elaraai/e3-core';
import { handleMarkSkipped } from './mark-skipped.js';
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
        graphTask('task-c', { dependsOn: ['task-b'] }),
      ],
    }),
    graphHash: none,
    tasks: new Map([
      taskState('task-a', { status: 'failed', error: 'failed' }),
      taskState('task-b'),
      taskState('task-c'),
    ]),
    executed: 0n,
    cached: 0n,
    failed: 1n,
    skipped: 0n,
    status: 'running',
    completedAt: none,
    error: none,
    events: [],
    eventSeq: 0n,
    ...overrides,
  };
}

describe('mark-skipped', () => {
  let mock: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    mock = createMockStorage();
  });

  it('returns empty when execution not found', async () => {
    const result = await handleMarkSkipped(mock.storage, {
      repo: REPO, workspace: WS, executionId: EXEC_ID, failedTask: 'task-a',
    });

    assert.deepEqual(result.skippedTasks, []);
    assert.equal(result.skippedCount, 0);
  });

  it('skips downstream dependents of failed task', async () => {
    const state = makeState();
    await mock.stateStore.create(state);

    const result = await handleMarkSkipped(mock.storage, {
      repo: REPO, workspace: WS, executionId: EXEC_ID, failedTask: 'task-a',
    });

    assert.ok(result.skippedCount >= 1);
    assert.ok(result.skippedTasks.includes('task-b'));
    assert.ok(result.skippedTasks.includes('task-c'));
  });

  it('returns empty when no graph in state', async () => {
    const state = makeState({ graph: none });
    await mock.stateStore.create(state);

    const result = await handleMarkSkipped(mock.storage, {
      repo: REPO, workspace: WS, executionId: EXEC_ID, failedTask: 'task-a',
    });

    assert.deepEqual(result.skippedTasks, []);
    assert.equal(result.skippedCount, 0);
  });
});
