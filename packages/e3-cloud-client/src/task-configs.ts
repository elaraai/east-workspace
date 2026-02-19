/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Task config API functions using BEAST2 format.
 */

import { NullType } from '@elaraai/east';
import {
  ComputeSizeType,
  ComputeConfigMapType,
  TaskTimeoutType,
  TimeoutConfigMapType,
  TaskConfigsType,
  type ComputeSize,
  type ComputeConfigMap,
  type TaskTimeout,
  type TimeoutConfigMap,
  type TaskConfigs,
} from '@elaraai/e3-cloud-types';
import { get, post, put, del, type RequestOptions } from '@elaraai/e3-api-client';

const basePath = (repo: string, ws: string) =>
  `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(ws)}/task-configs`;

// ── Compute ─────────────────────────────────────────────────────────────────

/**
 * List all compute configs for a workspace.
 */
export async function listCompute(
  url: string,
  repo: string,
  workspace: string,
  options: RequestOptions
): Promise<ComputeConfigMap> {
  return get(url, `${basePath(repo, workspace)}/compute`, ComputeConfigMapType, options);
}

/**
 * Get the compute config for a task.
 */
export async function getCompute(
  url: string,
  repo: string,
  workspace: string,
  taskName: string,
  options: RequestOptions
): Promise<ComputeSize> {
  return get(url, `${basePath(repo, workspace)}/compute/${encodeURIComponent(taskName)}`, ComputeSizeType, options);
}

/**
 * Set the compute size for a task.
 */
export async function setCompute(
  url: string,
  repo: string,
  workspace: string,
  taskName: string,
  size: ComputeSize,
  options: RequestOptions
): Promise<ComputeSize> {
  return put(url, `${basePath(repo, workspace)}/compute/${encodeURIComponent(taskName)}`, size, ComputeSizeType, ComputeSizeType, options);
}

/**
 * Batch set compute configs for a workspace.
 */
export async function setComputeBatch(
  url: string,
  repo: string,
  workspace: string,
  configs: ComputeConfigMap,
  options: RequestOptions
): Promise<ComputeConfigMap> {
  return post(url, `${basePath(repo, workspace)}/compute`, configs, ComputeConfigMapType, ComputeConfigMapType, options);
}

/**
 * Remove the compute config for a task.
 */
export async function removeCompute(
  url: string,
  repo: string,
  workspace: string,
  taskName: string,
  options: RequestOptions
): Promise<void> {
  await del(url, `${basePath(repo, workspace)}/compute/${encodeURIComponent(taskName)}`, NullType, options);
}

// ── Timeout ─────────────────────────────────────────────────────────────────

/**
 * List all timeout configs for a workspace.
 */
export async function listTimeout(
  url: string,
  repo: string,
  workspace: string,
  options: RequestOptions
): Promise<TimeoutConfigMap> {
  return get(url, `${basePath(repo, workspace)}/timeout`, TimeoutConfigMapType, options);
}

/**
 * Get the timeout for a task (returns effective default if not explicitly set).
 */
export async function getTimeout(
  url: string,
  repo: string,
  workspace: string,
  taskName: string,
  options: RequestOptions
): Promise<TaskTimeout> {
  return get(url, `${basePath(repo, workspace)}/timeout/${encodeURIComponent(taskName)}`, TaskTimeoutType, options);
}

/**
 * Set the timeout for a task.
 */
export async function setTimeout(
  url: string,
  repo: string,
  workspace: string,
  taskName: string,
  timeout: TaskTimeout,
  options: RequestOptions
): Promise<TaskTimeout> {
  return put(url, `${basePath(repo, workspace)}/timeout/${encodeURIComponent(taskName)}`, timeout, TaskTimeoutType, TaskTimeoutType, options);
}

/**
 * Batch set timeout configs for a workspace.
 */
export async function setTimeoutBatch(
  url: string,
  repo: string,
  workspace: string,
  configs: TimeoutConfigMap,
  options: RequestOptions
): Promise<TimeoutConfigMap> {
  return post(url, `${basePath(repo, workspace)}/timeout`, configs, TimeoutConfigMapType, TimeoutConfigMapType, options);
}

/**
 * Remove the timeout config for a task.
 */
export async function removeTimeout(
  url: string,
  repo: string,
  workspace: string,
  taskName: string,
  options: RequestOptions
): Promise<void> {
  await del(url, `${basePath(repo, workspace)}/timeout/${encodeURIComponent(taskName)}`, NullType, options);
}

// ── Unified ─────────────────────────────────────────────────────────────────

/**
 * List all task configs (compute + timeout) for a workspace.
 */
export async function listTaskConfigs(
  url: string,
  repo: string,
  workspace: string,
  options: RequestOptions
): Promise<TaskConfigs> {
  return get(url, basePath(repo, workspace), TaskConfigsType, options);
}
