/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { IntegerType, NullType, OptionType, lessFor, some, none, variant } from '@elaraai/east';
import {
  dataflowGetGraph,
  workspaceStatus,
  executionFindCurrent,
  executionReadLog,
  ExecutionNotFoundError,
  coreEventToApiEvent,
  coreStatusToApiStatus,
  type ApiDataflowEvent,
  type WorkspaceStatusResult as CoreWorkspaceStatusResult,
  type DatasetStatusInfo as CoreDatasetStatusInfo,
  type TaskStatusInfo as CoreTaskStatusInfo,
  type ExecutionEvent as CoreExecutionEvent,
  type ExecutionStateSummary,
  type DataflowExecutionStatus,
  type ExecutionProgress,
} from '@elaraai/e3-core/portable';
import type { DataflowOrchestrator, ExecutionStateStore, StorageBackend, TaskRunner } from '@elaraai/e3-core/portable';
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

/**
 * The budget a host's runners take from, as the dataflow routes serve it: its
 * capacity, and what the runners hold of it now.
 *
 * @remarks
 * e3-core's `Budget`, which a local server's runners hold, is one. The routes
 * read no more of it than this, so they take it from a host whose budget is
 * its own.
 */
export interface RunnerBudget {
  /** Runner processes at once. */
  readonly cores: number;
  /** Bytes of memory the runners may reserve between them. */
  readonly memory: number;
  /** Runner processes holding the budget now. */
  readonly inFlight: number;
  /** Bytes the runners hold now, each at the larger of its reservation and
   *  what it was last measured using. */
  readonly used: number;
}

/** A budget as the API serves it: its capacity, and what its runners hold of
 *  it now; `none` for a server whose runners hold no budget. */
function budgetView(budget: RunnerBudget | undefined): DataflowExecutionState['budget'] {
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
 * Returns 202 Accepted once the orchestrator has started the run, and leaves
 * nothing of the run in the request's host: the orchestrator runs it where it
 * runs its runs, and keeps its state in its state store, which
 * getDataflowExecution() polls. A run's end is the orchestrator's to handle
 * where it starts the run — a local one in its own process — so this never
 * waits on it.
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
    await orchestrator.start(storage, repoPath, workspace, {
      runner: options.runner,
      ...(options.width !== undefined && { width: options.width }),
      force: options.force,
      filter: options.filter,
      verbose: options.verbose,
    });

    // How the run ends is in its state, which a poll reads.
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

/** An API-visible event as the poll serves it. */
function apiEventValue(apiEvent: ApiDataflowEvent): DataflowExecutionState['events'][number] {
  switch (apiEvent.type) {
    case 'start':
      return variant('start', {
        task: apiEvent.task,
        timestamp: apiEvent.timestamp,
      });
    case 'complete':
      return variant('complete', {
        task: apiEvent.task,
        timestamp: apiEvent.timestamp,
        duration: apiEvent.duration ?? 0,
        peakBytes: apiEvent.peakBytes === undefined ? none : some(apiEvent.peakBytes),
      });
    case 'cached':
      return variant('cached', {
        task: apiEvent.task,
        timestamp: apiEvent.timestamp,
      });
    case 'failed':
      return variant('failed', {
        task: apiEvent.task,
        timestamp: apiEvent.timestamp,
        duration: apiEvent.duration ?? 0,
        exitCode: apiEvent.exitCode ?? BigInt(-1),
      });
    case 'error':
      return variant('error', {
        task: apiEvent.task,
        timestamp: apiEvent.timestamp,
        message: apiEvent.message ?? 'Unknown error',
      });
    case 'input_unavailable':
      return variant('input_unavailable', {
        task: apiEvent.task,
        timestamp: apiEvent.timestamp,
        reason: apiEvent.reason ?? 'Upstream task failed',
      });
    case 'requeued':
      // coreEventToApiEvent gives a requeue each of these.
      return variant('requeued', {
        task: apiEvent.task,
        timestamp: apiEvent.timestamp,
        unit: apiEvent.unit!,
        reason: variant(apiEvent.requeueReason!, null),
        peak: apiEvent.peak!,
        reserves: apiEvent.reserves!,
      });
  }
}

/** Whether one event sequence number comes before another. */
const seqBefore = lessFor(IntegerType);

/**
 * Get dataflow execution state (for polling).
 *
 * Returns the state of the workspace's latest run, as the state store keeps
 * it, and its events past the poll's cursor: the run in flight, whichever
 * process runs it, or the last to end. While the run is in flight, it carries
 * the tasks and units waiting for room and each split task's progress, which
 * the orchestrator running it keeps in memory; and it carries the server's
 * budget when it has one.
 *
 * @remarks
 * The poll reads the run's summary, not its whole state, and reads its events
 * only when the summary's last is past the cursor, so a poll that has every
 * event, or asks for none (`limit` 0), reads none. The cursor is the stored
 * sequence number of the last event the client has (`since`, 0 for none). The
 * response's `nextSeq` is the cursor past what the poll went through: the API
 * events it served and the events the API does not show between them, or
 * `since` when it went through none. The waits and the split tasks' progress
 * come from the orchestrator's memory, which holds none of a run another
 * process or instance runs.
 *
 * @param stateStore - The store the repository's runs keep their state in
 * @param orchestrator - The orchestrator that runs the repository's dataflows
 * @param repoPath - The repository's path
 * @param workspace - The workspace
 * @param options - The poll's cursor, and the most events it is served
 * @param budget - The server's budget, which its runners hold, if any
 * @returns The execution state, or `execution_not_found`
 */
export async function getDataflowExecution(
  stateStore: ExecutionStateStore,
  orchestrator: DataflowOrchestrator,
  repoPath: string,
  workspace: string,
  options: { since?: number; limit?: number } = {},
  budget?: RunnerBudget
): Promise<Response> {
  const since = BigInt(options.since ?? 0);
  let run: ExecutionStateSummary | null;
  let stored: CoreExecutionEvent[] = [];
  try {
    run = await stateStore.readLatestSummary(repoPath, workspace);
    if (run !== null && options.limit !== 0 && seqBefore(since, run.lastSeq)) {
      stored = await stateStore.getEventsSince(repoPath, workspace, run.id, options.since ?? 0);
    }
  } catch (err) {
    return sendError(DataflowExecutionStateType, errorToVariant(err));
  }
  if (run === null) {
    return sendError(DataflowExecutionStateType, variant('execution_not_found', {
      task: workspace,
    }));
  }

  // The API's events past the cursor, at most `limit` of them. The cursor
  // moves past each event served, and past each the API does not show — a run's
  // start and end, a split task's stages — up to the next served.
  const apiEvents: DataflowExecutionState['events'] = [];
  let nextSeq = since;
  for (const event of stored) {
    const apiEvent = coreEventToApiEvent(event);
    if (apiEvent !== null) {
      if (options.limit !== undefined && apiEvents.length >= options.limit) break;
      apiEvents.push(apiEventValue(apiEvent));
    }
    nextSeq = event.value.seq;
  }

  // Convert status to API format
  const apiStatus = coreStatusToApiStatus(run.status as DataflowExecutionStatus);
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
  const endTime = run.completedAt.type === 'some' ? run.completedAt.value.getTime() : Date.now();
  const duration = endTime - run.startedAt.getTime();

  // Build summary if not running
  let summary: DataflowExecutionState['summary'];
  if (run.status !== 'running') {
    summary = some({
      executed: run.executed,
      cached: run.cached,
      failed: run.failed,
      skipped: run.skipped,
      duration,
    });
  } else {
    summary = none;
  }

  // Get completedAt value (handle Option type)
  const completedAtValue = run.completedAt.type === 'some'
    ? some(run.completedAt.value.toISOString())
    : none;

  // The waits and each split task's progress, while the run is in flight:
  // nothing stores them, so the orchestrator answers them from its memory
  // where it runs the run, and has none of a run it does not hold.
  let live: ExecutionProgress | null = null;
  if (run.status === 'running') {
    try {
      live = await orchestrator.getProgress({ id: run.id, repo: repoPath, workspace });
    } catch {
      // Nothing is waiting that the poll can say.
    }
  }

  const state: DataflowExecutionState = {
    status,
    startedAt: run.startedAt.toISOString(),
    completedAt: completedAtValue,
    summary,
    events: apiEvents,
    nextSeq,
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
export function getDataflowBudget(budget: RunnerBudget | undefined): Response {
  return sendSuccess(OptionType(DataflowBudgetType), budgetView(budget));
}

/**
 * Cancel a running dataflow execution: the workspace's latest run, when its
 * summary says it is running.
 *
 * @param stateStore - The store the repository's runs keep their state in
 * @param orchestrator - The orchestrator that runs the repository's dataflows
 * @param repoPath - The repository's path
 * @param workspace - The workspace
 * @returns The response: null once the run is cancelled; `dataflow_error`
 *   when no run is running, the request meeting the workspace's state rather
 *   than a fault of the server's; or why else it is not
 */
export async function cancelDataflow(
  stateStore: ExecutionStateStore,
  orchestrator: DataflowOrchestrator,
  repoPath: string,
  workspace: string
): Promise<Response> {
  try {
    const run = await stateStore.readLatestSummary(repoPath, workspace);
    if (run === null || run.status !== 'running') {
      return sendError(NullType, variant('dataflow_error', {
        message: 'No active execution for this workspace',
      }));
    }

    await orchestrator.cancel({ id: run.id, repo: repoPath, workspace });

    return sendSuccess(NullType, null);
  } catch (err) {
    return sendError(NullType, errorToVariant(err));
  }
}
