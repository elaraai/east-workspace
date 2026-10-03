/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `WebStateStore`: where a dataflow run keeps its state beside a
 * {@link WebStorage}'s repositories — a record of the same records adapter,
 * one per run, under its repository, workspace and id.
 *
 * @packageDocumentation
 */

import { encodeBeast2For, some } from '@elaraai/east';
import { DataflowExecutionStateType, decodeDataflowExecutionState, executionStateSummary, type ExecutionStateSummary } from '@elaraai/e3-types';
import {
  checkName,
  type DataflowExecutionState,
  type DataflowTaskStatus,
  type ExecutionEvent,
  type ExecutionStateStore,
  type ExecutionStatusDetails,
  type StateWriteOutcome,
  type StoredRunState,
  type TaskState,
  type TaskStatusDetails,
} from '@elaraai/e3-core/portable';
import type { RecordKey, RecordsAdapter, RecordsRead } from './adapters.js';
import { recordKeys } from './record-keys.js';

const encodeState = encodeBeast2For(DataflowExecutionStateType);

/** A run's key, its workspace checked. */
function stateKey(repo: string, workspace: string, id: string): RecordKey {
  checkName('workspace', workspace);
  return recordKeys.state(repo, workspace, id);
}

/** A run's state, or `null` when the store holds none of its key. */
async function readState(read: RecordsRead, key: RecordKey): Promise<DataflowExecutionState | null> {
  const data = await read.get(key);
  return data === null ? null : decodeDataflowExecutionState(data);
}

/** The error of a run the store holds none of. */
function notFound(repo: string, workspace: string, id: string): Error {
  return new Error(`Execution ${id} not found in workspace '${workspace}' of ${repo}`);
}

/**
 * A run's state with a task's status set, and the task counted in the run's
 * summary as it finished.
 *
 * @throws {Error} When the run has no such task
 */
function withTaskStatus(state: DataflowExecutionState, task: string, status: DataflowTaskStatus, details: TaskStatusDetails = {}): DataflowExecutionState {
  const current = state.tasks.get(task);
  if (current === undefined) throw new Error(`Task '${task}' not found in execution ${state.id}`);
  const next: TaskState = {
    ...current,
    status,
    ...(details.cached !== undefined && { cached: some(details.cached) }),
    ...(details.outputHash !== undefined && { outputHash: some(details.outputHash) }),
    ...(details.error !== undefined && { error: some(details.error) }),
    ...(details.exitCode !== undefined && { exitCode: some(BigInt(details.exitCode)) }),
    ...(details.duration !== undefined && { duration: some(BigInt(details.duration)) }),
    completedAt: some(new Date()),
  };
  const tasks = new Map(state.tasks);
  tasks.set(task, next);
  if (status === 'completed' && details.cached === true) return { ...state, tasks, cached: state.cached + 1n };
  if (status === 'completed') return { ...state, tasks, executed: state.executed + 1n };
  if (status === 'failed') return { ...state, tasks, failed: state.failed + 1n };
  if (status === 'skipped') return { ...state, tasks, skipped: state.skipped + 1n };
  return { ...state, tasks };
}

/**
 * A run's state with its status set: ended, unless it is running, with its
 * error and its summary when given.
 */
function withStatus(
  state: DataflowExecutionState,
  status: 'running' | 'completed' | 'failed' | 'cancelled',
  details: ExecutionStatusDetails = {},
): DataflowExecutionState {
  const { summary } = details;
  return {
    ...state,
    status,
    ...(status !== 'running' && { completedAt: some(new Date()) }),
    ...(details.error !== undefined && details.error !== '' && { error: some(details.error) }),
    ...(summary !== undefined && {
      executed: BigInt(summary.executed),
      cached: BigInt(summary.cached),
      failed: BigInt(summary.failed),
      skipped: BigInt(summary.skipped),
    }),
  };
}

/**
 * A dataflow run's state, kept in the records a {@link WebStorage} keeps its
 * repositories in: each run's under its own key, so a workspace keeps every
 * run's, the latest sorting last by its UUIDv7.
 *
 * @remarks
 * Every change reads the state and writes it back in one transaction, so two
 * tabs changing one run lose neither's change. A run that has ended —
 * completed, failed or cancelled — keeps the state it ended with, whole: every
 * later write of it is dropped, and answers so. A workspace's removal, and its
 * repository's, delete its runs' states with its other records.
 *
 * @example
 * ```ts
 * const storage = await openWebStorage();
 * const orchestrator = new LocalOrchestrator(new WebStateStore(storage.adapters.records));
 * ```
 */
export class WebStateStore implements ExecutionStateStore {
  /**
   * @param records - The records the runs' states are kept in: a
   *   {@link WebStorage}'s, so its repositories and their runs' states are
   *   one store
   */
  constructor(private readonly records: RecordsAdapter) {}

  async create(state: DataflowExecutionState): Promise<void> {
    const key = stateKey(state.repo, state.workspace, state.id);
    await this.records.transact(async (tx) => {
      if ((await tx.get(key)) !== null) {
        throw new Error(`Execution ${state.id} already exists in workspace '${state.workspace}' of ${state.repo}`);
      }
      tx.put(key, encodeState(state));
    });
  }

  async read(repo: string, workspace: string, id: string): Promise<DataflowExecutionState | null> {
    return readState(this.records, stateKey(repo, workspace, id));
  }

  async readLatest(repo: string, workspace: string): Promise<DataflowExecutionState | null> {
    checkName('workspace', workspace);
    const [latest] = await this.records.scan([...recordKeys.kind(repo, 'state'), workspace], { reverse: true, limit: 1 });
    return latest === undefined ? null : decodeDataflowExecutionState(latest.value);
  }

  /** The summary of the workspace's latest run, from the record of its state. */
  async readLatestSummary(repo: string, workspace: string): Promise<ExecutionStateSummary | null> {
    const state = await this.readLatest(repo, workspace);
    return state === null ? null : executionStateSummary(state);
  }

  async update(state: DataflowExecutionState): Promise<StateWriteOutcome> {
    return this.change(state.repo, state.workspace, state.id, () => state);
  }

  async updateTaskStatus(
    repo: string,
    workspace: string,
    executionId: string,
    task: string,
    status: DataflowTaskStatus,
    details?: TaskStatusDetails,
  ): Promise<StateWriteOutcome> {
    return this.change(repo, workspace, executionId, (state) => withTaskStatus(state, task, status, details));
  }

  async updateStatus(
    repo: string,
    workspace: string,
    executionId: string,
    status: 'running' | 'completed' | 'failed' | 'cancelled',
    details?: ExecutionStatusDetails,
  ): Promise<StateWriteOutcome> {
    return this.change(repo, workspace, executionId, (state) => withStatus(state, status, details));
  }

  async recordEvent(repo: string, workspace: string, executionId: string, event: ExecutionEvent): Promise<StateWriteOutcome> {
    return this.change(repo, workspace, executionId, (state) => ({ ...state, events: [...state.events, event] }));
  }

  async getEventsSince(repo: string, workspace: string, executionId: string, sinceSeq: number): Promise<ExecutionEvent[]> {
    const state = await this.read(repo, workspace, executionId);
    if (state === null) return [];
    const since = BigInt(sinceSeq);
    return state.events.filter((event) => event.value.seq > since);
  }

  async delete(repo: string, workspace: string, executionId: string): Promise<void> {
    const key = stateKey(repo, workspace, executionId);
    await this.records.transact((tx) => {
      tx.delete(key);
      return Promise.resolve();
    });
  }

  /**
   * The run states the store holds of a repository, as stored: every run's,
   * each its own record, which a `replace` writes over in one transaction.
   */
  async readStored(repo: string): Promise<StoredRunState[]> {
    return (await this.records.scan(recordKeys.kind(repo, 'state'))).map(({ key, value }) => ({
      workspace: key[3]!,
      bytes: value,
      replace: (bytes) => this.records.transact((tx) => {
        tx.put(key, bytes);
        return Promise.resolve();
      }),
    }));
  }

  /**
   * Changes a run's state in one transaction: reads it, and writes what
   * `next` makes of it, unless the run has ended — completed, failed or
   * cancelled — which keeps the state it ended with.
   *
   * @returns `applied`, or `dropped` when the run has ended
   * @throws {Error} When the store holds no such run, or `next` throws
   */
  private async change(
    repo: string,
    workspace: string,
    id: string,
    next: (state: DataflowExecutionState) => DataflowExecutionState,
  ): Promise<StateWriteOutcome> {
    const key = stateKey(repo, workspace, id);
    return this.records.transact(async (tx) => {
      const current = await readState(tx, key);
      if (current === null) throw notFound(repo, workspace, id);
      if (current.status !== 'running') return 'dropped';
      tx.put(key, encodeState(next(current)));
      return 'applied';
    });
  }
}
