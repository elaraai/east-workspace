/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type { TaskRunner } from '@elaraai/e3-core/portable';

/** Lends a runner to one in-process dataflow run. */
export interface DataflowRunnerLease {
  /** Runs the tasks and units in this run. */
  runner: TaskRunner;
  /** Adds remote capacity to the orchestrator's width, without enlarging its local budget. */
  extraConcurrency: number;
  /** Releases the attachment once, on success, failure, cancellation or failed start. */
  close(): Promise<void>;
}

/** Opens a per-run attachment; undefined uses the host's existing runner. */
export type OpenDataflowRunner = (repoPath: string, workspace: string) => Promise<DataflowRunnerLease | undefined>;
