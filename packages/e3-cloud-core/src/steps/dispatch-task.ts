/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { DEFAULT_TIMEOUT_SERVERLESS, DEFAULT_TIMEOUT_FARGATE } from '@elaraai/e3-cloud-types';
import {
  stepPrepareTask,
  stepCheckVersionConsistency,
  inputsHash,
  uuidv7,
} from '@elaraai/e3-core';
import type { DataflowStorage } from '../dataflow-storage.js';
import type { TaskConfigStore } from '../task-config-store.js';

export interface DispatchTaskEvent {
  repo: string;
  workspace: string;
  /** Numeric execution ID */
  executionId: number;
  taskName: string;
  force?: boolean; // Skip cache check if true
  /** Task names to force (skip cache for), resolved from schedule patterns */
  forceTasks?: string[];
  /** UUIDv7 run ID for DataflowRun tracking */
  runId: string;
}

export interface DispatchTaskResult {
  taskName: string;
  status: 'ready' | 'cached' | 'not_ready' | 'cancelled';
  outputHash?: string;
  // Task execution parameters (when status is 'ready')
  taskHash?: string;
  inputHashes?: string[];
  outputPath?: string;
  /** UUIDv7 execution ID for this task execution */
  taskExecutionId?: string;
  /** Whether this task was served from cache */
  cached: boolean;
  /** Compute size for this task (serverless = Lambda, small/medium/large/xlarge = Fargate) */
  computeSize: { type: string };
  /** Timeout in minutes */
  timeoutMinutes: number;
  /** Timeout in seconds (for Step Functions timeout) */
  timeoutSeconds: number;
}

/**
 * Dispatch a task for execution.
 *
 * This handler:
 * 1. Checks for cancellation before doing expensive work
 * 2. Uses stepPrepareTask to resolve inputs and check cache
 * 3. If cached, returns cached status with output hash
 * 4. If not cached, generates a UUIDv7 taskExecutionId and returns ready status
 *
 * Note: Execution state writes are deferred to apply-results (runs after the Map)
 * to avoid lost update race conditions from concurrent Map iterations.
 */
export interface DispatchTaskDeps {
  storage: DataflowStorage;
  taskConfigStore: TaskConfigStore;
}

export async function handleDispatchTask(deps: DispatchTaskDeps, event: DispatchTaskEvent): Promise<DispatchTaskResult> {
  const { storage, taskConfigStore } = deps;
  const { repo, workspace, executionId, taskName, force, forceTasks } = event;
  const execId = executionId.toString().padStart(10, '0');

  console.log(`Dispatching task ${taskName} for execution ${executionId} (force=${force ?? false})`);

  // Read execution state
  const state = await storage.executions.read(repo, workspace, execId);

  // Check for cancellation before doing expensive work
  if (!state || state.status === 'cancelled') {
    console.log(`Execution ${executionId} was cancelled, skipping task ${taskName}`);
    return {
      taskName, status: 'cancelled', cached: false,
      computeSize: { type: 'serverless' }, timeoutMinutes: 15, timeoutSeconds: 900,
    };
  }

  // Check version consistency before preparing task
  const consistency = stepCheckVersionConsistency(state, taskName);
  if (!consistency.consistent) {
    console.log(`Task ${taskName} deferred: inconsistent at ${consistency.conflictPath}`);
    return {
      taskName, status: 'not_ready', cached: false,
      computeSize: { type: 'serverless' }, timeoutMinutes: 15, timeoutSeconds: 900,
    };
  }

  // Use stepPrepareTask to resolve inputs and check cache
  // Note: stepPrepareTask uses state.force, which was set during initialization
  const prepare = await stepPrepareTask(storage, state, taskName);

  console.log(`Task ${taskName} inputs: ${prepare.inputHashes.length} hashes`);

  // Read compute and timeout configs for this task
  const computeSizeConfig = await taskConfigStore.getCompute(repo, workspace, taskName);
  const computeSize = computeSizeConfig ? { type: computeSizeConfig.type } : { type: 'serverless' };
  const isServerless = computeSize.type === 'serverless';
  const timeoutConfig = await taskConfigStore.getTimeout(repo, workspace, taskName);
  const timeoutMinutes = timeoutConfig ? Number(timeoutConfig.minutes) : (isServerless ? DEFAULT_TIMEOUT_SERVERLESS : DEFAULT_TIMEOUT_FARGATE);
  const timeoutSeconds = timeoutMinutes * 60;

  console.log(`Task ${taskName} compute: ${computeSize.type}, timeout: ${timeoutMinutes}min`);

  // If cached and not forcing, return cached status (state update deferred to apply-results)
  if (prepare.cachedOutputHash && !force && !forceTasks?.includes(taskName)) {
    console.log(`Task ${taskName} is cached with output ${prepare.cachedOutputHash}`);

    // For cached tasks, get the executionId from the latest execution record
    const inHash = inputsHash(prepare.inputHashes);
    const latestStatus = await storage.refs.executionGetLatest(repo, prepare.taskHash, inHash);
    const cachedExecutionId = latestStatus?.type === 'success' ? latestStatus.value.executionId : uuidv7();

    return {
      taskName,
      status: 'cached',
      outputHash: prepare.cachedOutputHash,
      taskHash: prepare.taskHash,
      inputHashes: prepare.inputHashes,
      outputPath: prepare.outputPath,
      taskExecutionId: cachedExecutionId,
      cached: true,
      computeSize,
      timeoutMinutes,
      timeoutSeconds,
    };
  }

  // Not cached - generate a UUIDv7 execution ID
  const taskExecutionId = uuidv7();
  console.log(`Task ${taskName} ready for execution (taskExecutionId=${taskExecutionId})`);

  return {
    taskName,
    status: 'ready',
    taskHash: prepare.taskHash,
    inputHashes: prepare.inputHashes,
    outputPath: prepare.outputPath,
    taskExecutionId,
    cached: false,
    computeSize,
    timeoutMinutes,
    timeoutSeconds,
  };
}
