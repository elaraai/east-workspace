/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Rack lease persistence (#73, epic #67 design §9.2–9.3) — the DynamoDB-
 * layered pull queue behind {@link StoreRackDispatch} and the /rack
 * dispatch routes.
 *
 * Lease state machine (review F3), every transition a conditional write:
 *
 *   pending ──claim──▶ claimed ──complete──▶ completed
 *      │                 │  ▲
 *      │                 │  └─ extend (visibility)
 *      │           visibility expires (lazily observed: the lease becomes
 *      │           claimable again; a claim retakes it)
 *      ├──supersede──▶ superseded   (runner fell back to cloud)
 *      └──cancel─────▶ cancelled    (heartbeat delivers; agent kills the VM)
 *
 * `complete` against superseded/cancelled (or by a non-claimant) is
 * **accepted-and-discarded** — never an error, the response just tells the
 * agent to drop local state. `complete` on completed is idempotent-success.
 * Supersede/cancel are CAS: an already-completed lease stays completed and
 * the caller receives it (completed-wins).
 *
 * The lease id embeds the task identity (`{taskHash}#{inputsHash}#{uuid}`)
 * so the store can find re-attachable leases with a key-prefix query — no
 * scans, no extra index.
 */

import { uuidv7 } from '@elaraai/e3-core';
import type { RackLeaseStatus } from './rack-dispatch.js';
import type { RackLeaseAttempt, RackLeaseEvent, RackLeaseResult } from '../protocol/task-envelope.js';

/**
 * The most object keys a lease may be issued write targets for (#214): its
 * row records each, and a failed or expired lease deletes the uncatalogued
 * versions of each. A unit that writes more new objects than this falls back
 * to the cloud.
 */
export const MAX_LEASE_TARGETS = 4096;

/** A stored lease — the persistent shape behind the RackDispatch seam. */
export interface RackLeaseRecord {
  /** `{taskHash}#{inputsHash}#{uuidv7}` — see {@link makeLeaseId}. */
  leaseId: string;
  repo: string;
  workspace: string;
  taskHash: string;
  inputsHash: string;
  /** The rack tier the task needs (node | py | c | ...). */
  tier: string;
  /** The task's compute size tag — the agent's VM shape (default serverless). */
  computeSize?: string;
  status: RackLeaseStatus;
  /** The rack that claimed it (set on claim and preserved after). */
  claimedBy?: string;
  /** Epoch ms of the (latest) claim — the rack-activity timeline (D12 UI). */
  claimedAtMs?: number;
  /** Epoch ms of completion. */
  completedAtMs?: number;
  /** Epoch ms; while `claimed`, past-deadline means reclaimable. */
  visibilityDeadlineMs?: number;
  /** The task envelope the agent executes. */
  event: RackLeaseEvent;
  /** The attempt the latest claim runs: minted by the claim, for a task or
   *  unit lease (#214) */
  attempt?: RackLeaseAttempt;
  /** The object hashes the lease was issued write targets for (#214): what
   *  its end deletes the uncatalogued versions of */
  targets?: readonly string[];
  /** Terminal result (set on `completed`). */
  result?: RackLeaseResult;
  createdAtMs: number;
}

/** Disposition of a completion attempt (accepted-and-discarded semantics). */
export type CompleteDisposition = 'recorded' | 'idempotent' | 'discarded';

/**
 * Build a lease id embedding the re-attachment key.
 *
 * @param taskHash - The task's content hash
 * @param inputsHash - Hash of the resolved input set
 */
export function makeLeaseId(taskHash: string, inputsHash: string): string {
  return `${taskHash}#${inputsHash}#${uuidv7()}`;
}

/**
 * The key prefix all leases for a task identity share.
 */
export function leaseIdPrefix(taskHash: string, inputsHash: string): string {
  return `${taskHash}#${inputsHash}#`;
}

/**
 * Whether a lease can be claimed right now: pending, or claimed with an
 * expired visibility deadline (the claimant went quiet).
 *
 * @param record - The stored lease
 * @param nowMs - Current epoch ms
 */
export function isClaimable(record: RackLeaseRecord, nowMs: number): boolean {
  return (
    record.status === 'pending' ||
    (record.status === 'claimed' && (record.visibilityDeadlineMs ?? 0) < nowMs)
  );
}

/**
 * Whether a rack lease is still held: claimed within its visibility deadline,
 * which the claimant's heartbeat extends, or pending a claim. A rack
 * attempt's liveness (#206, `launchLiveness`): the attempt can still finish
 * while its lease is held.
 *
 * @param leases - The lease store
 * @param now - The time, in ms since the epoch (default `Date.now`)
 * @returns Whether a repository's lease is held
 */
export function rackLeaseHeld(
  leases: Pick<RackLeaseStore, 'get'>,
  now: () => number = Date.now,
): (repo: string, leaseId: string) => Promise<boolean> {
  return async (repo, leaseId) => {
    const record = await leases.get(repo, leaseId);
    if (record === null) return false;
    return record.status === 'pending' || (record.status === 'claimed' && (record.visibilityDeadlineMs ?? 0) >= now());
  };
}

/**
 * Rack lease persistence seam. Implementations: `InMemoryRackLeaseStore`
 * (testing) and `DynamoRackLeaseStore` (e3-aws; lease rows under
 * `PK=RACKLEASE/{repo}` plus a small `PK=RACKQUEUE` discovery partition).
 */
export interface RackLeaseStore {
  /** Persist a new pending lease (and its queue-discovery entry). */
  put(record: RackLeaseRecord): Promise<void>;

  /** Read one lease. */
  get(repo: string, leaseId: string): Promise<RackLeaseRecord | null>;

  /**
   * Latest lease for a task identity that is not superseded/cancelled —
   * the yield re-attachment lookup (prefix query on the lease id).
   */
  findByTask(repo: string, taskHash: string, inputsHash: string): Promise<RackLeaseRecord | null>;

  /**
   * Leases an agent with the given tiers could claim right now (pending or
   * visibility-expired), oldest first.
   *
   * @param tiers - The tiers the agent has rootfs for
   * @param nowMs - Current epoch ms
   * @param limit - Max candidates to return
   */
  listClaimable(tiers: string[], nowMs: number, limit: number): Promise<RackLeaseRecord[]>;

  /**
   * Conditionally claim a lease: succeeds only while {@link isClaimable}.
   * Exactly one racing claimant wins.
   *
   * @param attempt - The attempt the claim runs, for a task or unit lease
   *   (#214): it replaces the one an earlier claim ran
   * @returns The claimed record, or null when the condition lost
   */
  claim(repo: string, leaseId: string, rackId: string, visibilityDeadlineMs: number, attempt?: RackLeaseAttempt): Promise<RackLeaseRecord | null>;

  /**
   * Record object hashes a lease was issued write targets for (#214), only
   * by its claimant while it holds the lease. The lease keeps each once.
   *
   * @returns Whether they were recorded: false when the lease is not held by
   *   the rack
   */
  recordTargets(repo: string, leaseId: string, rackId: string, hashes: readonly string[]): Promise<boolean>;

  /**
   * Recent leases claimed by a rack, newest first — the fleet-table
   * activity view ("what has this rack done"). A lease reclaimed by
   * ANOTHER rack after visibility expiry leaves this rack's list (the
   * record tracks its latest claimant only).
   *
   * @param rackId - The rack whose activity is listed
   * @param limit - Max records
   */
  listRecentByRack(rackId: string, limit: number): Promise<RackLeaseRecord[]>;

  /**
   * Extend a claimed lease's visibility — only by its claimant.
   *
   * @returns Whether the extension applied
   */
  extend(repo: string, leaseId: string, rackId: string, visibilityDeadlineMs: number): Promise<boolean>;

  /**
   * Record a terminal result — only transitions `claimed → completed` by
   * the claimant. Anything else is 'idempotent' (already completed) or
   * 'discarded' (superseded/cancelled/expired-and-reclaimed/unknown).
   */
  complete(repo: string, leaseId: string, rackId: string, result: RackLeaseResult): Promise<CompleteDisposition>;

  /**
   * CAS supersede (runner falling back to cloud): `pending|claimed →
   * superseded`; a completed lease stays completed.
   *
   * @returns The lease's state after the attempt
   */
  supersede(repo: string, leaseId: string): Promise<RackLeaseRecord | null>;

  /**
   * CAS cancel: `pending|claimed → cancelled`; a completed lease stays
   * completed. Heartbeats deliver the signal to the running agent.
   *
   * @returns The lease's state after the attempt
   */
  cancel(repo: string, leaseId: string): Promise<RackLeaseRecord | null>;
}
