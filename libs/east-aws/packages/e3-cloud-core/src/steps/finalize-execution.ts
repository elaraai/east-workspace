/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * finalize-execution.ts - Updates execution state when dataflow completes
 *
 * Called at the end of Step Functions before success/fail terminal states.
 * Uses e3-core stepFinalize to update execution status and compute summary.
 * Also finalizes the DataflowRun record with task execution details.
 */

import { stepFinalize } from '@elaraai/e3-core';
import { variant, some } from '@elaraai/east';
import type { DataflowRun } from '@elaraai/e3-types';
import type { DataflowStorage } from '../dataflow-storage.js';
import type { DataflowRunStore } from '../dataflow-run-store.js';

export interface FinalizeExecutionEvent {
  repo: string;
  workspace: string;
  /** Numeric execution ID */
  executionId: number;
  status: 'completed' | 'failed';
  /** UUIDv7 run ID for DataflowRun tracking */
  runId: string;
  /** Task execution records from the state machine (taskName -> { taskExecutionId, cached }) */
  taskResults?: Array<{
    taskName: string;
    taskExecutionId?: string;
    cached: boolean;
  }>;
}

export interface FinalizeExecutionResult {
  success: boolean;
  executed?: number;
  cached?: number;
  failed?: number;
  skipped?: number;
  reexecuted?: number;
  duration?: number;
}

/**
 * Finalize execution by updating status, computing summary,
 * and writing the final DataflowRun record.
 *
 * Uses e3-core stepFinalize to update the execution state with final
 * status, completedAt timestamp, and summary counts.
 */
export interface FinalizeExecutionDeps {
  storage: DataflowStorage;
  dataflowRuns: DataflowRunStore;
}

export async function handleFinalizeExecution(deps: FinalizeExecutionDeps, event: FinalizeExecutionEvent): Promise<FinalizeExecutionResult> {
  const { storage, dataflowRuns } = deps;
  const { repo, workspace, executionId, runId, taskResults } = event;
  const execId = executionId.toString().padStart(10, '0');

  console.log(`Finalizing execution ${executionId} for workspace ${workspace} (run ${runId})`);

  try {
    // Read execution state
    const state = await storage.executions.read(repo, workspace, execId);
    if (!state) {
      console.error(`Execution ${executionId} not found`);
      return { success: false };
    }

    // Build task lookup map for O(1) version vector resolution (keyed by task.output path)
    const graph = state.graph.type === 'some' ? state.graph.value : null;
    const tasksByName = new Map(graph?.tasks.map(t => [t.name, t]) ?? []);

    // Idempotency guard: if the execution is already in a terminal state
    // (completed/failed/cancelled), skip stepFinalize to avoid duplicate events
    // on Step Functions retry. The DataflowRun write below is naturally idempotent.
    const isAlreadyFinalized = state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled';

    let result: { success: boolean; executed: number; cached: number; failed: number; skipped: number; reexecuted: number; duration: number };
    let wasCancelled: boolean;

    if (isAlreadyFinalized) {
      console.log(`Execution ${executionId} already finalized (status=${state.status}), skipping stepFinalize`);
      wasCancelled = state.status === 'cancelled';
      const startTime = state.startedAt.getTime();
      const completedTime = state.completedAt.type === 'some' ? state.completedAt.value.getTime() : Date.now();
      result = {
        success: state.failed === 0n && !wasCancelled,
        executed: Number(state.executed),
        cached: Number(state.cached),
        failed: Number(state.failed),
        skipped: Number(state.skipped),
        reexecuted: Number(state.reexecuted),
        duration: completedTime - startTime,
      };
    } else {
      // Check if execution was cancelled - preserve that status
      wasCancelled = state.status === 'cancelled';

      // Use stepFinalize to update state with completion status
      const finalized = stepFinalize(state, runId);

      // Restore cancelled status if it was cancelled (stepFinalize overwrites with completed/failed)
      if (wasCancelled) {
        (state as { status: string }).status = 'cancelled';
      }

      // Save updated state
      await storage.executions.update(state);

      result = finalized.result;
    }

    // Finalize the DataflowRun record
    const existingRun = await dataflowRuns.get(repo, workspace, runId);
    if (existingRun) {
      // Build taskExecutions map from the task results
      const taskExecutions = new Map<string, { executionId: string; cached: boolean; outputVersions: Map<string, string>; executionCount: bigint }>();
      if (taskResults) {
        for (const tr of taskResults) {
          if (tr.taskExecutionId) {
            // Version vectors are keyed by task output path (e.g. /out/task-a), not task name
            const task = tasksByName.get(tr.taskName);
            taskExecutions.set(tr.taskName, {
              executionId: tr.taskExecutionId,
              cached: tr.cached,
              outputVersions: task ? (state.versionVectors.get(task.output) ?? new Map()) : new Map(),
              // Each task executes at most once per dispatch cycle; re-execution creates a new dispatch
              executionCount: 1n,
            });
          }
        }
      }

      // Also build from execution state tasks if taskResults not available
      if (!taskResults || taskResults.length === 0) {
        for (const [taskName, taskState] of state.tasks) {
          const isCached = taskState.cached.type === 'some' ? taskState.cached.value : false;
          // Version vectors are keyed by task output path (e.g. /out/task-a), not task name
          const task = tasksByName.get(taskName);
          taskExecutions.set(taskName, {
            executionId: '',
            cached: isCached,
            outputVersions: task ? (state.versionVectors.get(task.output) ?? new Map()) : new Map(),
            // Each task executes at most once per dispatch cycle; re-execution creates a new dispatch
            executionCount: 1n,
          });
        }
      }

      // Determine final status
      const finalStatus = wasCancelled
        ? variant('cancelled', {})
        : result.success
          ? variant('completed', {})
          : (() => {
              // Find the failed task
              let failedTask = 'unknown';
              let failedError = 'Task execution failed';
              for (const [taskName, taskState] of state.tasks) {
                if (taskState.status === 'failed') {
                  failedTask = taskName;
                  failedError = taskState.error.type === 'some' ? taskState.error.value : 'Task execution failed';
                  break;
                }
              }
              return variant('failed', { failedTask, error: failedError });
            })();

      // Build output versions: map each task's output path to its produced hash.
      // Matches LocalOrchestrator.buildOutputVersions() — tracks what was produced,
      // not what was consumed (inputVersions already captures the input side).
      const outputMap = new Map<string, string>();
      if (graph) {
        for (const task of graph.tasks) {
          const ts = state.tasks.get(task.name);
          if (ts && ts.outputHash.type === 'some') {
            outputMap.set(task.output, ts.outputHash.value);
          }
        }
      }
      const outputVersions: DataflowRun['outputVersions'] = some(outputMap);

      // Count tasks from execution state
      const totalTasks = graph ? BigInt(graph.tasks.length) : 0n;

      const finalRun: DataflowRun = {
        ...existingRun,
        completedAt: some(new Date()),
        status: finalStatus,
        outputVersions,
        taskExecutions,
        summary: {
          total: totalTasks,
          completed: BigInt(result.executed) + BigInt(result.cached),
          cached: BigInt(result.cached),
          failed: BigInt(result.failed),
          skipped: BigInt(result.skipped),
          reexecuted: BigInt(result.reexecuted),
        },
      };
      await dataflowRuns.write(repo, workspace, finalRun);
      console.log(`Updated DataflowRun ${runId} with final status`);
    }

    console.log(`Finalized execution ${executionId}: success=${result.success}, executed=${result.executed}, cached=${result.cached}, failed=${result.failed}, skipped=${result.skipped}`);

    return {
      success: result.success,
      executed: result.executed,
      cached: result.cached,
      failed: result.failed,
      skipped: result.skipped,
      reexecuted: result.reexecuted,
      duration: result.duration,
    };
  } finally {
    // Guaranteed lock release — TTL is the last resort if this also fails
    // Release exclusive dataflow lock first, then shared workspace lock (reverse of acquisition order)
    try {
      await storage.locks.forceRelease(repo, `${workspace}#dataflow`);
    } catch (err) {
      console.error(`Failed to release dataflow lock for ${repo}/${workspace}#dataflow:`, err);
    }
    try {
      await storage.locks.forceRelease(repo, workspace);
    } catch (err) {
      console.error(`Failed to release workspace lock for ${repo}/${workspace}:`, err);
    }
  }
}
