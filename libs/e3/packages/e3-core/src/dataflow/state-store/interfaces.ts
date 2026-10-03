/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * State store interface for dataflow execution.
 *
 * Abstracts the persistence of execution state, enabling:
 * - InMemoryStateStore: For testing and simple cases
 * - FileStateStore: Local filesystem persistence (workspace/execution.beast2)
 * - DynamoDBStateStore: Cloud execution (in e3-aws)
 */

import type {
  DataflowExecutionState,
  ExecutionEvent,
  ExecutionStateSummary,
  TaskStatus,
} from '../types.js';

/**
 * Details for task status updates.
 */
export interface TaskStatusDetails {
  /** Whether the result was from cache */
  cached?: boolean;
  /** Output hash (for completed tasks) */
  outputHash?: string;
  /** Error message (for failed tasks) */
  error?: string;
  /** Exit code (for failed tasks) */
  exitCode?: number;
  /** Duration in milliseconds */
  duration?: number;
}

/**
 * Details for execution status updates.
 */
export interface ExecutionStatusDetails {
  /** Error message (for failed executions) */
  error?: string;
  /** Summary counts */
  summary?: {
    executed: number;
    cached: number;
    failed: number;
    skipped: number;
  };
}

/**
 * How a store took a write of a run's state.
 *
 * - `applied`: the store holds what was written.
 * - `dropped`: the run had ended — completed, failed or cancelled — so the
 *   store keeps the state it ended with, whole, and wrote nothing. A write that
 *   lands after a run's end, from its own loop or from another process, is
 *   dropped, never refused.
 * - `refused`: another process has moved the run on to a newer state that is
 *   not final, so this write, built on an older one, was not taken. Only a
 *   store a run's writers share across processes refuses: one process's writes
 *   of a run are one writer's, made in order, and never refuse each other.
 */
export type StateWriteOutcome = 'applied' | 'dropped' | 'refused';

/**
 * A run's state as a store holds it, in whatever form the release that wrote
 * it wrote: what a repository upgrade step reads, and writes back in another
 * form.
 */
export interface StoredRunState {
  /** The run's workspace */
  readonly workspace: string;
  /** The state's bytes, as stored */
  readonly bytes: Uint8Array;
  /**
   * Stores these bytes in the state's place, whatever the run's status: an
   * upgrade step's write, which changes the state's form and not the run, so a
   * run that has ended takes it too.
   *
   * @param bytes - The state's bytes, in another form
   */
  replace(bytes: Uint8Array): Promise<void>;
}

/**
 * Interface for persisting and retrieving execution state.
 *
 * Implementations must be thread-safe for concurrent access within a process.
 * For distributed execution (cloud), implementations should use optimistic
 * concurrency control (e.g., DynamoDB conditional writes).
 *
 * @remarks
 * All methods take repo and workspace parameters because cloud storage
 * (DynamoDB) needs both to identify an execution uniquely across repositories.
 * An execution's id is its run's UUIDv7, which the orchestrator mints.
 *
 * A run's state has one writer in each process: the orchestrator running it
 * writes it a write at a time, in the order the writes were made, each a
 * snapshot of the state as it was then. A store applies writes as they reach
 * it, even ones made at once.
 *
 * A run's end is final. Once a run is completed, failed or cancelled, every
 * write of it — a whole state of any status, a status, a task's status, an
 * event — is `dropped`, and the store keeps the state the run ended with,
 * whole. Every write answers how the store took it ({@link StateWriteOutcome}),
 * so the writer learns that the run ended, or was moved on, elsewhere.
 */
export interface ExecutionStateStore {
  /**
   * Create a new execution state.
   *
   * @param state - The initial execution state (contains repo and workspace)
   * @throws If an execution with the same ID already exists
   */
  create(state: DataflowExecutionState): Promise<void>;

  /**
   * Read an execution state by ID.
   *
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @param id - Execution ID
   * @returns The execution state, or null if not found
   */
  read(repo: string, workspace: string, id: string): Promise<DataflowExecutionState | null>;

  /**
   * Read the most recent execution for a workspace.
   *
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @returns The most recent execution state, or null if none exists
   */
  readLatest(repo: string, workspace: string): Promise<DataflowExecutionState | null>;

  /**
   * Read the summary of a workspace's most recent run: its id, status, times,
   * error and counts, and the sequence number of its last event.
   *
   * @remarks
   * A poll of the run, and a cancel, read it rather than the whole state,
   * which grows with the dataflow and with every event of the run. A poll then
   * reads the events past its cursor ({@link getEventsSince}) only when the
   * summary's last event is past it. A store that reads the whole state for it
   * derives it (`executionStateSummary`), as the file, in-memory and browser
   * stores do; a store whose reads cost by the byte keeps it beside the state,
   * written with each change.
   *
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @returns The summary of the run {@link readLatest} returns, or null if
   *   none exists
   */
  readLatestSummary(repo: string, workspace: string): Promise<ExecutionStateSummary | null>;

  /**
   * Update the entire execution state.
   *
   * This is used for bulk updates after a sequence of step functions.
   * Implementations may optimize by only writing changed fields.
   *
   * @param state - The updated execution state (contains repo and workspace)
   * @returns How the store took it: `dropped` once the run has ended
   */
  update(state: DataflowExecutionState): Promise<StateWriteOutcome>;

  /**
   * Update a task's status within an execution.
   *
   * This is a convenience method for updating a single task without
   * reading and writing the entire state.
   *
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @param executionId - Execution ID
   * @param task - Task name
   * @param status - New status
   * @param details - Additional details (output hash, error, etc.)
   * @returns How the store took it: `dropped` once the run has ended
   */
  updateTaskStatus(
    repo: string,
    workspace: string,
    executionId: string,
    task: string,
    status: TaskStatus,
    details?: TaskStatusDetails
  ): Promise<StateWriteOutcome>;

  /**
   * Update the execution's overall status.
   *
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @param executionId - Execution ID
   * @param status - New status ('running' | 'completed' | 'failed' | 'cancelled')
   * @param details - Additional details (error message, summary)
   * @returns How the store took it: `dropped` once the run has ended
   */
  updateStatus(
    repo: string,
    workspace: string,
    executionId: string,
    status: 'running' | 'completed' | 'failed' | 'cancelled',
    details?: ExecutionStatusDetails
  ): Promise<StateWriteOutcome>;

  /**
   * Record an event for an execution.
   *
   * Events are used for monitoring and debugging. They are append-only
   * and can be read with getEventsSince().
   *
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @param executionId - Execution ID
   * @param event - The event to record
   * @returns How the store took it: `dropped` once the run has ended
   */
  recordEvent(
    repo: string,
    workspace: string,
    executionId: string,
    event: ExecutionEvent
  ): Promise<StateWriteOutcome>;

  /**
   * Get events for an execution since a given sequence number.
   *
   * Used for polling/watching execution progress: a poll reads the events
   * past its cursor, which a store that keeps a run's events apart from its
   * state answers without reading the rest.
   *
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @param executionId - Execution ID
   * @param sinceSeq - Only return events with seq > sinceSeq
   * @returns Array of events in sequence order
   */
  getEventsSince(
    repo: string,
    workspace: string,
    executionId: string,
    sinceSeq: number
  ): Promise<ExecutionEvent[]>;

  /**
   * Delete an execution state.
   *
   * Used for cleanup after execution completion or for removing
   * abandoned executions.
   *
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @param executionId - Execution ID
   */
  delete(repo: string, workspace: string, executionId: string): Promise<void>;

  /**
   * Every run state the store holds of a repository, as it holds them: each
   * one's workspace and bytes, in whatever form the release that wrote it
   * wrote, and a way to replace them.
   *
   * @remarks
   * A repository upgrade step reads the store through this, since a state an
   * earlier release wrote does not decode as this release's, and writes each
   * one it carries forward back through its `replace`. The repository is held
   * still while a step runs, so no run's loop writes meanwhile.
   *
   * @param repo - Repository identifier
   * @returns The stored states
   */
  readStored(repo: string): Promise<StoredRunState[]>;
}
