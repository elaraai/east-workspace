/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A copy of a run's state that shares nothing the loop changes in place.
 *
 * @packageDocumentation
 */

import { some } from '@elaraai/east';
import type { DataflowExecutionState, TaskState } from '../types.js';

/**
 * Copies a run's state, sharing nothing the loop changes in place: what a
 * store keeps, and what a write of the state carries while it waits its turn.
 *
 * @remarks
 * The step functions change a run's state by replacing a task's fields, and
 * the run's counters, and by adding to its maps and its events, never by
 * changing a field's value in place. So each task's state is copied, and each
 * map and list; an event, once added, is never changed, and is shared. The
 * run's graph is fixed once the run starts, and is shared whole: a write of a
 * large run copies none of it.
 *
 * @param state - The run's state
 * @returns A copy of it
 */
export function cloneExecutionState(state: DataflowExecutionState): DataflowExecutionState {
  const tasks = new Map<string, TaskState>();
  for (const [name, taskState] of state.tasks) {
    tasks.set(name, { ...taskState } as TaskState);
  }

  let completedAt = state.completedAt;
  if (state.completedAt.type === 'some') {
    completedAt = some(new Date(state.completedAt.value.getTime()));
  }

  const versionVectors = new Map<string, Map<string, string>>();
  for (const [k, v] of state.versionVectors) {
    versionVectors.set(k, new Map(v));
  }

  return {
    ...state,
    startedAt: new Date(state.startedAt.getTime()),
    completedAt,
    tasks,
    events: [...state.events],
    versionVectors,
    inputSnapshot: new Map(state.inputSnapshot),
    taskOutputPaths: [...state.taskOutputPaths],
  } as DataflowExecutionState;
}
