/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A run of which a rack runs part whole: the selection is granted to a rack's
 * run before the origin's loop starts, and the loop takes each granted task's
 * result from it as it reaches the task.
 */

import { variant } from '@elaraai/east';
import {
  LocalTaskRunner, syncDescribe,
  type Budget, type DetachedCallExecutor, type LocalTaskRunnerOptions, type ReplicaRun, type StorageBackend, type TaskBodyExecutor, type TaskRunner,
} from '@elaraai/e3-core';
import type { SyncDescription } from '@elaraai/e3-types';
import type { RackPlacementEvent } from '../protocol/placement.js';
import { EligibilityEvaluator } from '../routing/eligibility.js';
import type { RackPolicy } from '../routing/policy.js';
import { hostBound, type RackVerdict } from '../runner/rack-lease.js';
import { createRackRunBody } from './run-body.js';
import { rackRunSelection } from './selection.js';

/** How {@link openRackRun} opens a run. */
export interface OpenRackRunOptions {
  /** The repository */
  readonly repoPath: string;
  /** The workspace its run runs */
  readonly workspace: string;
  /** Its storage */
  readonly storage: StorageBackend;
  /** The repository's rack policy */
  readonly policy: RackPolicy;
  /** The process's budget, which every body run here takes from */
  readonly budget?: Budget;
  /** How every process run here runs */
  readonly settings?: Omit<LocalTaskRunnerOptions, 'body' | 'detached'>;
  /** What the run forces, as its start is given it */
  readonly force?: boolean | readonly string[];
  /** The run's filter, as its start is given it */
  readonly filter?: string;
  /** The tiers the rack that would take the run up boots: a task of another
   *  is not granted it. Absent, any tier is */
  readonly tiers?: ReadonlySet<string>;
  /** Opens the rack's run once there is something to grant it: the
   *  selection, described, and each of its tasks' verdicts. A run that says
   *  where it is placed has its tasks' placements said by it */
  readonly open: (description: SyncDescription, verdicts: ReadonlyMap<string, RackVerdict>) => Promise<PlacedRun>;
  /** Told where each granted task ran: on the run's rack, or here */
  readonly onPlacement?: (event: RackPlacementEvent) => void;
  /** The body for everything the rack's run is not granted */
  readonly inner?: TaskBodyExecutor;
  /** The executor of a detached call, which no rack's run is granted */
  readonly detached?: DetachedCallExecutor;
}

/** A rack's run, and the rack that took it up, when it can say. */
export type PlacedRun = ReplicaRun & { placedOn?(): { readonly rackLabel: string; readonly leaseId: string } | undefined };

/** A run's runner, and the rack's run its granted tasks come from. */
export interface RackRunHandle {
  /** The runner the run's loop runs with */
  readonly runner: TaskRunner;
  /** How many more tasks and units the run's loop keeps in flight than its
   *  cores: one for each granted task, which waits on the rack's run */
  readonly rackSlots: number;
  /** The tasks granted the rack's run */
  readonly selected: readonly string[];
  /** Why no rack's run was granted anything, when none was */
  readonly unattached?: string;
  /** Cancels the rack's run */
  close(): Promise<void>;
}

/**
 * Opens a run of which a rack runs part.
 *
 * @remarks
 * Selects the tasks a rack's run runs whole ({@link rackRunSelection}),
 * describes them, with each task the cache answers given by the output it
 * answers it with, opens the rack's run and grants it, before anything runs.
 * The runner it answers takes each granted task's result from that run
 * ({@link createRackRunBody}), and runs everything else with the inner body.
 * With nothing selected the rack's run is never opened. A failure of the
 * rack's side never stops the run: the runner is then the local one, and
 * says why.
 *
 * @param options - The repository, its policy, the run's force and filter,
 *   and how the rack's run is opened
 * @returns The runner and the rack's run
 * @example
 * const rack = await openRackRun({ repoPath, workspace: 'dev', storage, policy, budget, open });
 * try { await orchestrator.wait(await orchestrator.start(storage, repoPath, 'dev', { runner: rack.runner, width: budget.cores + rack.rackSlots })); }
 * finally { await rack.close(); }
 */
export async function openRackRun(options: OpenRackRunOptions): Promise<RackRunHandle> {
  const { repoPath, workspace, storage, policy, budget, settings } = options;
  const here = (unattached: string): RackRunHandle => ({
    runner: new LocalTaskRunner(repoPath, budget, { ...settings, ...(options.inner !== undefined && { body: options.inner }),
      ...(options.detached !== undefined && { detached: options.detached }) }),
    rackSlots: 0,
    selected: [],
    unattached,
    close: () => Promise.resolve(),
  });
  let run: PlacedRun | undefined;
  try {
    const selection = await rackRunSelection(storage, repoPath, workspace, {
      evaluator: new EligibilityEvaluator(policy),
      hostBound: hostBound(settings ?? {}, undefined),
      ...(options.tiers !== undefined && { tiers: options.tiers }),
      ...(options.force !== undefined && { force: options.force }),
      ...(options.filter !== undefined && { filter: options.filter }),
    });
    if (selection.tasks.length === 0) return here('the rack policy selects no task the cache does not answer');
    const description = await syncDescribe(storage, repoPath, workspace, variant('partial', {
      tasks: [...selection.tasks], binds: { paths: [], functions: [], records: [], pages: [] }, records: [],
    }), { values: selection.values });
    run = await options.open(description, selection.verdicts);
    // The rack's run forces what the run forces of what it was granted
    const named = Array.isArray(options.force) ? options.force : null;
    const forced = selection.tasks.filter((name) => named !== null ? named.includes(name)
      : options.force === true && (options.filter === undefined || name === options.filter));
    await run.grant({ description, force: forced.length > 0 ? forced : false });
    const granted = run;
    const body = createRackRunBody({
      run: granted,
      selected: new Set(selection.tasks),
      retryTaskFailuresLocally: policy.retryTaskFailuresLocally,
      ...(options.inner !== undefined && { inner: options.inner }),
      ...(options.onPlacement !== undefined && { onPlacement: options.onPlacement, placedOn: () => granted.placedOn?.() }),
    });
    return {
      runner: new LocalTaskRunner(repoPath, budget, { ...settings, body, ...(options.detached !== undefined && { detached: options.detached }) }),
      rackSlots: selection.tasks.length,
      selected: selection.tasks,
      close: () => granted.cancel(),
    };
  } catch (err) {
    await run?.cancel().catch(() => undefined);
    return here(`the rack's run could not be granted: ${err instanceof Error ? err.message : String(err)}`);
  }
}
