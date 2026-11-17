/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { setTimeout as delay } from 'node:timers/promises';
import { LocalTaskRunner, type Budget, type LocalTaskRunnerOptions, type StorageBackend, type TaskRunner } from '@elaraai/e3-core';
import { connectHub } from '../client/connect.js';
import { RackSession } from '../client/session.js';
import { loadPolicy, policyTargetsRack, type RackPolicy } from '../routing/policy.js';
import { compatibleRacks, rackResources, rackWidth } from './capacity.js';
import type { RackPlacementEvent } from '../protocol/placement.js';
import { createRackBody } from './rack-body.js';
import { createRackCall } from './rack-call.js';
import { RackLayerBuilds } from './rack-lease.js';
import type { RackEnvironmentEvent } from './environment.js';
import { RackTally, type RackRunSummary } from './summary.js';

/** Configures rack delegation for one run, one watch session, or one command's piece of work. */
export interface OpenRackRunnerOptions {
  /** Local repository path. */
  repoPath: string;
  /** Workspace being run, which the rack's activity view names: for a
   *  command that runs in none, what its work comes from. */
  workspace: string;
  /** The run's repository backend. */
  storage: StorageBackend;
  /** Human-readable session label for rack status. */
  label: string;
  /** Policy snapshot, otherwise loaded from the repository. */
  policy?: RackPolicy;
  /** Keeps eligible work queued when capacity is busy. */
  rackOnly?: boolean;
  /**
   * Whether all the runner's work is a rack's, whatever the policy's rules
   * select: a command's `--rack`, which names its one piece of work — a task
   * run ad hoc, or a function call. A rule that matches the work's name still
   * gives its size, its timeout, its memory limit, its GPU and its
   * host-coupling override. A session is opened under any policy.
   */
  selected?: boolean;
  /** How long work waits, under `rackOnly`, for a rack that runs its tier to
   *  be healthy before it runs locally, in ms; two minutes unless set. */
  unreachableWaitMs?: number;
  /** Milliseconds to await a healthy compatible rack; defaults to ten seconds. */
  waitForRackMs?: number;
  /** Receives task, unit and call placement notifications. */
  onPlacement?: (event: RackPlacementEvent) => void;
  /** Told an environment's layers are being built for a rack's platform, and
   *  what the build came to. */
  onEnvironment?: (event: RackEnvironmentEvent) => void;
  /** The process's existing budget, preserved for every local body. */
  budget?: Budget;
  /** Settings preserved for every local process and detached call. */
  settings?: Omit<LocalTaskRunnerOptions, 'body' | 'detached'>;
  /** Overrides the user-wide private state home for an isolated deployment. */
  home?: string;
  /** Ends the wait for the hub and for capacity when the run is aborted. */
  signal?: AbortSignal;
  /** Receives hub startup messages. */
  log?: (line: string) => void;
}

/** Owns the runner's session and reports capacity for the local orchestrator. */
export interface RackRunnerHandle {
  /** Core's LocalTaskRunner, with the delegation body and call executor when
   *  connected. */
  readonly runner: TaskRunner;
  /** Why the runner runs all its work locally, when it opened no session, in
   *  words: none of its work says where it runs, and a command that names one
   *  piece of work says it for it. */
  readonly unattached?: string;
  /** The work the compatible racks of the latest snapshot can hold at once:
   *  their cores, or the slots of one that admits by slots. A run is that
   *  much wider. */
  readonly rackSlots: number;
  /**
   * Describes usable racks or why work will run locally.
   * @param formatBytes - How a memory size reads; by default as `262 GiB`
   */
  describe(formatBytes?: (bytes: number) => string): string;
  /** Refreshes capacity before a watch run without replacing its session,
   *  and forgets the environment builds that failed, which that run tries
   *  again. */
  refreshSlots(): Promise<number>;
  /** What the rack work since the last take came to: a run's summary, read
   *  with `describeRackSummary`. */
  takeSummary(): RackRunSummary;
  /** Unsubscribes from shared work and closes the private data socket. */
  close(): Promise<void>;
}

/**
 * Opens a run's rack attachment, falling back to the standard local runner
 * for unavailable service or incompatible agents. Local settings and budget
 * are preserved in either case; a rack problem never prevents a local run.
 * An opening its caller's signal stopped is unattached too, and says the
 * stop, not that work runs locally: its caller runs nothing more.
 * @param options - Repository, policy and the host's runtime collaborators
 * @returns The runner and a session handle the caller closes in finally
 * @example
 * const rack = await openRackRunner({ repoPath, workspace: 'dev', storage, label: 'run dev', budget });
 * try { await rack.runner.execute(storage, taskHash, inputs, { taskName: 'train_model' }); }
 * finally { await rack.close(); }
 */
export async function openRackRunner(options: OpenRackRunnerOptions): Promise<RackRunnerHandle> {
  const local = new LocalTaskRunner(options.repoPath, options.budget, options.settings);
  const tally = new RackTally();
  const takeSummary = () => tally.take();
  let session: RackSession | undefined;
  let slots = 0;
  const gib = (bytes: number) => `${Math.round(bytes / 1024 ** 3 * 10) / 10} GiB`;
  let description: (formatBytes: (bytes: number) => string) => string = () => 'No healthy compatible rack; running locally';
  const describe = (formatBytes: (bytes: number) => string = gib) => description(formatBytes);
  try {
    const policy = options.policy ?? await loadPolicy(options.repoPath);
    // A policy that selects no task for a rack needs no session: nothing it
    // routes would wait for one. A command's flag selects its work itself.
    if (options.selected !== true && !policyTargetsRack(policy)) {
      return { runner: local, unattached: 'the rack policy selects no task for a rack', rackSlots: 0, describe: () => 'Rack policy selects no task for a rack; running locally',
        refreshSlots: () => Promise.resolve(0), takeSummary, close: () => Promise.resolve() };
    }
    const client = await connectHub({ home: options.home, log: options.log, signal: options.signal });
    session = await RackSession.open(client, options);
    const attached = session;
    let enrolled = 0;
    // The session's runs share their environments' layer builds
    const layerBuilds = new RackLayerBuilds();
    const refreshSlots = async () => {
      layerBuilds.forgetFailures();
      try {
        const capacity = await attached.refreshCapacity();
        const racks = compatibleRacks(capacity);
        enrolled = capacity.racks.length;
        slots = racks.reduce((sum, rack) => sum + rackWidth(rack), 0);
        const text = racks.length > 0 ? undefined
          : capacity.racks.length === 0 ? 'No connected rack; running locally'
            : `No healthy compatible rack; running locally (${capacity.racks.map((rack) => `${rack.label}: ${rack.problem.type === 'some' ? rack.problem.value : rack.pendingApproval ? 'boot needs approval' : !rack.healthy ? 'unhealthy' : rack.bundledE3.type === 'none' ? 'bundled e3 version missing' : `e3 ${rack.bundledE3.value} is incompatible`}`).join(', ')})`;
        // A rack that admits by its resources is said by them; one that
        // admits by slots, by its slots, and that it takes whole tasks only:
        // a split task's units then run here, which a run that keeps its work
        // for a rack is told before it starts. One this hub has not heard
        // say what it is yet is said by its slots alone.
        // One that composes environments says the platform it runs them on.
        description = (formatBytes) => text ?? racks.map((rack) => {
          const all = rackResources(rack);
          const e3 = `e3 ${rack.bundledE3.type === 'some' ? rack.bundledE3.value : 'unknown'}` +
            (rack.features.includes('environments') && rack.target.type === 'some' ? `, environments for ${rack.target.value}` : '');
          return all === undefined ? `${rack.label} (${Number(rack.capacity)} slots, ${rack.reported ? 'whole tasks only, ' : ''}${e3})`
            : `${rack.label} (${all.cores} ${all.cores === 1 ? 'core' : 'cores'}, ${formatBytes(all.memoryBytes)}${all.gpus > 0 ? `, ${all.gpus} ${all.gpus === 1 ? 'GPU' : 'GPUs'}` : ''}, ${e3})`;
        }).join(', ');
      } catch (error) { slots = 0; enrolled = 0; const text = `Rack unavailable: ${error instanceof Error ? error.message : String(error)}; running locally`; description = () => text; }
      return slots;
    };
    // Waits for an enrolled rack to report healthy, up to the deadline. With
    // none enrolled there is nothing to wait for: one appears by enrollment.
    const deadline = Date.now() + Math.max(0, options.waitForRackMs ?? 10000);
    do {
      await refreshSlots();
      if (slots > 0 || enrolled === 0 || attached.hubLost || options.signal?.aborted === true || Date.now() >= deadline) break;
      await delay(Math.min(250, deadline - Date.now()), undefined, { signal: options.signal }).catch(() => {});
    } while (Date.now() <= deadline);
    // A task's body and a call go to a rack alike, sharing the session's
    // environment builds and its run's tally
    const delegation = { session: attached, policy, workspace: options.workspace, rackOnly: options.rackOnly, selected: options.selected,
      unreachableWaitMs: options.unreachableWaitMs, onEnvironment: options.onEnvironment, layerBuilds,
      onPlacement: (event: RackPlacementEvent) => { tally.add(event); options.onPlacement?.(event); } };
    const runner = new LocalTaskRunner(options.repoPath, options.budget, { ...options.settings,
      body: createRackBody(delegation), detached: createRackCall(delegation) });
    return { runner, get rackSlots() { return slots; }, describe, refreshSlots, takeSummary, close: () => attached.close() };
  } catch (error) {
    await session?.close().catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    // Stopped by its caller, the opening names no rack problem a local run
    // answers: nothing of the caller's runs on
    const stopped = options.signal?.aborted === true;
    return { runner: local, unattached: message, rackSlots: 0, describe: () => (stopped ? message : `${message}; running locally`),
      refreshSlots: () => Promise.resolve(0), takeSummary, close: () => Promise.resolve() };
  }
}
