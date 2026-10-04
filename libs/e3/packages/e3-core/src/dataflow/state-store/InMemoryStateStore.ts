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

import { encodeBeast2For, some } from '@elaraai/east';
import { DataflowExecutionStateType, decodeDataflowExecutionState, executionStateSummary } from '@elaraai/e3-types';
import type {
  ExecutionStateStore,
  StateWriteOutcome,
  StoredRunState,
  TaskStatusDetails,
  ExecutionStatusDetails,
} from './interfaces.js';
import type {
  DataflowExecutionState,
  ExecutionEvent,
  ExecutionStateSummary,
  TaskStatus,
  TaskState,
} from '../types.js';
import { checkName } from '../../errors.js';
import { cloneExecutionState } from './clone.js';
import { compareEventSeqs, eventsSince, planEventAppend, segmentBefore, stateWithoutEvents } from './events.js';

// Type helper for mutable state (removes readonly)
type Mutable<T> = { -readonly [P in keyof T]: T[P] extends object ? Mutable<T[P]> : T[P] };

const encodeState = encodeBeast2For(DataflowExecutionStateType);

/**
 * A run's state as the store holds it: the state a write gave it, or the
 * bytes a `replace` left — what an upgrade step writes, or a test standing in
 * for an earlier release — which are read as a stored state is.
 */
type Held = { readonly state: DataflowExecutionState } | { readonly bytes: Uint8Array };

/** A run's events, apart from its state: each segment's bytes, by its first
 *  event's sequence number. */
type Segments = Map<bigint, Uint8Array>;

/** The runs of one workspace of one repository. */
interface WorkspaceRuns {
  readonly repo: string;
  readonly workspace: string;
  /** Execution ID -> its state */
  readonly runs: Map<string, Held>;
  /** Execution ID -> its events */
  readonly events: Map<string, Segments>;
}

/** A held run's state: the state itself, or its bytes decoded. */
function stateOf(held: Held): DataflowExecutionState {
  return 'state' in held ? held.state : decodeDataflowExecutionState(held.bytes);
}

/** A run's state as the store keeps it: a copy, without its events, which it
 *  keeps apart. */
function withoutEvents(state: DataflowExecutionState): DataflowExecutionState {
  return cloneExecutionState(stateWithoutEvents(state));
}

/** Appends events to a run's segments, as every store does
 *  ({@link planEventAppend}), with nothing in between. */
function appendEvents(segments: Segments, events: readonly ExecutionEvent[]): void {
  const held = [...segments.keys()].sort(compareEventSeqs);
  const before = segmentBefore(held, events);
  const bytes = before === null ? undefined : segments.get(before);
  const { remove, put } = planEventAppend(held, before === null || bytes === undefined ? null : { first: before, bytes }, events);
  for (const first of remove) segments.delete(first);
  for (const segment of put) segments.set(segment.first, segment.bytes);
}

/**
 * In-memory state store for testing and simple use cases.
 *
 * @remarks
 * - Thread-safe for concurrent access within a single process: each change
 *   reads, changes and keeps a run's state, and appends its events, with
 *   nothing in between
 * - Keeps a run's events apart from its state, in segments, as every store
 *   does
 * - A run that has ended keeps the state it ended with: every later write is
 *   dropped
 * - State is lost on process exit
 * - No durability guarantees
 */
export class InMemoryStateStore implements ExecutionStateStore {
  /** Map of "repo::workspace" -> the workspace's runs */
  private states = new Map<string, WorkspaceRuns>();

  /** A workspace's key, its name refused when it cannot be one path segment,
   *  as every state store refuses it. */
  private makeKey(repo: string, workspace: string): string {
    checkName('workspace', workspace);
    return `${repo}::${workspace}`;
  }

  /** A run's segments, made when it is first given events. */
  private static segmentsOf(ws: WorkspaceRuns, id: string): Segments {
    let segments = ws.events.get(id);
    if (segments === undefined) {
      segments = new Map();
      ws.events.set(id, segments);
    }
    return segments;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async create(state: DataflowExecutionState): Promise<void> {
    const key = this.makeKey(state.repo, state.workspace);
    if (!this.states.has(key)) {
      this.states.set(key, { repo: state.repo, workspace: state.workspace, runs: new Map(), events: new Map() });
    }

    const ws = this.states.get(key)!;
    if (ws.runs.has(state.id)) {
      throw new Error(`Execution ${state.id} already exists in ${key}`);
    }

    // A copy, so no change made outside reaches it; its events kept apart.
    appendEvents(InMemoryStateStore.segmentsOf(ws, state.id), state.events);
    ws.runs.set(state.id, { state: withoutEvents(state) });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async read(repo: string, workspace: string, id: string): Promise<DataflowExecutionState | null> {
    const held = this.states.get(this.makeKey(repo, workspace))?.runs.get(id);
    if (held === undefined) return null;

    return cloneExecutionState(stateOf(held));
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async readLatest(repo: string, workspace: string): Promise<DataflowExecutionState | null> {
    const wsStates = this.states.get(this.makeKey(repo, workspace))?.runs;
    if (!wsStates || wsStates.size === 0) return null;

    // An execution's id is its run's UUIDv7, so the latest sorts last.
    const latestId = [...wsStates.keys()].sort().at(-1)!;
    return cloneExecutionState(stateOf(wsStates.get(latestId)!));
  }

  /** The summary of the workspace's latest run, from the state it holds. */
  async readLatestSummary(repo: string, workspace: string): Promise<ExecutionStateSummary | null> {
    const state = await this.readLatest(repo, workspace);
    return state === null ? null : executionStateSummary(state);
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
    return this.change(repo, workspace, executionId, (current) => ({ ...current, events: [event] }));
  }

  async getEventsSince(
    repo: string,
    workspace: string,
    executionId: string,
    sinceSeq: number,
    limit?: number
  ): Promise<ExecutionEvent[]> {
    const segments = this.states.get(this.makeKey(repo, workspace))?.events.get(executionId);
    if (segments === undefined) return [];
    const held = [...segments.keys()].sort(compareEventSeqs);
    return eventsSince(held, (first) => Promise.resolve(segments.get(first) ?? null), BigInt(sinceSeq), limit);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async delete(repo: string, workspace: string, executionId: string): Promise<void> {
    const ws = this.states.get(this.makeKey(repo, workspace));
    ws?.runs.delete(executionId);
    ws?.events.delete(executionId);
  }

  /**
   * The run states the store holds of a repository, as stored: a state a
   * write gave it encoded in this release's form, and bytes a `replace` left
   * as they are. A `replace` leaves its bytes in the run's place, and
   * `writeEvents` a segment among the run's events.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async readStored(repo: string): Promise<StoredRunState[]> {
    const stored: StoredRunState[] = [];
    for (const ws of this.states.values()) {
      if (ws.repo !== repo) continue;
      for (const [id, held] of ws.runs) {
        stored.push({
          workspace: ws.workspace,
          bytes: 'state' in held ? encodeState(held.state) : held.bytes,
          replace: (bytes) => {
            ws.runs.set(id, { bytes });
            return Promise.resolve();
          },
          writeEvents: (runId, segment) => {
            InMemoryStateStore.segmentsOf(ws, runId).set(segment.first, segment.bytes);
            return Promise.resolve();
          },
        });
      }
    }
    return stored;
  }

  /**
   * Removes a workspace's runs: what the in-memory backend's removal of the
   * workspace does, as a local repository's removes the workspace's directory.
   *
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   */
  removeWorkspace(repo: string, workspace: string): void {
    this.states.delete(this.makeKey(repo, workspace));
  }

  /**
   * Removes a repository's runs: what the in-memory backend's removal of the
   * repository does.
   *
   * @param repo - Repository identifier
   * @returns How many runs it removed
   */
  drop(repo: string): number {
    let dropped = 0;
    for (const [key, { repo: of, runs }] of this.states) {
      if (of !== repo) continue;
      dropped += runs.size;
      this.states.delete(key);
    }
    return dropped;
  }

  /**
   * Clear all state (for testing).
   */
  clear(): void {
    this.states.clear();
  }

  /**
   * Changes a run's state at once — read, changed and kept, its new events
   * appended, with nothing in between — unless the run has ended, which keeps
   * the state it ended with.
   *
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @param id - Execution ID
   * @param next - The run's next state, from its current one, which it may
   *   not change: the events it holds are appended to the run's
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
    const ws = this.states.get(key);
    const held = ws?.runs.get(id);
    if (ws === undefined || held === undefined) {
      throw new Error(`Execution ${id} not found in ${key}`);
    }
    const current = stateOf(held);
    if (current.status !== 'running') return 'dropped';
    const state = next(current);
    appendEvents(InMemoryStateStore.segmentsOf(ws, id), state.events);
    ws.runs.set(id, { state: withoutEvents(state) });
    return 'applied';
  }
}
