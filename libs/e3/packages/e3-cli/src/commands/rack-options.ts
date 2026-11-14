/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type { OpenRackRunnerOptions, RackPlacementEvent, RackRunnerHandle } from '@elaraai/e3-rack';
import { formatSize } from '../format.js';

/** Rack flags shared by dataflow run and watch. */
export interface RackFlags {
  /** Enables or disables rack routing for this invocation. */
  rack?: boolean;
  /** Disables capacity spill; infrastructure fallback remains available. */
  rackOnly?: boolean;
}

/** Rejects rack flags on remote repository URLs before resolving credentials. */
export function refuseRemoteRack(repo: string, flags: RackFlags): void {
  if (/^https?:\/\//.test(repo) && (flags.rack !== undefined || flags.rackOnly)) {
    throw new Error('rack delegation applies to local repositories — a server decides where its own tasks run');
  }
  if (flags.rackOnly && flags.rack === false) throw new Error('--rack-only and --no-rack cannot be combined');
}

/** Resolves the invocation override, then the repository's enabled policy. */
export async function rackEnabled(repo: string, flags: RackFlags): Promise<boolean> {
  if (flags.rackOnly) return true;
  if (flags.rack !== undefined) return flags.rack;
  try {
    // The rack package is loaded only once a policy may enable it.
    const { loadPolicy } = await import('@elaraai/e3-rack');
    return (await loadPolicy(repo)).enabled;
  } catch (error) {
    console.warn(`Rack policy: ${error instanceof Error ? error.message : String(error)}; running locally`);
    return false;
  }
}

/**
 * Opens a run's rack attachment, loading the rack package for it: a command
 * that runs nothing on a rack never loads the hub, its routes or its TLS.
 */
export async function openRack(options: OpenRackRunnerOptions): Promise<RackRunnerHandle> {
  const { openRackRunner } = await import('@elaraai/e3-rack');
  return openRackRunner(options);
}

/**
 * The line a run prints for a placement event, when it prints one:
 * - `[RACK] train → rack-a` when a rack claims a task (split progress
 *   already describes its units);
 * - `[RACK] train input transfer retried (2 of 5): connection reset`;
 * - `[RACK] train waiting: needs 4 GB, rack-a has 1 GB free` for work queued
 *   with no rack having room for it, a task's or a unit's alike, once;
 * - `[LOCAL] train (input-transfer-failed: connection reset)` for a rack's
 *   work that this machine runs after all, with the rack's reason when its
 *   result gave one, a task's or a unit's alike;
 * - `[LOCAL] score (memory-limit-exceeded: needs 3 GB, limit 2 GB)` for a
 *   piece whose cap would pass its rule's memory limit.
 *
 * @param event - The event
 * @returns The line, or undefined for an event a run does not print
 */
export function rackPlacementLine(event: RackPlacementEvent): string | undefined {
  if (event.kind === 'retried') return `  [RACK] ${event.taskName} ${event.retry.transfer} transfer retried (${event.retry.attempt} of ${event.retry.of}): ${event.retry.cause}`;
  if (event.kind === 'waiting') {
    return `  [RACK] ${event.taskName} waiting: needs ${formatSize(event.needs.memoryBytes)}, ${event.rackLabel} has ${event.free === undefined ? 'no free slot' : `${formatSize(event.free.memoryBytes)} free`}`;
  }
  if (event.where === 'rack') return event.role === 'unit' ? undefined : `  [RACK] ${event.taskName} → ${event.rackLabel}`;
  if (event.detail?.code === 'memory-limit-exceeded' && event.detail.needsBytes !== undefined && event.detail.limitBytes !== undefined) {
    return `  [LOCAL] ${event.taskName} (memory-limit-exceeded: needs ${formatSize(event.detail.needsBytes)}, limit ${formatSize(event.detail.limitBytes)})`;
  }
  if (event.detail !== undefined) return `  [LOCAL] ${event.taskName} (${event.reason.replace(/^fallback:/, '')})`;
  if (event.role === 'unit') return undefined;
  return event.reason === 'spill' || event.reason.startsWith('fallback:') || event.reason.startsWith('no-rack-')
    ? `  [LOCAL] ${event.taskName} (${event.reason})` : undefined;
}

/** Prints a placement event's line, when a run prints one for it. */
export function printRackPlacement(event: RackPlacementEvent): void {
  const line = rackPlacementLine(event);
  if (line !== undefined) console.log(line);
}

/** Prints what the run's rack work came to, when any went to a rack or came back from one. */
export async function printRackSummary(rack: RackRunnerHandle): Promise<void> {
  const { describeRackSummary } = await import('@elaraai/e3-rack');
  const line = describeRackSummary(rack.takeSummary());
  if (line !== undefined) console.log(line);
}
