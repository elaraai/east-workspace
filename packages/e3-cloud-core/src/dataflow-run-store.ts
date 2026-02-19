/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import type { DataflowRun } from '@elaraai/e3-types';

/**
 * Cloud-agnostic interface for DataflowRun records.
 *
 * Stores per-workspace run history including status, task executions,
 * and summary statistics.
 */
export interface DataflowRunStore {
  /** Get a specific run by ID. */
  get(repo: string, workspace: string, runId: string): Promise<DataflowRun | null>;

  /** Write (create or update) a run record. */
  write(repo: string, workspace: string, run: DataflowRun): Promise<void>;

  /** List all run IDs for a workspace. */
  list(repo: string, workspace: string): Promise<string[]>;

  /** Get the most recent run for a workspace. */
  getLatest(repo: string, workspace: string): Promise<DataflowRun | null>;

  /** Delete a run record. */
  delete(repo: string, workspace: string, runId: string): Promise<void>;
}
