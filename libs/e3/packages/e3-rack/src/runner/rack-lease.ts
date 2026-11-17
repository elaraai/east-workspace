/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What a task's body and a function call share on their way to a rack: the
 * builds of an environment's layers, the fleet as one piece of work sees it,
 * where the work goes before it is leased, and the wait on its lease once it
 * is. Each says in its own words what the work's end comes to: a task's
 * records and logs, or a call's value.
 */

import { setTimeout as delay } from 'node:timers/promises';
import { EnvironmentTargetRefused, LONGEST_TIMER_MS, type Budget, type StorageBackend } from '@elaraai/e3-core';
import type { CreateLease } from '../protocol/control.js';
import type { LeaseAttempt, LeaseHandle, LeaseUpdate, RackSession } from '../client/session.js';
import type { RackPlacementEvent } from '../protocol/placement.js';
import { describeRackReason, readRackReason, readRackRetries, type RackLeaseResources, type RackLeaseResult, type RackReason, type RackTransferRetry } from '../protocol/task-envelope.js';
import type { RackResources } from '../protocol/rack-json.js';
import { EligibilityEvaluator, type Eligibility } from '../routing/eligibility.js';
import { RACK_SIZES, type RackPolicy } from '../routing/policy.js';
import { compatibleRacks, rackCapsUnits, rackCouldHold, rackFree, rackResources, rackRoom, type SnapshotRack } from './capacity.js';
import { publishEnvLayers, type EnvLayerTarget, type RackEnvironmentEvent } from './environment.js';

/**
 * How long work that keeps its work for a rack (`--rack-only`) waits for one
 * that runs the work's tier to be healthy, in ms, before the work runs
 * locally: a rack's fault never fails a run.
 */
export const RACK_ONLY_WAIT_MS = 120_000;

/** How often work that waits for a rack to be healthy looks again, in ms. */
const RACK_WAIT_TICK_MS = 1000;

/** What a build of an environment's layers for a platform came to: nothing,
 *  when they are kept; else why not, and the build's own words. */
export interface RackLayerBuild {
  /** Why the layers are not kept: an `EnvironmentTargetRefused` reason, or
   *  `build-failed` */
  readonly reason?: string;
  /** The build's own words for it */
  readonly said?: string;
  /** Whether the layers kept were built over the tier image asked for: not
   *  for an environment that does not fit it, which is kept whole */
  readonly over?: boolean;
}

/** The image of a tier a rack boots environments over: its manifest's
 *  digest, as the rack's snapshot names it. */
export interface RackTierImage {
  /** The manifest's digest, `sha256:<hex>` */
  readonly digest: string;
}

/** The name a build of an environment's layers is known by among a
 *  session's: the platform, and the tier image it is built over. */
function layersFor(platform: string, image?: RackTierImage): string {
  return image === undefined ? platform : `${platform} ${image.digest}`;
}

/**
 * The builds of environments' layers a session's runs asked for, each once
 * for an environment, a platform, and the tier and its image it is built
 * over: a second ask is answered what the first came to. Two tiers whose
 * racks boot one image are two builds, as their manifests are kept under
 * keys that name the tier.
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
   * @param platform - The platform, and the tier image the layers are built
   *   over when they are, as one name
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

  /**
   * The build of an environment's layers for a rack's platform, kept in the
   * repository the work is a session's of ({@link publishEnvLayers}): the one
   * asked for already, or this one.
   * @param storage - The repository's storage, which holds the environment's
   *   spec and files
   * @param repo - Repository path
   * @param envHash - The environment's hash
   * @param target - The platform, the tier, the e3 release, and the tier's
   *   image when the layers are built over it
   * @param onEvent - Told a build starts, and what it came to
   * @param signal - Ends a wait for another build of the same layers
   * @returns What the build came to: why the layers are not kept, when they
   *   are not, and the build's own words; and whether they were built over
   *   the tier's image
   */
  publish(storage: StorageBackend, repo: string, envHash: string, target: EnvLayerTarget,
    onEvent?: (event: RackEnvironmentEvent) => void, signal?: AbortSignal): Promise<RackLayerBuild> {
    // Over an image, named by its tier too, as the manifest's key is
    const name = target.over === undefined ? target.platform : `${layersFor(target.platform, target.over)} ${target.tier}`;
    return this.get(envHash, name, () => publishEnvLayers(storage, repo, envHash, target, onEvent, signal).then(
      (manifest) => ({ over: manifest.over !== undefined }),
      (error: unknown) => error instanceof EnvironmentTargetRefused ? { reason: error.reason, said: error.message }
        : { reason: 'build-failed', said: error instanceof Error ? error.message : String(error) }));
  }

  /** Forgets the builds that failed, so the next run tries them again. */
  forgetFailures(): void {
    for (const key of this.failed) this.builds.delete(key);
    this.failed.clear();
  }
}

/** The verdict that work may go to a rack: its tier, its rule's size,
 *  timeout, memory limit and GPU, and the environment it declares. */
export type RackVerdict = Extract<Eligibility, { eligible: true }>;

/**
 * Configures a run's rack executors without acquiring local resources: its
 * body executor (`createRackBody`), and its call executor
 * (`createRackCall`).
 */
export interface RackDelegationOptions {
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
  /**
   * Whether all the run's work is a rack's, whatever the policy's rules
   * select: a command's `--rack`, which names its one piece of work. A rule
   * that matches the work's name still gives its size, its timeout, its
   * memory limit, its GPU and its host-coupling override.
   */
  selected?: boolean;
  /** Receives placement and fallback notifications. */
  onPlacement?: (event: RackPlacementEvent) => void;
  /** Told an environment's layers are being built for a rack's platform, and
   *  what the build came to. */
  onEnvironment?: (event: RackEnvironmentEvent) => void;
  /** The layer builds the session's runs share; the body's own unless given. */
  layerBuilds?: RackLayerBuilds;
}

/** A run's delegation options, as each of its executors reads them. */
export interface RackDelegation {
  /** Judges the run's work by its policy, or takes all of it under a
   *  command's flag */
  readonly evaluator: EligibilityEvaluator;
  /** The builds of environments' layers the run's work shares */
  readonly builds: RackLayerBuilds;
  /** Whether the run keeps its work for a rack */
  readonly rackOnly: boolean;
  /** How long its work waits for a rack to be healthy, in ms */
  readonly unreachableWaitMs: number;
  /**
   * Whether work may run here now rather than wait for a rack: the policy
   * spills, the run does not keep its work for a rack, and this machine could
   * take it ({@link localIdle}).
   * @param budget - The run's budget
   * @param expectedBytes - The memory the work expects to need
   * @returns Whether it may
   */
  spills(budget: Budget | undefined, expectedBytes?: number): boolean;
}

/**
 * Reads a run's delegation options once, for both its executors.
 *
 * @param options - The options: its policy, and what it sets beside it
 * @returns The evaluator, the layer builds and the waits they name, with
 *   their defaults
 * @example
 * const { evaluator, rackOnly } = readDelegation({ policy, selected: true });
 */
export function readDelegation(options: Pick<RackDelegationOptions, 'policy' | 'selected' | 'layerBuilds' | 'rackOnly' | 'unreachableWaitMs'>): RackDelegation {
  const rackOnly = options.rackOnly === true;
  return {
    evaluator: new EligibilityEvaluator(options.policy, { selected: options.selected === true }),
    builds: options.layerBuilds ?? new RackLayerBuilds(),
    rackOnly,
    unreachableWaitMs: options.unreachableWaitMs ?? RACK_ONLY_WAIT_MS,
    spills: (budget, expectedBytes = 0) => options.policy.spill && !rackOnly && localIdle(budget, expectedBytes),
  };
}

/**
 * Whether work is bound to this machine's process settings: an environment or
 * an identity its runner was explicitly configured with, or variables of its
 * own, none of which a stock guest reproduces.
 *
 * @param settings - The runner's process settings
 * @param extraEnv - The work's own variables
 * @returns Whether it is
 * @example
 * hostBound({ uid: 1000 }, undefined); // true
 */
export function hostBound(settings: { readonly env?: unknown; readonly uid?: unknown; readonly gid?: unknown }, extraEnv: Readonly<Record<string, string>> | undefined): boolean {
  return settings.env !== undefined || settings.uid !== undefined || settings.gid !== undefined ||
    (extraEnv !== undefined && Object.keys(extraEnv).length > 0);
}

/**
 * The reason work runs here after its rack's lease went wrong: the rack's
 * reason in its own words, or, for a reason that carries none, with the
 * result's; and for a result that gave no reason, what the result said, or
 * what is said of one that said nothing.
 *
 * @param reason - The rack's reason, when its result gave one
 * @param text - What the result said went wrong
 * @param otherwise - What is said of a result that said nothing
 * @returns The `fallback:` reason
 * @example
 * fallbackReason({ code: 'guest-crashed', detail: 'the VM died' }, undefined, 'rack execution failed'); // 'fallback:guest-crashed: the VM died'
 */
export function fallbackReason(reason: RackReason | undefined, text: string | undefined, otherwise: string): string {
  return `fallback:${reason === undefined ? text ?? otherwise
    : reason.cause === undefined && reason.detail === undefined && text !== undefined ? `${reason.code}: ${text}` : describeRackReason(reason)}`;
}

/**
 * The reason work runs here after its lease threw: what the error says.
 *
 * @param error - What was thrown
 * @returns The `fallback:` reason
 */
export function thrownFallback(error: unknown): string {
  return `fallback:${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Whether a lease ended because a transfer failed its tries: the link's
 * fault, for which work kept for a rack is leased once more before it runs
 * here.
 *
 * @param reason - The rack's reason
 * @returns Whether it did
 */
export function transferFailed(reason: RackReason | undefined): boolean {
  return reason?.code === 'input-transfer-failed' || reason?.code === 'output-transfer-failed';
}

/**
 * The cap a rack stopped work at: the one its reason names, or, for a rack
 * that names none, what the lease asked.
 *
 * @param reason - The rack's reason, `outgrew-cap`
 * @param resources - What the lease asked
 * @returns The cap, in bytes
 */
export function outgrownCap(reason: RackReason, resources: RackLeaseResources): number {
  return reason.capBytes ?? resources.memoryBytes;
}

/**
 * Leaves a lease the work no longer waits on, when it holds one: a lease the
 * hub has already ended, or cannot be told of, is left all the same.
 *
 * @param handle - The lease, when there is one
 */
export async function leaveLease(handle: Pick<LeaseHandle, 'cancel'> | undefined): Promise<void> {
  if (handle !== undefined) await handle.cancel().catch(() => {});
}

/**
 * Tells a run where one piece of work is placed, lease by lease, and keeps
 * what its events need from one to the next: the rack that claimed it, since
 * when it has waited for room, and whether a rack claimed it before.
 *
 * @example
 * ```ts
 * const report = new RackPlacementReport(options.onPlacement, { taskName: 'fn:score', role: 'call' });
 * report.queued(submitted);
 * report.claimed(claim.rackLabel, leaseId, resources);
 * const reason = report.reason(leaseId, result);
 * ```
 */
export class RackPlacementReport {
  /** The rack that last claimed the work: `rack` until one has */
  rackLabel = 'rack';
  private waitingSince: number | undefined;
  private claimedBefore = false;

  /**
   * @param sink - Told each event, when the run listens
   * @param work - The work's name and what it is
   */
  constructor(private readonly sink: ((event: RackPlacementEvent) => void) | undefined,
    private readonly work: { readonly taskName: string; readonly role: 'task' | 'unit' | 'call' }) {}

  /**
   * The work runs here.
   * @param reason - Why
   * @param detail - The rack's reason, when a rack gave one
   */
  local(reason: string, detail?: RackReason): void {
    this.sink?.({ kind: 'placed', ...this.work, where: 'local', reason, ...(detail !== undefined && { detail }) });
  }

  /**
   * How a lease's queuing tells that it waits for room.
   * @param needs - What the lease asks
   * @returns What {@link RackFleet.submit} tells of the wait
   */
  waiting(needs: RackLeaseResources): RackSubmitOptions['onWaiting'] {
    return (rack, free, leaseId) => this.sink?.({ kind: 'waiting', ...this.work, where: 'rack', rackLabel: rack.label, leaseId, needs, ...(free !== undefined && { free }) });
  }

  /**
   * A lease was queued: since when the work waits for room, when it does.
   * @param submitted - The queued lease
   */
  queued(submitted: Pick<RackSubmitted, 'waitingSince'>): void {
    this.waitingSince = submitted.waitingSince ?? this.waitingSince;
  }

  /**
   * A rack claimed the work's lease: it says how long the work waited, when
   * it did, and that it was leased before, when it was.
   * @param rackLabel - The rack
   * @param leaseId - The lease
   * @param needs - What the lease asked of it
   */
  claimed(rackLabel: string, leaseId: string, needs: RackLeaseResources): void {
    this.rackLabel = rackLabel;
    this.sink?.({ kind: 'placed', ...this.work, where: 'rack', rackLabel, leaseId, needs,
      ...(this.waitingSince !== undefined && { waitedMs: Date.now() - this.waitingSince }), ...(this.claimedBefore && { again: true as const }) });
    this.waitingSince = undefined;
    this.claimedBefore = true;
  }

  /**
   * What a rack said of a completed lease beyond its outcome: each try of a
   * transfer that was followed by another is told, and its reason returned. A
   * reason this build cannot read is a rack's fault it cannot name.
   * @param leaseId - The lease
   * @param result - Its result
   * @returns The rack's reason, when it gave one this build reads
   */
  reason(leaseId: string, result: Pick<RackLeaseResult, 'retries' | 'reason'>): RackReason | undefined {
    for (const retry of readRackRetries(result.retries)) this.retried(leaseId, retry);
    return readRackReason(result.reason);
  }

  private retried(leaseId: string, retry: RackTransferRetry): void {
    this.sink?.({ kind: 'retried', ...this.work, where: 'rack', rackLabel: this.rackLabel, leaseId, retry });
  }

  /**
   * Its rack stopped the work at its cap.
   * @param leaseId - The lease
   * @param capBytes - The cap
   * @param againBytes - The cap it runs again under, when it does
   */
  outgrew(leaseId: string, capBytes: number, againBytes?: number): void {
    this.sink?.({ kind: 'outgrew', ...this.work, where: 'rack', rackLabel: this.rackLabel, leaseId, capBytes, ...(againBytes !== undefined && { againBytes }) });
  }

  /**
   * Its rack stopped the work to keep its host from running out of memory.
   * @param leaseId - The lease
   * @param peakBytes - What the work had reached
   * @param againBytes - What it reserves when it runs again
   */
  stopped(leaseId: string, peakBytes: number, againBytes: number): void {
    this.sink?.({ kind: 'stopped', ...this.work, where: 'rack', rackLabel: this.rackLabel, leaseId, peakBytes, againBytes });
  }
}

/** Why work runs here: the reason its local placement gives, the rack's
 *  reason it rests on, and a build's own words for it. */
export interface LocalReason {
  /** The reason the placement gives */
  readonly reason: string;
  /** The rack's reason, when a rack gave one */
  readonly detail?: RackReason;
  /** An environment build's own words, when its build is why */
  readonly said?: string;
}

/**
 * What whole work asks of a rack — a task, or a call — and what the rack
 * books for it: its size's cores, but no more than the rack with the most
 * has, whose VM it is then given (a VM is given no more cores than its host
 * has); and its rule's memory limit, else its size's memory, as both its
 * reservation and its cap, since a rack never stops whole work to keep its
 * host's memory.
 *
 * @param verdict - Its rule's size, memory limit and GPU
 * @param mostCores - The most cores a rack that could take the work has; no
 *   bound unless given
 * @returns The resources
 * @example
 * wholeResources(verdict, 4); // { kind: 'task', cores: 4, memoryBytes: 16 * 1024 ** 3, gpu: false } for a large rule
 */
export function wholeResources(verdict: Pick<RackVerdict, 'size' | 'memoryLimit' | 'gpu'>, mostCores = Infinity): RackLeaseResources {
  const size = RACK_SIZES[verdict.size];
  return { kind: 'task', cores: Math.max(1, Math.min(size.cores, mostCores)), memoryBytes: verdict.memoryLimit ?? size.memoryBytes, gpu: verdict.gpu };
}

/**
 * Whether this machine could take a core for work now, and the memory it
 * expects to need: whether a run may spill it here rather than queue it.
 *
 * @param budget - The run's budget; none means every spawn runs at once
 * @param expectedBytes - The memory the work expects to need
 * @returns Whether it could
 */
export function localIdle(budget: Budget | undefined, expectedBytes = 0): boolean {
  if (budget === undefined) return true;
  return budget.queued === 0 && budget.inFlight < budget.cores &&
    (expectedBytes > budget.memory ? budget.inFlight === 0 : budget.used + expectedBytes <= budget.memory);
}

/** Whether a rack composes a lease's environment from layers, and says the
 *  platform it runs environments on. */
function composes(rack: SnapshotRack): rack is SnapshotRack & { target: { type: 'some'; value: string } } {
  return rack.features.includes('environments') && rack.target.type === 'some';
}

/**
 * What a rack that runs the work's tier is to the work: one that takes it;
 * one that has said what it is, and never takes it (it caps no unit, or
 * composes no environment the work's layers are kept for); or one that has
 * not yet said what it is to this hub (`unsaid`), which may take it once it
 * has.
 */
type RackStanding = 'takes' | 'unsaid' | 'caps-no-unit' | 'no-environment';

/**
 * Why no rack can take work now, and whether a run that keeps its work for a
 * rack waits for one that could: it does for a rack that is not healthy, or
 * has not said what it is, and for one to be enrolled, and not for racks that
 * have said they never take the work.
 */
export interface NoRack {
  /** The reason the work's local placement gives */
  readonly reason: string;
  /** Whether a rack is waited for */
  readonly waited: boolean;
}

/** Where work goes before it is leased: to a rack, asking this much of it;
 *  here, by its reason; or nowhere, its run aborted meanwhile. */
export type RackPlacement =
  | { readonly kind: 'rack'; readonly resources: RackLeaseResources }
  | { readonly kind: 'local'; readonly why: LocalReason }
  | { readonly kind: 'aborted' };

/** How {@link RackFleet.place} places work. */
export interface RackPlaceOptions {
  /** Whether the work waits, up to {@link unreachableWaitMs}, for a rack that
   *  runs its tier to be healthy, before it runs locally */
  readonly rackOnly: boolean;
  /** How long it waits, in ms */
  readonly unreachableWaitMs: number;
  /** Ends a wait, when its run is aborted */
  readonly signal?: AbortSignal;
  /** What the work asks of a rack, given the most cores a rack that takes it
   *  has; or why it cannot be a rack's */
  readonly asks: (mostCores: number) => RackLeaseResources | RackReason;
  /** Builds the environment's layers for a platform, once for each, and for
   *  each image of the work's tier a rack of the platform boots environments
   *  over */
  readonly layers: (envHash: string, platform: string, image?: RackTierImage) => Promise<RackLayerBuild>;
}

/** How {@link RackFleet.submit} queues a lease. */
export interface RackSubmitOptions {
  /** Whether the work may join identical work queued or held already, which
   *  costs the racks nothing more: a task's or a unit's may, and a call's
   *  never, since two calls of one program differ by their arguments */
  readonly joins: boolean;
  /** Whether the work may run here now rather than wait for a rack's room */
  readonly canSpill: () => boolean;
  /** Told the lease is queued with no rack having room for it now: the rack
   *  with the most memory free, what it has free, and the lease */
  readonly onWaiting: (rack: SnapshotRack, free: RackResources | undefined, leaseId: string) => void;
}

/** A queued lease, and since when it has waited for room, when it waits. */
export interface RackSubmitted {
  /** The subscription to the lease */
  readonly handle: LeaseHandle;
  /** When it was queued with no rack having room for it, in ms since the
   *  epoch; absent when a rack had room, or it joined work a rack holds */
  readonly waitingSince?: number;
}

/**
 * The fleet as one piece of work sees it: the racks that take it, why none
 * does, whether it is leased at all, and how its lease is queued.
 *
 * @remarks
 * A rack takes work of its tier that is whole and declares no environment.
 * A unit of a split task is a rack's that caps it at what its lease asks
 * ({@link rackCapsUnits}), and work that declares an environment one's that
 * composes environments, for a platform its layers are kept for, once that is
 * known. A rack says both with its heartbeats: of one this hub has not heard
 * yet, neither is known. For a rack that names the image of the work's tier
 * it boots environments over, the layers are built over that image, and
 * whole for any other: the rack is served whichever its build came to.
 *
 * @example
 * ```ts
 * const fleet = new RackFleet(session, verdict, false);
 * const placed = await fleet.place({ rackOnly: false, unreachableWaitMs: RACK_ONLY_WAIT_MS, asks: (cores) => wholeResources(verdict, cores),
 *   layers: (envHash, platform, image) => builds.publish(storage, repo, envHash, { platform, tier: verdict.tier, e3Version }) });
 * ```
 */
export class RackFleet {
  /** What the work's environment's layers are kept for, once built: each
   *  platform they are kept whole for, and each platform and tier image they
   *  are kept built over ({@link layersFor}) */
  private kept: ReadonlySet<string> | undefined;

  /**
   * @param session - The session the work is leased through
   * @param verdict - The work's tier and environment
   * @param unit - Whether the work is a unit of a split task
   */
  constructor(private readonly session: RackSession, private readonly verdict: RackVerdict, private readonly unit: boolean) {}

  /** The image of the work's tier a rack boots environments over, when it
   *  names one. */
  private image(rack: SnapshotRack): RackTierImage | undefined {
    const digest = rack.tierManifests.find(({ tier }) => tier === this.verdict.tier)?.manifest;
    return digest === undefined ? undefined : { digest };
  }

  /** Whether the layers a rack would be served are kept: those built over
   *  its tier's image, or the whole environment's. */
  private serves(rack: SnapshotRack & { target: { value: string } }): boolean {
    return this.kept === undefined || this.kept.has(layersFor(rack.target.value, this.image(rack))) || this.kept.has(layersFor(rack.target.value));
  }

  private standing(rack: SnapshotRack): RackStanding {
    if (!this.unit && this.verdict.environment === null) return 'takes';
    if (!rack.reported) return 'unsaid';
    if (this.unit && !rackCapsUnits(rack)) return 'caps-no-unit';
    if (this.verdict.environment !== null && !(composes(rack) && this.serves(rack))) return 'no-environment';
    return 'takes';
  }

  /**
   * The racks that can take the work now: the healthy ones that run its tier
   * and take it.
   * @returns Their snapshots
   */
  racks(): SnapshotRack[] {
    return compatibleRacks(this.session.capacity(), this.verdict.tier).filter((rack) => this.standing(rack) === 'takes');
  }

  /**
   * Why no rack can take the work now: one that could, or may yet, is not
   * healthy or has not said what it is; none that could is enrolled; none
   * that runs its tier caps a unit; or none composes the environment it
   * declares.
   * @returns The reason, or null when a rack can
   */
  noRack(): NoRack | null {
    if (this.racks().length > 0) return null;
    const serving = this.session.capacity().racks.filter((rack) => rack.tiers.includes(this.verdict.tier));
    const stands = serving.map((rack) => this.standing(rack));
    if (serving.some((rack, i) => stands[i] === 'unsaid' || (stands[i] === 'takes' && !rack.healthy))) return { reason: 'source-unreachable', waited: true };
    // The racks have said what they do: one that caps no unit, or composes
    // no environment, is not waited for
    if (stands.includes('no-environment') && !stands.includes('takes')) return { reason: `no-rack-for-environment:${this.verdict.tier}`, waited: false };
    if (stands.includes('caps-no-unit') && !stands.includes('takes')) return { reason: `no-rack-caps-units:${this.verdict.tier}`, waited: false };
    return { reason: `no-rack-for-tier:${this.verdict.tier}`, waited: true };
  }

  /**
   * Why no rack could ever hold work asking this much, with nothing else on
   * it, or null when one could: work no rack could hold is not queued, since
   * it would wait for ever, and for want of memory runs locally by that name.
   * @param needs - What the work asks
   * @returns The reason it runs locally, or null
   */
  unheld(needs: RackLeaseResources): LocalReason | null {
    const racks = this.racks();
    if (racks.length === 0) return { reason: 'fallback:rack-unavailable' };
    if (racks.some((rack) => rackCouldHold(rack, needs))) return null;
    const most = Math.max(...racks.map((rack) => rackResources(rack)?.memoryBytes ?? 0));
    return needs.memoryBytes > most
      ? { reason: 'memory-limit-exceeded', detail: { code: 'memory-limit-exceeded', needsBytes: needs.memoryBytes, limitBytes: most } }
      : { reason: `no-rack-holds:${needs.gpu ? 'gpu' : `${needs.cores}-cores`}` };
  }

  /**
   * How many more leases asking this much the racks that take the work hold
   * in the latest snapshot, less the work already queued for them.
   * @param needs - What one lease asks
   * @returns The count, which may be below zero
   */
  room(needs: RackLeaseResources): number {
    return this.racks().reduce((sum, rack) => sum + rackRoom(rack, needs), 0) - Number(this.session.capacity().queued);
  }

  /**
   * Where the work goes before it is leased.
   *
   * @remarks
   * Work that keeps its work for a rack waits for one to be healthy before
   * it runs locally; any other runs it locally at once. Work no rack could
   * hold runs locally, by name ({@link unheld}). Work that declares an
   * environment is a rack's once the environment's layers are kept for the
   * platform of a rack that could hold it: they are built first, for each
   * such platform, over the tier image each such rack names and whole for a
   * rack that names none. A build over an image that fails is tried whole for
   * its platform, which a rack of that image runs too. Work whose environment
   * no install makes for any of them, or whose builds fail, runs locally with
   * the build's reason and words: a whole build's, when one was tried.
   *
   * @param options - Whether it waits for a rack, what it asks, and how its
   *   environment's layers are built
   * @returns Where it goes
   */
  async place(options: RackPlaceOptions): Promise<RackPlacement> {
    let absent = this.noRack();
    if (absent?.waited === true && options.rackOnly) {
      const until = Date.now() + options.unreachableWaitMs;
      while (absent?.waited === true && Date.now() < until && options.signal?.aborted !== true && !this.session.hubLost) {
        await delay(Math.max(1, Math.min(RACK_WAIT_TICK_MS, until - Date.now())), undefined, { signal: options.signal }).catch(() => {});
        // Work that waits here together asks the hub once between them each
        // tick: an answer under half a tick old is this tick's. A timer may
        // fire a little early, so one a whole tick old is not taken for it.
        // An ask the hub does not answer leaves the snapshot its events keep.
        await this.session.refreshCapacity(RACK_WAIT_TICK_MS / 2).catch(() => {});
        absent = this.noRack();
      }
      if (options.signal?.aborted) return { kind: 'aborted' };
    }
    if (absent !== null) return { kind: 'local', why: { reason: absent.reason } };
    const asked = options.asks(Math.max(...this.racks().map((rack) => rackResources(rack)?.cores ?? Infinity)));
    if ('code' in asked) return { kind: 'local', why: { reason: asked.code, detail: asked } };
    const never = this.unheld(asked);
    if (never !== null) return { kind: 'local', why: never };
    const environment = this.verdict.environment;
    if (environment !== null) {
      // For each platform a rack that could hold the work runs environments
      // on: built now if the repository keeps none, and for no rack that
      // could never hold the work. The work is then a rack's whose platform
      // they were built for.
      const wanted = new Map<string, { platform: string; image?: RackTierImage }>();
      for (const rack of this.racks().filter((candidate) => rackCouldHold(candidate, asked)).filter(composes)) {
        const image = this.image(rack);
        wanted.set(layersFor(rack.target.value, image), { platform: rack.target.value, ...(image !== undefined && { image }) });
      }
      const built = [...wanted.keys()].sort().map((name) => wanted.get(name)!);
      const made = await Promise.all(built.map(({ platform, image }) => options.layers(environment, platform, image)));
      if (options.signal?.aborted) return { kind: 'aborted' };
      // A build over an image that failed is tried whole, once for its
      // platform: the whole environment runs on a rack of that image too
      const failedOver = new Set(built.filter(({ image }, i) => image !== undefined && made[i]!.reason !== undefined).map(({ platform }) => platform));
      const wholes = [...failedOver].filter((platform) => !built.some((build) => build.image === undefined && build.platform === platform)).sort();
      const whole = await Promise.all(wholes.map((platform) => options.layers(environment, platform)));
      if (options.signal?.aborted) return { kind: 'aborted' };
      // Kept over the image asked for, or whole: an environment that does
      // not fit an image is kept whole, which a rack of that image runs too
      this.kept = new Set([
        ...built.flatMap(({ platform, image }, i) => made[i]!.reason !== undefined ? [] : [layersFor(platform, made[i]!.over === true ? image : undefined)]),
        ...wholes.flatMap((platform, i) => whole[i]!.reason !== undefined ? [] : [layersFor(platform)]),
      ]);
      if (this.kept.size === 0) {
        const refused = whole.find((result) => result.reason !== undefined) ?? made.find((result) => result.reason !== undefined)!;
        return { kind: 'local', why: { reason: `environment:${refused.reason!}`, ...(refused.said !== undefined && { said: refused.said }) } };
      }
      const nowhere = this.unheld(asked);
      if (nowhere !== null) return { kind: 'local', why: nowhere };
    }
    return { kind: 'rack', resources: asked };
  }

  /**
   * Queues the work's lease, or, when the racks are full and the work may
   * run here, joins identical work queued or held already, which costs them
   * no further capacity; anything else is left to run here, without first
   * queuing a lease a rack could claim before the spill.
   * @param lease - The lease
   * @param needs - What it asks
   * @param options - Whether it may join other work, whether it may spill,
   *   and what is told when it waits
   * @returns The queued lease, or null when the work spills here
   * @throws {RackHubError} When the hub refuses the lease or its attach (a
   *   hub that is draining, a queue that is full) or does not answer; its
   *   caller runs the work here by what it says
   * @throws {RackHubUnavailableError} When the session is closed or its hub
   *   is gone
   */
  async submit(lease: CreateLease, needs: RackLeaseResources, options: RackSubmitOptions): Promise<RackSubmitted | null> {
    const full = this.room(needs) <= 0;
    let handle: LeaseHandle;
    if (full && options.canSpill()) {
      if (!options.joins) return null;
      const attached = await this.session.attachLease(lease);
      if (attached === null) return null;
      handle = attached;
    } else handle = await this.session.createLease(lease);
    // Work attached to a lease a rack already holds waits for nothing
    if (!full || handle.attempt !== null) return { handle };
    // Queued with no room for it now: said once, with the rack that has the
    // most memory free
    const waitingSince = Date.now();
    const racks = this.racks();
    const best = racks.reduce((most, rack) => (rackFree(rack)?.memoryBytes ?? 0) > (rackFree(most)?.memoryBytes ?? 0) ? rack : most, racks[0]);
    if (best !== undefined) options.onWaiting(best, rackFree(best), handle.leaseId);
    return { handle, waitingSince };
  }
}

/** Where work is admitted before a lease is made for it: to a rack, with its
 *  verdict, the fleet as it sees it, what it asks and the repository it is
 *  leased from; here, by its reason; or nowhere, its run aborted meanwhile. */
export type RackAdmission =
  | { readonly kind: 'rack'; readonly verdict: RackVerdict; readonly fleet: RackFleet; readonly resources: RackLeaseResources; readonly storage: StorageBackend }
  | { readonly kind: 'local'; readonly why: LocalReason }
  | { readonly kind: 'aborted' };

/** What {@link admitWork} admits work by. */
export interface RackAdmitOptions {
  /** The session the work would be leased through */
  readonly session: RackSession;
  /** The run's delegation options */
  readonly delegation: RackDelegation;
  /** The run's abort */
  readonly signal?: AbortSignal;
  /** The repository's storage, which the work is judged over and which holds
   *  its environment; work given none runs here */
  readonly storage: StorageBackend | undefined;
  /** The repository */
  readonly repo: string;
  /** Judges whether the work may go to a rack: its rule, its runner, its
   *  environment and its program */
  readonly judge: (storage: StorageBackend) => Promise<Eligibility>;
  /** Whether the work is bound to this machine's process settings
   *  ({@link hostBound}) */
  readonly hostBound: boolean;
  /** Whether the work is a unit of a split task */
  readonly unit: boolean;
  /** What the work asks of a rack, given its verdict and the most cores a
   *  rack that takes it has; or why it cannot be a rack's */
  readonly asks: (verdict: RackVerdict, mostCores: number) => RackLeaseResources | RackReason;
  /** Told an environment's layers are being built for a rack's platform, and
   *  what the build came to */
  readonly onEnvironment?: (event: RackEnvironmentEvent) => void;
}

/**
 * Admits work to a rack, or says why it runs here, before any lease is made
 * for it: a task's body, a unit's or a call alike.
 *
 * @remarks
 * In this order. A run already aborted admits nothing. Work whose hub is
 * lost, or that is given no repository, runs here; so does work its policy or
 * its program keeps here ({@link RackAdmitOptions.judge}), and work bound to
 * this machine's process settings. The rest is placed by the fleet as the
 * work sees it ({@link RackFleet.place}), its environment's layers built
 * first, once for an environment and a platform.
 *
 * @param options - The session, the run's delegation options, and the work
 * @returns Where the work goes
 * @example
 * ```ts
 * const admitted = await admitWork({ session, delegation, signal, storage, repo, unit: false, hostBound: false,
 *   judge: (storage) => delegation.evaluator.evaluateCall(request, storage), asks: wholeResources });
 * if (admitted.kind === 'local') return runLocal(admitted.why.reason, admitted.why.detail, admitted.why.said);
 * ```
 */
export async function admitWork(options: RackAdmitOptions): Promise<RackAdmission> {
  const { session, delegation, signal, storage, repo } = options;
  if (signal?.aborted) return { kind: 'aborted' };
  if (session.hubLost) return { kind: 'local', why: { reason: 'hub-unreachable' } };
  if (storage === undefined) return { kind: 'local', why: { reason: 'no-repository' } };
  const verdict = await options.judge(storage);
  if (!verdict.eligible) return { kind: 'local', why: { reason: verdict.reason } };
  if (options.hostBound) return { kind: 'local', why: { reason: 'host-process-settings' } };
  const fleet = new RackFleet(session, verdict, options.unit);
  const placed = await fleet.place({ rackOnly: delegation.rackOnly, unreachableWaitMs: delegation.unreachableWaitMs, signal,
    asks: (mostCores) => options.asks(verdict, mostCores),
    layers: async (envHash, platform, image) => {
      // The image's manifest, as the rack reported it: one the hub cannot
      // give is no image to build over, and the environment is built whole
      const manifest = image === undefined ? null : await session.tierManifest(image.digest);
      return delegation.builds.publish(storage, repo, envHash, { platform, tier: verdict.tier, e3Version: session.e3Version,
        ...(image !== undefined && manifest !== null && { over: { digest: image.digest, manifest } }) }, options.onEnvironment, signal);
    } });
  return placed.kind === 'rack' ? { kind: 'rack', verdict, fleet, resources: placed.resources, storage } : placed;
}

/** How the wait on a lease ended. */
export type RackLeaseEnd =
  /** The run was aborted: while the lease was waited on, or after its
   *  session left it. The lease is left either way. */
  | { readonly kind: 'aborted'; readonly how: 'waiting' | 'left' }
  /** The work's deadline passed, and the lease was left */
  | { readonly kind: 'expired' }
  /** The work runs here instead, by the reason */
  | { readonly kind: 'local'; readonly reason: string }
  /** A rack completed the lease */
  | { readonly kind: 'completed'; readonly result: RackLeaseResult; readonly attempt: LeaseAttempt | null };

/** What the wait on a lease watches. */
export interface RackLeaseWatch {
  /** The session the lease is the work's in */
  readonly session: RackSession;
  /** The fleet as the work sees it */
  readonly fleet: RackFleet;
  /** The run's policy: how long a lease waits for a claim */
  readonly policy: RackPolicy;
  /** Whether the work keeps its work for a rack */
  readonly rackOnly: boolean;
  /** How long it waits for a rack to be healthy again, in ms */
  readonly unreachableWaitMs: number;
  /** The run's abort */
  readonly signal?: AbortSignal;
  /** Whether the work may run here now rather than wait for a claim */
  readonly canSpill: () => boolean;
  /**
   * When the work must have ended by: after `afterClaimMs` from the claim
   * that runs it, as a task's time counts from its claim; or `at`, in ms
   * since the epoch, from before it is claimed, as a call's does from when
   * its caller made it.
   */
  readonly deadline: { readonly afterClaimMs: number } | { readonly at: number };
  /** Told each claim of the lease: the first, and one after its reclaim */
  readonly onClaimed: (claim: Extract<LeaseUpdate, { kind: 'claimed' }>) => void;
  /** Since when no rack could claim the work, in ms since the epoch: kept
   *  across the work's leases, as each one leaves it */
  readonly unreachable: { since?: number };
}

/** Waits without abandoning a pending next() when a timer wins the race. */
function wait(next: Promise<LeaseUpdate>, ms: number, signal?: AbortSignal): Promise<LeaseUpdate | 'tick' | 'abort'> {
  if (signal?.aborted) return Promise.resolve('abort');
  return new Promise((resolve, reject) => {
    const finish = (value: LeaseUpdate | 'tick' | 'abort') => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(value); };
    const abort = () => finish('abort');
    const timer = setTimeout(() => finish('tick'), Math.max(1, Math.min(ms, LONGEST_TIMER_MS)));
    signal?.addEventListener('abort', abort, { once: true });
    next.then(finish, (error: unknown) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); });
  });
}

/**
 * Waits on a lease until it ends: a rack completes it, the work's deadline
 * passes, the run is aborted, or the work is to run here.
 *
 * @remarks
 * A lease no rack claims within the policy's claim timeout is looked at
 * again: work that may run here does, and any other waits on, unless no rack
 * could claim it, when it runs here at once, or, for work kept for a rack,
 * once no rack has been healthy for {@link RackLeaseWatch.unreachableWaitMs}.
 * A status the hub does not answer is no verdict on the lease: the snapshot
 * its events keep stands, and a hub that is gone ends the lease by them.
 * The leases of a stage tick together and share one ask, so one that fails
 * must not send them all here.
 *
 * @param handle - The lease
 * @param watch - The fleet, the policy, the deadline and the claims
 * @returns How the wait ended; the lease is left, when the work leaves it
 * @throws {Error} What the lease's subscription rejects with (its session's
 *   connection to the hub failing, say); its caller runs the work here by
 *   what it says
 */
export async function awaitLease(handle: LeaseHandle, watch: RackLeaseWatch): Promise<RackLeaseEnd> {
  const { session, fleet, policy, signal } = watch;
  const claimWait = Number(policy.claimTimeoutSeconds) * 1000;
  let claimDeadline = Date.now() + claimWait;
  let executionDeadline = 'at' in watch.deadline ? watch.deadline.at : undefined;
  let claimed = false;
  let next = handle.next();
  for (;;) {
    const until = claimed ? executionDeadline! : Math.min(claimDeadline, executionDeadline ?? Infinity);
    const update = await wait(next, until - Date.now(), signal);
    if (update === 'abort') {
      await leaveLease(handle);
      return { kind: 'aborted', how: 'waiting' };
    }
    if (update === 'tick') {
      if (executionDeadline !== undefined && Date.now() >= executionDeadline) {
        await leaveLease(handle);
        return { kind: 'expired' };
      }
      // The host owns the deadline once a rack has claimed the work; before
      // then, a claim timeout is looked at again
      if (claimed || Date.now() < claimDeadline) continue;
      await session.refreshCapacity().catch(() => {});
      const gone = fleet.noRack();
      if (gone === null) watch.unreachable.since = undefined;
      else {
        // No rack could claim the lease. Work kept for a rack gives one its
        // wait to be healthy again.
        watch.unreachable.since ??= Date.now();
        if (!watch.rackOnly || !gone.waited || Date.now() - watch.unreachable.since >= watch.unreachableWaitMs) {
          return { kind: 'local', reason: gone.reason === 'source-unreachable' ? 'fallback:source-unreachable' : gone.waited ? 'fallback:rack-unavailable' : `fallback:${gone.reason}` };
        }
      }
      if (watch.canSpill()) return { kind: 'local', reason: 'fallback:not-claimed' };
      claimDeadline = Date.now() + claimWait;
      continue;
    }
    if (update.kind === 'claimed') {
      claimed = true;
      // The host owns the deadline; the rack's clock does not determine it.
      if ('afterClaimMs' in watch.deadline) executionDeadline ??= Date.now() + watch.deadline.afterClaimMs;
      watch.onClaimed(update);
      next = handle.next();
      continue;
    }
    if (update.kind === 'lost') return { kind: 'local', reason: `fallback:${update.reason}` };
    if (update.kind === 'cancelled') {
      // This session left the lease: by the run's abort, or by closing under
      // a run that was not aborted, whose work then finishes locally.
      return signal?.aborted ? { kind: 'aborted', how: 'left' } : { kind: 'local', reason: 'fallback:rack session closed' };
    }
    return { kind: 'completed', result: update.result, attempt: update.attempt };
  }
}
