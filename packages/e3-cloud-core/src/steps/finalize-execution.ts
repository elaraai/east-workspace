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
import { variant, some, none } from '@elaraai/east';
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

    // Check if execution was cancelled - preserve that status
    const wasCancelled = state.status === 'cancelled';

    // Use stepFinalize to update state with completion status
    const { result } = stepFinalize(state, runId);

    // Restore cancelled status if it was cancelled (stepFinalize overwrites with completed/failed)
    if (wasCancelled) {
      (state as { status: string }).status = 'cancelled';
    }

    // Save updated state
    await storage.executions.update(state);

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

      // Capture input dataset state at termination (inputSnapshot is kept up-to-date
      // by stepDetectInputChanges on each get-ready cycle, so it reflects the actual
      // input state when the dataflow finished, regardless of what individual tasks saw)
      const outputVersions: DataflowRun['outputVersions'] = some(new Map(state.inputSnapshot));

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
    try {
      await storage.locks.forceRelease(repo, `workspace/${workspace}`);
    } catch (err) {
      console.error(`Failed to release lock for ${repo}/workspace/${workspace}:`, err);
    }
  }
}
