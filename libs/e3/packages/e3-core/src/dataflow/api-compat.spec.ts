/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { variant, some, none } from '@elaraai/east';
import { E3_RELEASE, executionStateSummary } from '@elaraai/e3-types';
import type { ExecutionEvent, DataflowExecutionState } from './types.js';
import { coreEventToApiEvent, coreStateToApiState } from './api-compat.js';

const now = new Date('2025-01-15T12:00:00Z');

// =============================================================================
// Helper: build a minimal DataflowExecutionState
// =============================================================================

function makeState(overrides: Partial<DataflowExecutionState> = {}): DataflowExecutionState {
  return {
    release: E3_RELEASE,
    id: '1',
    repo: 'test-repo',
    workspace: 'ws',
    startedAt: now,
    force: false,
    filter: none,
    graph: none,
    graphHash: none,
    tasks: new Map(),
    executed: 0n,
    cached: 0n,
    failed: 0n,
    skipped: 0n,
    status: 'completed',
    completedAt: some(now),
    error: none,
    events: [],
    eventSeq: 0n,
    versionVectors: new Map(),
    inputSnapshot: new Map(),
    taskOutputPaths: [],
    reexecuted: 0n,
    ...overrides,
  };
}

// =============================================================================
// coreEventToApiEvent
// =============================================================================

describe('coreEventToApiEvent', () => {
  it('maps task_started to start', () => {
    const event: ExecutionEvent = variant('task_started', {
      seq: 1n, timestamp: now, task: 'build',
    });
    const result = coreEventToApiEvent(event);
    assert.strictEqual(result?.type, 'start');
    assert.strictEqual(result?.task, 'build');
  });

  it('maps task_completed (not cached) to complete, with the peak its runners reported', () => {
    const event: ExecutionEvent = variant('task_completed', {
      seq: 2n, timestamp: now, task: 'build',
      cached: false, outputHash: 'abc', duration: 1000n, peakBytes: some(96n * 1024n ** 2n),
    });
    const result = coreEventToApiEvent(event);
    assert.strictEqual(result?.type, 'complete');
    assert.strictEqual(result?.duration, 1000);
    assert.strictEqual(result?.peakBytes, 96n * 1024n ** 2n);
    const unmeasured: ExecutionEvent = variant('task_completed', {
      seq: 2n, timestamp: now, task: 'build',
      cached: false, outputHash: 'abc', duration: 1000n, peakBytes: none,
    });
    assert.strictEqual(coreEventToApiEvent(unmeasured)?.peakBytes, undefined);
  });

  it('maps task_completed (cached) to cached', () => {
    const event: ExecutionEvent = variant('task_completed', {
      seq: 2n, timestamp: now, task: 'build',
      cached: true, outputHash: 'abc', duration: 0n, peakBytes: none,
    });
    const result = coreEventToApiEvent(event);
    assert.strictEqual(result?.type, 'cached');
  });

  it('maps task_failed with exitCode to failed', () => {
    const event: ExecutionEvent = variant('task_failed', {
      seq: 3n, timestamp: now, task: 'build',
      error: none, exitCode: some(1n), duration: 500n,
    });
    const result = coreEventToApiEvent(event);
    assert.strictEqual(result?.type, 'failed');
    assert.strictEqual(result?.exitCode, 1n);
  });

  it('maps task_failed without exitCode to error', () => {
    const event: ExecutionEvent = variant('task_failed', {
      seq: 3n, timestamp: now, task: 'build',
      error: some('OOM'), exitCode: none, duration: 500n,
    });
    const result = coreEventToApiEvent(event);
    assert.strictEqual(result?.type, 'error');
    assert.strictEqual(result?.message, 'OOM');
  });

  it('maps task_skipped to input_unavailable', () => {
    const event: ExecutionEvent = variant('task_skipped', {
      seq: 4n, timestamp: now, task: 'deploy', cause: 'build',
    });
    const result = coreEventToApiEvent(event);
    assert.strictEqual(result?.type, 'input_unavailable');
    assert.strictEqual(result?.reason, "Upstream task 'build' failed");
  });

  it('returns null for execution_started', () => {
    const event: ExecutionEvent = variant('execution_started', {
      seq: 0n, timestamp: now, executionId: '1', totalTasks: 3n,
    });
    assert.strictEqual(coreEventToApiEvent(event), null);
  });

  it('returns null for task_ready', () => {
    const event: ExecutionEvent = variant('task_ready', {
      seq: 1n, timestamp: now, task: 'build',
    });
    assert.strictEqual(coreEventToApiEvent(event), null);
  });

  it('returns null for execution_completed', () => {
    const event: ExecutionEvent = variant('execution_completed', {
      seq: 5n, timestamp: now, success: true,
      executed: 1n, cached: 0n, failed: 0n, skipped: 0n, duration: 1000n,
    });
    assert.strictEqual(coreEventToApiEvent(event), null);
  });

  it('returns null for execution_cancelled', () => {
    const event: ExecutionEvent = variant('execution_cancelled', {
      seq: 5n, timestamp: now, reason: none,
    });
    assert.strictEqual(coreEventToApiEvent(event), null);
  });

  it('maps unit_requeued to requeued, naming the unit, why, its peak and what it reserves', () => {
    const unit = { merge: some({ level: 1n, levels: 2n }), index: 2n, units: 4n };
    const event: ExecutionEvent = variant('unit_requeued', {
      seq: 9n, timestamp: now, task: 'build', unit, reason: variant('cap', null), peak: 96n * 1024n ** 2n, reserves: 96n * 1024n ** 2n,
    });
    assert.deepStrictEqual(coreEventToApiEvent(event), {
      type: 'requeued', task: 'build', timestamp: now.toISOString(), unit, requeueReason: 'cap', peak: 96n * 1024n ** 2n, reserves: 96n * 1024n ** 2n,
    });
  });

  it('returns null for a split task\'s stages: the API\'s events are a task\'s', () => {
    const events: ExecutionEvent[] = [
      variant('task_split', { seq: 6n, timestamp: now, task: 'build', pieces: 4n }),
      variant('task_merge_started', { seq: 7n, timestamp: now, task: 'build', level: 1n, levels: 1n, units: 2n }),
      variant('task_merge_completed', { seq: 8n, timestamp: now, task: 'build', level: 1n, levels: 1n }),
    ];
    assert.deepStrictEqual(events.map(coreEventToApiEvent), [null, null, null]);
  });
});

// =============================================================================
// coreStateToApiState — the events past a cursor, and the cursor past them
// =============================================================================

describe('coreStateToApiState', () => {
  it('serves only the API-visible events, with the cursor past them its caller gives', () => {
    // 5 core events: execution_started, task_ready, task_started, task_completed, execution_completed
    // Only 2 are API-visible: task_started → start, task_completed → complete
    const events: ExecutionEvent[] = [
      variant('execution_started', {
        seq: 0n, timestamp: now, executionId: '1', totalTasks: 1n,
      }),
      variant('task_ready', {
        seq: 1n, timestamp: now, task: 'build',
      }),
      variant('task_started', {
        seq: 2n, timestamp: now, task: 'build',
      }),
      variant('task_completed', {
        seq: 3n, timestamp: now, task: 'build',
        cached: false, outputHash: 'abc', duration: 1000n, peakBytes: none,
      }),
      variant('execution_completed', {
        seq: 4n, timestamp: now, success: true,
        executed: 1n, cached: 0n, failed: 0n, skipped: 0n, duration: 1000n,
      }),
    ];

    const state = makeState({ executed: 1n, events });
    const result = coreStateToApiState(state, events, 4n, 1000);

    assert.strictEqual(result.events.length, 2);
    assert.strictEqual(result.nextSeq, 4n);
    assert.strictEqual(result.events[0]?.type, 'start');
    assert.strictEqual(result.events[1]?.type, 'complete');
  });

  it('serves no events when every one is internal, and the cursor past them', () => {
    const events: ExecutionEvent[] = [
      variant('execution_started', {
        seq: 0n, timestamp: now, executionId: '1', totalTasks: 0n,
      }),
      variant('execution_completed', {
        seq: 1n, timestamp: now, success: true,
        executed: 0n, cached: 0n, failed: 0n, skipped: 0n, duration: 0n,
      }),
    ];

    const state = makeState({ events });
    const result = coreStateToApiState(state, events, 1n, 0);

    assert.strictEqual(result.events.length, 0);
    assert.strictEqual(result.nextSeq, 1n);
  });

  it('answers a run\'s summary as its whole state, which holds the summary', () => {
    const events: ExecutionEvent[] = [variant('task_started', { seq: 1n, timestamp: now, task: 'build' })];
    const state = makeState({ executed: 3n, cached: 2n, failed: 1n, skipped: 4n, status: 'failed', events });
    assert.deepStrictEqual(coreStateToApiState(executionStateSummary(state), events, 1n, 700), coreStateToApiState(state, events, 1n, 700));
  });

  it('includes summary only for non-running executions', () => {
    const state = makeState({ status: 'running', completedAt: none });
    const result = coreStateToApiState(state, [], 0n, 500);

    assert.strictEqual(result.summary, null);
    assert.strictEqual(result.status, 'running');
  });

  it('maps cancelled status to aborted', () => {
    const state = makeState({ status: 'cancelled' });
    const result = coreStateToApiState(state, [], 0n, 0);

    assert.strictEqual(result.status, 'aborted');
  });
});
