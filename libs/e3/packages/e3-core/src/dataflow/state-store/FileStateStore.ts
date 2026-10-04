/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * File-based implementation of ExecutionStateStore.
 *
 * Persists a workspace's latest execution state, whose id is its run's, to
 * `workspaces/{ws}/execution.beast2`, and the run's events apart from it, in
 * segments, to `workspaces/{ws}/execution-events/{runId}/{first}.beast2`.
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { IntegerType, encodeBeast2For, parseFor, printFor, some } from '@elaraai/east';
import { decodeDataflowExecutionState, executionStateSummary } from '@elaraai/e3-types';
import type {
  ExecutionStateStore,
  StateWriteOutcome,
  StoredRunState,
  TaskStatusDetails,
  ExecutionStatusDetails,
} from './interfaces.js';
import {
  DataflowExecutionStateType,
  type DataflowExecutionState,
  type ExecutionEvent,
  type ExecutionStateSummary,
  type TaskState,
  type TaskStatus,
} from '../types.js';
import { checkId, checkName, isNotFoundError } from '../../errors.js';
import { withKeyedLock } from '../../keyed-mutex.js';
import { isUuidv7 } from '../../uuid.js';
// The one atomic write every local record goes through: staged as a `.partial`
// gc sweeps, and renamed over the record with the shared Windows retry budget.
import { atomicWriteFile } from '../../storage/local/localHelpers.js';
import { compareEventSeqs, eventsSince, planEventAppend, segmentBefore, stateWithoutEvents, type EventSegment } from './events.js';

// The state is written at this e3's version, and read at any version it
// reads (decodeDataflowExecutionState).
const encode = encodeBeast2For(DataflowExecutionStateType);

/** The directory, in a workspace's, of its runs' events. */
const EVENTS_DIR = 'execution-events';

const printSeq = printFor(IntegerType);
const parseSeq = parseFor(IntegerType);

/** A segment's file name: its first event's sequence number, in twenty
 *  digits, so the names sort as the numbers do. */
function segmentName(first: bigint): string {
  return `${printSeq(first).padStart(20, '0')}.beast2`;
}

/** The first event's sequence number a segment's file name holds; null for
 *  a file that is no segment, such as a write's `.partial`. */
function segmentKey(name: string): bigint | null {
  if (!/^\d{20}\.beast2$/.test(name)) return null;
  const parsed = parseSeq(name.slice(0, 20));
  return parsed.success ? parsed.value : null;
}

// Type helper for mutable state (removes readonly)
type Mutable<T> = { -readonly [P in keyof T]: T[P] extends object ? Mutable<T[P]> : T[P] };

/**
 * File-based state store for local filesystem persistence.
 *
 * @remarks
 * - Uses atomic writes (write to temp, then rename) for durability
 * - State is stored in beast2 binary format for type safety
 * - A run's events are kept apart from its state, in segments of at most a
 *   thousand, each a file named by its first event: a write appends the
 *   events the run added since its last, rewriting at most the segment it
 *   last wrote, before it writes the state that numbers them; a poll reads
 *   the segments past its cursor, and not the state
 * - Changes a workspace's state one at a time within a process: each reads
 *   the file, and writes it back, under an in-process lock of the file's
 *   path, so changes made at once never write over each other
 * - A run that has ended keeps the state it ended with: every later write is
 *   dropped, as is a write of a run a later one has replaced
 * - A new run's state replaces the workspace's, and the events of the run it
 *   replaces go with it
 * - Suitable for local CLI and API server usage
 */
export class FileStateStore implements ExecutionStateStore {
  /**
   * Create a new FileStateStore.
   *
   * @param workspacesDir - Path to the workspaces directory (e.g., repo/workspaces)
   */
  constructor(private readonly workspacesDir: string) {}

  /**
   * Get the path to a workspace's directory.
   */
  private workspacePath(workspace: string): string {
    checkName('workspace', workspace);
    return join(this.workspacesDir, workspace);
  }

  /**
   * Get the path to a workspace's execution state file.
   */
  private statePath(workspace: string): string {
    return join(this.workspacePath(workspace), 'execution.beast2');
  }

  /** The directory of a run's events, its id checked: a UUIDv7, which names
   *  a directory of the workspace's and no other. */
  private eventsPath(workspace: string, runId: string): string {
    checkId('run id', runId);
    return join(this.workspacePath(workspace), EVENTS_DIR, runId);
  }

  async create(state: DataflowExecutionState): Promise<void> {
    const path = this.statePath(state.workspace);
    await withKeyedLock(path, async () => {
      // Check if execution already exists
      const existing = await this.read(state.repo, state.workspace, state.id);
      if (existing) {
        throw new Error(`Execution ${state.id} already exists in workspace '${state.workspace}'`);
      }

      // The run's events, then the state that numbers them, which replaces the
      // run before it, whose events go with it.
      await this.appendEvents(state.workspace, state.id, state.events);
      await atomicWriteFile(path, encode(stateWithoutEvents(state)));
      await this.removeEventsBut(state.workspace, state.id);
    });
  }

  async read(repo: string, workspace: string, id: string): Promise<DataflowExecutionState | null> {
    const path = this.statePath(workspace);

    try {
      const data = await fs.readFile(path);
      const state = decodeDataflowExecutionState(data);

      // Check if this is the requested execution
      if (state.id !== id) {
        return null;
      }

      // Verify repo matches (if stored)
      if (state.repo && state.repo !== repo) {
        return null;
      }

      return state;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async readLatest(_repo: string, workspace: string): Promise<DataflowExecutionState | null> {
    const path = this.statePath(workspace);

    try {
      const data = await fs.readFile(path);
      return decodeDataflowExecutionState(data);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  /** The summary of the workspace's run, read from its file whole: the file
   *  holds the run's state alone, its events apart. */
  async readLatestSummary(repo: string, workspace: string): Promise<ExecutionStateSummary | null> {
    const state = await this.readLatest(repo, workspace);
    return state === null ? null : executionStateSummary(state);
  }

  async update(state: DataflowExecutionState): Promise<StateWriteOutcome> {
    const path = this.statePath(state.workspace);
    return withKeyedLock(path, () => this.put(path, state));
  }

  async updateTaskStatus(
    repo: string,
    workspace: string,
    executionId: string,
    task: string,
    status: TaskStatus,
    details?: TaskStatusDetails
  ): Promise<StateWriteOutcome> {
    return this.change(repo, workspace, executionId, (state) => {
      const taskState = state.tasks.get(task) as Mutable<TaskState> | undefined;
      if (!taskState) {
        throw new Error(`Task '${task}' not found in execution ${executionId}`);
      }

      const mutableState = state as Mutable<DataflowExecutionState>;

      taskState.status = status;
      if (details) {
        if (details.cached !== undefined) taskState.cached = some(details.cached);
        if (details.outputHash !== undefined) taskState.outputHash = some(details.outputHash);
        if (details.error !== undefined) taskState.error = some(details.error);
        if (details.exitCode !== undefined) taskState.exitCode = some(BigInt(details.exitCode));
        if (details.duration !== undefined) taskState.duration = some(BigInt(details.duration));
      }
      taskState.completedAt = some(new Date());

      // Update counters based on status
      if (status === 'completed' && details?.cached) {
        mutableState.cached = state.cached + 1n;
      } else if (status === 'completed') {
        mutableState.executed = state.executed + 1n;
      } else if (status === 'failed') {
        mutableState.failed = state.failed + 1n;
      } else if (status === 'skipped') {
        mutableState.skipped = state.skipped + 1n;
      }
    });
  }

  async updateStatus(
    repo: string,
    workspace: string,
    executionId: string,
    status: 'running' | 'completed' | 'failed' | 'cancelled',
    details?: ExecutionStatusDetails
  ): Promise<StateWriteOutcome> {
    return this.change(repo, workspace, executionId, (state) => {
      const mutableState = state as Mutable<DataflowExecutionState>;

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
    });
  }

  async recordEvent(
    repo: string,
    workspace: string,
    executionId: string,
    event: ExecutionEvent
  ): Promise<StateWriteOutcome> {
    return this.change(repo, workspace, executionId, (state) => {
      // Appended to the run's events with the state's write
      (state.events as ExecutionEvent[]).push(event);
    });
  }

  /** The events of the run past the cursor, from its segments alone: a run
   *  whose id is no UUIDv7, which names no run, has none. */
  async getEventsSince(
    _repo: string,
    workspace: string,
    executionId: string,
    sinceSeq: number,
    limit?: number
  ): Promise<ExecutionEvent[]> {
    checkName('workspace', workspace);
    if (!isUuidv7(executionId)) return [];
    const dir = this.eventsPath(workspace, executionId);
    return eventsSince(await this.segmentKeys(dir), (first) => this.readSegment(dir, first), BigInt(sinceSeq), limit);
  }

  async delete(_repo: string, workspace: string, executionId: string): Promise<void> {
    const statePath = this.statePath(workspace);
    await withKeyedLock(statePath, async () => {
      // Only delete if the stored execution matches the requested ID
      const state = await this.readLatest(_repo, workspace);
      if (state && state.id === executionId) {
        try {
          await fs.unlink(statePath);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw err;
          }
        }
      }
      // And the run's events, whichever run the file holds
      if (isUuidv7(executionId)) await fs.rm(this.eventsPath(workspace, executionId), { recursive: true, force: true });
    });
  }

  /**
   * The run states the store holds, as stored: each workspace's file, whose
   * run is the workspace's latest. A file is replaced, and a segment of its
   * run's events written, under its lock, as a run's writes are.
   */
  async readStored(_repo: string): Promise<StoredRunState[]> {
    let workspaces: string[];
    try {
      workspaces = await fs.readdir(this.workspacesDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const stored: StoredRunState[] = [];
    for (const workspace of workspaces.sort()) {
      const path = join(this.workspacesDir, workspace, 'execution.beast2');
      let bytes: Uint8Array;
      try {
        bytes = await fs.readFile(path);
      } catch (err) {
        // A workspace that has had no run, or an entry that is no workspace's
        // directory.
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') continue;
        throw err;
      }
      stored.push({
        workspace,
        bytes,
        replace: (next) => withKeyedLock(path, () => atomicWriteFile(path, next)),
        writeEvents: (runId: string, segment: EventSegment) => withKeyedLock(path, () =>
          atomicWriteFile(join(this.eventsPath(workspace, runId), segmentName(segment.first)), segment.bytes)),
      });
    }
    return stored;
  }

  /**
   * Check if an incomplete execution exists for a workspace.
   *
   * An execution is incomplete if its status is 'running'.
   * This is used to detect crash recovery scenarios.
   *
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @returns The incomplete execution if one exists, null otherwise
   */
  async getIncompleteExecution(repo: string, workspace: string): Promise<DataflowExecutionState | null> {
    const state = await this.readLatest(repo, workspace);
    if (state && state.status === 'running') {
      return state;
    }
    return null;
  }

  /**
   * Changes a run's state under its file's lock: reads it, applies `change`
   * to it, and writes it back, with any events `change` adds, unless the run
   * has ended.
   *
   * @throws {Error} When the file holds no such run, or `change` throws
   */
  private async change(
    repo: string,
    workspace: string,
    executionId: string,
    change: (state: DataflowExecutionState) => void
  ): Promise<StateWriteOutcome> {
    const path = this.statePath(workspace);
    return withKeyedLock(path, async () => {
      const state = await this.read(repo, workspace, executionId);
      if (!state) {
        throw new Error(`Execution ${executionId} not found in workspace '${workspace}'`);
      }
      // A run that has ended keeps the state it ended with, task and event
      // included.
      if (state.status !== 'running') return 'dropped';
      change(state);
      await this.appendEvents(workspace, executionId, state.events);
      await atomicWriteFile(path, encode(stateWithoutEvents(state)));
      return 'applied';
    });
  }

  /**
   * Writes a run's state over the workspace's file, which its caller holds the
   * lock of, after the events it holds: unless the file holds a run that has
   * ended, or another run, which a later one replaced this one with.
   */
  private async put(path: string, state: DataflowExecutionState): Promise<StateWriteOutcome> {
    try {
      const current = decodeDataflowExecutionState(await fs.readFile(path));
      if (current.id !== state.id || current.status !== 'running') return 'dropped';
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await this.appendEvents(state.workspace, state.id, state.events);
    await atomicWriteFile(path, encode(stateWithoutEvents(state)));
    return 'applied';
  }

  /**
   * Appends events to a run's segments ({@link planEventAppend}), under the
   * lock of the workspace's state: the segments from the first new event on
   * removed, the segment before it filled, the rest written after it.
   */
  private async appendEvents(workspace: string, runId: string, events: readonly ExecutionEvent[]): Promise<void> {
    if (events.length === 0) return;
    const dir = this.eventsPath(workspace, runId);
    const held = await this.segmentKeys(dir);
    const before = segmentBefore(held, events);
    const bytes = before === null ? null : await this.readSegment(dir, before);
    const { remove, put } = planEventAppend(held, before === null || bytes === null ? null : { first: before, bytes }, events);
    for (const first of remove) await fs.rm(join(dir, segmentName(first)), { force: true });
    for (const segment of put) await atomicWriteFile(join(dir, segmentName(segment.first)), segment.bytes);
  }

  /** The keys of a run's segments, in order: none when it has no events. */
  private async segmentKeys(dir: string): Promise<bigint[]> {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch (err) {
      if (isNotFoundError(err)) return [];
      throw err;
    }
    return names.flatMap((name) => {
      const key = segmentKey(name);
      return key === null ? [] : [key];
    }).sort(compareEventSeqs);
  }

  /** A segment's bytes; null when it is gone. */
  private async readSegment(dir: string, first: bigint): Promise<Uint8Array | null> {
    try {
      return await fs.readFile(join(dir, segmentName(first)));
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }

  /** Removes the events of every run of the workspace but one: those of the
   *  run its state replaced. */
  private async removeEventsBut(workspace: string, runId: string): Promise<void> {
    const dir = join(this.workspacePath(workspace), EVENTS_DIR);
    let runs: string[];
    try {
      runs = await fs.readdir(dir);
    } catch (err) {
      if (isNotFoundError(err)) return;
      throw err;
    }
    for (const run of runs) {
      if (run !== runId) await fs.rm(join(dir, run), { recursive: true, force: true });
    }
  }
}
