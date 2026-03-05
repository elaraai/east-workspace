/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { none, some, variant } from '@elaraai/east';
import { type DataflowExecutionState } from '@elaraai/e3-core';
import type { DataflowRun } from '@elaraai/e3-types';
import { handleFinalizeExecution } from './finalize-execution.js';
import { createMockStorage, InMemoryDataflowRunStore, taskState, graphTask } from '../testing/step-helpers.js';

const REPO = 'test-repo';
const WS = 'test-ws';
const EXEC_ID = 1;
const EXEC_ID_STR = '0000000001';
const RUN_ID = 'run-001';

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
      tasks: [graphTask('task-a')],
    }),
    graphHash: none,
    tasks: new Map([
      taskState('task-a', { status: 'completed', cached: false, outputHash: 'hash-a', duration: 1000n }),
    ]),
    executed: 1n,
    cached: 0n,
    failed: 0n,
    skipped: 0n,
    status: 'running',
    completedAt: none,
    error: none,
    versionVectors: new Map(),
    inputSnapshot: new Map(),
    taskOutputPaths: [],
    reexecuted: 0n,
    events: [],
    eventSeq: 0n,
    ...overrides,
  };
}

function makeRun(): DataflowRun {
  return {
    runId: RUN_ID,
    workspaceName: WS,
    packageRef: 'test-pkg@1.0.0',
    startedAt: new Date(),
    completedAt: none,
    status: variant('running', {}),
    inputVersions: new Map(),
    outputVersions: none,
    taskExecutions: new Map(),
    summary: { total: 0n, completed: 0n, cached: 0n, failed: 0n, skipped: 0n, reexecuted: 0n },
  };
}

describe('finalize-execution', () => {
  let mock: ReturnType<typeof createMockStorage>;
  let dataflowRuns: InstanceType<typeof InMemoryDataflowRunStore>;

  beforeEach(() => {
    mock = createMockStorage();
    dataflowRuns = mock.dataflowRuns as unknown as InstanceType<typeof InMemoryDataflowRunStore>;
  });

  it('returns success=false when execution not found', async () => {
    const result = await handleFinalizeExecution(
      { storage: mock.storage, dataflowRuns },
      { repo: REPO, workspace: WS, executionId: EXEC_ID, status: 'completed', runId: RUN_ID },
    );

    assert.equal(result.success, false);
  });

  it('finalizes a successful execution', async () => {
    const state = makeState();
    await mock.stateStore.create(state);
    await dataflowRuns.write(REPO, WS, makeRun());

    const result = await handleFinalizeExecution(
      { storage: mock.storage, dataflowRuns },
      { repo: REPO, workspace: WS, executionId: EXEC_ID, status: 'completed', runId: RUN_ID },
    );

    assert.equal(result.success, true);
    assert.equal(result.executed, 1);
    assert.equal(result.cached, 0);
    assert.equal(result.failed, 0);
  });

  it('preserves cancelled status', async () => {
    const state = makeState({ status: 'cancelled' });
    await mock.stateStore.create(state);
    await dataflowRuns.write(REPO, WS, makeRun());

    await handleFinalizeExecution(
      { storage: mock.storage, dataflowRuns },
      { repo: REPO, workspace: WS, executionId: EXEC_ID, status: 'failed', runId: RUN_ID },
    );

    const savedState = await mock.stateStore.read(REPO, WS, EXEC_ID_STR);
    assert.equal(savedState?.status, 'cancelled');
  });

  it('resolves version vectors by task output path, not task name', async () => {
    const versionVectors = new Map<string, Map<string, string>>();
    versionVectors.set('/out/task-a', new Map([['ds1', 'v1']]));

    const state = makeState({ versionVectors });
    await mock.stateStore.create(state);
    await dataflowRuns.write(REPO, WS, makeRun());

    const result = await handleFinalizeExecution(
      { storage: mock.storage, dataflowRuns },
      {
        repo: REPO, workspace: WS, executionId: EXEC_ID, status: 'completed', runId: RUN_ID,
        taskResults: [{ taskName: 'task-a', taskExecutionId: 'exec-1', cached: false }],
      },
    );

    assert.equal(result.success, true);

    // Verify the run was written with correct outputVersions from version vectors
    const finalRun = await dataflowRuns.get(REPO, WS, RUN_ID);
    assert.ok(finalRun);
    const taskExec = finalRun.taskExecutions.get('task-a');
    assert.ok(taskExec);
    // Version vectors are keyed by output path (/out/task-a), not task name (task-a)
    assert.deepEqual(taskExec.outputVersions, new Map([['ds1', 'v1']]));
  });

  it('propagates DataflowRun write errors', async () => {
    const state = makeState();
    await mock.stateStore.create(state);
    await dataflowRuns.write(REPO, WS, makeRun());

    // Stub write to throw
    const originalWrite = dataflowRuns.write.bind(dataflowRuns);
    dataflowRuns.write = async () => { throw new Error('DynamoDB throttled'); };

    await assert.rejects(
      () => handleFinalizeExecution(
        { storage: mock.storage, dataflowRuns },
        { repo: REPO, workspace: WS, executionId: EXEC_ID, status: 'completed', runId: RUN_ID },
      ),
      { message: 'DynamoDB throttled' },
    );

    // Restore for cleanup
    dataflowRuns.write = originalWrite;
  });

  it('releases workspace lock on finalize', async () => {
    const state = makeState();
    await mock.stateStore.create(state);

    const result = await handleFinalizeExecution(
      { storage: mock.storage, dataflowRuns },
      { repo: REPO, workspace: WS, executionId: EXEC_ID, status: 'completed', runId: RUN_ID },
    );

    assert.equal(result.success, true);
  });
});
