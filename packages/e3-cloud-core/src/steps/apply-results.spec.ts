/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { none, some } from '@elaraai/east';
import { type DataflowExecutionState } from '@elaraai/e3-core';
import { handleApplyResults, type TaskResult } from './apply-results.js';
import { createMockStorage, taskState, graphTask } from '../testing/step-helpers.js';

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
      tasks: [
        graphTask('task-a', { output: '.out/task-a' }),
        graphTask('task-b', { dependsOn: ['task-a'], output: '.out/task-b' }),
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
    versionVectors: new Map(),
    inputSnapshot: new Map(),
    taskOutputPaths: [],
    reexecuted: 0n,
    events: [],
    eventSeq: 0n,
    ...overrides,
  };
}

describe('apply-results', () => {
  let mock: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    mock = createMockStorage();
  });

  it('throws when execution not found', async () => {
    await assert.rejects(
      () => handleApplyResults(mock.storage, {
        repo: REPO, workspace: WS, executionId: EXEC_ID, runId: RUN_ID,
        force: false, taskResults: [],
      }),
      { message: `Execution ${EXEC_ID} not found` },
    );
  });

  it('skips not_ready and cancelled tasks', async () => {
    const state = makeState();
    await mock.stateStore.create(state);

    const results: TaskResult[] = [
      { taskName: 'task-a', status: 'not_ready' },
      { taskName: 'task-b', status: 'cancelled' },
    ];

    await handleApplyResults(mock.storage, {
      repo: REPO, workspace: WS, executionId: EXEC_ID, runId: RUN_ID,
      force: false, taskResults: results,
    });

    const saved = await mock.stateStore.read(REPO, WS, EXEC_ID_STR);
    // Tasks should remain in their original pending state
    assert.equal(saved?.tasks.get('task-a')?.status, 'pending');
    assert.equal(saved?.tasks.get('task-b')?.status, 'pending');
  });

  it('records failed task and skips dependents', async () => {
    const state = makeState();
    await mock.stateStore.create(state);

    const results: TaskResult[] = [
      { taskName: 'task-a', status: 'failed', error: 'boom', exitCode: 1, duration: 500 },
    ];

    await handleApplyResults(mock.storage, {
      repo: REPO, workspace: WS, executionId: EXEC_ID, runId: RUN_ID,
      force: false, taskResults: results,
    });

    const saved = await mock.stateStore.read(REPO, WS, EXEC_ID_STR);
    assert.equal(saved?.tasks.get('task-a')?.status, 'failed');
    assert.equal(saved?.failed, 1n);
    // task-b depends on task-a and should be skipped
    assert.equal(saved?.tasks.get('task-b')?.status, 'skipped');
  });

  it('records cached task with tree update', async () => {
    const state = makeState({
      tasks: new Map([
        taskState('task-a'),
      ]),
      graph: some({
        tasks: [graphTask('task-a', { output: '.out/task-a' })],
      }),
    });
    await mock.stateStore.create(state);

    const results: TaskResult[] = [
      { taskName: 'task-a', status: 'cached', outputPath: '.out/task-a', outputHash: 'hash-abc' },
    ];

    await handleApplyResults(mock.storage, {
      repo: REPO, workspace: WS, executionId: EXEC_ID, runId: RUN_ID,
      force: false, taskResults: results,
    });

    const saved = await mock.stateStore.read(REPO, WS, EXEC_ID_STR);
    assert.equal(saved?.tasks.get('task-a')?.status, 'completed');
    assert.equal(saved?.cached, 1n);
    assert.equal(saved?.tasks.get('task-a')?.cached?.type, 'some');
    if (saved?.tasks.get('task-a')?.cached?.type === 'some') {
      assert.equal(saved.tasks.get('task-a')!.cached.value, true);
    }
  });

  it('records completed task with execution record', async () => {
    const state = makeState({
      tasks: new Map([
        taskState('task-a'),
      ]),
      graph: some({
        tasks: [graphTask('task-a', { output: '.out/task-a' })],
      }),
    });
    await mock.stateStore.create(state);

    const results: TaskResult[] = [
      {
        taskName: 'task-a', status: 'completed', outputPath: '.out/task-a',
        outputHash: 'hash-xyz', taskHash: 'th-1', inputHashes: ['ih-1'],
        taskExecutionId: 'te-1', duration: 1234,
      },
    ];

    await handleApplyResults(mock.storage, {
      repo: REPO, workspace: WS, executionId: EXEC_ID, runId: RUN_ID,
      force: false, taskResults: results,
    });

    const saved = await mock.stateStore.read(REPO, WS, EXEC_ID_STR);
    assert.equal(saved?.tasks.get('task-a')?.status, 'completed');
    assert.equal(saved?.executed, 1n);
  });

  it('applies tree update with correct version vectors', async () => {
    const versionVectors = new Map<string, Map<string, string>>();
    versionVectors.set('.out/task-a', new Map([['ds1', 'v1']]));

    const state = makeState({
      tasks: new Map([
        taskState('task-a'),
      ]),
      graph: some({
        tasks: [graphTask('task-a', { output: '.out/task-a' })],
      }),
      versionVectors,
    });
    await mock.stateStore.create(state);

    const results: TaskResult[] = [
      { taskName: 'task-a', status: 'completed', outputPath: '.out/task-a', outputHash: 'hash-vv' },
    ];

    // Should not throw — version vectors are resolved by task output path
    await handleApplyResults(mock.storage, {
      repo: REPO, workspace: WS, executionId: EXEC_ID, runId: RUN_ID,
      force: false, taskResults: results,
    });

    const saved = await mock.stateStore.read(REPO, WS, EXEC_ID_STR);
    assert.equal(saved?.tasks.get('task-a')?.status, 'completed');
  });

  it('handles empty graph gracefully', async () => {
    // Graph is present but has no tasks — tasksByName is empty
    const state = makeState({
      graph: some({ tasks: [] }),
      tasks: new Map(),
    });
    await mock.stateStore.create(state);

    // No task results to process
    await handleApplyResults(mock.storage, {
      repo: REPO, workspace: WS, executionId: EXEC_ID, runId: RUN_ID,
      force: false, taskResults: [],
    });

    const saved = await mock.stateStore.read(REPO, WS, EXEC_ID_STR);
    assert.ok(saved);
    assert.equal(saved?.status, 'running');
  });

  it('processes mixed results in sequence', async () => {
    const state = makeState({
      graph: some({
        tasks: [
          graphTask('task-a', { output: '.out/task-a' }),
          graphTask('task-b', { output: '.out/task-b' }),
          graphTask('task-c', { output: '.out/task-c' }),
        ],
      }),
      tasks: new Map([
        taskState('task-a'),
        taskState('task-b'),
        taskState('task-c'),
      ]),
    });
    await mock.stateStore.create(state);

    const results: TaskResult[] = [
      { taskName: 'task-a', status: 'completed', outputPath: '.out/task-a', outputHash: 'h-a', duration: 100 },
      { taskName: 'task-b', status: 'cached', outputPath: '.out/task-b', outputHash: 'h-b' },
      { taskName: 'task-c', status: 'not_ready' },
    ];

    await handleApplyResults(mock.storage, {
      repo: REPO, workspace: WS, executionId: EXEC_ID, runId: RUN_ID,
      force: false, taskResults: results,
    });

    const saved = await mock.stateStore.read(REPO, WS, EXEC_ID_STR);
    assert.equal(saved?.tasks.get('task-a')?.status, 'completed');
    assert.equal(saved?.executed, 1n);
    assert.equal(saved?.tasks.get('task-b')?.status, 'completed');
    assert.equal(saved?.cached, 1n);
    // task-c was not_ready — no state mutation from apply-results
    // (stepTaskCompleted may mark it ready if it's a dependent)
    assert.ok(saved?.tasks.get('task-c')?.status !== 'completed');
  });

  it('returns passthrough fields', async () => {
    const state = makeState();
    await mock.stateStore.create(state);

    const output = await handleApplyResults(mock.storage, {
      repo: REPO, workspace: WS, executionId: EXEC_ID, runId: RUN_ID,
      force: true, forceTasks: ['task-a'], taskResults: [],
    });

    assert.equal(output.repo, REPO);
    assert.equal(output.workspace, WS);
    assert.equal(output.executionId, EXEC_ID);
    assert.equal(output.runId, RUN_ID);
    assert.equal(output.force, true);
    assert.deepEqual(output.forceTasks, ['task-a']);
  });
});
