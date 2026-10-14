/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type { DataflowRunnerFactory } from '@elaraai/e3-api-server';
import { openRackRunner } from './rack-runner.js';

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
