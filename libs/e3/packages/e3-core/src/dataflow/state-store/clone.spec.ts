/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The copy of a run's state a write carries, and a store keeps: nothing the
 * loop changes in place reaches it, and the run's graph, which never changes
 * once a run starts, is shared rather than copied.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { none, some, variant } from '@elaraai/east';
import { E3_RELEASE, dataflowForce } from '@elaraai/e3-types';
import type { DataflowExecutionState, ExecutionEvent, Mutable, TaskState } from '../types.js';
import { cloneExecutionState } from './clone.js';

/** A running run of two tasks, `a` before `b`. */
function runningState(): DataflowExecutionState {
  const task = (name: string): TaskState => ({
    name,
    status: 'pending',
    cached: none,
    outputHash: none,
    error: none,
    exitCode: none,
    startedAt: none,
    completedAt: none,
    duration: none,
    plan: none,
    execution: none,
  } as TaskState);
  return {
    release: E3_RELEASE,
    id: 'run-1',
    repo: 'repo',
    workspace: 'ws',
    startedAt: new Date(),
    force: dataflowForce(false),
    filter: none,
    graph: some({
      tasks: [
        { name: 'a', hash: 'hash-a', inputs: ['.input'], output: '.out_a', dependsOn: [] },
        { name: 'b', hash: 'hash-b', inputs: ['.out_a'], output: '.out_b', dependsOn: ['a'] },
      ],
    }),
    graphHash: none,
    tasks: new Map([['a', task('a')], ['b', task('b')]]),
    executed: 0n,
    cached: 0n,
    failed: 0n,
    skipped: 0n,
    status: 'running',
    completedAt: none,
    error: none,
    versionVectors: new Map([['.input', new Map([['.input', 'hash-in']])]]),
    inputSnapshot: new Map([['.input', 'hash-in']]),
    taskOutputPaths: ['.out_a', '.out_b'],
    reexecuted: 0n,
    events: [],
    eventSeq: 0n,
  } as DataflowExecutionState;
}

describe('cloneExecutionState', () => {
  it('copies what the loop changes in place, so no later change reaches the copy', () => {
    const state = runningState();
    const copy = cloneExecutionState(state);

    (state.tasks.get('a') as Mutable<TaskState>).status = 'in_progress';
    state.versionVectors.get('.input')!.set('.input', 'hash-changed');
    state.inputSnapshot.set('.input', 'hash-changed');
    (state.events as ExecutionEvent[]).push(variant('task_started', { seq: 1n, timestamp: new Date(), task: 'a' }));

    assert.equal(copy.tasks.get('a')!.status, 'pending');
    assert.equal(copy.versionVectors.get('.input')!.get('.input'), 'hash-in');
    assert.equal(copy.inputSnapshot.get('.input'), 'hash-in');
    assert.equal(copy.events.length, 0);
  });

  it('shares the run\'s graph, which never changes once the run starts, so a write copies none of it', () => {
    const state = runningState();
    assert.equal(cloneExecutionState(state).graph, state.graph);
  });
});
