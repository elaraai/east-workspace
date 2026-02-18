/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

import type { ComputeSize, TaskTimeout } from '@elaraai/e3-cloud-types';

/**
 * Storage interface for per-task compute and timeout configuration.
 *
 * Implementations:
 * - DynamoTaskConfigStore (e3-aws-storage) - DynamoDB-backed
 */
export interface TaskConfigStore {
  /** Get the compute size for a task (null if none) */
  getCompute(repo: string, workspace: string, taskName: string): Promise<ComputeSize | null>;

  /** Set the compute size for a task */
  putCompute(repo: string, workspace: string, taskName: string, size: ComputeSize): Promise<void>;

  /** Set compute sizes for multiple tasks */
  putComputeBatch(repo: string, workspace: string, configs: Record<string, ComputeSize>): Promise<void>;

  /** Delete the compute size for a task */
  deleteCompute(repo: string, workspace: string, taskName: string): Promise<void>;

  /** Delete compute sizes for multiple tasks */
  deleteComputeBatch(repo: string, workspace: string, taskNames: string[]): Promise<void>;

  /** List all compute sizes for a workspace */
  listCompute(repo: string, workspace: string): Promise<Record<string, ComputeSize>>;

  /** Get the timeout for a task (null if none) */
  getTimeout(repo: string, workspace: string, taskName: string): Promise<TaskTimeout | null>;

  /** Set the timeout for a task */
  putTimeout(repo: string, workspace: string, taskName: string, timeout: TaskTimeout): Promise<void>;

  /** Set timeouts for multiple tasks */
  putTimeoutBatch(repo: string, workspace: string, configs: Record<string, TaskTimeout>): Promise<void>;

  /** Delete the timeout for a task */
  deleteTimeout(repo: string, workspace: string, taskName: string): Promise<void>;

  /** Delete timeouts for multiple tasks */
  deleteTimeoutBatch(repo: string, workspace: string, taskNames: string[]): Promise<void>;

  /** List all timeouts for a workspace */
  listTimeout(repo: string, workspace: string): Promise<Record<string, TaskTimeout>>;

  /** Delete all task configs for a workspace */
  deleteAllForWorkspace(repo: string, workspace: string): Promise<void>;

  /** Delete all task configs for a repo (caller must provide workspace list) */
  deleteAllForRepo(repo: string): Promise<void>;
}
