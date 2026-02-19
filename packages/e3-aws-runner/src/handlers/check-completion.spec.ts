/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleCheckCompletion } from './check-completion.js';
import { InMemoryExecutionTracker } from './test-helpers.js';

const REPO = 'test-repo';
const WS = 'test-ws';
const EXEC_ID = 1;

describe('check-completion', () => {
  let tracker: InstanceType<typeof InMemoryExecutionTracker>;

  beforeEach(() => {
    tracker = new InMemoryExecutionTracker();
  });

  it('returns completed tasks with success status', async () => {
    await tracker.setTaskStatus(REPO, EXEC_ID, 'task-a', {
      status: 'success', outputPath: '/out/a', outputHash: 'hash-a',
    });

    const result = await handleCheckCompletion(tracker, {
      repo: REPO, workspace: WS, executionId: EXEC_ID,
      dispatchResults: [{ taskName: 'task-a', status: 'dispatched' }],
    });

    assert.equal(result.completed.length, 1);
    assert.equal(result.completed[0].taskName, 'task-a');
    assert.equal(result.completed[0].status, 'success');
    assert.equal(result.failedCount, 0);
    assert.equal(result.stillRunning.length, 0);
    assert.equal(result.anyCompleted, true);
  });

  it('returns cached tasks as completed', async () => {
    await tracker.setTaskStatus(REPO, EXEC_ID, 'task-b', {
      status: 'cached', outputPath: '/out/b', outputHash: 'hash-b',
    });

    const result = await handleCheckCompletion(tracker, {
      repo: REPO, workspace: WS, executionId: EXEC_ID,
      dispatchResults: [{ taskName: 'task-b', status: 'cached' }],
    });

    assert.equal(result.completed.length, 1);
    assert.equal(result.completed[0].status, 'cached');
  });

  it('detects failed tasks', async () => {
    await tracker.setTaskStatus(REPO, EXEC_ID, 'task-c', {
      status: 'failed', error: 'exit code 1', exitCode: 1,
    });

    const result = await handleCheckCompletion(tracker, {
      repo: REPO, workspace: WS, executionId: EXEC_ID,
      dispatchResults: [{ taskName: 'task-c', status: 'dispatched' }],
    });

    assert.equal(result.failedCount, 1);
    assert.deepEqual(result.failedTasks, ['task-c']);
    assert.equal(result.anyCompleted, true);
  });

  it('keeps running tasks in stillRunning', async () => {
    await tracker.setTaskStatus(REPO, EXEC_ID, 'task-d', {
      status: 'running', heartbeat: Date.now(),
    });

    const result = await handleCheckCompletion(tracker, {
      repo: REPO, workspace: WS, executionId: EXEC_ID,
      dispatchResults: [{ taskName: 'task-d', status: 'dispatched' }],
    });

    assert.equal(result.stillRunning.length, 1);
    assert.deepEqual(result.stillRunning, ['task-d']);
    assert.equal(result.anyCompleted, false);
  });

  it('marks stale heartbeat tasks as failed', async () => {
    // Heartbeat older than 5 minutes
    const staleTime = Date.now() - 6 * 60 * 1000;
    await tracker.setTaskStatus(REPO, EXEC_ID, 'task-e', {
      status: 'running', heartbeat: staleTime,
    });

    const result = await handleCheckCompletion(tracker, {
      repo: REPO, workspace: WS, executionId: EXEC_ID,
      dispatchResults: [{ taskName: 'task-e', status: 'dispatched' }],
    });

    assert.equal(result.failedCount, 1);
    assert.deepEqual(result.failedTasks, ['task-e']);
  });

  it('discovers in-progress tasks when no dispatchResults provided', async () => {
    await tracker.setTaskStatus(REPO, EXEC_ID, 'task-f', {
      status: 'dispatched',
    });
    await tracker.setTaskStatus(REPO, EXEC_ID, 'task-g', {
      status: 'running', heartbeat: Date.now(),
    });

    const result = await handleCheckCompletion(tracker, {
      repo: REPO, workspace: WS, executionId: EXEC_ID,
    });

    // Both dispatched and running tasks are discovered as still running
    assert.equal(result.stillRunning.length, 2);
    assert.ok(result.stillRunning.includes('task-f'));
    assert.ok(result.stillRunning.includes('task-g'));
  });
});
