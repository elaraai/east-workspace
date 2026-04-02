/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Dataflow execution record.
 */
export interface DataflowExecution {
  /** Numeric execution ID */
  id: number;
  /** Repository name */
  repo: string;
  /** Workspace name */
  workspace: string;
  /** Execution status */
  status: 'starting' | 'running' | 'completed' | 'failed';
  /** When execution started */
  startedAt: string;
  /** When execution completed (if finished) */
  completedAt?: string;
  /** Total number of tasks (set when execution starts running) */
  taskCount?: number;
  /** Number of successfully completed tasks */
  completedCount: number;
  /** Number of failed tasks */
  failedCount: number;
  /** Number of skipped tasks */
  skippedCount: number;
  /** Number of cached tasks */
  cachedCount: number;
  /** Counter for next event sequence number */
  eventSeq: number;
  /** JSON-serialized task graph (set when execution starts running) */
  graph?: string;
}

/**
 * Task status within a dataflow execution.
 */
export interface TaskExecutionStatus {
  taskName: string;
  status: 'dispatched' | 'running' | 'success' | 'cached' | 'failed' | 'error' | 'skipped' | 'ready';
  outputHash?: string;
  outputPath?: string;
  taskHash?: string;
  inputHashes?: string[];
  exitCode?: number;
  error?: string;
  reason?: string;
  duration?: number;
  heartbeat?: number;
  readyAt?: string;
  completedAt?: string;
  failedAt?: string;
  skippedAt?: string;
}

/**
 * Dataflow event types recorded by the orchestrator.
 */
export interface DataflowEvent {
  seq: number;
  type: 'start' | 'complete' | 'cached' | 'failed' | 'error' | 'skipped';
  task: string;
  timestamp: string;
  duration?: number;
  exitCode?: number;
  message?: string;
  reason?: string;
}

/**
 * Cloud-agnostic interface for tracking dataflow execution state.
 *
 * Manages execution lifecycle, task statuses within executions,
 * and event recording.
 */
export interface ExecutionTracker {
  /** Create a new execution in 'starting' status. Returns the new execution. */
  createExecution(repo: string, workspace: string): Promise<DataflowExecution>;

  /** Transition execution from 'starting' to 'running' with graph and task count. */
  startExecution(
    repo: string,
    workspace: string,
    executionId: number,
    graph: string,
    taskCount: number,
  ): Promise<void>;

  /** Get an execution by ID, or the latest if executionId is omitted. */
  getExecution(
    repo: string,
    workspace: string,
    executionId?: number,
  ): Promise<DataflowExecution | null>;

  /** Update execution fields. */
  updateExecution(
    repo: string,
    workspace: string,
    executionId: number,
    updates: Partial<Pick<DataflowExecution, 'status' | 'completedAt' | 'completedCount' | 'failedCount' | 'skippedCount' | 'cachedCount' | 'eventSeq'>>,
  ): Promise<void>;

  /** Atomically increment execution counters. */
  incrementExecutionCounters(
    repo: string,
    workspace: string,
    executionId: number,
    increments: { completedCount?: number; failedCount?: number; skippedCount?: number; cachedCount?: number },
  ): Promise<void>;

  /** List executions for a workspace (newest first). */
  listExecutions(
    repo: string,
    workspace: string,
    limit?: number,
  ): Promise<DataflowExecution[]>;

  /** Get all task statuses for an execution. */
  getExecutionTasks(repo: string, executionId: number): Promise<TaskExecutionStatus[]>;

  /** Set (create/replace) task status for an execution. */
  setTaskStatus(
    repo: string,
    executionId: number,
    taskName: string,
    status: Omit<TaskExecutionStatus, 'taskName'>,
  ): Promise<void>;

  /** Update specific fields of a task status. */
  updateTaskStatus(
    repo: string,
    executionId: number,
    taskName: string,
    updates: Partial<Omit<TaskExecutionStatus, 'taskName'>>,
  ): Promise<void>;

  /** Get events for an execution with pagination. */
  getExecutionEvents(
    repo: string,
    executionId: number,
    offset?: number,
    limit?: number,
  ): Promise<{ events: DataflowEvent[]; total: number }>;

  /** Add an event to an execution. Returns the sequence number. */
  addExecutionEvent(
    repo: string,
    workspace: string,
    executionId: number,
    event: Omit<DataflowEvent, 'seq'>,
  ): Promise<number>;
}
