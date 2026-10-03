/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { IntegerType, NullType, OptionType, none, printFor, some, variant } from '@elaraai/east';
import { dataflowForce } from '@elaraai/e3-types';
import type { LogChunk, DataflowBudget, DataflowGraph, DataflowResult, DataflowExecutionState, TaskExecutionResult } from './types.js';
import {
  LogChunkType,
  DataflowRequestType,
  DataflowGraphType,
  DataflowBudgetType,
  DataflowExecutionStateType,
} from './types.js';
import { get, post, verboseQuery, ApiError, type RequestOptions } from './http.js';

/**
 * Options for starting dataflow execution. The run takes the server's budget
 * of cores and memory.
 */
export interface DataflowOptions {
  /** The tasks the run re-executes even where the cache holds their results:
   *  `true` for every task — under a filter, the filter's task — the names of
   *  the tasks, or `false` for none (default). A start naming a task the graph
   *  does not have (`task_not_found`), or one the filter's run leaves out
   *  (`dataflow_error`), is refused before anything runs. */
  force?: boolean | readonly string[];
  /** One task's exact name: the run runs it and its dependency closure */
  filter?: string;
}

/**
 * Options for polling during dataflow execution.
 */
export interface DataflowPollOptions {
  /** Interval between polls in milliseconds (default: 500) */
  pollInterval?: number;
  /** Maximum time to wait for completion in milliseconds (default: 300000 = 5 minutes) */
  timeout?: number;
}

/**
 * Start dataflow execution on a workspace (non-blocking).
 *
 * Returns immediately after spawning execution in background.
 * Use dataflowExecutePoll() to poll for progress.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param dataflowOptions - Execution options
 * @param options - Request options including auth token
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function dataflowExecuteLaunch(
  url: string,
  repo: string,
  workspace: string,
  dataflowOptions: DataflowOptions = {},
  options: RequestOptions
): Promise<void> {
  const maxRetries = 5;
  const baseDelay = 200;

  for (let attempt = 0; ; attempt++) {
    try {
      await post(
        url,
        verboseQuery(`/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/dataflow`, options),
        {
          force: dataflowForce(dataflowOptions.force),
          filter: dataflowOptions.filter != null ? some(dataflowOptions.filter) : none,
        },
        DataflowRequestType,
        NullType,
        options
      );
      return;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'workspace_locked' && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Build DataflowResult from DataflowExecutionState.
 *
 * Converts events into task execution results.
 */
function buildDataflowResult(state: DataflowExecutionState): DataflowResult {
  const tasks: TaskExecutionResult[] = [];

  // Process events to build task results
  // Events are: start, complete, cached, failed, error, input_unavailable,
  // and a unit's requeued, which ends no task
  for (const event of state.events) {
    switch (event.type) {
      case 'complete':
        tasks.push({
          name: event.value.task,
          cached: false,
          state: variant('success', null),
          duration: event.value.duration,
        });
        break;
      case 'cached':
        tasks.push({
          name: event.value.task,
          cached: true,
          state: variant('success', null),
          duration: 0,
        });
        break;
      case 'failed':
        tasks.push({
          name: event.value.task,
          cached: false,
          state: variant('failed', { exitCode: event.value.exitCode }),
          duration: event.value.duration,
        });
        break;
      case 'error':
        tasks.push({
          name: event.value.task,
          cached: false,
          state: variant('error', { message: event.value.message }),
          duration: 0,
        });
        break;
      case 'input_unavailable':
        tasks.push({
          name: event.value.task,
          cached: false,
          state: variant('skipped', null),
          duration: 0,
        });
        break;
      // 'start' events don't create task results - they're tracked separately
    }
  }

  // Get summary from state or calculate from tasks
  const summary = state.summary.type === 'some' ? state.summary.value : {
    executed: BigInt(tasks.filter(t => !t.cached && t.state.type === 'success').length),
    cached: BigInt(tasks.filter(t => t.cached).length),
    failed: BigInt(tasks.filter(t => t.state.type === 'failed' || t.state.type === 'error').length),
    skipped: BigInt(tasks.filter(t => t.state.type === 'skipped').length),
    duration: 0,
  };

  return {
    success: state.status.type === 'completed',
    executed: summary.executed,
    cached: summary.cached,
    failed: summary.failed,
    skipped: summary.skipped,
    tasks,
    duration: summary.duration,
  };
}

/**
 * Execute dataflow on a workspace with client-side polling.
 *
 * Starts execution, polls until complete, and returns the result.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param dataflowOptions - Execution options
 * @param options - Request options including auth token
 * @param pollOptions - Polling configuration
 * @returns Dataflow execution result
 */
export async function dataflowExecute(
  url: string,
  repo: string,
  workspace: string,
  dataflowOptions: DataflowOptions = {},
  options: RequestOptions,
  pollOptions: DataflowPollOptions = {}
): Promise<DataflowResult> {
  const { pollInterval = 500, timeout = 300000 } = pollOptions;

  // Start execution
  await dataflowExecuteLaunch(url, repo, workspace, dataflowOptions, options);

  // Poll until complete, each poll served the events since the one before
  const startTime = Date.now();
  const events: DataflowExecutionState['events'] = [];
  let since = 0n;
  while (Date.now() - startTime < timeout) {
    const state = await dataflowExecutePoll(url, repo, workspace, { since }, options);
    events.push(...state.events);
    since = state.nextSeq;

    if (state.status.type === 'completed' || state.status.type === 'failed' || state.status.type === 'aborted') {
      return buildDataflowResult({ ...state, events });
    }

    await new Promise(r => setTimeout(r, pollInterval));
  }

  throw new Error('Dataflow execution timed out');
}

/**
 * Get the dependency graph for a workspace.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param options - Request options including auth token
 * @returns Dataflow graph with tasks and dependencies
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function dataflowGraph(
  url: string,
  repo: string,
  workspace: string,
  options: RequestOptions
): Promise<DataflowGraph> {
  return get(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/dataflow/graph`,
    DataflowGraphType,
    options
  );
}

/**
 * Options for reading task logs.
 */
export interface LogOptions {
  /** Which stream to read (default: 'stdout') */
  stream?: 'stdout' | 'stderr';
  /** Byte offset to start from (default: 0) */
  offset?: number;
  /** Maximum bytes to read (default: 65536) */
  limit?: number;
}

/**
 * Read task logs from a workspace.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param task - Task name
 * @param logOptions - Log reading options
 * @param options - Request options including auth token
 * @returns Log chunk with data and metadata
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function taskLogs(
  url: string,
  repo: string,
  workspace: string,
  task: string,
  logOptions: LogOptions = {},
  options: RequestOptions
): Promise<LogChunk> {
  const params = new URLSearchParams();
  if (logOptions.stream) params.set('stream', logOptions.stream);
  if (logOptions.offset != null) params.set('offset', String(logOptions.offset));
  if (logOptions.limit != null) params.set('limit', String(logOptions.limit));

  const query = params.toString();
  const path = `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/dataflow/logs/${encodeURIComponent(task)}${query ? `?${query}` : ''}`;

  return get(url, path, LogChunkType, options);
}

/**
 * Options for getting execution state.
 */
export interface ExecutionStateOptions {
  /** The poll's cursor: the `nextSeq` the poll before answered, after which
   *  the events are served (default: 0, every event) */
  since?: bigint;
  /** Maximum events to return (default: all); 0 for the run's state alone */
  limit?: number;
}

/** A cursor as a query spells it. */
const printSeq = printFor(IntegerType);

/**
 * Get dataflow execution state (for polling).
 *
 * Returns the current state of the workspace's latest run, and its events
 * past the poll's cursor. A client polling a run passes the `nextSeq` each
 * answer gives as the next poll's `since`, so each poll is served what is new.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param stateOptions - The poll's cursor, and the most events it is served
 * @param options - Request options including auth token
 * @returns Execution state with events and summary
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function dataflowExecutePoll(
  url: string,
  repo: string,
  workspace: string,
  stateOptions: ExecutionStateOptions = {},
  options: RequestOptions
): Promise<DataflowExecutionState> {
  const params = new URLSearchParams();
  if (stateOptions.since != null) params.set('since', printSeq(stateOptions.since));
  if (stateOptions.limit != null) params.set('limit', String(stateOptions.limit));

  const query = params.toString();
  const path = `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/dataflow/execution${query ? `?${query}` : ''}`;

  return get(url, path, DataflowExecutionStateType, options);
}

/**
 * Get the budget a run of a workspace's dataflow gets: the server's cores and
 * memory, which it shares with everything else the server runs, and what its
 * runners hold of it now.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param options - Request options including auth token
 * @returns The budget, or `null` for a server whose runners hold none
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function dataflowBudget(
  url: string,
  repo: string,
  workspace: string,
  options: RequestOptions
): Promise<DataflowBudget | null> {
  const budget = await get(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/dataflow/budget`,
    OptionType(DataflowBudgetType),
    options
  );
  return budget.type === 'some' ? budget.value : null;
}

/**
 * Cancel a running dataflow execution.
 *
 * @param url - Base URL of the API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param options - Request options (token, etc.)
 * @throws {ApiError} `dataflow_error`, "No active execution for this
 *   workspace", when no execution is running; or why else the cancel failed
 * @throws {AuthError} On 401 Unauthorized
 */
export async function dataflowCancel(
  url: string,
  repo: string,
  workspace: string,
  options: RequestOptions
): Promise<void> {
  await post(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/dataflow/cancel`,
    null,
    NullType,
    NullType,
    options
  );
}
