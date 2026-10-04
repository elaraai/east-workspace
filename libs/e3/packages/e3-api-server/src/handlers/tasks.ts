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
} from '@elaraai/e3-core/portable';
import type { StorageBackend } from '@elaraai/e3-core/portable';
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

    // Get hash + role for each task (the object read is content-addressed and cheap)
    const result = await Promise.all(
      taskNames.map(async (name) => {
        const hash = await workspaceGetTaskHash(storage, repoPath, workspace, name);
        const task = await workspaceGetTask(storage, repoPath, workspace, name);
        return { name, hash, role: task.role };
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
      body: task.body,
      runner: task.runner,
      inputs: task.inputs,
      output: task.output,
      role: task.role,
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
    case 'cancelled':
      return variant('cancelled', null);
    case 'interrupted':
      return variant('interrupted', null);
  }
}

/**
 * Calculate duration in milliseconds between two dates.
 */
function calculateDuration(startedAt: Date, completedAt: Date): bigint {
  return BigInt(Math.round(completedAt.getTime() - startedAt.getTime()));
}

/**
 * One execution as the history lists it: a cancelled or interrupted one with
 * why it stopped.
 */
function toExecutionListItem(inputsHash: string, executionId: string, status: ExecutionStatus): ExecutionListItem {
  if (status.type === 'success') {
    return {
      inputsHash,
      executionId,
      inputHashes: status.value.inputHashes,
      status: statusToApiStatus(status),
      startedAt: status.value.startedAt.toISOString(),
      completedAt: some(status.value.completedAt.toISOString()),
      duration: some(calculateDuration(status.value.startedAt, status.value.completedAt)),
      exitCode: none,
      peakBytes: status.value.peakBytes,
      reason: none,
    };
  }
  if (status.type === 'failed') {
    return {
      inputsHash,
      executionId,
      inputHashes: status.value.inputHashes,
      status: statusToApiStatus(status),
      startedAt: status.value.startedAt.toISOString(),
      completedAt: some(status.value.completedAt.toISOString()),
      duration: some(calculateDuration(status.value.startedAt, status.value.completedAt)),
      exitCode: some(status.value.exitCode),
      peakBytes: status.value.peakBytes,
      reason: none,
    };
  }
  if (status.type === 'cancelled') {
    return {
      inputsHash,
      executionId,
      inputHashes: status.value.inputHashes,
      status: statusToApiStatus(status),
      startedAt: status.value.startedAt.toISOString(),
      completedAt: some(status.value.completedAt.toISOString()),
      duration: some(calculateDuration(status.value.startedAt, status.value.completedAt)),
      exitCode: none,
      peakBytes: none,
      reason: some(status.value.reason),
    };
  }
  // An interruption's completedAt is when it was found, not when the runner
  // stopped, so it has no duration, as an error has none.
  if (status.type === 'error' || status.type === 'interrupted') {
    return {
      inputsHash,
      executionId,
      inputHashes: status.value.inputHashes,
      status: statusToApiStatus(status),
      startedAt: status.value.startedAt.toISOString(),
      completedAt: some(status.value.completedAt.toISOString()),
      duration: none,
      exitCode: none,
      peakBytes: none,
      reason: status.type === 'interrupted' ? some(status.value.reason) : none,
    };
  }
  // running
  return {
    inputsHash,
    executionId,
    inputHashes: status.value.inputHashes,
    status: statusToApiStatus(status),
    startedAt: status.value.startedAt.toISOString(),
    completedAt: none,
    duration: none,
    exitCode: none,
    peakBytes: none,
    reason: none,
  };
}

/**
 * List a page of a task's history: its runs, the latest first — every attempt,
 * a forced re-run or a retry after a failure among them — those before the run
 * `page.before` names when given, at most `page.limit` of them. A split task's
 * units are recorded under its hash too, and are left out: they are not its
 * runs. It reads the task's index of runs (`RefStore.executionListRuns`), so a
 * page costs what it holds, however long the task has run.
 *
 * @param storage - Storage backend
 * @param repoPath - The repository's path
 * @param workspace - The workspace
 * @param taskName - The task
 * @param page - The run the page begins before, if any, and the most it holds
 * @returns The page, or the error
 */
export async function listExecutions(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  taskName: string,
  page: { before?: string; limit: number },
): Promise<Response> {
  try {
    const taskHash = await workspaceGetTaskHash(storage, repoPath, workspace, taskName);
    const runs = await storage.refs.executionListRuns(repoPath, taskHash, page);
    return sendSuccess(ArrayType(ExecutionListItemType),
      runs.map(({ inputsHash, executionId, status }) => toExecutionListItem(inputsHash, executionId, status)));
  } catch (err) {
    return sendError(ArrayType(ExecutionListItemType), errorToVariant(err));
  }
}
