/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type { OpenRackRunnerOptions, RackEnvironmentEvent, RackPlacementEvent, RackRunnerHandle } from '@elaraai/e3-rack';
// The protocol's entry alone, which loads no hub, route or TLS
import { leaseReserve } from '@elaraai/e3-rack/protocol';
import { formatSize } from '../format.js';

/** Rack flags shared by dataflow run and watch, and by run and call, which take `--rack` alone. */
export interface RackFlags {
  /** Enables or disables rack routing for this invocation. */
  rack?: boolean;
  /** Disables capacity spill; infrastructure fallback remains available. */
  rackOnly?: boolean;
}

/** Rejects rack flags on remote repository URLs before resolving credentials. */
export function refuseRemoteRack(repo: string, flags: RackFlags): void {
  if (/^https?:\/\//.test(repo) && (flags.rack !== undefined || flags.rackOnly)) {
    throw new Error('rack delegation applies to local repositories — a server decides where its own work runs');
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
 * - `[RACK] train → rack-a (cap 16 GB)` when a rack claims a task (split
 *   progress already describes its units);
 * - `[RACK] score outgrew its 3 GB cap on rack-a: runs again under 4.5 GB`
 *   for a unit its rack stopped at its cap, and `[RACK] train failed:
 *   memory-limit-exceeded (cap 16 GB); raise --memory-limit or --size` for a
 *   whole task, which e3 does not run again;
 * - `[RACK] score stopped on rack-a at 2 GB, its host short of memory: runs
 *   again reserving 2 GB` for a unit its rack stopped to keep its host from
 *   running out;
 * - `[RACK] train input transfer retried (2 of 5): connection reset`;
 * - `[RACK] train waiting: needs 1 core and 4 GB, rack-a has 0 cores and 1 GB
 *   free` for work queued with no rack having room for it, a task's or a
 *   unit's alike, once: what it reserves, which is what a rack waits to have
 *   free (its cap is what it may grow to), and a GPU when it asks for one;
 * - `[LOCAL] train (input-transfer-failed: connection reset)` for a rack's
 *   work that this machine runs after all, with the rack's reason when its
 *   result gave one, a task's or a unit's alike;
 * - `[LOCAL] score (memory-limit-exceeded: needs 3 GB, limit 2 GB)` for a
 *   piece whose cap would pass its rule's memory limit;
 * - `[LOCAL] fit (environment:native-package:fastfit)` for a task whose
 *   environment cannot go to a rack, and `[LOCAL] fit
 *   (no-rack-for-environment:py)` where no rack composes environments.
 *
 * A command that names one piece of work and asks for a rack for it (`e3 run
 * --rack`, `e3 call --rack`) is told every reason its work runs here
 * (`everyReason`): `[LOCAL] fn:read_config (host-coupled:fs_read_file)` too.
 *
 * @param event - The event
 * @param everyReason - Whether every reason work runs here is printed, not
 *   only those of a rack's work that ran here after all
 * @returns The line, or undefined for an event a run does not print
 */
export function rackPlacementLine(event: RackPlacementEvent, everyReason = false): string | undefined {
  if (event.kind === 'retried') return `  [RACK] ${event.taskName} ${event.retry.transfer} transfer retried (${event.retry.attempt} of ${event.retry.of}): ${event.retry.cause}`;
  if (event.kind === 'waiting') {
    const cores = (n: number) => `${n} ${n === 1 ? 'core' : 'cores'}`;
    const gpus = (n: number) => `${n} ${n === 1 ? 'GPU' : 'GPUs'}`;
    const needs = `${cores(event.needs.cores)}${event.needs.gpu ? `, a GPU` : ''} and ${formatSize(leaseReserve(event.needs))}`;
    const free = event.free === undefined ? 'no free slot'
      : `${cores(event.free.cores)}${event.needs.gpu ? `, ${gpus(event.free.gpus)}` : ''} and ${formatSize(event.free.memoryBytes)} free`;
    return `  [RACK] ${event.taskName} waiting: needs ${needs}, ${event.rackLabel} has ${free}`;
  }
  if (event.kind === 'stopped') {
    return `  [RACK] ${event.taskName} stopped on ${event.rackLabel} at ${formatSize(event.peakBytes)}, its host short of memory: runs again reserving ${formatSize(event.againBytes)}`;
  }
  if (event.kind === 'outgrew') {
    return event.againBytes !== undefined
      ? `  [RACK] ${event.taskName} outgrew its ${formatSize(event.capBytes)} cap on ${event.rackLabel}: runs again under ${formatSize(event.againBytes)}`
      : `  [RACK] ${event.taskName} failed: memory-limit-exceeded (cap ${formatSize(event.capBytes)}); raise --memory-limit or --size`;
  }
  if (event.where === 'rack') {
    return event.role === 'unit' ? undefined : `  [RACK] ${event.taskName} → ${event.rackLabel}${event.needs === undefined ? '' : ` (cap ${formatSize(event.needs.memoryBytes)})`}`;
  }
  if (event.detail?.code === 'memory-limit-exceeded' && event.detail.needsBytes !== undefined && event.detail.limitBytes !== undefined) {
    return `  [LOCAL] ${event.taskName} (memory-limit-exceeded: needs ${formatSize(event.detail.needsBytes)}, limit ${formatSize(event.detail.limitBytes)})`;
  }
  if (event.detail !== undefined) return `  [LOCAL] ${event.taskName} (${event.reason.replace(/^fallback:/, '')})`;
  if (event.role === 'unit') return undefined;
  return everyReason || event.reason === 'spill' || event.reason === 'source-unreachable' || event.reason.startsWith('fallback:') || event.reason.startsWith('no-rack-') ||
    event.reason.startsWith('environment:')
    ? `  [LOCAL] ${event.taskName} (${event.reason})` : undefined;
}

/**
 * What a command that names one piece of work says of where it runs, once it
 * asked for a rack for it: each placement's line, every reason it runs here
 * among them ({@link rackPlacementLine}).
 *
 * @param print - Where a line goes: a run's progress, or, for a call whose
 *   value goes to stdout, the terminal's stderr
 * @returns The placement sink
 */
export function commandPlacement(print: (line: string) => void): (event: RackPlacementEvent) => void {
  return (event) => {
    const line = rackPlacementLine(event, true);
    if (line !== undefined) print(line);
  };
}

/**
 * What a command that names one piece of work says when it opened no rack
 * session, whose work then runs here without a placement of its own.
 *
 * @param name - The work's name: a task's, or a call's `fn:<name>`
 * @param why - Why the session was not opened, in words
 * @returns The line
 */
export function unattachedLine(name: string, why: string): string {
  return `  [LOCAL] ${name} (no-rack-session: ${why})`;
}

/**
 * The line a run prints when an environment's layers are built for a rack:
 * - `[ENV] 3f9a2b1c0d4e for x86_64-manylinux_2_28: building`, when the
 *   repository keeps none for the platform yet;
 * - `[ENV] 3f9a2b1c0d4e built in 48 s: 4 layers, 2.1 GB (1 new)`, once it does.
 *
 * A run whose repository keeps the layers already prints neither.
 *
 * @param event - The event
 * @returns The line
 */
export function rackEnvironmentLine(event: RackEnvironmentEvent): string {
  const name = event.envHash.slice(0, 12);
  if (event.kind === 'building') return `  [ENV] ${name} for ${event.platform}: building`;
  return `  [ENV] ${name} built in ${Math.round(event.ms / 1000)} s: ${event.layers} ${event.layers === 1 ? 'layer' : 'layers'}, ${formatSize(event.bytes)} (${event.fresh} new)`;
}

/** Prints an environment event's line. */
export function printRackEnvironment(event: RackEnvironmentEvent): void {
  console.log(rackEnvironmentLine(event));
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
