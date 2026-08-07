/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Orchestrator interface for dataflow execution.
 *
 * Abstracts the execution loop, enabling:
 * - LocalOrchestrator: In-process async loop with mutex
 * - StepFunctionsOrchestrator: AWS Step Functions state machine (in e3-aws)
 */

import type { PartitionProgress } from '@elaraai/e3-types';
import type { StorageBackend, LockHandle } from '../../storage/interfaces.js';
import type { TaskRunner } from '../../execution/interfaces.js';
import type { DataflowExecutionState, ExecutionEvent, FinalizeResult } from '../types.js';

/**
 * Handle to a running dataflow execution.
 */
export interface ExecutionHandle {
  /** Unique execution ID (string for UUID support) */
  readonly id: string;
  /** Repository identifier */
  readonly repo: string;
  /** Workspace name */
  readonly workspace: string;
}

/**
 * Status of a dataflow execution (summary view).
 */
export interface ExecutionStatus {
  /** Execution ID (string for UUID support) */
  id: string;
  /** Current state */
  state: 'running' | 'completed' | 'failed' | 'cancelled';
  /** Tasks that have completed successfully */
  completed: string[];
  /** Tasks currently running */
  running: string[];
  /** Tasks waiting to run */
  pending: string[];
  /** Tasks that failed */
  failed: string[];
  /** Tasks skipped due to upstream failure */
  skipped: string[];
  /** Error message if state is 'failed' */
  error?: string;
  /** Start time */
  startedAt: Date;
  /** Completion time */
  completedAt?: Date;
}

/**
 * Options for starting a dataflow execution.
 */
export interface OrchestratorStartOptions {
  /** Maximum concurrent task executions (default: 4) */
  concurrency?: number;
  /** Force re-execution even if cached (default: false) */
  force?: boolean;
  /** Filter to run only specific task(s) by exact name */
  filter?: string;
  /**
   * Pass `-v` to each task's runner (known runtimes only) so it prints
   * timing/perf to stderr (captured into the task's logs). A runtime
   * collaborator like {@link signal}/callbacks — supplied fresh per run and
   * never persisted, so it has no effect on the task hash or caching.
   */
  verbose?: boolean;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** External lock handle (if caller manages locking) */
  lock?: LockHandle;
  /** Task runner for executing individual tasks */
  runner?: TaskRunner;
  /** Maximum concurrent per-partition executions within each partitioned
   *  task (default: 4). Runtime-only: never affects hashes or caching. */
  partitionConcurrency?: number;
  /** Callback when a task starts */
  onTaskStart?: (name: string) => void;
  /** Callback when a task completes */
  onTaskComplete?: (result: TaskCompletedCallback) => void;
  /** Called as each unit of a partitioned task (slice execution or combine
   *  step) starts and completes. Callback-only progress — deliberately not
   *  persisted as execution events (the persisted event wire is frozen; see
   *  `ExecutionEventType`'s wire warning). */
  onPartitionProgress?: (taskName: string, progress: PartitionProgress) => void;
  /** Callback for task stdout */
  onStdout?: (taskName: string, data: string) => void;
  /** Callback for task stderr */
  onStderr?: (taskName: string, data: string) => void;
  /** Called when a root input dataset changes during execution */
  onInputChanged?: (path: string, previousHash: string, newHash: string) => void;
  /** Called when a task is invalidated for re-execution */
  onTaskInvalidated?: (taskName: string, reason: string) => void;
  /** Called when a task is deferred due to inconsistent input versions */
  onTaskDeferred?: (taskName: string, conflictPath: string) => void;
  /**
   * Polled by the execution loop (before each launch and each wait).
   * Return true to checkpoint: the loop stops launching, resets in-flight
   * tasks to pending, persists the state (still 'running'), releases locks,
   * and resolves wait() with `{ yielded: true }`. Continue the execution
   * later with resume(). Used by bounded-lifetime hosts (e.g. a Lambda
   * approaching its time limit); requires a state store to be useful.
   */
  shouldYield?: () => boolean;
}

/**
 * Options for resuming a yielded (or crashed) execution.
 *
 * Execution config (concurrency, force, filter) comes from the persisted
 * state and cannot be changed; runtime collaborators (runner, callbacks,
 * signal, shouldYield) are provided fresh by the resuming host.
 */
export interface ResumeOptions extends OrchestratorStartOptions {
  /**
   * Dataflow run ID to continue recording under. Pass the runId returned
   * by the original start()'s FinalizeResult/DataflowRun so the run record
   * stays continuous across yields; a fresh UUID is generated if omitted.
   */
  runId?: string;
}

/**
 * Callback data for task completion.
 */
export interface TaskCompletedCallback {
  /** Task name */
  name: string;
  /** Whether the task was cached */
  cached: boolean;
  /** Final state */
  state: 'success' | 'failed' | 'error' | 'skipped';
  /** Error message if state is 'error' */
  error?: string;
  /** Exit code if state is 'failed' */
  exitCode?: number;
  /** Duration in milliseconds */
  duration: number;
}

/**
 * Interface for dataflow orchestration.
 *
 * Orchestrators manage the execution loop, calling step functions in sequence
 * and handling concurrency, cancellation, and state persistence.
 */
export interface DataflowOrchestrator {
  /**
   * Start a dataflow execution.
   *
   * Acquires the workspace lock (if not provided) and begins execution.
   * Returns immediately with a handle that can be used to monitor progress.
   *
   * @param storage - Storage backend
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @param options - Execution options
   * @returns Execution handle
   *
   * @throws {WorkspaceNotFoundError} If workspace doesn't exist
   * @throws {WorkspaceNotDeployedError} If workspace has no package deployed
   * @throws {WorkspaceLockError} If workspace is locked by another process
   */
  start(
    storage: StorageBackend,
    repo: string,
    workspace: string,
    options?: OrchestratorStartOptions
  ): Promise<ExecutionHandle>;

  /**
   * Resume an execution that yielded (see OrchestratorStartOptions.shouldYield)
   * or whose host died mid-run. Reads the persisted state, resets any tasks
   * stranded in_progress back to pending (their finished work is recovered
   * via the execution cache), re-acquires locks, and continues the loop.
   *
   * Optional: only orchestrators with a state store can support it.
   *
   * @param storage - Storage backend
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @param executionId - ID of the persisted execution to resume
   * @param options - Runtime options (runner, callbacks, runId continuity)
   * @returns Execution handle (same id as the original execution)
   *
   * @throws {DataflowError} If there is no state store, the execution is
   *   unknown, or its status is not 'running'
   * @throws {WorkspaceLockError} If workspace is locked by another process
   */
  resume?(
    storage: StorageBackend,
    repo: string,
    workspace: string,
    executionId: string,
    options?: ResumeOptions
  ): Promise<ExecutionHandle>;

  /**
   * Wait for a dataflow execution to complete.
   *
   * Blocks until the execution completes (success, failure, or cancellation).
   *
   * @param handle - Execution handle from start()
   * @returns Final result
   */
  wait(handle: ExecutionHandle): Promise<FinalizeResult>;

  /**
   * Get the current status of a dataflow execution.
   *
   * @param handle - Execution handle from start()
   * @returns Current status
   */
  getStatus(handle: ExecutionHandle): Promise<ExecutionStatus>;

  /**
   * Cancel a running dataflow execution.
   *
   * Running tasks will be terminated. The execution will transition to
   * 'cancelled' state.
   *
   * @param handle - Execution handle from start()
   */
  cancel(handle: ExecutionHandle): Promise<void>;

  /**
   * Get events for a dataflow execution since a given sequence number.
   *
   * Used for polling/watching execution progress.
   *
   * @param handle - Execution handle from start()
   * @param sinceSeq - Only return events with seq > sinceSeq
   * @returns Array of events in sequence order
   */
  getEvents(handle: ExecutionHandle, sinceSeq: number): Promise<ExecutionEvent[]>;
}

/**
 * Convert execution state to status summary.
 */
export function stateToStatus(state: DataflowExecutionState): ExecutionStatus {
  const completed: string[] = [];
  const running: string[] = [];
  const pending: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];

  for (const [name, taskState] of state.tasks) {
    switch (taskState.status) {
      case 'completed':
        completed.push(name);
        break;
      case 'in_progress':
        running.push(name);
        break;
      case 'pending':
      case 'ready':
      case 'deferred':
        pending.push(name);
        break;
      case 'failed':
        failed.push(name);
        break;
      case 'skipped':
        skipped.push(name);
        break;
    }
  }

  // Get error value (handle Option type)
  const errorValue = state.error.type === 'some' ? state.error.value : undefined;

  // Get completedAt value (handle Option type)
  const completedAtValue = state.completedAt.type === 'some' ? state.completedAt.value : undefined;

  return {
    id: state.id,
    state: state.status as 'running' | 'completed' | 'failed' | 'cancelled',
    completed,
    running,
    pending,
    failed,
    skipped,
    error: errorValue,
    startedAt: state.startedAt,
    completedAt: completedAtValue,
  };
}
