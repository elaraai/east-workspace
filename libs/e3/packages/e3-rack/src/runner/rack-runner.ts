/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { setTimeout as delay } from 'node:timers/promises';
import { LocalTaskRunner, type Budget, type LocalTaskRunnerOptions, type StorageBackend, type TaskRunner } from '@elaraai/e3-core';
import { connectHub } from '../client/connect.js';
import { RackSession } from '../client/session.js';
import { loadPolicy, type RackPolicy } from '../routing/policy.js';
import { compatibleRacks } from './capacity.js';
import { createRackBody, type RackPlacementEvent } from './rack-body.js';

/** Configures rack delegation for one run or one watch session. */
export interface OpenRackRunnerOptions {
  /** Local repository path. */
  repoPath: string;
  /** Workspace being run. */
  workspace: string;
  /** The run's repository backend. */
  storage: StorageBackend;
  /** Human-readable session label for rack status. */
  label: string;
  /** Policy snapshot, otherwise loaded from the repository. */
  policy?: RackPolicy;
  /** Keeps eligible work queued when capacity is busy. */
  rackOnly?: boolean;
  /** Milliseconds to await a healthy compatible rack; defaults to ten seconds. */
  waitForRackMs?: number;
  /** Receives task/unit placement notifications. */
  onPlacement?: (event: RackPlacementEvent) => void;
  /** The process's existing budget, preserved for every local body. */
  budget?: Budget;
  /** Settings preserved for every local process and detached call. */
  settings?: Omit<LocalTaskRunnerOptions, 'body'>;
  /** Overrides the user-wide private state home for an isolated deployment. */
  home?: string;
  /** Receives hub startup messages. */
  log?: (line: string) => void;
}

/** Owns the runner's session and reports capacity for the local orchestrator. */
export interface RackRunnerHandle {
  /** Core's LocalTaskRunner, with the delegation body when connected. */
  readonly runner: TaskRunner;
  /** Total compatible rack capacity in the latest snapshot. */
  readonly rackSlots: number;
  /** Describes usable racks or why work will run locally. */
  describe(): string;
  /** Refreshes capacity before a watch run without replacing its session. */
  refreshSlots(): Promise<number>;
  /** Unsubscribes from shared work and closes the private data socket. */
  close(): Promise<void>;
}

/**
 * Opens a run's rack attachment, falling back to the standard local runner
 * for unavailable service or incompatible agents. Local settings and budget
 * are preserved in either case; a rack problem never prevents a local run.
 * @param options - Repository, policy and the host's runtime collaborators
 * @returns The runner and a session handle the caller closes in finally
 * @example
 * const rack = await openRackRunner({ repoPath, workspace: 'dev', storage, label: 'run dev', budget });
 * try { await rack.runner.execute(storage, taskHash, inputs, { taskName: 'train_model' }); }
 * finally { await rack.close(); }
 */
export async function openRackRunner(options: OpenRackRunnerOptions): Promise<RackRunnerHandle> {
  const local = new LocalTaskRunner(options.repoPath, options.budget, options.settings);
  let session: RackSession | undefined;
  let slots = 0;
  let description = 'No healthy compatible rack; running locally';
  try {
    const policy = options.policy ?? await loadPolicy(options.repoPath);
    const client = await connectHub({ home: options.home, log: options.log });
    session = await RackSession.open(client, options);
    const attached = session;
    const refreshSlots = async () => {
      try {
        const capacity = await attached.refreshCapacity();
        const racks = compatibleRacks(capacity);
        slots = racks.reduce((sum, rack) => sum + Number(rack.capacity), 0);
        description = racks.length > 0 ? racks.map((rack) => `${rack.label} (${Number(rack.capacity)} slots, e3 ${rack.bundledE3.type === 'some' ? rack.bundledE3.value : 'unknown'})`).join(', ')
          : capacity.racks.length === 0 ? 'No connected rack; running locally'
            : `No healthy compatible rack; running locally (${capacity.racks.map((rack) => `${rack.label}: ${rack.pendingApproval ? 'boot needs approval' : !rack.healthy ? 'unhealthy' : rack.bundledE3.type === 'none' ? 'bundled e3 version missing' : `e3 ${rack.bundledE3.value} is incompatible`}`).join(', ')})`;
      } catch (error) { slots = 0; description = `Rack unavailable: ${error instanceof Error ? error.message : String(error)}; running locally`; }
      return slots;
    };
    const deadline = Date.now() + Math.max(0, options.waitForRackMs ?? 10000);
    do {
      await refreshSlots();
      if (slots > 0 || attached.hubLost || Date.now() >= deadline) break;
      await delay(Math.min(250, deadline - Date.now()));
    } while (Date.now() <= deadline);
    const runner = new LocalTaskRunner(options.repoPath, options.budget, { ...options.settings,
      body: createRackBody({ session: attached, policy, workspace: options.workspace, rackOnly: options.rackOnly, onPlacement: options.onPlacement }) });
    return { runner, get rackSlots() { return slots; }, describe: () => description, refreshSlots, close: () => attached.close() };
  } catch (error) {
    await session?.close().catch(() => {});
    description = `${error instanceof Error ? error.message : String(error)}; running locally`;
    return { runner: local, rackSlots: 0, describe: () => description, refreshSlots: () => Promise.resolve(0), close: () => Promise.resolve() };
  }
}
