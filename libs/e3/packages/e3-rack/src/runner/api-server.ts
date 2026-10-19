/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type { Budget, StorageBackend, TaskRunner } from '@elaraai/e3-core';
import { openRackRunner } from './rack-runner.js';

/**
 * What the server lends one dataflow run: e3-api-server's
 * `DataflowRunnerLease`, declared here so this package needs nothing of the
 * server, whose optional peer it is.
 */
export interface DataflowRunnerLease {
  /** Runs the tasks and units in this run. */
  runner: TaskRunner;
  /** Adds remote capacity to the orchestrator's width, without enlarging its local budget. */
  extraConcurrency: number;
  /** Releases the attachment once, on success, failure, cancellation or failed start. */
  close(): Promise<void>;
}

/**
 * The server's `dataflowRunner` option: e3-api-server's
 * `DataflowRunnerFactory`, structurally, given the server's own backend and
 * budget; undefined or a thrown error uses the server's local runner.
 */
export type DataflowRunnerFactory = (repoPath: string, workspace: string, context: { storage: StorageBackend; budget: Budget }) => Promise<DataflowRunnerLease | undefined>;

/** Configures labels and an optional isolated home for server attachments. */
export interface DataflowRackOptions {
  /** Prefixes the workspace and process id in rack status. */
  labelPrefix?: string;
  /** Overrides the user-wide rack home. */
  home?: string;
  /** Overrides the ten-second compatible-capacity startup wait. */
  waitForRackMs?: number;
}

/**
 * Creates one rack session per API dataflow run on the server's existing budget.
 * Explicit server opt-in ignores policy.enabled; each repository's rules and
 * routing mode still select eligible tasks. Calls and mutations remain local.
 * @param options - Session labels and optional isolated deployment settings
 * @returns A factory for createServer's dataflowRunner option
 */
export function createDataflowRunnerFactory(options: DataflowRackOptions = {}): DataflowRunnerFactory {
  return async (repoPath, workspace, { storage, budget }) => {
    const rack = await openRackRunner({ repoPath, workspace, storage, budget,
      label: `${options.labelPrefix ?? 'e3-api-server'} ${workspace} (pid ${process.pid})`,
      home: options.home, waitForRackMs: options.waitForRackMs });
    return { runner: rack.runner, extraConcurrency: rack.rackSlots, close: () => rack.close() };
  };
}
