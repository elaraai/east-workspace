/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { takeRackPolicyNotice, type DetachedSpec, type StorageBackend } from '@elaraai/e3-core';
import type { OpenRackRunnerOptions, RackEnvironmentEvent, RackPlacementEvent, RackPolicy, RackRunnerHandle } from '@elaraai/e3-rack';
// The protocol's entry alone, which loads no hub, route or TLS
import { leaseReserve, ranLocally } from '@elaraai/e3-rack/protocol';
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

/**
 * Whether the invocation asks for a rack itself, with `--rack` or
 * `--rack-only`, whatever the repository's policy says.
 *
 * @param flags - The invocation's rack flags
 * @returns True when it names one of them
 */
export function rackAsked(flags: RackFlags): boolean {
  return flags.rack === true || flags.rackOnly === true;
}

/**
 * Says, once, on stderr, what the repository's upgrade let go of its rack
 * policy, and why (e3-core's `takeRackPolicyNotice`): the first command that
 * reads the policy after the upgrade says it, and no later one. A notice that
 * cannot be read is passed over.
 *
 * @param repo - The repository's path
 * @returns Once said
 */
export async function sayRackPolicyNotice(repo: string): Promise<void> {
  const lines = await takeRackPolicyNotice(repo).catch(() => []);
  if (lines.length === 0) return;
  console.error(`Rack policy: carried into this release's form, which no longer holds these settings it had:\n${lines.map((line) => `  - ${line}`).join('\n')}`);
}

/** Resolves the invocation override, then the repository's enabled policy. */
export async function rackEnabled(repo: string, flags: RackFlags): Promise<boolean> {
  await sayRackPolicyNotice(repo);
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
  await sayRackPolicyNotice(options.repoPath);
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
  // A rack's work that ran here after all, by the rule a run's summary counts by
  return everyReason || ranLocally(event) ? `  [LOCAL] ${event.taskName} (${event.reason})` : undefined;
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
 * Opens the rack session of a command that names one piece of work and asks
 * for a rack for it (`e3 run --rack`, `e3 call --rack`): its work is a rack's
 * whatever the repository's policy selects, and every line of where it runs,
 * and of an environment built for it, goes where the command prints.
 *
 * @param options - The repository, what the rack's activity view names the
 *   work by, the session's label, the command's budget, whether the work is
 *   kept for a rack, the signal that ends its wait and its lease, the policy
 *   when the command has read it already, and where a line goes: a run's
 *   progress, or, for a call whose value goes to stdout, the terminal's stderr
 * @returns The session's handle
 * @throws The signal's reason, when it stopped the session's opening: the
 *   command's work then runs nowhere, and is not said to run here
 */
export async function openCommandRack(
  options: Pick<OpenRackRunnerOptions, 'repoPath' | 'workspace' | 'storage' | 'label' | 'budget' | 'rackOnly' | 'signal' | 'policy'> & { print: (line: string) => void },
): Promise<RackRunnerHandle> {
  const { print, ...session } = options;
  const rack = await openRack({ ...session, selected: true, onPlacement: commandPlacement(print), onEnvironment: (event) => print(rackEnvironmentLine(event)), log: print });
  if (rack.unattached !== undefined) options.signal?.throwIfAborted();
  return rack;
}

/** Where `e3 call --rack` takes a call, read before anything of it runs. */
export type RackCallPlan =
  /** To a rack, under the policy its session is opened with, and with the
   *  time a rule that names it gives it, when one does */
  | { readonly kind: 'rack'; readonly policy: RackPolicy; readonly timeoutMs: number | null }
  /** Here, as the line says, with the time a rule gives it, when one does */
  | { readonly kind: 'here'; readonly line: string; readonly timeoutMs: number | null };

/**
 * Where a call kept for a rack (`e3 call --rack`) goes, read from the
 * repository's rack policy before anything of the call runs or any rack
 * session is opened: a call no rack may run (a program that reaches the host,
 * a custom runner, an environment no rack installs) runs here at once,
 * saying why, and starts no hub and waits for no rack. A rule that names the
 * call (`fn:<name>`) gives it its time, which the drafts it lays here and its
 * function share, wherever it runs.
 *
 * @param repoPath - The repository
 * @param storage - Its storage, which holds the environment the call declares
 * @param name - The function's name, or its IR file's
 * @param spec - The call: its program, runner and environment are judged
 * @returns Where it goes, and its rule's time
 * @example
 * const plan = await planRackCall(repoPath, storage, 'score', spec);
 * if (plan.kind === 'here') console.error(plan.line);
 */
export async function planRackCall(repoPath: string, storage: StorageBackend, name: string, spec: DetachedSpec): Promise<RackCallPlan> {
  const taskName = `fn:${name}`;
  const here = (reason: string, timeoutMs: number | null = null): RackCallPlan =>
    ({ kind: 'here', line: rackPlacementLine({ kind: 'placed', taskName, role: 'call', where: 'local', reason }, true)!, timeoutMs });
  const { EligibilityEvaluator, loadPolicy, rackCallTimeoutMs } = await import('@elaraai/e3-rack');
  let policy: RackPolicy;
  try {
    policy = await loadPolicy(repoPath);
  } catch (error) {
    // A policy that does not read opens no session, as a session's opening says
    return here(`no-rack-session: ${error instanceof Error ? error.message : String(error)}`);
  }
  const timeoutMs = rackCallTimeoutMs(policy, name);
  const verdict = await new EligibilityEvaluator(policy, { selected: true })
    .evaluateCall({ repo: repoPath, spec, options: { storage, functionName: name }, settings: {} }, storage);
  return verdict.eligible ? { kind: 'rack', policy, timeoutMs } : here(verdict.reason, timeoutMs);
}

/**
 * What a command that names one piece of work says when it opened no rack
 * session, whose work then ran here without a placement of its own: nothing
 * of work that did not run, as a run the cache answered did not.
 *
 * @param rack - The command's rack handle: why its session was not opened,
 *   when it was not
 * @param name - The work's name: a task's, or a call's `fn:<name>`
 * @param ran - Whether the work ran
 * @returns The line, or undefined when there is none to print
 * @example
 * const line = unattachedLine(rack, 'train', !result.cached);
 * if (line !== undefined) console.log(line);
 */
export function unattachedLine(rack: Pick<RackRunnerHandle, 'unattached'>, name: string, ran: boolean): string | undefined {
  return rack.unattached !== undefined && ran ? `  [LOCAL] ${name} (no-rack-session: ${rack.unattached})` : undefined;
}

/**
 * The line a run prints when an environment's layers are built for a rack:
 * - `[ENV] 3f9a2b1c0d4e for x86_64-manylinux_2_28: building`, when the
 *   repository keeps none for the platform yet;
 * - `[ENV] 3f9a2b1c0d4e built in 48 s: 4 layers, 2.1 GB (1 new)`, once it does;
 * - `[ENV] 3f9a2b1c0d4e for x86_64-manylinux_2_28 over py-datascience: building`
 *   and `[ENV] 3f9a2b1c0d4e built in 41 s: 2 layers, 6.2 MB (2 new), 31
 *   distributions from the tier`, for one built over the tier image its rack
 *   boots it over, without what that image holds.
 *
 * A run whose repository keeps the layers already prints neither.
 *
 * @param event - The event
 * @returns The line
 */
export function rackEnvironmentLine(event: RackEnvironmentEvent): string {
  const name = event.envHash.slice(0, 12);
  if (event.kind === 'building') return `  [ENV] ${name} for ${event.platform}${event.over === undefined ? '' : ` over ${event.over}`}: building`;
  const fromTier = event.fromTier === undefined ? '' : `, ${event.fromTier} ${event.fromTier === 1 ? 'distribution' : 'distributions'} from the tier`;
  return `  [ENV] ${name} built in ${Math.round(event.ms / 1000)} s: ${event.layers} ${event.layers === 1 ? 'layer' : 'layers'}, ${formatSize(event.bytes)} (${event.fresh} new)${fromTier}`;
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
