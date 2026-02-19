/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { getStorage } from '@elaraai/e3-aws-storage/init';
import {
  stepTaskStarted,
  stepTaskCompleted,
  stepTaskFailed,
  stepTasksSkipped,
  inputsHash,
} from '@elaraai/e3-core';
import { variant } from '@elaraai/east';
import type { ExecutionStatus } from '@elaraai/e3-types';

const storage = getStorage();

/** Result from a single task in the Map iteration */
export interface TaskResult {
  taskName: string;
  status: 'completed' | 'cached' | 'failed' | 'not_ready' | 'cancelled';
  outputPath?: string;
  outputHash?: string;
  taskHash?: string;
  inputHashes?: string[];
  taskExecutionId?: string;
  cached?: boolean;
  duration?: number;
  error?: string;
  exitCode?: number;
}

export interface ApplyResultsEvent {
  repo: string;
  workspace: string;
  /** Numeric execution ID */
  executionId: number;
  /** UUIDv7 run ID for DataflowRun tracking */
  runId: string;
  force: boolean;
  /** Task name patterns to force-execute (empty = force all) */
  forceTasks?: string[];
  taskResults: TaskResult[];
}

/** Tree update info for ApplyTreeUpdates */
interface TreeUpdate {
  outputPath: string;
  outputHash: string;
  needsTreeUpdate: boolean;
}

export interface ApplyResultsOutput {
  repo: string;
  workspace: string;
  executionId: number;
  runId: string;
  force: boolean;
  forceTasks?: string[];
  treeUpdates: TreeUpdate[];
}

/**
 * Lambda handler: Apply all task results to execution state serially.
 *
 * Called after the parallel DispatchTasksMap completes. Processes all execution
 * state mutations in a single read-modify-write cycle to avoid lost update
 * race conditions that occur when multiple Map iterations write concurrently.
 *
 * Also writes execution records for both successful and failed tasks.
 */
export async function handler(event: ApplyResultsEvent): Promise<ApplyResultsOutput> {
  const { repo, workspace, executionId, runId, force, forceTasks = [], taskResults } = event;
  const execId = executionId.toString().padStart(10, '0');

  console.log(`Applying ${taskResults.length} task results for execution ${executionId}`);

  // Read execution state once
  const state = await storage.executions.read(repo, workspace, execId);
  if (!state) {
    throw new Error(`Execution ${executionId} not found`);
  }

  const treeUpdates: TreeUpdate[] = [];
  const now = new Date();

  for (const result of taskResults) {
    // Skip not_ready and cancelled tasks - nothing to record
    if (result.status === 'not_ready' || result.status === 'cancelled') {
      continue;
    }

    if (result.status === 'failed') {
      console.log(`Recording failure for task ${result.taskName}: ${result.error ?? 'unknown'}`);

      // Mark as started then failed
      stepTaskStarted(state, result.taskName);
      const { result: failResult } = stepTaskFailed(state, result.taskName, result.error, result.exitCode, result.duration ?? 0);

      // Skip dependent tasks
      if (failResult.toSkip.length > 0) {
        console.log(`Skipping ${failResult.toSkip.length} dependent tasks: ${failResult.toSkip.join(', ')}`);
        stepTasksSkipped(state, failResult.toSkip, result.taskName);
      }

      // Write failed execution record (Fix 2)
      if (result.taskHash && result.inputHashes && result.taskExecutionId) {
        const inHash = inputsHash(result.inputHashes);
        const executionStatus: ExecutionStatus = variant('failed', {
          executionId: result.taskExecutionId,
          inputHashes: result.inputHashes,
          startedAt: now,
          completedAt: now,
          exitCode: BigInt(result.exitCode ?? 1),
        });
        await storage.refs.executionWrite(repo, result.taskHash, inHash, result.taskExecutionId, executionStatus);
      }

      treeUpdates.push({ outputPath: '', outputHash: '', needsTreeUpdate: false });
    } else if (result.status === 'cached') {
      console.log(`Recording cached result for task ${result.taskName}`);

      // Cached tasks: dispatch-task already verified cache, just update state
      stepTaskCompleted(state, result.taskName, result.outputHash!, true, 0);

      treeUpdates.push({
        outputPath: result.outputPath!,
        outputHash: result.outputHash!,
        needsTreeUpdate: true,
      });
    } else if (result.status === 'completed') {
      console.log(`Recording result for task ${result.taskName} (duration: ${result.duration ?? 0}ms)`);

      // Executed tasks: mark started then completed
      stepTaskStarted(state, result.taskName);
      stepTaskCompleted(state, result.taskName, result.outputHash!, false, result.duration ?? 0);

      // Write success execution record
      if (result.taskHash && result.inputHashes && result.outputHash && result.taskExecutionId) {
        const inHash = inputsHash(result.inputHashes);
        const executionStatus: ExecutionStatus = variant('success', {
          executionId: result.taskExecutionId,
          inputHashes: result.inputHashes,
          outputHash: result.outputHash,
          startedAt: now,
          completedAt: now,
        });
        await storage.refs.executionWrite(repo, result.taskHash, inHash, result.taskExecutionId, executionStatus);
      }

      treeUpdates.push({
        outputPath: result.outputPath!,
        outputHash: result.outputHash!,
        needsTreeUpdate: true,
      });
    }
  }

  // Check for cancellation before saving (preserve cancelled status)
  const currentState = await storage.executions.read(repo, workspace, execId);
  if (currentState?.status === 'cancelled') {
    (state as { status: string }).status = 'cancelled';
  }

  // Write execution state once
  await storage.executions.update(state);

  console.log(`Applied ${taskResults.length} task results, ${treeUpdates.filter(u => u.needsTreeUpdate).length} tree updates needed`);

  return { repo, workspace, executionId, runId, force, forceTasks, treeUpdates };
}
