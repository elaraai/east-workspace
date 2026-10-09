/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ArrayType, BooleanType, DateTimeType, IntegerType, OptionType, StringType, StructType, type ValueTypeOf } from "@elaraai/east";

/**
 * Rack security posture (D12, #90) — deliberately a SEPARATE settings key
 * from the delegation policy: both are stored as BEAST2 blobs, and
 * adding a field to an already-stored struct breaks decoding of existing
 * values. New security knobs evolve here (or in further keys), never by
 * widening the delegation policy.
 */
export const RackSecurityPolicyType = StructType({
  /**
   * Quarantine every agent process restart (new bootId) until an admin
   * approves it in the fleet table. Enrollment itself authorizes the FIRST
   * boot — the admin minted that token moments earlier.
   */
  requireStartApproval: BooleanType,
});
export type RackSecurityPolicy = ValueTypeOf<typeof RackSecurityPolicyType>;

/**
 * One enrolled rack agent, as recorded in the rack registry at enrollment
 * and refreshed by heartbeats. `tiers` uses the runner-tier vocabulary
 * (node | py | py-datascience | c | full — see #57): only tasks whose tier
 * the rack has actually built are routed to it.
 *
 * Boot identity (D12, #90): `lastBootId` is what the agent most recently
 * reported (a fresh uuid per process lifetime; none until the first
 * heartbeat lands), `approvedBootId` is the boot a human authorized —
 * enrollment covers the first boot (adopted on its first heartbeat), every
 * later restart needs the fleet-table Approve when the deployment's
 * {@link RackSecurityPolicyType} demands it. A rack is QUARANTINED (no
 * leases) while the two differ under `requireStartApproval`.
 */
export const RackRegistrationType = StructType({
  rackId: StringType,
  label: StringType,
  enrolledAt: DateTimeType,
  tiers: ArrayType(StringType),
  /** Declared max concurrent microVMs. */
  capacity: IntegerType,
  lastSeenAt: DateTimeType,
  agentVersion: StringType,
  healthy: BooleanType,
  lastBootId: OptionType(StringType),
  approvedBootId: OptionType(StringType),
});
export type RackRegistration = ValueTypeOf<typeof RackRegistrationType>;

/**
 * One entry of a rack's activity timeline (fleet UI, D12): a lease this
 * rack claimed, newest first. `status` is the lease status
 * (claimed | completed | superseded | cancelled); `outcome` is the task
 * result when completed (success | failed), with `error` carrying the
 * failure detail. Task stdout/stderr is NOT here — it lives with the task
 * in the workspace UI.
 */
export const RackActivityEntryType = StructType({
  repo: StringType,
  workspace: StringType,
  taskName: StringType,
  tier: StringType,
  status: StringType,
  outcome: OptionType(StringType),
  error: OptionType(StringType),
  claimedAt: DateTimeType,
  completedAt: OptionType(DateTimeType),
});
export type RackActivityEntry = ValueTypeOf<typeof RackActivityEntryType>;
