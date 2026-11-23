/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What a run is told of where its work runs, and the one rule for which of it
 * was a rack's work run here: read by a command that prints a run's lines
 * without loading the hub.
 */

import type { RackResources } from './rack-json.js';
import type { RackLeaseResources, RackReason, RackTransferRetry } from './task-envelope.js';

/**
 * Why a task or a unit a rack was to run runs here instead: fetching what the
 * rack does not hold of its inputs would take longer than the work last took
 * to run (`fetch-bound`). Of the rack that would fetch it soonest.
 */
export interface RackFetchCost {
  /** The bytes of the work's closure that rack is not known to hold */
  readonly bytes: number;
  /** How long they would take to fetch at its link's rate, in ms */
  readonly fetchMs: number;
  /** How long the work last ran, as e3 recorded it, in ms */
  readonly ranMs: number;
  /** Whether the hub has measured the link's rate; else it was assumed
   *  (`RACK_LINK_ASSUMED_BYTES_PER_SECOND`) */
  readonly measured: boolean;
}

/**
 * Reports where one task body, split unit or function call runs, and what
 * happens to it on a rack:
 * - `placed` on a rack, when one claims its lease;
 * - `placed` locally, with why: never a rack's work (`reason` is why it is not
 *   eligible), or a rack's work that this machine runs after all (`spill`,
 *   `no-rack-for-tier:<tier>`, `source-unreachable` when the racks that run
 *   its tier are not healthy, or have not yet said what they are to a hub
 *   that has just started, `no-rack-caps-units:<tier>` when it is a unit
 *   and none of them caps one, `no-rack-for-environment:<tier>` when none of
 *   them composes environments, an `environment:` reason when the
 *   environment it declares cannot go to a rack, `fetch-bound` when fetching
 *   its inputs would take longer than it last ran, with the `fetch` cost, or a
 *   `fallback:` with what went wrong, and the rack's `detail` when its result
 *   gave a reason);
 * - `retried`: a transfer of its lease failed a try and was given another;
 * - `waiting`: its lease is queued, and no rack has room for what it asks
 *   now. `rackLabel` is the rack with the most memory free, and `free` what
 *   that rack has, when it admits by its resources. A lease that waited says
 *   for how long once a rack claims it (`waitedMs`);
 * - `outgrew`: its rack stopped it at its cap. A unit of a split task runs
 *   again under a larger one (`againBytes`); a whole task or a call does not,
 *   and fails;
 * - `stopped`: its rack's host ran short of memory, and the rack stopped it,
 *   the newest work it held, at `peakBytes`: a unit runs again reserving what
 *   it reached (`againBytes`), as the local budget's guard runs one again.
 *
 * A claim says what the lease asked of its rack (`needs`), and, when the work
 * was leased before and is leased again, that it is (`again`). A call's
 * `taskName` is `fn:<name>`, as its rule and its lease name it.
 */
export type RackPlacementEvent =
  | { kind: 'placed'; taskName: string; role: 'task' | 'unit' | 'call'; where: 'rack'; rackLabel: string; leaseId: string; needs?: RackLeaseResources; waitedMs?: number; again?: true }
  | { kind: 'outgrew'; taskName: string; role: 'task' | 'unit' | 'call'; where: 'rack'; rackLabel: string; leaseId: string; capBytes: number; againBytes?: number }
  | { kind: 'stopped'; taskName: string; role: 'task' | 'unit' | 'call'; where: 'rack'; rackLabel: string; leaseId: string; peakBytes: number; againBytes: number }
  | { kind: 'waiting'; taskName: string; role: 'task' | 'unit' | 'call'; where: 'rack'; rackLabel: string; leaseId: string; needs: RackLeaseResources; free?: RackResources }
  | { kind: 'placed'; taskName: string; role: 'task' | 'unit' | 'call'; where: 'local'; reason: string; detail?: RackReason; fetch?: RackFetchCost }
  | { kind: 'retried'; taskName: string; role: 'task' | 'unit' | 'call'; where: 'rack'; rackLabel: string; leaseId: string; retry: RackTransferRetry };

/**
 * Whether a local placement is of work a rack was to run: what a run prints
 * and counts as having run locally. Work that was never a rack's is not.
 *
 * @param event - A placement event
 * @returns Whether it is a rack's work run locally
 * @example
 * if (ranLocally(event)) console.log(`[LOCAL] ${event.taskName} (${event.reason})`);
 */
export function ranLocally(event: RackPlacementEvent): event is Extract<RackPlacementEvent, { where: 'local' }> {
  return event.kind === 'placed' && event.where === 'local' &&
    (event.detail !== undefined || event.reason === 'spill' || event.reason === 'source-unreachable' || event.reason === 'fetch-bound' || event.reason.startsWith('fallback:') ||
      event.reason.startsWith('no-rack-') || event.reason.startsWith('environment:'));
}
