/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * API compatibility layer for dataflow execution.
 *
 * Maps e3-core internal event/status types to API-compatible types
 * used by e3-api-server and e3-api-client. This ensures consumers
 * of the API see a stable interface regardless of internal changes.
 *
 * Vocabulary mappings:
 * - e3-core 'cancelled' -> API 'aborted'
 * - e3-core 'running', with a cancel requested -> API 'stopping'
 * - e3-core 'task_started' -> API 'start'
 * - e3-core 'task_completed' (cached: false) -> API 'complete'
 * - e3-core 'task_completed' (cached: true) -> API 'cached'
 * - e3-core 'task_failed' -> API 'failed' or 'error'
 * - e3-core 'task_skipped' -> API 'input_unavailable'
 * - e3-core 'unit_requeued' -> API 'requeued'
 */

import { variant } from '@elaraai/east';
import type { DataflowEvent } from '@elaraai/e3-types';
import type {
  ExecutionEvent,
  DataflowExecutionStatus,
  ExecutionStateSummary,
} from './types.js';

/**
 * API-compatible execution status.
 */
export type ApiExecutionStatus = 'running' | 'stopping' | 'completed' | 'failed' | 'aborted';

/**
 * API-compatible execution summary.
 */
export interface ApiExecutionSummary {
  executed: bigint;
  cached: bigint;
  failed: bigint;
  skipped: bigint;
  /** Tasks left waiting on an unassigned input, and their dependents */
  waiting: bigint;
  duration: number;
}

/**
 * API-compatible execution state: the part of the API's that the stored state
 * holds. The budget, the waits and each split task's progress are a live
 * server's, which nothing stores.
 */
export interface ApiExecutionState {
  /** The run's id */
  runId: string;
  status: ApiExecutionStatus;
  startedAt: Date;
  completedAt: Date | null;
  summary: ApiExecutionSummary | null;
  /** The run's API-visible events past the poll's cursor */
  events: DataflowEvent[];
  /** The cursor past the events served: the next poll's `since` */
  nextSeq: bigint;
  /** The sequence number of the run's last event: a poll whose `nextSeq` is
   *  before it left events for the next */
  lastSeq: bigint;
}

// =============================================================================
// Conversion Functions
// =============================================================================

/**
 * Convert e3-core execution event to API-compatible event.
 *
 * Returns null for events that don't have an API equivalent
 * (e.g., execution_started, task_ready, execution_completed, execution_cancelled).
 *
 * @param event - The e3-core execution event (variant format)
 * @returns API-compatible event or null if no mapping exists
 */
export function coreEventToApiEvent(event: ExecutionEvent): DataflowEvent | null {
  switch (event.type) {
    case 'task_started':
      return variant('start', { task: event.value.task, timestamp: event.value.timestamp });

    case 'task_completed':
      if (event.value.cached) {
        return variant('cached', { task: event.value.task, timestamp: event.value.timestamp });
      }
      return variant('complete', {
        task: event.value.task,
        timestamp: event.value.timestamp,
        duration: Number(event.value.duration),
        peakBytes: event.value.peakBytes,
      });

    case 'task_failed':
      // An exit code is a failure; none is an error.
      if (event.value.exitCode.type === 'some') {
        return variant('failed', {
          task: event.value.task,
          timestamp: event.value.timestamp,
          duration: Number(event.value.duration),
          exitCode: event.value.exitCode.value,
        });
      }
      return variant('error', {
        task: event.value.task,
        timestamp: event.value.timestamp,
        message: event.value.error.type === 'some' ? event.value.error.value : 'Unknown error',
      });

    case 'task_skipped':
      return variant('input_unavailable', {
        task: event.value.task,
        timestamp: event.value.timestamp,
        reason: `Upstream task '${event.value.cause}' failed`,
      });

    case 'unit_requeued':
      return variant('requeued', {
        task: event.value.task,
        timestamp: event.value.timestamp,
        unit: event.value.unit,
        reason: event.value.reason,
        peak: event.value.peak,
        reserves: event.value.reserves,
      });

    // Events without API equivalents.
    // Reactive events (input_changed, task_invalidated, task_deferred) are
    // internal to the execution loop and not yet exposed via the API, and
    // neither are a split task's stages (task_split, task_merge_started,
    // task_merge_completed): the API's events are a task's, but for a unit
    // requeued.
    case 'execution_started':
    case 'task_ready':
    case 'execution_completed':
    case 'execution_cancelled':
    case 'input_changed':
    case 'task_invalidated':
    case 'task_deferred':
    case 'task_split':
    case 'task_merge_started':
    case 'task_merge_completed':
      return null;
  }
}

/**
 * Convert e3-core execution status to API status.
 *
 * @param status - The e3-core execution status
 * @returns API-compatible status string
 */
export function coreStatusToApiStatus(status: DataflowExecutionStatus): ApiExecutionStatus {
  switch (status) {
    case 'running':
      return 'running';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'aborted';
  }
}

/**
 * The API's status of a run, from its summary: a running run with a cancel
 * requested is `stopping` until it has stopped, and any other is its status's
 * ({@link coreStatusToApiStatus}).
 *
 * @param summary - The run's summary, as a store answers it
 * @returns API-compatible status string
 */
export function summaryToApiStatus(summary: Pick<ExecutionStateSummary, 'status' | 'cancelRequested'>): ApiExecutionStatus {
  if (summary.status === 'running' && summary.cancelRequested) return 'stopping';
  return coreStatusToApiStatus(summary.status as DataflowExecutionStatus);
}

/**
 * Convert e3-core execution state to API-compatible state.
 *
 * @param state - The run's summary (`ExecutionStateSummary`), as a store
 *   answers it; a whole state's is `executionStateSummary(state)`
 * @param events - The events past the poll's cursor, at most its limit, and
 *   none past the summary's last
 * @param nextSeq - The cursor past those events: the next poll's `since`
 * @param duration - Total execution duration in milliseconds
 * @returns API-compatible execution state, naming the run and its last event
 */
export function coreStateToApiState(
  state: Pick<ExecutionStateSummary, 'id' | 'status' | 'startedAt' | 'completedAt' | 'executed' | 'cached' | 'failed' | 'skipped' | 'waiting' | 'lastSeq' | 'cancelRequested'>,
  events: ExecutionEvent[],
  nextSeq: bigint,
  duration: number
): ApiExecutionState {
  // Convert events, filtering out those without API equivalents
  const apiEvents: DataflowEvent[] = [];
  for (const event of events) {
    const apiEvent = coreEventToApiEvent(event);
    if (apiEvent !== null) {
      apiEvents.push(apiEvent);
    }
  }

  // Build summary if execution is complete
  let summary: ApiExecutionSummary | null = null;
  if (state.status !== 'running') {
    summary = {
      executed: state.executed,
      cached: state.cached,
      failed: state.failed,
      skipped: state.skipped,
      waiting: state.waiting,
      duration,
    };
  }

  return {
    runId: state.id,
    status: summaryToApiStatus(state),
    startedAt: state.startedAt,
    completedAt: state.completedAt.type === 'some' ? state.completedAt.value : null,
    summary,
    events: apiEvents,
    nextSeq,
    lastSeq: state.lastSeq,
  };
}
