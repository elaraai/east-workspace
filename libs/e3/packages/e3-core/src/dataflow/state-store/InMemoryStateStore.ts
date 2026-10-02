/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * In-memory implementation of ExecutionStateStore.
 *
 * Useful for testing and simple cases where persistence is not required.
 * State is lost when the process exits.
 */

import { some } from '@elaraai/east';
import type {
  ExecutionStateStore,
  StateWriteOutcome,
  TaskStatusDetails,
  ExecutionStatusDetails,
} from './interfaces.js';
import type {
  DataflowExecutionState,
  ExecutionEvent,
  TaskStatus,
  TaskState,
} from '../types.js';
import { cloneExecutionState } from './clone.js';

// Type helper for mutable state (removes readonly)
type Mutable<T> = { -readonly [P in keyof T]: T[P] extends object ? Mutable<T[P]> : T[P] };

/**
 * In-memory state store for testing and simple use cases.
 *
 * @remarks
 * - Thread-safe for concurrent access within a single process: each change
 *   reads, changes and keeps a run's state with nothing in between
 * - A run that has ended keeps the state it ended with: every later write is
 *   dropped
 * - State is lost on process exit
 * - No durability guarantees
 */
export class InMemoryStateStore implements ExecutionStateStore {
  /** Map of "repo::workspace" -> execution ID -> state */
  private states = new Map<string, Map<string, DataflowExecutionState>>();

  private makeKey(repo: string, workspace: string): string {
    return `${repo}::${workspace}`;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async create(state: DataflowExecutionState): Promise<void> {
    const key = this.makeKey(state.repo, state.workspace);
    if (!this.states.has(key)) {
      this.states.set(key, new Map());
    }

    const wsStates = this.states.get(key)!;
    if (wsStates.has(state.id)) {
      throw new Error(`Execution ${state.id} already exists in ${key}`);
    }

    // Deep clone to prevent external mutation
    wsStates.set(state.id, cloneExecutionState(state));
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async read(repo: string, workspace: string, id: string): Promise<DataflowExecutionState | null> {
    const key = this.makeKey(repo, workspace);
    const wsStates = this.states.get(key);
    if (!wsStates) return null;

    const state = wsStates.get(id);
    if (!state) return null;

    return cloneExecutionState(state);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async readLatest(repo: string, workspace: string): Promise<DataflowExecutionState | null> {
    const key = this.makeKey(repo, workspace);
    const wsStates = this.states.get(key);
    if (!wsStates || wsStates.size === 0) return null;

    // An execution's id is its run's UUIDv7, so the latest sorts last.
    const latestId = [...wsStates.keys()].sort().at(-1)!;
    return cloneExecutionState(wsStates.get(latestId)!);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async update(state: DataflowExecutionState): Promise<StateWriteOutcome> {
    return this.change(state.repo, state.workspace, state.id, () => state);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async updateTaskStatus(
    repo: string,
    workspace: string,
    executionId: string,
    task: string,
    status: TaskStatus,
    details?: TaskStatusDetails
  ): Promise<StateWriteOutcome> {
    return this.change(repo, workspace, executionId, (current) => {
      const state = cloneExecutionState(current);
      const taskState = state.tasks.get(task) as Mutable<TaskState> | undefined;
      if (!taskState) {
        throw new Error(`Task '${task}' not found in execution ${executionId}`);
      }

      taskState.status = status;
      if (details) {
        if (details.cached !== undefined) taskState.cached = some(details.cached);
        if (details.outputHash !== undefined) taskState.outputHash = some(details.outputHash);
        if (details.error !== undefined) taskState.error = some(details.error);
        if (details.exitCode !== undefined) taskState.exitCode = some(BigInt(details.exitCode));
        if (details.duration !== undefined) taskState.duration = some(BigInt(details.duration));
      }
      taskState.completedAt = some(new Date());

      // The run's summary counts the task as it finished.
      const mutableState = state as Mutable<DataflowExecutionState>;
      if (status === 'completed' && details?.cached) {
        mutableState.cached = state.cached + 1n;
      } else if (status === 'completed') {
        mutableState.executed = state.executed + 1n;
      } else if (status === 'failed') {
        mutableState.failed = state.failed + 1n;
      } else if (status === 'skipped') {
        mutableState.skipped = state.skipped + 1n;
      }
      return state;
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async updateStatus(
    repo: string,
    workspace: string,
    executionId: string,
    status: 'running' | 'completed' | 'failed' | 'cancelled',
    details?: ExecutionStatusDetails
  ): Promise<StateWriteOutcome> {
    return this.change(repo, workspace, executionId, (current) => {
      const mutableState = cloneExecutionState(current) as Mutable<DataflowExecutionState>;

      mutableState.status = status;
      if (status !== 'running') {
        mutableState.completedAt = some(new Date());
      }
      if (details?.error) {
        mutableState.error = some(details.error);
      }
      if (details?.summary) {
        mutableState.executed = BigInt(details.summary.executed);
        mutableState.cached = BigInt(details.summary.cached);
        mutableState.failed = BigInt(details.summary.failed);
        mutableState.skipped = BigInt(details.summary.skipped);
      }
      return mutableState as DataflowExecutionState;
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async recordEvent(
    repo: string,
    workspace: string,
    executionId: string,
    event: ExecutionEvent
  ): Promise<StateWriteOutcome> {
    return this.change(repo, workspace, executionId, (current) => ({ ...current, events: [...current.events, event] }));
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getEventsSince(
    repo: string,
    workspace: string,
    executionId: string,
    sinceSeq: number
  ): Promise<ExecutionEvent[]> {
    const key = this.makeKey(repo, workspace);
    const wsStates = this.states.get(key);
    if (!wsStates) return [];

    const state = wsStates.get(executionId);
    if (!state) return [];

    // Filter events from inline array
    const sinceSeqBigInt = BigInt(sinceSeq);
    return state.events.filter(e => e.value.seq > sinceSeqBigInt);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async delete(repo: string, workspace: string, executionId: string): Promise<void> {
    const key = this.makeKey(repo, workspace);
    const wsStates = this.states.get(key);
    if (wsStates) {
      wsStates.delete(executionId);
    }
  }

  /**
   * Clear all state (for testing).
   */
  clear(): void {
    this.states.clear();
  }

  /**
   * Changes a run's state at once — read, changed and kept, with nothing in
   * between — unless the run has ended, which keeps the state it ended with.
   *
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @param id - Execution ID
   * @param next - The run's next state, from its current one, which it may
   *   not change
   * @returns `applied`, or `dropped` when the run has ended
   * @throws {Error} When the store holds no such run, or `next` throws
   */
  private change(
    repo: string,
    workspace: string,
    id: string,
    next: (current: DataflowExecutionState) => DataflowExecutionState
  ): StateWriteOutcome {
    const key = this.makeKey(repo, workspace);
    const wsStates = this.states.get(key);
    const current = wsStates?.get(id);
    if (wsStates === undefined || current === undefined) {
      throw new Error(`Execution ${id} not found in ${key}`);
    }
    if (current.status !== 'running') return 'dropped';
    wsStates.set(id, cloneExecutionState(next(current)));
    return 'applied';
  }
}
