/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { setTimeout as delay } from 'node:timers/promises';
import { EnvironmentTargetRefused, ExecutionAttempt, touchReachable, unitCap, uuidv7, type ExecutionResult, type TaskBodyExecutor, type TaskBodyRequest } from '@elaraai/e3-core';
import type { LeaseHandle, LeaseUpdate, RackSession } from '../client/session.js';
import { recordClosure, stagedObjects, taskClosure } from '../lease/closure.js';
import { RACK_LEASE_VERSION, describeRackReason, leaseReserve, readRackReason, readRackRetries, type RackLeaseEvent, type RackLeaseResources, type RackReason, type RackTransferRetry } from '../protocol/task-envelope.js';
import { splitUnitToWire } from '../runner-event.js';
import { EligibilityEvaluator, type Eligibility } from '../routing/eligibility.js';
import { RACK_SIZES, type RackPolicy } from '../routing/policy.js';
import { compatibleRacks, rackCouldHold, rackFree, rackResources, rackRoom, type SnapshotRack } from './capacity.js';
import { publishEnvLayers, type RackEnvironmentEvent } from './environment.js';
import type { RackResources } from '../protocol/rack-json.js';

/**
 * Reports where one task body or split unit runs, and what happens to it on a
 * rack:
 * - `placed` on a rack, when one claims its lease;
 * - `placed` locally, with why: never a rack's work (`reason` is why it is not
 *   eligible), or a rack's work that this machine runs after all (`spill`,
 *   `no-rack-for-tier:<tier>`, `source-unreachable` when the racks that run
 *   its tier are not healthy, `no-rack-for-environment:<tier>` when none of
 *   them composes environments, an `environment:` reason when the
 *   environment it declares cannot go to a rack, or a `fallback:` with what
 *   went wrong, and the rack's `detail` when its result gave a reason);
 * - `retried`: a transfer of its lease failed a try and was given another;
 * - `waiting`: its lease is queued, and no rack has room for what it asks
 *   now. `rackLabel` is the rack with the most memory free, and `free` what
 *   that rack has, when it admits by its resources. A lease that waited says
 *   for how long once a rack claims it (`waitedMs`);
 * - `outgrew`: its rack stopped it at its cap. A unit of a split task runs
 *   again under a larger one (`againBytes`); a whole task does not, and
 *   fails;
 * - `stopped`: its rack's host ran short of memory, and the rack stopped it,
 *   the newest work it held, at `peakBytes`: a unit runs again reserving what
 *   it reached (`againBytes`), as the local budget's guard runs one again.
 *
 * A claim says what the lease asked of its rack (`needs`), and, when the work
 * was leased before and is leased again, that it is (`again`).
 */
export type RackPlacementEvent =
  | { kind: 'placed'; taskName: string; role: 'task' | 'unit'; where: 'rack'; rackLabel: string; leaseId: string; needs?: RackLeaseResources; waitedMs?: number; again?: true }
  | { kind: 'outgrew'; taskName: string; role: 'task' | 'unit'; where: 'rack'; rackLabel: string; leaseId: string; capBytes: number; againBytes?: number }
  | { kind: 'stopped'; taskName: string; role: 'task' | 'unit'; where: 'rack'; rackLabel: string; leaseId: string; peakBytes: number; againBytes: number }
  | { kind: 'waiting'; taskName: string; role: 'task' | 'unit'; where: 'rack'; rackLabel: string; leaseId: string; needs: RackLeaseResources; free?: RackResources }
  | { kind: 'placed'; taskName: string; role: 'task' | 'unit'; where: 'local'; reason: string; detail?: RackReason }
  | { kind: 'retried'; taskName: string; role: 'task' | 'unit'; where: 'rack'; rackLabel: string; leaseId: string; retry: RackTransferRetry };

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
    (event.detail !== undefined || event.reason === 'spill' || event.reason === 'source-unreachable' || event.reason.startsWith('fallback:') ||
      event.reason.startsWith('no-rack-') || event.reason.startsWith('environment:'));
}

/** Configures a run's body executor without acquiring local resources. */
export interface RackBodyOptions {
  /** Live session serving this repository. */
  session: RackSession;
  /** Policy snapshot for this run. */
  policy: RackPolicy;
  /** Workspace named on the rack's activity view. */
  workspace: string;
  /** Disables capacity spill, but still permits infrastructure fallback:
   *  after a wait for a rack to be healthy, and one further lease for work
   *  whose transfer failed. */
  rackOnly?: boolean;
  /** How long work waits, under {@link rackOnly}, for a rack that runs its
   *  tier to be healthy before it runs locally, in ms: two minutes
   *  ({@link RACK_ONLY_WAIT_MS}) unless set. */
  unreachableWaitMs?: number;
  /** Receives placement and fallback notifications. */
  onPlacement?: (event: RackPlacementEvent) => void;
  /** Told an environment's layers are being built for a rack's platform, and
   *  what the build came to. */
  onEnvironment?: (event: RackEnvironmentEvent) => void;
  /** The layer builds the session's runs share; the body's own unless given. */
  layerBuilds?: RackLayerBuilds;
}

/** What a build of an environment's layers for a platform came to: nothing,
 *  when they are kept; else why not, and the build's own words. */
export interface RackLayerBuild {
  /** Why the layers are not kept: an `EnvironmentTargetRefused` reason, or
   *  `build-failed` */
  readonly reason?: string;
  /** The build's own words for it */
  readonly said?: string;
}

/**
 * The builds of environments' layers a session's runs asked for, each once
 * for an environment and a platform: a second ask is answered what the first
 * came to.
 *
 * @remarks
 * A build that failed is tried again by the next run, once its session is
 * told one starts ({@link forgetFailures}): a download that failed, or a run
 * that was stopped, is no verdict on the environment. One that no install
 * makes for the platform (`EnvironmentTargetRefused`) is: it is not tried
 * again until the environment changes, which makes it another.
 *
 * @example
 * ```ts
 * const builds = new RackLayerBuilds();
 * const body = createRackBody({ session, policy, workspace: 'dev', layerBuilds: builds });
 * // before each run of a watch:
 * builds.forgetFailures();
 * ```
 */
export class RackLayerBuilds {
  private readonly builds = new Map<string, Promise<RackLayerBuild>>();
  private readonly failed = new Set<string>();

  /**
   * The build of an environment's layers for a platform: the one asked for
   * already, or this one, started now.
   * @param envHash - The environment's hash
   * @param platform - The platform
   * @param build - Builds them, answering what it came to
   * @returns What the build came to
   */
  get(envHash: string, platform: string, build: () => Promise<RackLayerBuild>): Promise<RackLayerBuild> {
    const key = `${envHash} ${platform}`;
    let made = this.builds.get(key);
    if (made === undefined) {
      made = build().then((result) => {
        if (result.reason === 'build-failed') this.failed.add(key);
        return result;
      });
      this.builds.set(key, made);
    }
    return made;
  }

  /** Forgets the builds that failed, so the next run tries them again. */
  forgetFailures(): void {
    for (const key of this.failed) this.builds.delete(key);
    this.failed.clear();
  }
}

/** Whether a rack composes a lease's environment from layers, and says the
 *  platform it runs environments on. */
function composes(rack: SnapshotRack): rack is SnapshotRack & { target: { type: 'some'; value: string } } {
  return rack.features.includes('environments') && rack.target.type === 'some';
}

/**
 * What a body's lease asks of a rack, and what the rack books for it.
 *
 * @remarks
 * A unit of a split task takes one core, reserves what it expects to need,
 * and is capped where e3-core caps a local unit that expects the same peak
 * (`unitCap`): half as much again. What it expects is its stage's measured
 * peak, the task's previous peak, or, the first time the task runs, e3-core's
 * estimate of the largest piece (the runner's own memory and what the piece
 * holds of its rows), which a local unit reserves too: so a rack holds as
 * many units as a local run of its memory would, and a first run is as wide
 * as a later one. Only a unit that expects nothing at all is given its rule's
 * memory limit, else its size's memory, as its reservation and its cap. A
 * whole task takes its size's cores, but no more than the rack with the most
 * has, whose VM it is then given (a VM is given no more cores than its host
 * has); and its rule's memory limit, else its size's memory, as both its
 * reservation and its cap, since a rack never stops a whole task to keep its
 * host's memory.
 *
 * @param request - The task body or unit
 * @param verdict - Its rule's size, memory limit and GPU
 * @param mostCores - The most cores a rack that could take the work has; no
 *   bound unless given
 * @returns The resources, or the reason the work cannot be a rack's: the cap
 *   a unit needs is more than its rule's memory limit
 */
export function leaseResources(request: Pick<TaskBodyRequest, 'unit' | 'options'>, verdict: Extract<Eligibility, { eligible: true }>,
  mostCores = Infinity): RackLeaseResources | RackReason {
  const size = RACK_SIZES[verdict.size];
  const fallback = verdict.memoryLimit ?? size.memoryBytes;
  if (request.unit === undefined) return { kind: 'task', cores: Math.max(1, Math.min(size.cores, mostCores)), memoryBytes: fallback, gpu: verdict.gpu };
  const expected = request.options.expectedPeakBytes;
  if (expected === undefined || expected <= 0) return { kind: 'unit', cores: 1, memoryBytes: fallback, gpu: verdict.gpu };
  return unitResources(expected, verdict);
}

/** A unit that reserves `reserve` bytes, capped at `unitCap` of it; or the
 *  reason it cannot be a rack's: that cap passes its rule's memory limit. */
function unitResources(reserve: number, verdict: Extract<Eligibility, { eligible: true }>): RackLeaseResources | RackReason {
  const cap = unitCap(reserve);
  if (verdict.memoryLimit !== null && cap > verdict.memoryLimit) return { code: 'memory-limit-exceeded', needsBytes: cap, limitBytes: verdict.memoryLimit };
  return { kind: 'unit', cores: 1, memoryBytes: cap, reserveBytes: reserve, gpu: verdict.gpu };
}

/**
 * How long a run that keeps its work for a rack (`--rack-only`) waits for one
 * that runs the work's tier to be healthy, in ms, before the work runs
 * locally: a rack's fault never fails a run.
 */
export const RACK_ONLY_WAIT_MS = 120_000;

/** Whether this body could obtain a local core and its memory reservation. */
function localIdle(request: TaskBodyRequest): boolean {
  const budget = request.options.budget;
  if (budget === undefined) return true;
  const memory = request.options.expectedPeakBytes ?? 0;
  return budget.queued === 0 && budget.inFlight < budget.cores &&
    (memory > budget.memory ? budget.inFlight === 0 : budget.used + memory <= budget.memory);
}

/** Waits without abandoning a pending next() when a timer wins the race. */
function wait(next: Promise<LeaseUpdate>, ms: number, signal?: AbortSignal): Promise<LeaseUpdate | 'tick' | 'abort'> {
  if (signal?.aborted) return Promise.resolve('abort');
  return new Promise((resolve, reject) => {
    const finish = (value: LeaseUpdate | 'tick' | 'abort') => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(value); };
    const abort = () => finish('abort');
    const timer = setTimeout(() => finish('tick'), Math.max(1, Math.min(ms, 2147483647)));
    signal?.addEventListener('abort', abort, { once: true });
    next.then(finish, (error: unknown) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); });
  });
}

/**
 * Delegates eligible cache misses through the shared hub. The hub alone
 * writes the remote attempt; local() owns every local fallback and grant.
 *
 * Work that declares an environment is leased once the environment's layers
 * are kept for the platform of a rack that composes environments: they are
 * built first, once for an environment and a platform ({@link RackLayerBuilds}),
 * and work whose environment no install makes for that platform, or whose
 * build fails, runs locally with the reason.
 * @param options - Session, policy and placement sink
 * @returns The body hook for e3-core's LocalTaskRunner
 * @example
 * const runner = new LocalTaskRunner(repo, budget, { body: createRackBody({ session, policy, workspace: 'dev' }) });
 */
export function createRackBody(options: RackBodyOptions): TaskBodyExecutor {
  const { session, policy } = options;
  const evaluator = new EligibilityEvaluator(policy);
  // Each environment's layers for each platform, once: why they are not
  // there, when they are not, and the build's own words.
  const builds = options.layerBuilds ?? new RackLayerBuilds();
  const layersFor = (request: TaskBodyRequest, envHash: string, platform: string, tier: string): Promise<RackLayerBuild> =>
    builds.get(envHash, platform, () =>
      publishEnvLayers(request.storage, request.repo, envHash, { platform, tier, e3Version: session.e3Version }, options.onEnvironment,
        request.options.signal).then(
        () => ({}),
        (error: unknown) => error instanceof EnvironmentTargetRefused ? { reason: error.reason, said: error.message }
          : { reason: 'build-failed', said: error instanceof Error ? error.message : String(error) }));
  return async (request, local) => {
    const placement = { taskName: request.options.taskName ?? request.taskHash, role: request.role };
    let handle: LeaseHandle | undefined;
    let rackLabel = 'rack';
    let untee: (() => void) | undefined;
    let leavingRack = false;
    const freshIds = () => ({ inHash: request.ids.inHash, executionId: uuidv7(), startTime: Date.now() });
    const stop = (kind: 'cancelled' | 'error', cause: string) => {
      leavingRack = true;
      return new ExecutionAttempt(request.storage, request.repo, request.taskHash, request.inputHashes, freshIds(), request.unit !== undefined && !request.unit.own).recordStopped(kind, cause);
    };
    // A rack's result that gives its reason is placed by it: the reason's
    // code, and its cause or detail, are what the run prints.
    const runLocal = async (reason: string, detail?: RackReason, said?: string): Promise<ExecutionResult> => {
      leavingRack = true;
      if (handle !== undefined) await handle.cancel().catch(() => {});
      const ids = handle === undefined ? request.ids : freshIds();
      options.onPlacement?.({ kind: 'placed', ...placement, where: 'local', reason, ...(detail !== undefined && { detail }) });
      // What went wrong is in the task's log: a rack's attempt, or the build
      // of its environment for a rack, in the build tool's own words.
      const line = reason.startsWith('fallback:') ? `e3: rack attempt failed on ${rackLabel}: ${reason.slice(9)} — running locally\n`
        : said !== undefined ? `e3: the environment was not built for a rack (${reason}): ${said} — running locally\n` : undefined;
      if (line !== undefined) {
        await request.storage.logs.append(request.repo, request.taskHash, ids.inHash, ids.executionId, 'stderr', line);
        request.options.onStderr?.(line);
      }
      return local(ids);
    };
    if (request.options.signal?.aborted) return local();
    if (session.hubLost) return runLocal('hub-unreachable');
    const verdict = await evaluator.evaluate(request);
    if (!verdict.eligible) return runLocal(verdict.reason);
    // An explicitly configured host process environment or identity cannot be
    // reproduced by a stock guest. Keep these settings on the standard body.
    if (request.options.env !== undefined || request.options.uid !== undefined || request.options.gid !== undefined ||
      (request.options.extraEnv !== undefined && Object.keys(request.options.extraEnv).length > 0)) return runLocal('host-process-settings');
    // The racks that can take the work: the healthy ones that run its tier
    // and, for work that declares an environment, compose environments, for
    // a platform its layers are kept for once that is known.
    let platforms: ReadonlySet<string> | undefined;
    const fleet = (): SnapshotRack[] => {
      const racks = compatibleRacks(session.capacity(), verdict.tier);
      return verdict.environment === null ? racks : racks.filter((rack) => composes(rack) && (platforms === undefined || platforms.has(rack.target.value)));
    };
    // Why no rack can take the work now: one that could is not healthy, none
    // that could is enrolled, or none that runs its tier composes the
    // environment it declares. Only a rack that composes it could take work
    // that declares one, so only such a rack's health is waited for.
    const noRack = (): string | null => {
      if (fleet().length > 0) return null;
      const serving = session.capacity().racks.filter((rack) => rack.tiers.includes(verdict.tier));
      const could = verdict.environment === null ? serving
        : serving.filter((rack) => composes(rack) && (platforms === undefined || platforms.has(rack.target.value)));
      if (could.some((rack) => !rack.healthy)) return 'source-unreachable';
      return verdict.environment !== null && could.length === 0 && serving.length > 0 ? `no-rack-for-environment:${verdict.tier}` : `no-rack-for-tier:${verdict.tier}`;
    };
    // A rack that is healthy has said what it does: one that composes no
    // environment is not waited for.
    const waitedFor = (why: string): boolean => !why.startsWith('no-rack-for-environment:');
    const unreachableWaitMs = options.unreachableWaitMs ?? RACK_ONLY_WAIT_MS;
    // A run that keeps its work for a rack waits for one to be healthy
    // before the work runs locally; any other runs it locally at once.
    let absent = noRack();
    if (absent !== null && waitedFor(absent) && options.rackOnly) {
      const until = Date.now() + unreachableWaitMs;
      while (absent !== null && waitedFor(absent) && Date.now() < until && request.options.signal?.aborted !== true && !session.hubLost) {
        await delay(Math.max(1, Math.min(1000, until - Date.now())), undefined, { signal: request.options.signal }).catch(() => {});
        await session.refreshCapacity().catch(() => {});
        absent = noRack();
      }
      if (request.options.signal?.aborted) return local();
    }
    if (absent !== null) return runLocal(absent);
    // A unit whose cap would pass its rule's limit is not a rack's: a unit is
    // pure, and runs under the local budget instead.
    const asked = leaseResources(request, verdict, Math.max(...fleet().map((rack) => rackResources(rack)?.cores ?? Infinity)));
    if ('code' in asked) return runLocal(asked.code, asked);
    // What the lease asks: a unit its cap stopped asks more of its next lease.
    let resources: RackLeaseResources = asked;
    // Work no rack could hold, with nothing else on it, is not queued: it
    // would wait for ever. For want of memory it runs locally by that name.
    const unheld = (needs: RackLeaseResources): (() => Promise<ExecutionResult>) | null => {
      const racks = fleet();
      if (racks.length === 0) return () => runLocal('fallback:rack-unavailable');
      if (racks.some((rack) => rackCouldHold(rack, needs))) return null;
      const most = Math.max(...racks.map((rack) => rackResources(rack)?.memoryBytes ?? 0));
      return () => needs.memoryBytes > most
        ? runLocal('memory-limit-exceeded', { code: 'memory-limit-exceeded', needsBytes: needs.memoryBytes, limitBytes: most })
        : runLocal(`no-rack-holds:${needs.gpu ? 'gpu' : `${needs.cores}-cores`}`);
    };
    const never = unheld(resources);
    if (never !== null) return never();
    if (verdict.environment !== null) {
      // The environment's layers, for each platform a rack that could hold
      // the work runs environments on: built now if the repository keeps
      // none, and for no rack that could never hold the work. The work is
      // then a rack's whose platform they were built for.
      const environment = verdict.environment;
      const built = [...new Set(fleet().filter((rack) => rackCouldHold(rack, resources)).filter(composes).map((rack) => rack.target.value))].sort();
      const made = await Promise.all(built.map((platform) => layersFor(request, environment, platform, verdict.tier)));
      if (request.options.signal?.aborted) return local();
      platforms = new Set(built.filter((_, i) => made[i]!.reason === undefined));
      if (platforms.size === 0) {
        const refused = made.find((result) => result.reason !== undefined)!;
        return runLocal(`environment:${refused.reason!}`, undefined, refused.said);
      }
      const nowhere = unheld(resources);
      if (nowhere !== null) return nowhere();
    }
    const canSpill = () => policy.spill && !options.rackOnly && localIdle(request);
    // How many more leases asking this much the compatible racks hold in the
    // latest snapshot, less the work already queued for them.
    const room = () => fleet().reduce((sum, rack) => sum + rackRoom(rack, resources), 0) - Number(session.capacity().queued);
    let waitingSince: number | undefined;
    // Under rack-only, work whose transfer failed is leased once more.
    let leasedAgain = false;
    // Whether a rack has claimed the work before: a claim after it is the
    // same work leased again, which a run counts once.
    let claimedBefore = false;
    // Since when a queued lease has had no rack that could claim it.
    let unreachableSince: number | undefined;
    try {
      const hashes = await taskClosure(request.storage, request.repo, request.taskHash, request.task,
        request.unit === undefined ? request.inputHashes : stagedObjects(request.unit.inputs, request.unit.merge));
      const closure = await recordClosure(request.storage, request.repo, hashes);
      const timeoutMs = Math.min(verdict.timeoutMinutes * 60000, request.options.timeout ?? Infinity);
      // A lease at a time, as the local body runs an attempt at a time: a
      // unit its cap stopped is leased again asking for more.
      leases: for (;;) {
      handle = undefined;
      const common = { launchId: uuidv7(), repo: session.repoAlias, timeoutMs,
        taskHash: request.taskHash, force: true, verbose: request.options.verbose === true,
        ...(request.options.expectedPeakBytes !== undefined && { expectedPeakBytes: request.options.expectedPeakBytes }) };
      const event: RackLeaseEvent = { version: RACK_LEASE_VERSION,
        runnerEvent: request.unit === undefined ? { ...common, mode: 'task', inputHashes: request.inputHashes }
          : { ...common, mode: 'unit', unit: splitUnitToWire(request.unit) },
        workspace: options.workspace, taskName: placement.taskName, e3Version: session.e3Version, closure, resources,
        ...(verdict.environment !== null && { environment: verdict.environment }) };
      if (request.options.signal?.aborted) return await stop('cancelled', 'cancelled: e3 did not start the rack execution because the run was aborted');
      const lease = { eventJson: JSON.stringify(event), tier: verdict.tier, computeSize: verdict.size };
      const full = room() <= 0;
      if (full && canSpill()) {
        // The racks are full. Identical work already queued or held costs them
        // no further capacity, so attach to it; anything else runs locally now,
        // without first queuing a lease a rack could claim before the spill.
        const attached = await session.attachLease(lease);
        if (attached === null) return await runLocal('spill');
        handle = attached;
      } else handle = await session.createLease(lease);
      if (full && handle.attempt === null) {
        // Queued with no room for it now: said once, with the rack that has
        // the most memory free. Work attached to a lease a rack already holds
        // waits for nothing.
        waitingSince = Date.now();
        const racks = fleet();
        const best = racks.reduce((most, rack) => (rackFree(rack)?.memoryBytes ?? 0) > (rackFree(most)?.memoryBytes ?? 0) ? rack : most, racks[0]);
        if (best !== undefined) {
          const free = rackFree(best);
          options.onPlacement?.({ kind: 'waiting', ...placement, where: 'rack', rackLabel: best.label, leaseId: handle.leaseId, needs: resources, ...(free !== undefined && { free }) });
        }
      }
      const claimWait = Number(policy.claimTimeoutSeconds) * 1000;
      let claimDeadline = Date.now() + claimWait;
      let executionDeadline: number | undefined;
      let next = handle.next();
      for (;;) {
        const update = await wait(next, (executionDeadline ?? claimDeadline) - Date.now(), request.options.signal);
        if (update === 'abort') {
          await handle.cancel().catch(() => {});
          return await stop('cancelled', 'cancelled: e3 stopped waiting for the rack execution because the run was aborted');
        }
        if (update === 'tick') {
          if (executionDeadline !== undefined) {
            if (Date.now() < executionDeadline) continue;
            await handle.cancel().catch(() => {});
            return await stop('error', `timed out: the task exceeded ${verdict.timeoutMinutes} min on rack ${rackLabel}`);
          }
          await session.refreshCapacity();
          const gone = noRack();
          if (gone === null) unreachableSince = undefined;
          else {
            // No rack could claim the lease. A run that keeps its work for a
            // rack gives one two minutes to be healthy again.
            unreachableSince ??= Date.now();
            if (!options.rackOnly || !waitedFor(gone) || Date.now() - unreachableSince >= unreachableWaitMs) {
              return await runLocal(gone === 'source-unreachable' ? 'fallback:source-unreachable' : waitedFor(gone) ? 'fallback:rack-unavailable' : `fallback:${gone}`);
            }
          }
          if (canSpill()) return await runLocal('fallback:not-claimed');
          claimDeadline = Date.now() + claimWait;
          continue;
        }
        if (update.kind === 'claimed') {
          rackLabel = update.rackLabel;
          // The host owns the deadline; the rack's clock does not determine it.
          executionDeadline ??= Date.now() + common.timeoutMs;
          untee?.();
          untee = session.onLog(update.attempt.executionId, (stream, text) => {
            if (stream === 'stdout') request.options.onStdout?.(text); else request.options.onStderr?.(text);
          });
          options.onPlacement?.({ kind: 'placed', ...placement, where: 'rack', rackLabel, leaseId: handle.leaseId, needs: resources,
            ...(waitingSince !== undefined && { waitedMs: Date.now() - waitingSince }), ...(claimedBefore && { again: true as const }) });
          waitingSince = undefined;
          claimedBefore = true;
          next = handle.next();
          continue;
        }
        if (update.kind === 'lost') return await runLocal(`fallback:${update.reason}`);
        if (update.kind === 'cancelled') {
          // This session left the lease: by the run's abort, or by closing
          // under a run that was not aborted, whose work then finishes locally.
          if (request.options.signal?.aborted) return await stop('cancelled', 'cancelled: e3 left the rack execution because the run was aborted');
          return await runLocal('fallback:rack session closed');
        }
        const result = update.result;
        if (update.attempt === null) return await runLocal('fallback:missing-attempt');
        const attempt = update.attempt;
        // What the rack said of the lease beyond its outcome. A reason this
        // build cannot read is a rack's fault it cannot name.
        const leaseId = handle.leaseId;
        for (const retry of readRackRetries(result.retries)) options.onPlacement?.({ kind: 'retried', ...placement, where: 'rack', rackLabel, leaseId, retry });
        const reason = readRackReason(result.reason);
        // A reason that carries no words of its own is said with the result's.
        const fallback = (text: string | undefined, otherwise: string) => runLocal(`fallback:${reason === undefined ? text ?? otherwise
          : reason.cause === undefined && reason.detail === undefined && text !== undefined ? `${reason.code}: ${text}` : describeRackReason(reason)}`, reason);
        const duration = () => Date.now() - request.ids.startTime;
        const peak = result.peakBytes !== undefined ? { peakBytes: result.peakBytes } : {};
        if (reason?.code === 'outgrew-cap') {
          const cap = reason.capBytes ?? resources.memoryBytes;
          if (resources.kind === 'unit') {
            // The rack stopped the unit at its cap, as its cgroup's cap stops
            // a local one, which then runs again under a cap half as large
            // again. So does this one, on its next lease: unless that would
            // pass its rule's limit, or what any rack could hold, when it
            // runs locally, under the local budget.
            const again = unitCap(cap);
            request.options.onRequeued?.({ reason: 'cap', peak: cap, reserves: cap });
            options.onPlacement?.({ kind: 'outgrew', ...placement, where: 'rack', rackLabel, leaseId, capBytes: cap, againBytes: again });
            untee?.(); untee = undefined;
            if (verdict.memoryLimit !== null && again > verdict.memoryLimit) {
              return await runLocal('memory-limit-exceeded', { code: 'memory-limit-exceeded', needsBytes: again, limitBytes: verdict.memoryLimit });
            }
            // It reserves what it reached, as a local unit its cap stopped does.
            const larger = { ...resources, memoryBytes: again, reserveBytes: cap };
            const nowhere = unheld(larger);
            if (nowhere !== null) return await nowhere();
            resources = larger;
            continue leases;
          }
          // A whole task e3 does not run again: its cap stopped it, and that
          // is its failure, as a task the local guard stops fails.
          options.onPlacement?.({ kind: 'outgrew', ...placement, where: 'rack', rackLabel, leaseId, capBytes: cap });
          if (policy.retryTaskFailuresLocally) return await fallback(result.error, 'the task outgrew its cap');
          return { inputsHash: request.ids.inHash, executionId: attempt.executionId, cached: false, state: 'failed', outputHash: null, exitCode: -1, duration: duration(),
            error: `memory-limit-exceeded: the task outgrew its cap of ${Math.round(cap / 1024 ** 2)} MiB on rack ${rackLabel}; raise --memory-limit or --size`, cancelled: false, ...peak };
        }
        if (reason?.code === 'requeued-pressure' && resources.kind === 'unit') {
          // The rack's host ran short of memory, and the rack stopped the
          // newest work it held: this unit, which did not outgrow its own
          // cap. It runs again reserving what it reached, at least what it
          // reserved, as the local budget's guard runs one again; past its
          // rule's limit, or every rack's memory, it runs locally.
          const reached = Math.max(reason.peakBytes ?? 0, leaseReserve(resources));
          const again = unitResources(reached, verdict);
          request.options.onRequeued?.({ reason: 'budget', peak: reason.peakBytes ?? reached, reserves: reached });
          options.onPlacement?.({ kind: 'stopped', ...placement, where: 'rack', rackLabel, leaseId, peakBytes: reason.peakBytes ?? reached, againBytes: reached });
          untee?.(); untee = undefined;
          if ('code' in again) return await runLocal(again.code, again);
          const nowhere = unheld(again);
          if (nowhere !== null) return await nowhere();
          resources = again;
          continue leases;
        }
        if (result.cancelled === true) {
          // To e3-core a cancelled result is its own abort's: the task goes back
          // to pending, and a loop that was not aborted launches it again at
          // once. Only this run's abort is one. A rack that stopped the attempt
          // for a reason of its own did not run it, and the work runs locally.
          if (!request.options.signal?.aborted) return await fallback(result.error, 'the rack stopped the attempt');
          return { inputsHash: request.ids.inHash, executionId: attempt.executionId, cached: false, state: 'error', outputHash: null,
            exitCode: result.exitCode ?? null, duration: duration(), error: result.error ?? null, cancelled: true, ...peak };
        }
        const state = result.state ?? (result.status === 'success' ? 'success' : (result.exitCode ?? 0) > 0 ? 'failed' : 'error');
        if (state === 'success') {
          if (result.outputHash === undefined || !await touchReachable(request.storage, request.repo, [result.outputHash])) return await runLocal('fallback:incomplete-output');
          return { inputsHash: request.ids.inHash, executionId: attempt.executionId, cached: false, state, outputHash: result.outputHash,
            exitCode: 0, duration: duration(), error: result.error ?? null, cancelled: false, ...peak };
        }
        // e3-core, which the rack ran, records its own timeout as an error whose
        // message begins `timed out:` (as an abort's begins `cancelled:`). The
        // task would use its time up again here, so that error stands. Any
        // other error is the rack's, and the work runs locally; a task's own
        // failure is its verdict, whatever its message mentions, unless the
        // policy retries failures locally.
        // A transfer that failed its tries is the link's fault: a run that
        // keeps its work for a rack leases it once more before it runs locally.
        if (options.rackOnly && !leasedAgain && (reason?.code === 'input-transfer-failed' || reason?.code === 'output-transfer-failed')) {
          leasedAgain = true;
          untee?.(); untee = undefined;
          continue leases;
        }
        const timedOut = state === 'error' && /^timed out:/.test(result.error ?? '');
        if (state === 'error' ? !timedOut : policy.retryTaskFailuresLocally) return await fallback(result.error, 'rack execution failed');
        return { inputsHash: request.ids.inHash, executionId: attempt.executionId, cached: false, state, outputHash: null,
          exitCode: result.exitCode ?? null, duration: duration(), error: result.error ?? null, cancelled: false, ...peak };
      }
      }
    } catch (error) {
      if (leavingRack) throw error;
      return await runLocal(`fallback:${error instanceof Error ? error.message : String(error)}`);
    } finally { untee?.(); }
  };
}
