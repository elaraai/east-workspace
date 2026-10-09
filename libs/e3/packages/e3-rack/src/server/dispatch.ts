/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * StoreRackDispatch (#73) — the real {@link RackDispatch} the
 * DelegatingTaskRunner drives, layered on the lease store + rack registry.
 *
 * Status derivation for the runner's view:
 * - a `claimed` lease past its visibility deadline is reported `pending`
 *   for one reclaim window (another agent may retake it), then `null`
 *   (lost) — which makes the runner supersede and fall back to cloud;
 * - everything else passes through.
 *
 * Rack health for `anyHealthyRackWithTier` is heartbeat freshness: the
 * stored `healthy` flag AND `lastSeenAt` within the healthy window (a rack
 * that stops heartbeating fails safe — it just stops receiving work), and an
 * agent that runs a v2 lease ({@link LEASE_MIN_AGENT}).
 *
 * A lease superseded or cancelled while a rack held it leaves its attempt
 * recorded (`interrupted`, `cancelled`) and what it wrote and never committed
 * discarded (#214), through {@link StoreRackDispatchOptions.endings}.
 */

import { inputsHash as computeInputsHash } from '@elaraai/e3-core';
import { OptionType, StringType, equalFor } from '@elaraai/east';
import { LEASE_MIN_AGENT, agentVersionAtLeast, type RackRegistration } from '../protocol/index.js';
import type { RackDispatch, RackLease, RackLeaseStatus } from '../lease/rack-dispatch.js';
import {
  makeLeaseId,
  rackLeaseHeld,
  type RackLeaseRecord,
  type RackLeaseStore,
} from '../lease/lease-store.js';
import type { RackRegistry } from '../registry/rack-registry.js';
import { leaseInputs, leaseRun, leaseTaskHash, type RackLeaseEvent } from '../protocol/task-envelope.js';
import type { EnvIndexStore } from './env-publication.js';
import type { RackStorageBridge } from './storage-bridge.js';
import { backendLeaseCoordinator, type LeaseCoordinator } from '../lease/coordinator.js';

/**
 * Whether a registration's latest boot lacks approval (D12 start
 * approval): the reported and approved boot ids differ. Both-none is NOT
 * pending — a freshly enrolled rack adopts its first boot on first
 * heartbeat, and quarantining the pre-heartbeat window would serve nothing
 * (an agent that never heartbeats never claims work healthily anyway).
 */
export function bootPendingApproval(registration: RackRegistration): boolean {
  const { lastBootId, approvedBootId } = registration;
  return !equalFor(OptionType(StringType))(lastBootId, approvedBootId);
}

/**
 * What a lease that ends while a rack holds it leaves (#214): its attempt's
 * record, and the uncatalogued versions of the keys it was issued.
 */
export interface RackLeaseEndings {
  /** Where its attempt's record goes: `interrupted` or `cancelled` */
  readonly stopped: (record: RackLeaseRecord, how: 'interrupted' | 'cancelled', cause: string) => Promise<void>;
  /** Discards the versions it wrote and never committed */
  readonly writes?: Pick<RackStorageBridge, 'discardWrites'>;
}

/** Runtime collaborators of the shared dispatcher. */
export interface StoreRackDispatchOptions {
  /** Shares the routes' fence for transitions and their repository effects. */
  coordinator?: LeaseCoordinator;
  /** Clock for health and visibility. */
  now?: () => number;
  /** How stale a heartbeat may be before a rack stops counting as healthy. */
  healthyWindowMs?: number;
  /** Visibility window granted on claim (and per extension). */
  visibilityMs?: number;
  /** Published-env index — env/custom delegation is disabled without it
   *  (env tasks fall back to cloud). #94 Slice D. */
  envIndex?: EnvIndexStore;
  /** The deployment's e3 version (selects the published env build). */
  e3Version?: string;
  /** What a lease superseded or cancelled while claimed leaves (#214):
   *  absent, nothing is recorded or discarded, as a function lease writes
   *  nothing */
  endings?: RackLeaseEndings;
}

/** Three missed heartbeats make a rack unavailable for new work. */
export const DEFAULT_HEALTHY_WINDOW_MS = 45_000;
/** Visibility granted by a claim or extension. */
export const DEFAULT_VISIBILITY_MS = 60_000;

// The oldest agent the cloud leases work to (#214) is part of the rack
// protocol: e3-cloud-types', where the agent and the suites read it too
export { LEASE_MIN_AGENT, agentVersionAtLeast } from '../protocol/index.js';

/**
 * Why an agent is refused leases, or null when it is leased work: an agent
 * older than {@link LEASE_MIN_AGENT}.
 *
 * @param agentVersion - The agent build its registration reports
 * @returns The refusal, naming the upgrade, or null
 */
export function leaseRefusal(agentVersion: string): string | null {
  if (agentVersionAtLeast(agentVersion, LEASE_MIN_AGENT)) return null;
  return `this rack's agent (${agentVersion}) is older than ${LEASE_MIN_AGENT}, the oldest this deployment leases work to: ` +
    `its guest cannot run e3-core's own execution (elaraai/e3-cloud#214). Upgrade it to rack-v${LEASE_MIN_AGENT} or later ` +
    '(download the release and re-run `e3-rack install --api-url …`); until then its work runs in the cloud';
}

/**
 * Dispatches rack work through the shared registry and lease state machine.
 * @example
 * const dispatch = new StoreRackDispatch(leases, registry);
 */
export class StoreRackDispatch implements RackDispatch {
  private readonly now: () => number;
  private readonly healthyWindowMs: number;
  private readonly visibilityMs: number;
  private readonly envIndex?: EnvIndexStore;
  private readonly e3Version?: string;
  private readonly endings?: RackLeaseEndings;
  private readonly held: (repo: string, leaseId: string) => Promise<boolean>;
  private readonly coordinator: LeaseCoordinator;

  /**
   * @param leases - Lease persistence
   * @param settings - Enrolled machines and security policy
   * @param options - Clocks, visibility and callbacks for stopped attempts
   */
  constructor(
    private readonly leases: RackLeaseStore,
    private readonly settings: RackRegistry,
    options?: StoreRackDispatchOptions,
  ) {
    this.now = options?.now ?? Date.now;
    this.healthyWindowMs = options?.healthyWindowMs ?? DEFAULT_HEALTHY_WINDOW_MS;
    this.visibilityMs = options?.visibilityMs ?? DEFAULT_VISIBILITY_MS;
    this.envIndex = options?.envIndex;
    this.e3Version = options?.e3Version;
    this.endings = options?.endings;
    this.held = rackLeaseHeld(leases, this.now);
    this.coordinator = options?.coordinator ?? backendLeaseCoordinator;
  }

  async anyHealthyRackWithTier(tier: string): Promise<boolean> {
    return (await this.listHealthyRacks({ tier })).length > 0;
  }

  /**
   * Lists healthy, approved, compatible racks matching an optional tier/floor.
   * @param filter - Required tier and minimum bundled e3 release
   * @returns Matching registrations
   */
  async listHealthyRacks(filter: { tier?: string; minBundledE3?: string } = {}): Promise<RackRegistration[]> {
    const cutoff = this.now() - this.healthyWindowMs;
    const [racks, security] = await Promise.all([
      this.settings.listRacks(),
      this.settings.getRackSecurityPolicy(),
    ]);
    // Quarantined boots (D12 start approval) don't count as available —
    // otherwise the runner would route work at a rack whose lease poll is
    // answered 204, and every such task would ride the fallback timeout.
    const requireApproval = security?.requireStartApproval === true;
    return racks.filter(
      (rack) =>
        rack.healthy &&
        rack.lastSeenAt.getTime() >= cutoff &&
        (filter.tier === undefined || rack.tiers.includes(filter.tier)) &&
        !(requireApproval && bootPendingApproval(rack)) &&
        // #214: only an agent that runs a v2 lease is leased work
        agentVersionAtLeast(rack.agentVersion, LEASE_MIN_AGENT) &&
        (filter.minBundledE3 === undefined || (bundledE3Version(rack.agentVersion) !== null &&
          agentVersionAtLeast(bundledE3Version(rack.agentVersion)!, filter.minBundledE3))),
    );
  }

  async envBaseTier(envHash: string): Promise<string | null> {
    if (this.envIndex === undefined || this.e3Version === undefined) return null;
    const record = await this.envIndex.get(envHash, this.e3Version);
    return record?.baseTier ?? null;
  }

  async findLease(repo: string, taskHash: string, inputsHash: string): Promise<RackLease | null> {
    const record = await this.leases.findByTask(repo, taskHash, inputsHash);
    return record === null ? null : this.toLease(record);
  }

  async createLease(event: RackLeaseEvent, tier: string, computeSize?: string): Promise<RackLease> {
    const taskHash = leaseTaskHash(event);
    const inputsHash = computeInputsHash(leaseInputs(event));
    const record: RackLeaseRecord = {
      leaseId: makeLeaseId(taskHash, inputsHash),
      repo: event.runnerEvent.repo,
      workspace: event.workspace,
      taskHash,
      inputsHash,
      tier,
      ...(computeSize !== undefined ? { computeSize } : {}),
      status: 'pending',
      event,
      createdAtMs: this.now(),
    };
    await this.leases.put(record);
    return this.toLease(record)!;
  }

  async getLease(repo: string, leaseId: string): Promise<RackLease | null> {
    const record = await this.leases.get(repo, leaseId);
    return record === null ? null : this.toLease(record);
  }

  async supersede(repo: string, leaseId: string): Promise<RackLease | null> {
    return this.coordinator.run(repo, leaseId, async () => {
    const record = await this.leases.supersede(repo, leaseId);
    if (record?.status === 'superseded') {
      await this.ended(record, 'interrupted', 'its rack lease was superseded before the rack recorded an outcome: the work falls back to its originating host');
    }
    return record === null ? null : this.toLease(record);
    });
  }

  async cancel(repo: string, leaseId: string): Promise<RackLease | null> {
    return this.coordinator.run(repo, leaseId, async () => {
    const record = await this.leases.cancel(repo, leaseId);
    if (record?.status === 'cancelled') await this.ended(record, 'cancelled', 'its run was cancelled, so its rack lease was cancelled');
    return record === null ? null : this.toLease(record);
    });
  }

  leaseHeld(repo: string, leaseId: string): Promise<boolean> {
    return this.held(repo, leaseId);
  }

  /**
   * What a lease that ended while a rack held it leaves: its attempt recorded
   * as it ended, when it recorded no outcome, and the versions it wrote and
   * never committed discarded. Neither fails the transition, which stands.
   */
  private async ended(record: RackLeaseRecord, how: 'interrupted' | 'cancelled', cause: string): Promise<void> {
    const endings = this.endings;
    if (endings === undefined) return;
    if (record.attempt !== undefined) {
      await endings.stopped(record, how, cause).catch((err: unknown) => {
        console.warn(`rack lease ${record.leaseId}: its attempt ${record.attempt!.executionId} was not recorded ${how}: ${messageOf(err)}`);
      });
    }
    if (endings.writes !== undefined && (record.targets?.length ?? 0) > 0) {
      await endings.writes.discardWrites(record.repo, record.leaseId, record.targets!).catch((err: unknown) => {
        console.warn(`rack lease ${record.leaseId}: the versions it wrote were not discarded: ${messageOf(err)}`);
      });
    }
  }

  /**
   * Map a stored record to the runner's seam view, deriving visibility
   * expiry: expired-claimed reads as `pending` for one reclaim window,
   * then as lost (`null`).
   */
  private toLease(record: RackLeaseRecord): RackLease | null {
    let status: RackLeaseStatus = record.status;
    if (record.status === 'claimed' && record.visibilityDeadlineMs !== undefined) {
      const now = this.now();
      if (record.visibilityDeadlineMs + this.visibilityMs < now) {
        return null; // claimant gone and nobody retook it — lost
      }
      if (record.visibilityDeadlineMs < now) {
        status = 'pending'; // reclaim window: another agent may take it
      }
    }
    const runId = leaseRun(record.event)?.id;
    return {
      leaseId: record.leaseId,
      repo: record.repo,
      workspace: record.workspace,
      taskHash: record.taskHash,
      inputsHash: record.inputsHash,
      ...(runId !== undefined ? { runId } : {}),
      tier: record.tier,
      computeSize: record.computeSize ?? 'serverless',
      status,
      ...(record.claimedBy !== undefined ? { claimedBy: record.claimedBy } : {}),
      ...(record.attempt !== undefined ? { attempt: record.attempt } : {}),
      ...(record.result !== undefined ? { result: record.result } : {}),
    };
  }
}

/**
 * Reads the bundled e3 release from an agent's semver build metadata.
 * @param agentVersion - An agent version such as 0.5.0+e3.1.0.85
 * @returns Its e3 version, or null when absent/malformed
 * @example
 * bundledE3Version('0.5.0+e3.1.0.85'); // '1.0.85'
 */
export function bundledE3Version(agentVersion: string): string | null {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\+e3\.(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(agentVersion)?.[1] ?? null;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
