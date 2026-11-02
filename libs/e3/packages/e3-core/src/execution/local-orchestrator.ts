/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The dataflow on this machine: the root entry's `LocalOrchestrator`, whose
 * host is this process, and `dataflowExecute`, which runs a workspace's
 * dataflow through it.
 *
 * The orchestrator every backend shares is `dataflow/orchestrator/
 * LocalOrchestrator.ts`'s, which runs a run's tasks on the runner its start
 * names, or its host's. Here its host is this process: a task a run names no
 * runner for runs on this machine (`taskExecute`, `taskExecuteUnit`), and this
 * process owns a split task's own execution (`processOwner`). A run whose
 * units a local runner runs under a guarded budget starts each stage of a
 * split task with every unit at once (`LocalTaskRunner.firstWave`).
 *
 * @packageDocumentation
 */

import {
  LocalOrchestrator as SharedLocalOrchestrator,
  type LocalOrchestratorHost,
} from '../dataflow/orchestrator/LocalOrchestrator.js';
import type { ExecutionStateStore } from '../dataflow/state-store/interfaces.js';
import type { ExecutionHandle, OrchestratorStartOptions, ResumeOptions } from '../dataflow/orchestrator/interfaces.js';
import type { DataflowOptions, DataflowResult, TaskExecutionResult } from '../dataflow.js';
import type { LockHandle, StorageBackend } from '../storage/interfaces.js';
import { LocalTaskRunner, taskExecute, taskExecuteUnit } from './LocalTaskRunner.js';
import { processOwner } from './processHelpers.js';

/** This process, as a LocalOrchestrator's host: tasks run on this machine,
 *  and this process owns a split task's own execution. */
const THIS_PROCESS: LocalOrchestratorHost = {
  runner: { execute: taskExecute, executeUnit: taskExecuteUnit },
  owner: processOwner,
};

/**
 * Local orchestrator for in-process dataflow execution, on this machine.
 *
 * @remarks
 * The shared `LocalOrchestrator` with this process as its host: a run whose
 * start names no runner runs its tasks here, spawning their runners
 * (`taskExecute`), and a split task's own execution is recorded under this
 * process unless the run names another owner. A run whose runner is a
 * {@link LocalTaskRunner} starts a split task's stages as that runner says
 * (`firstWave`), unless the run says otherwise.
 *
 * - Uses step functions for each operation
 * - Per-dataset ref writes are atomic and independent (no mutex needed)
 * - Supports AbortSignal for cancellation
 * - Persists state through the provided state store
 * - Reactive: detects input changes after each task, invalidates and
 *   re-executes affected tasks until fixpoint
 */
export class LocalOrchestrator extends SharedLocalOrchestrator {
  /**
   * Create a new LocalOrchestrator.
   *
   * @param stateStore - Optional state store for persistence.
   *   If not provided, state is only kept in memory.
   */
  constructor(stateStore?: ExecutionStateStore) {
    super(stateStore, THIS_PROCESS);
  }

  override start(storage: StorageBackend, repo: string, workspace: string, options: OrchestratorStartOptions = {}): Promise<ExecutionHandle> {
    return super.start(storage, repo, workspace, withFirstWave(options));
  }

  override resume(storage: StorageBackend, repo: string, workspace: string, executionId: string, options: ResumeOptions = {}): Promise<ExecutionHandle> {
    return super.resume(storage, repo, workspace, executionId, withFirstWave(options));
  }
}

/** A run's options, with the first wave its local runner gives when the run
 *  names none: a run on another runner, or on this process with no budget,
 *  measures. */
function withFirstWave<T extends OrchestratorStartOptions>(options: T): T {
  if (options.firstWave !== undefined || !(options.runner instanceof LocalTaskRunner)) return options;
  return { ...options, firstWave: options.runner.firstWave };
}

/**
 * Execute all tasks in a workspace according to the dependency graph.
 *
 * Delegates to `LocalOrchestrator` which implements reactive fixpoint
 * execution using step functions. After each task completes, input changes
 * are detected and affected tasks are invalidated and re-executed.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param options - Execution options
 * @returns Result of the dataflow execution
 *
 * @throws {WorkspaceLockError} If workspace is locked by another process
 * @throws {WorkspaceNotFoundError} If workspace doesn't exist
 * @throws {WorkspaceNotDeployedError} If workspace has no package deployed
 * @throws {TaskNotFoundError} If filter specifies a task that doesn't exist
 * @throws {DataflowError} If execution fails for other reasons
 */
export async function dataflowExecute(
  storage: StorageBackend,
  repo: string,
  ws: string,
  options: DataflowOptions = {}
): Promise<DataflowResult> {
  const orchestrator = new LocalOrchestrator();

  const taskResults: TaskExecutionResult[] = [];

  const handle = await orchestrator.start(storage, repo, ws, {
    force: options.force,
    filter: options.filter,
    signal: options.signal,
    lock: options.lock,
    runner: options.runner,
    width: options.width,
    onTaskStart: options.onTaskStart,
    onTaskComplete: (result) => {
      taskResults.push({
        name: result.name,
        cached: result.cached,
        state: result.state,
        error: result.error,
        exitCode: result.exitCode,
        duration: result.duration,
      });
      options.onTaskComplete?.({
        name: result.name,
        cached: result.cached,
        state: result.state,
        error: result.error,
        exitCode: result.exitCode,
        duration: result.duration,
      });
    },
    onStdout: options.onStdout,
    onStderr: options.onStderr,
    onInputChanged: options.onInputChanged,
    onTaskInvalidated: options.onTaskInvalidated,
    onTaskDeferred: options.onTaskDeferred,
    onTaskWaiting: options.onTaskWaiting,
  });

  const result = await orchestrator.wait(handle);

  return {
    success: result.success,
    runId: result.runId,
    executed: result.executed,
    cached: result.cached,
    failed: result.failed,
    skipped: result.skipped,
    waiting: result.waiting,
    reexecuted: result.reexecuted,
    tasks: taskResults,
    duration: result.duration,
  };
}

/**
 * Execute dataflow with an externally-held lock.
 * The lock is released automatically when execution completes or fails.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param options - Execution options (lock must be provided)
 * @returns Promise that resolves when execution completes
 */
export async function dataflowStart(
  storage: StorageBackend,
  repo: string,
  ws: string,
  options: DataflowOptions & { lock: LockHandle }
): Promise<DataflowResult> {
  try {
    return await dataflowExecute(storage, repo, ws, options);
  } finally {
    await options.lock.release();
  }
}
