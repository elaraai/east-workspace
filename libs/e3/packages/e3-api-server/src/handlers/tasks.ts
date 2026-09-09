/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ArrayType, none, some, variant } from '@elaraai/east';
import type { ExecutionStatus } from '@elaraai/e3-types';
import {
  workspaceListTasks,
  workspaceGetTask,
  workspaceGetTaskHash,
  executionListForTask,
  executionGetLatest,
  executionListIds,
  executionGet,
} from '@elaraai/e3-core';
import type { StorageBackend } from '@elaraai/e3-core';
import { sendSuccess, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import { TaskListItemType, TaskDetailsType, ExecutionListItemType, type ExecutionListItem } from '../types.js';

/**
 * List all tasks in a workspace.
 */
export async function listTasks(
  storage: StorageBackend,
  repoPath: string,
  workspace: string
): Promise<Response> {
  try {
    const taskNames = await workspaceListTasks(storage, repoPath, workspace);

    // Get hash + kind for each task (the object read is content-addressed and cheap)
    const result = await Promise.all(
      taskNames.map(async (name) => {
        const hash = await workspaceGetTaskHash(storage, repoPath, workspace, name);
        const task = await workspaceGetTask(storage, repoPath, workspace, name);
        return { name, hash, kind: task.kind };
      })
    );

    return sendSuccess(ArrayType(TaskListItemType), result);
  } catch (err) {
    return sendError(ArrayType(TaskListItemType), errorToVariant(err));
  }
}

/**
 * Get task details.
 */
export async function getTask(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  taskName: string
): Promise<Response> {
  try {
    const hash = await workspaceGetTaskHash(storage, repoPath, workspace, taskName);
    const task = await workspaceGetTask(storage, repoPath, workspace, taskName);

    return sendSuccess(TaskDetailsType, {
      name: taskName,
      hash,
      commandIr: task.commandIr,
      inputs: task.inputs,
      output: task.output,
      kind: task.kind,
      metadata: task.metadata,
    });
  } catch (err) {
    return sendError(TaskDetailsType, errorToVariant(err));
  }
}

/**
 * Convert ExecutionStatus to API ExecutionHistoryStatus variant.
 */
function statusToApiStatus(status: ExecutionStatus): ExecutionListItem['status'] {
  switch (status.type) {
    case 'running':
      return variant('running', null);
    case 'success':
      return variant('success', null);
    case 'failed':
      return variant('failed', null);
    case 'error':
      return variant('error', null);
  }
}

/**
 * Calculate duration in milliseconds between two dates.
 */
function calculateDuration(startedAt: Date, completedAt: Date): bigint {
  return BigInt(Math.round(completedAt.getTime() - startedAt.getTime()));
}

/**
 * One execution as the history lists it.
 */
function toExecutionListItem(inputsHash: string, status: ExecutionStatus): ExecutionListItem {
  if (status.type === 'success') {
    return {
      inputsHash,
      inputHashes: status.value.inputHashes,
      status: statusToApiStatus(status),
      startedAt: status.value.startedAt.toISOString(),
      completedAt: some(status.value.completedAt.toISOString()),
      duration: some(calculateDuration(status.value.startedAt, status.value.completedAt)),
      exitCode: none,
    };
  }
  if (status.type === 'failed') {
    return {
      inputsHash,
      inputHashes: status.value.inputHashes,
      status: statusToApiStatus(status),
      startedAt: status.value.startedAt.toISOString(),
      completedAt: some(status.value.completedAt.toISOString()),
      duration: some(calculateDuration(status.value.startedAt, status.value.completedAt)),
      exitCode: some(status.value.exitCode),
    };
  }
  if (status.type === 'error') {
    return {
      inputsHash,
      inputHashes: status.value.inputHashes,
      status: statusToApiStatus(status),
      startedAt: status.value.startedAt.toISOString(),
      completedAt: some(status.value.completedAt.toISOString()),
      duration: none,
      exitCode: none,
    };
  }
  // running
  return {
    inputsHash,
    inputHashes: status.value.inputHashes,
    status: statusToApiStatus(status),
    startedAt: status.value.startedAt.toISOString(),
    completedAt: none,
    duration: none,
    exitCode: none,
  };
}

/**
 * List execution history for a task: the latest attempt per distinct
 * inputs hash, or — with `all` — every attempt (a forced re-run or a retry
 * after a failure adds one under the same inputs hash).
 */
export async function listExecutions(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  taskName: string,
  all = false
): Promise<Response> {
  try {
    const taskHash = await workspaceGetTaskHash(storage, repoPath, workspace, taskName);
    const inputsHashes = await executionListForTask(storage, repoPath, taskHash);

    const result: ExecutionListItem[] = [];

    for (const inputsHash of inputsHashes) {
      const statuses: (ExecutionStatus | null)[] = all
        ? await Promise.all((await executionListIds(storage, repoPath, taskHash, inputsHash))
          .map(executionId => executionGet(storage, repoPath, taskHash, inputsHash, executionId)))
        : [await executionGetLatest(storage, repoPath, taskHash, inputsHash)];
      for (const status of statuses) {
        if (status) result.push(toExecutionListItem(inputsHash, status));
      }
    }

    return sendSuccess(ArrayType(ExecutionListItemType), result);
  } catch (err) {
    return sendError(ArrayType(ExecutionListItemType), errorToVariant(err));
  }
}
