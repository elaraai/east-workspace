/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { none, some, variant } from '@elaraai/east';
import { type DataflowExecutionState } from '@elaraai/e3-core';
import { DEFAULT_TIMEOUT_SERVERLESS } from '@elaraai/e3-cloud-types';
import { handleDispatchTask } from './dispatch-task.js';
import { createMockStorage, InMemoryTaskConfigStore, taskState, graphTask } from '../testing/step-helpers.js';

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
      ],
    }),
    graphHash: none,
    tasks: new Map([
      taskState('task-a'),
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

describe('dispatch-task', () => {
  let mock: ReturnType<typeof createMockStorage>;
  let taskConfigStore: InstanceType<typeof InMemoryTaskConfigStore>;

  beforeEach(() => {
    mock = createMockStorage();
    taskConfigStore = new InMemoryTaskConfigStore();
  });

  it('returns cancelled when execution not found', async () => {
    const result = await handleDispatchTask(
      { storage: mock.storage, taskConfigStore },
      { repo: REPO, workspace: WS, executionId: EXEC_ID, taskName: 'task-a', runId: 'run-1' },
    );

    assert.equal(result.status, 'cancelled');
    assert.equal(result.cached, false);
  });

  it('returns cancelled when execution is cancelled', async () => {
    const state = makeState({ status: 'cancelled' });
    await mock.stateStore.create(state);

    const result = await handleDispatchTask(
      { storage: mock.storage, taskConfigStore },
      { repo: REPO, workspace: WS, executionId: EXEC_ID, taskName: 'task-a', runId: 'run-1' },
    );

    assert.equal(result.status, 'cancelled');
  });

  it('uses default serverless timeout when no config set', async () => {
    const state = makeState();
    await mock.stateStore.create(state);

    const result = await handleDispatchTask(
      { storage: mock.storage, taskConfigStore },
      { repo: REPO, workspace: WS, executionId: EXEC_ID, taskName: 'task-a', runId: 'run-1' },
    );

    assert.equal(result.timeoutMinutes, DEFAULT_TIMEOUT_SERVERLESS);
    assert.equal(result.timeoutSeconds, DEFAULT_TIMEOUT_SERVERLESS * 60);
    assert.deepEqual(result.computeSize, { type: 'serverless' });
  });

  it('uses custom compute size and timeout from config', async () => {
    const state = makeState();
    await mock.stateStore.create(state);
    await taskConfigStore.putCompute(REPO, WS, 'task-a', variant('small', null));
    await taskConfigStore.putTimeout(REPO, WS, 'task-a', { minutes: 120n });

    const result = await handleDispatchTask(
      { storage: mock.storage, taskConfigStore },
      { repo: REPO, workspace: WS, executionId: EXEC_ID, taskName: 'task-a', runId: 'run-1' },
    );

    assert.deepEqual(result.computeSize, { type: 'small' });
    assert.equal(result.timeoutMinutes, 120);
    assert.equal(result.timeoutSeconds, 7200);
  });
});
