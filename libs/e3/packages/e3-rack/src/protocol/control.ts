/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ArrayType, BooleanType, DateTimeType, IntegerType, NullType, OptionType, StringType, StructType, VariantType, type ValueTypeOf } from '@elaraai/east';
import { RackRegistrationType } from './registration.js';

/** An empty control message. */
export const EmptyType = StructType({});
/** Configures the user-wide listener and idle lifetime, inside rack state format 1. */
export const HubConfigType = StructType({
  listen: OptionType(StructType({ host: StringType, port: IntegerType })), allow: ArrayType(StringType),
  idleExitMinutes: IntegerType, advertiseUrl: OptionType(StringType),
});
/** The user-wide hub configuration, derived from the control wire. */
export type HubConfig = ValueTypeOf<typeof HubConfigType>;
/** Identifies a host process without confusing a reused PID with its owner. */
export const HubOwnerType = StructType({ pid: IntegerType, pidStartTime: IntegerType, bootId: StringType });
/** Answers the fixed handshake; subsequent schemas require an exact protocol match. */
export const HubHelloType = StructType({ version: StringType, protocol: IntegerType, pid: IntegerType, draining: BooleanType });
/** Registers a repository-owning session. repoPath is already canonicalized by the session. */
export const OpenSessionType = StructType({
  protocol: IntegerType, e3Version: StringType, owner: HubOwnerType,
  repoPath: StringType, workspace: StringType, label: StringType, dataSocket: StringType, dataToken: StringType,
});
/** Returns the session's identity and stable rack-cache namespace. */
export const OpenSessionResultType = StructType({ sessionId: StringType, repoAlias: StringType });
/** Submits the current v2 task/unit event and the requested rack shape. */
export const CreateLeaseType = StructType({ eventJson: StringType, tier: StringType, computeSize: StringType });
/** Names a claim-time attempt, which changes on reclaim. */
export const HubAttemptType = StructType({ executionId: StringType, startedAt: DateTimeType });
/** Attaches to a lease, replaying its current attempt through the event stream. */
export const CreateLeaseResultType = StructType({ leaseId: StringType, attached: BooleanType, attempt: OptionType(HubAttemptType) });
/** Reports a committed lease transition to every subscribing session. */
export const SessionEventType = StructType({ seq: IntegerType, event: VariantType({
  claimed: StructType({ leaseId: StringType, rackId: StringType, rackLabel: StringType, attempt: HubAttemptType }),
  completed: StructType({ leaseId: StringType, attempt: OptionType(HubAttemptType), resultJson: StringType, at: DateTimeType }),
  lost: StructType({ leaseId: StringType, reason: StringType }),
  cancelled: StructType({ leaseId: StringType }),
}) });
/** Reports healthy fleet capacity and the requesting session's queue. */
export const CapacitySnapshotType = StructType({
  racks: ArrayType(StructType({ rackId: StringType, label: StringType, tiers: ArrayType(StringType), capacity: IntegerType,
    busy: IntegerType, healthy: BooleanType, bundledE3: OptionType(StringType), pendingApproval: BooleanType })),
  queued: IntegerType, mine: StructType({ pending: IntegerType, claimed: IntegerType }),
});
/** Requests events after a cursor, waiting at most 20 seconds. */
export const SessionPollType = StructType({ after: IntegerType, waitMs: IntegerType });
/** Returns ordered events and a fresh capacity snapshot. */
export const SessionPollResultType = StructType({ events: ArrayType(SessionEventType), capacity: CapacitySnapshotType });
/** Reports listener readiness without hiding a failed VPN/LAN bind. */
export const RackListenerType = VariantType({ disabled: NullType, up: StructType({ origin: StringType }), down: StructType({ reason: StringType }) });
/** Reports the hub, attached sessions, fleet and queue. */
export const HubStatusType = StructType({
  hello: HubHelloType, rackListener: RackListenerType, racks: ArrayType(RackRegistrationType),
  sessions: ArrayType(StructType({ sessionId: StringType, repoAlias: StringType, workspace: StringType, label: StringType, e3Version: StringType,
    pending: IntegerType, claimed: IntegerType })),
  capacity: CapacitySnapshotType,
});
/** Requests a short-lived enrollment credential. */
export const HubEnrollType = StructType({ label: OptionType(StringType), ttlMinutes: OptionType(IntegerType) });
/** Returns the one-time enrollment secret and exact control-plane origin. */
export const HubEnrollResultType = StructType({ enrollmentToken: StringType, apiUrl: StringType, expiresAt: DateTimeType, e3Version: StringType });
/** Approves exactly the boot the operator saw. */
export const ApproveRackType = StructType({ bootId: StringType });
/** Reports whether a registry entry was removed. */
export const RemoveRackResultType = StructType({ removed: BooleanType });
/** Reports the lease state after a subscriber leaves. */
export const CancelLeaseResultType = StructType({ status: StringType });
/** The session's events and fleet snapshot, decoded from the control wire. */
export type SessionEvent = ValueTypeOf<typeof SessionEventType>;
/** The live capacity snapshot, decoded from the control wire. */
export type CapacitySnapshot = ValueTypeOf<typeof CapacitySnapshotType>;
/** The session registration, decoded from the control wire. */
export type OpenSession = ValueTypeOf<typeof OpenSessionType>;
/** A local lease submission, decoded from the control wire. */
export type CreateLease = ValueTypeOf<typeof CreateLeaseType>;
/** A process identity belonging to the hub. */
export type HubOwner = ValueTypeOf<typeof HubOwnerType>;
