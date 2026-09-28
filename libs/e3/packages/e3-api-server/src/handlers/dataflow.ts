/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { NullType, OptionType, some, none, variant } from '@elaraai/east';
import {
  dataflowGetGraph,
  workspaceStatus,
  executionFindCurrent,
  executionReadLog,
  ExecutionNotFoundError,
  coreEventToApiEvent,
  coreStatusToApiStatus,
  type WorkspaceStatusResult as CoreWorkspaceStatusResult,
  type DatasetStatusInfo as CoreDatasetStatusInfo,
  type TaskStatusInfo as CoreTaskStatusInfo,
  type DataflowExecutionState as CoreDataflowExecutionState,
  type DataflowExecutionStatus,
  type OrchestratorExecutionStatus,
} from '@elaraai/e3-core';
import type { Budget, DataflowOrchestrator, ExecutionStateStore, StorageBackend, TaskRunner } from '@elaraai/e3-core';
import { sendSuccess, sendError, sendSuccessWithStatus } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import {
  WorkspaceStatusResultType,
  DataflowGraphType,
  LogChunkType,
  DataflowExecutionStateType,
  DataflowBudgetType,
  type WorkspaceStatusResult,
  type DatasetStatusInfo,
  type TaskStatusInfo,
  type DataflowExecutionState,
} from '../types.js';

/**
 * Convert core DatasetStatusInfo to API type.
 */
function convertDatasetStatus(info: CoreDatasetStatusInfo): DatasetStatusInfo {
  let status: DatasetStatusInfo['status'];
  switch (info.status.type) {
    case 'unset':
      status = variant('unset', null);
      break;
    case 'stale':
      status = variant('stale', null);
      break;
    case 'up-to-date':
      status = variant('up-to-date', null);
      break;
  }

  return {
    path: info.path,
    status,
    hash: info.hash ? some(info.hash) : none,
    isTaskOutput: info.isTaskOutput,
    producedBy: info.producedBy ? some(info.producedBy) : none,
  };
}

/**
 * Convert core TaskStatusInfo to API type.
 */
function convertTaskStatus(info: CoreTaskStatusInfo): TaskStatusInfo {
  let status: TaskStatusInfo['status'];
  switch (info.status.type) {
    case 'up-to-date':
      status = variant('up-to-date', { cached: info.status.cached });
      break;
    case 'ready':
      status = variant('ready', null);
      break;
    case 'waiting':
      status = variant('waiting', { reason: info.status.reason });
      break;
    case 'in-progress':
      status = variant('in-progress', {
        pid: info.status.pid != null ? some(BigInt(info.status.pid)) : none,
        startedAt: info.status.startedAt ? some(info.status.startedAt) : none,
      });
      break;
    case 'failed':
      status = variant('failed', {
        exitCode: BigInt(info.status.exitCode),
        completedAt: info.status.completedAt ? some(info.status.completedAt) : none,
      });
      break;
    case 'error':
      status = variant('error', {
        message: info.status.message,
        completedAt: info.status.completedAt ? some(info.status.completedAt) : none,
      });
      break;
    case 'stale-running':
      status = variant('stale-running', {
        pid: info.status.pid != null ? some(BigInt(info.status.pid)) : none,
        startedAt: info.status.startedAt ? some(info.status.startedAt) : none,
      });
      break;
  }

  return {
    name: info.name,
    hash: info.hash,
    status,
    inputs: info.inputs,
    output: info.output,
    dependsOn: info.dependsOn,
    peakBytes: info.peakBytes === null ? none : some(BigInt(info.peakBytes)),
  };
}

/** A budget as the API serves it: its capacity, and what its runners hold of
 *  it now; `none` for a server whose runners hold no budget. */
function budgetView(budget: Budget | undefined): DataflowExecutionState['budget'] {
  if (budget === undefined) return none;
  return some({
    cores: BigInt(budget.cores),
    memory: BigInt(budget.memory),
    coresInUse: BigInt(budget.inFlight),
    memoryInUse: BigInt(budget.used),
  });
}

/**
 * Convert core WorkspaceStatusResult to API type.
 */
function convertWorkspaceStatus(result: CoreWorkspaceStatusResult): WorkspaceStatusResult {
  return {
    workspace: result.workspace,
    lock: result.lock && result.lock.pid !== undefined
      ? some({
          pid: BigInt(result.lock.pid),
          acquiredAt: result.lock.acquiredAt,
          bootId: result.lock.bootId ? some(result.lock.bootId) : none,
          command: result.lock.command ? some(result.lock.command) : none,
        })
      : none,
    datasets: result.datasets.map(convertDatasetStatus),
    tasks: result.tasks.map(convertTaskStatus),
    summary: {
      datasets: {
        total: BigInt(result.summary.datasets.total),
        unset: BigInt(result.summary.datasets.unset),
        stale: BigInt(result.summary.datasets.stale),
        upToDate: BigInt(result.summary.datasets.upToDate),
      },
      tasks: {
        total: BigInt(result.summary.tasks.total),
        upToDate: BigInt(result.summary.tasks.upToDate),
        ready: BigInt(result.summary.tasks.ready),
        waiting: BigInt(result.summary.tasks.waiting),
        inProgress: BigInt(result.summary.tasks.inProgress),
        failed: BigInt(result.summary.tasks.failed),
        error: BigInt(result.summary.tasks.error),
        staleRunning: BigInt(result.summary.tasks.staleRunning),
      },
    },
  };
}

/**
 * Start dataflow execution (non-blocking).
 *
 * Returns 202 Accepted immediately and runs execution in background.
 * The run's state, which the orchestrator keeps in its state store, is what
 * getDataflowExecution() polls.
 *
 * @param storage - Storage backend
 * @param orchestrator - The orchestrator that runs the repository's dataflows
 * @param repoPath - The repository's path
 * @param workspace - The workspace whose dataflow runs
 * @param options - The runner the run's tasks and units run on, which holds
 *   the server's budget; the tasks and units the loop keeps in flight, the
 *   orchestrator's own default when absent; and the run's force, filter and
 *   verbosity
 * @returns 202 once the run has started, or the error that stopped it
 */
export async function startDataflow(
  storage: StorageBackend,
  orchestrator: DataflowOrchestrator,
  repoPath: string,
  workspace: string,
  options: { runner: TaskRunner; width?: number; force: boolean; filter?: string; verbose?: boolean }
): Promise<Response> {
  try {
    // Start execution via orchestrator (acquires lock internally). The loop
    // keeps `width` tasks and units in flight, and the runner decides which
    // of them spawn.
    const handle = await orchestrator.start(storage, repoPath, workspace, {
      runner: options.runner,
      ...(options.width !== undefined && { width: options.width }),
      force: options.force,
      filter: options.filter,
      verbose: options.verbose,
    });

    // How the run ends is in its state, which a poll reads: its end is
    // awaited only so that a failure is never an unhandled rejection.
    void orchestrator.wait(handle).catch(() => {});

    // Return immediately with 202 Accepted
    return sendSuccessWithStatus(NullType, null, 202);
  } catch (err) {
    return sendError(NullType, errorToVariant(err));
  }
}

/**
 * Get workspace status (for polling).
 *
 * @param storage - Storage backend
 * @param runner - The runner the repository's tasks run on, which says
 *   whether an execution recorded running can still finish
 * @param repoPath - The repository's path
 * @param workspace - The workspace
 * @returns The response: the status, or the error
 */
export async function getDataflowStatus(
  storage: StorageBackend,
  runner: TaskRunner,
  repoPath: string,
  workspace: string
): Promise<Response> {
  try {
    const result = await workspaceStatus(storage, runner, repoPath, workspace);
    return sendSuccess(WorkspaceStatusResultType, convertWorkspaceStatus(result));
  } catch (err) {
    return sendError(WorkspaceStatusResultType, errorToVariant(err));
  }
}

/**
 * Get dependency graph.
 */
export async function getDataflowGraph(
  storage: StorageBackend,
  repoPath: string,
  workspace: string
): Promise<Response> {
  try {
    const graph = await dataflowGetGraph(storage, repoPath, workspace);
    return sendSuccess(DataflowGraphType, {
      tasks: graph.tasks.map((t) => ({
        name: t.name,
        hash: t.hash,
        inputs: t.inputs,
        output: t.output,
        dependsOn: t.dependsOn,
      })),
    });
  } catch (err) {
    return sendError(DataflowGraphType, errorToVariant(err));
  }
}

/**
 * Get task logs.
 */
export async function getTaskLogs(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  taskName: string,
  stream: 'stdout' | 'stderr',
  offset: number,
  limit: number
): Promise<Response> {
  try {
    // Find the current execution for this task
    const execution = await executionFindCurrent(storage, repoPath, workspace, taskName);
    if (!execution) {
      throw new ExecutionNotFoundError(taskName);
    }

    // Read logs
    const chunk = await executionReadLog(storage, repoPath, execution.taskHash, execution.inputsHash, execution.executionId, stream, { offset, limit });

    return sendSuccess(LogChunkType, {
      data: chunk.data,
      offset: BigInt(chunk.offset),
      size: BigInt(chunk.size),
      totalSize: BigInt(chunk.totalSize),
      complete: chunk.complete,
    });
  } catch (err) {
    return sendError(LogChunkType, errorToVariant(err));
  }
}

/**
 * Get dataflow execution state (for polling).
 *
 * Returns the state of the workspace's latest run, as the state store keeps
 * it, including events for progress tracking: the run in flight, whichever
 * process runs it, or the last to end. Supports offset/limit for paginating
 * events. While the run is in flight, it carries the tasks and units waiting
 * for room and each split task's progress, which the orchestrator running it
 * keeps in memory; and it carries the server's budget when it has one.
 *
 * @param stateStore - The store the repository's runs keep their state in
 * @param orchestrator - The orchestrator that runs the repository's dataflows
 * @param repoPath - The repository's path
 * @param workspace - The workspace
 * @param options - The window of events to serve
 * @param budget - The server's budget, which its runners hold, if any
 * @returns The execution state, or `execution_not_found`
 */
export async function getDataflowExecution(
  stateStore: ExecutionStateStore,
  orchestrator: DataflowOrchestrator,
  repoPath: string,
  workspace: string,
  options: { offset?: number; limit?: number } = {},
  budget?: Budget
): Promise<Response> {
  let coreState: CoreDataflowExecutionState | null;
  try {
    coreState = await stateStore.readLatest(repoPath, workspace);
  } catch (err) {
    return sendError(DataflowExecutionStateType, errorToVariant(err));
  }
  if (!coreState) {
    return sendError(DataflowExecutionStateType, variant('execution_not_found', {
      task: workspace,
    }));
  }

  // Filter to API-visible events FIRST, then slice: the client advances its
  // offset by API events RECEIVED, so slicing the unfiltered core list would
  // re-serve part of the window every time a core-only event (execution
  // lifecycle, reactive invalidation) sits inside it.
  const offset = options.offset ?? 0;
  const visibleEvents = [];
  for (const event of coreState.events) {
    const apiEvent = coreEventToApiEvent(event);
    if (apiEvent !== null) visibleEvents.push(apiEvent);
  }
  const totalApiEvents = visibleEvents.length;

  // Apply offset and limit over the API-visible sequence
  let events = visibleEvents.slice(offset);
  if (options.limit !== undefined) {
    events = events.slice(0, options.limit);
  }

  // Convert page events to East variant format
  const apiEvents: DataflowExecutionState['events'] = [];
  for (const apiEvent of events) {
    switch (apiEvent.type) {
      case 'start':
        apiEvents.push(variant('start', {
          task: apiEvent.task,
          timestamp: apiEvent.timestamp,
        }));
        break;
      case 'complete':
        apiEvents.push(variant('complete', {
          task: apiEvent.task,
          timestamp: apiEvent.timestamp,
          duration: apiEvent.duration ?? 0,
          peakBytes: apiEvent.peakBytes === undefined ? none : some(apiEvent.peakBytes),
        }));
        break;
      case 'cached':
        apiEvents.push(variant('cached', {
          task: apiEvent.task,
          timestamp: apiEvent.timestamp,
        }));
        break;
      case 'failed':
        apiEvents.push(variant('failed', {
          task: apiEvent.task,
          timestamp: apiEvent.timestamp,
          duration: apiEvent.duration ?? 0,
          exitCode: apiEvent.exitCode ?? BigInt(-1),
        }));
        break;
      case 'error':
        apiEvents.push(variant('error', {
          task: apiEvent.task,
          timestamp: apiEvent.timestamp,
          message: apiEvent.message ?? 'Unknown error',
        }));
        break;
      case 'input_unavailable':
        apiEvents.push(variant('input_unavailable', {
          task: apiEvent.task,
          timestamp: apiEvent.timestamp,
          reason: apiEvent.reason ?? 'Upstream task failed',
        }));
        break;
      case 'requeued':
        // coreEventToApiEvent gives a requeue each of these.
        apiEvents.push(variant('requeued', {
          task: apiEvent.task,
          timestamp: apiEvent.timestamp,
          unit: apiEvent.unit!,
          reason: variant(apiEvent.requeueReason!, null),
          peak: apiEvent.peak!,
          reserves: apiEvent.reserves!,
        }));
        break;
    }
  }

  // Convert status to API format
  const apiStatus = coreStatusToApiStatus(coreState.status as DataflowExecutionStatus);
  let status: DataflowExecutionState['status'];
  switch (apiStatus) {
    case 'running':
      status = variant('running', null);
      break;
    case 'completed':
      status = variant('completed', null);
      break;
    case 'failed':
      status = variant('failed', null);
      break;
    case 'aborted':
      status = variant('aborted', null);
      break;
  }

  // The run's duration, from its own times: until now while it runs
  const endTime = coreState.completedAt.type === 'some' ? coreState.completedAt.value.getTime() : Date.now();
  const duration = endTime - coreState.startedAt.getTime();

  // Build summary if not running
  let summary: DataflowExecutionState['summary'];
  if (coreState.status !== 'running') {
    summary = some({
      executed: coreState.executed,
      cached: coreState.cached,
      failed: coreState.failed,
      skipped: coreState.skipped,
      duration,
    });
  } else {
    summary = none;
  }

  // Get completedAt value (handle Option type)
  const completedAtValue = coreState.completedAt.type === 'some'
    ? some(coreState.completedAt.value.toISOString())
    : none;

  // The waits and each split task's progress, while the run is in flight:
  // nothing stores them, so the orchestrator answers them where it runs the
  // run, and a run that has ended, or that it does not hold, has none.
  let live: OrchestratorExecutionStatus | null = null;
  if (coreState.status === 'running') {
    try {
      live = await orchestrator.getStatus({ id: coreState.id, repo: repoPath, workspace });
    } catch {
      // Ended since it was read: nothing is waiting.
    }
  }

  const state: DataflowExecutionState = {
    status,
    startedAt: coreState.startedAt.toISOString(),
    completedAt: completedAtValue,
    summary,
    events: apiEvents,
    totalEvents: BigInt(totalApiEvents),
    budget: budgetView(budget),
    waiting: live?.waiting ?? [],
    splits: live?.splits ?? [],
  };

  return sendSuccess(DataflowExecutionStateType, state);
}

/**
 * The budget a run of the dataflow gets: the server's, which it shares with
 * everything else the server runs.
 *
 * @param budget - The server's budget, which its runners hold, if any
 * @returns The budget with what its runners hold now, or `none` for a server
 *   whose runners hold none
 */
export function getDataflowBudget(budget: Budget | undefined): Response {
  return sendSuccess(OptionType(DataflowBudgetType), budgetView(budget));
}

/**
 * Cancel a running dataflow execution: the workspace's latest run, when its
 * state says it is running.
 *
 * @param stateStore - The store the repository's runs keep their state in
 * @param orchestrator - The orchestrator that runs the repository's dataflows
 * @param repoPath - The repository's path
 * @param workspace - The workspace
 * @returns The response: null once the run is cancelled, or why it is not
 */
export async function cancelDataflow(
  stateStore: ExecutionStateStore,
  orchestrator: DataflowOrchestrator,
  repoPath: string,
  workspace: string
): Promise<Response> {
  try {
    const state = await stateStore.readLatest(repoPath, workspace);
    if (state === null || state.status !== 'running') {
      return sendError(NullType, variant('internal', {
        message: 'No active execution for this workspace',
      }));
    }

    await orchestrator.cancel({ id: state.id, repo: repoPath, workspace });

    return sendSuccess(NullType, null);
  } catch (err) {
    return sendError(NullType, errorToVariant(err));
  }
}
