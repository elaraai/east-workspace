/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The rack dispatch seam DelegatingTaskRunner drives (epic #67 design §7.3,
 * §9.2 rev. 2026-07-11). #73 implements it over the RackLease store +
 * registry; FakeRackDispatch (testing) lets #70 land and test independently.
 *
 * Lease lifecycle (every transition a conditional write):
 * `pending → claimed → completed | superseded | cancelled`, with visibility
 * expiry making a claimed lease reclaimable. A completion against a
 * superseded/cancelled lease is accepted-and-discarded by the store. The
 * cloud records a task or unit lease's attempt itself (#214): `running` when
 * a rack claims it, its outcome when the rack completes it, and `interrupted`
 * or `cancelled` when it is superseded or cancelled while claimed.
 */

import type { RackLeaseAttempt, RackLeaseEvent, RackLeaseResult } from '../protocol/task-envelope.js';

/** A lease's lifecycle state. */
export type RackLeaseStatus = 'pending' | 'claimed' | 'completed' | 'superseded' | 'cancelled';

/** One delegated task hand-off. */
export interface RackLease {
  leaseId: string;
  repo: string;
  workspace: string;
  /** Task identity — the re-attachment key across orchestrator yields. */
  taskHash: string;
  inputsHash: string;
  /** The dataflow run this lease belongs to, a UUIDv7: re-attach is scoped
   *  to it (a lease from a prior run is never a cache; #67) */
  runId?: string;
  /** The rack tier it runs on */
  tier: string;
  /** The compute size tag its VM is shaped by */
  computeSize: string;
  status: RackLeaseStatus;
  /** The rack that claimed it (set on `claimed` and beyond). */
  claimedBy?: string;
  /** The attempt its latest claim runs, for a task or unit lease (#214) */
  attempt?: RackLeaseAttempt;
  /** Terminal result (set on `completed`). */
  result?: RackLeaseResult;
}

/**
 * What DelegatingTaskRunner needs from the rack control plane. Implemented
 * over the lease store + rack registry (#73); faked in tests.
 */
export interface RackDispatch {
  /**
   * Whether any healthy enrolled rack advertises the tier and runs an agent
   * that runs a v2 lease (0.5.0 and later, #214): the prefer-rack
   * availability check. NOT per-rack targeting: the v1 lease pool is
   * repo-global and any matching agent claims.
   *
   * @param tier - The work's rack tier (node | py | c | full | env base)
   */
  anyHealthyRackWithTier(tier: string): Promise<boolean>;

  /**
   * The rack tier (base image) a PUBLISHED environment was built on, or
   * null when the env is not published for rack execution (#94 Slice D).
   * Also the delegability gate for env/custom tasks: null ⇒ cloud.
   *
   * @param envHash - The task's declared environment hash
   */
  envBaseTier(envHash: string): Promise<string | null>;

  /**
   * Find a live (pending/claimed) or completed lease for a task — the
   * re-attachment path a resumed orchestrator cycle takes instead of
   * creating a duplicate.
   */
  findLease(repo: string, taskHash: string, inputsHash: string): Promise<RackLease | null>;

  /**
   * Create a pending lease carrying the work's event.
   *
   * @param event - The v2 lease event the agent will run
   * @param tier - The rack tier the work requires
   * @param computeSize - The work's resolved compute size tag (VM shape)
   */
  createLease(event: RackLeaseEvent, tier: string, computeSize?: string): Promise<RackLease>;

  /** Re-read a lease's current state. */
  getLease(repo: string, leaseId: string): Promise<RackLease | null>;

  /**
   * Terminally supersede a lease (runner falling back to cloud). A CAS —
   * a lease already `completed` stays completed (the store returns the
   * final state so the caller can still use a result that won the race).
   * A claimed lease's attempt is recorded `interrupted` (#214).
   *
   * @returns The lease's state after the attempt
   */
  supersede(repo: string, leaseId: string): Promise<RackLease | null>;

  /**
   * Terminally cancel a lease: its run was cancelled. A CAS, as
   * {@link supersede}; the rack's next heartbeat stops it, and a claimed
   * lease's attempt is recorded `cancelled` (#214).
   *
   * @returns The lease's state after the attempt
   */
  cancel(repo: string, leaseId: string): Promise<RackLease | null>;

  /**
   * Whether a lease is still held: pending a claim, or claimed within its
   * visibility deadline. A rack attempt's liveness (#206, #214).
   */
  leaseHeld(repo: string, leaseId: string): Promise<boolean>;
}
