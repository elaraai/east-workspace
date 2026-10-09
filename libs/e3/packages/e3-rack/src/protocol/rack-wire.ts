/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Rack machine-protocol wire types (epic #67 design §9) — the BEAST2 bodies
 * exchanged between a rack agent and the deployment's /api/rack endpoints.
 * Shared by the server routes (e3-cloud-core), the HTTP client, and the
 * rack agent, so the shapes live here beside the delegation types.
 */

import {
  ArrayType,
  BlobType,
  BooleanType,
  DateTimeType,
  DictType,
  IntegerType,
  NullType,
  OptionType,
  StringType,
  StructType,
  VariantType,
  type ValueTypeOf,
} from '@elaraai/east';

/**
 * What an enrolling agent declares about its host: the operator-facing
 * label, the runner tiers it has rootfs images for (node | py |
 * py-datascience | c | full — the #57 vocabulary), its max concurrent
 * microVMs, and the agent build it runs.
 */
export const RackHostInfoType = StructType({
  label: StringType,
  tiers: ArrayType(StringType),
  capacity: IntegerType,
  agentVersion: StringType,
});
export type RackHostInfo = ValueTypeOf<typeof RackHostInfoType>;

/**
 * POST /rack/enroll request — exchanges a single-use enrollment token
 * (minted by an admin in the UI) for a long-lived rack credential.
 */
export const RackEnrollRequestType = StructType({
  enrollmentToken: StringType,
  hostInfo: RackHostInfoType,
});
export type RackEnrollRequest = ValueTypeOf<typeof RackEnrollRequestType>;

/**
 * POST /rack/enroll response — the generated rack identity and its
 * bearer credential. The token is shown exactly once and stored hashed
 * at rest server-side; the agent persists it mode 0600.
 */
export const RackEnrollResponseType = StructType({
  rackId: StringType,
  rackToken: StringType,
});
export type RackEnrollResponse = ValueTypeOf<typeof RackEnrollResponseType>;

/** A (repo, leaseId) reference — leases are partitioned per repo. */
export const RackLeaseRefType = StructType({
  repo: StringType,
  leaseId: StringType,
});
export type RackLeaseRef = ValueTypeOf<typeof RackLeaseRefType>;

/**
 * POST /rack/lease request — long-poll for the next claimable task
 * matching any of the agent's tiers. `bootId` declares WHICH process
 * lifetime is asking: under `requireStartApproval` only the approved boot
 * receives grants, checked against the request itself so no heartbeat
 * ordering can leak a lease to an unapproved restart (D12, #90).
 */
export const RackLeaseRequestType = StructType({
  tiers: ArrayType(StringType),
  bootId: StringType,
});
export type RackLeaseRequest = ValueTypeOf<typeof RackLeaseRequestType>;

/**
 * A granted lease. `eventJson` carries the lease's event (e3-cloud-core's
 * `RackLeaseEvent`, v2 since elaraai/e3-cloud#214) as JSON: the runner
 * containers' v2 event (#205) the guest runs, the runtime version, and the
 * lease's closure. The agent must extend visibility before
 * `visibilityDeadline` or the lease becomes reclaimable.
 */
export const RackLeaseGrantType = StructType({
  repo: StringType,
  workspace: StringType,
  leaseId: StringType,
  tier: StringType,
  /** Compute size tag -> the agent's VM shape (serverless when unset upstream). */
  computeSize: StringType,
  eventJson: StringType,
  visibilityDeadline: DateTimeType,
});
export type RackLeaseGrant = ValueTypeOf<typeof RackLeaseGrantType>;

/**
 * POST /rack/heartbeat request — liveness + running work, every ~15 s.
 * `bootId` (D12, #90) is a fresh uuid per agent process lifetime, the unit
 * of start-approval quarantine. `cacheBytes` (RCK-D1, elaraai/e3-cloud#214)
 * is what the agent's object cache holds after its last collection, which
 * it runs after every lease and every 10 minutes; the cloud keeps none of
 * it yet (a registration is a stored value: its shape grows only with a
 * migration).
 *
 * The machine protocol evolves IN PLACE (pre-GA): a deployment and its
 * racks update together. #80's drift check is the planned skew answer —
 * a too-old binary gets "update required", never shape negotiation.
 */
export const RackHeartbeatRequestType = StructType({
  healthy: BooleanType,
  freeCapacity: IntegerType,
  runningLeases: ArrayType(RackLeaseRefType),
  agentVersion: StringType,
  bootId: StringType,
  cacheBytes: IntegerType,
});
export type RackHeartbeatRequest = ValueTypeOf<typeof RackHeartbeatRequestType>;

/**
 * POST /rack/heartbeat response —
 * - `stop`: leases the agent should stop working on (cancelled by an
 *   operator, or superseded because the runner fell back to cloud).
 *   Cancellation SLA is therefore one heartbeat + VM kill.
 * - `rotatedToken` (D12, #90): a successor rack token (shown once, hashed
 *   at rest server-side). The agent persists it and switches; the old
 *   token stays valid until the successor's first use, then for a short
 *   grace window — a lost response never strands the agent, and a leaked
 *   token ages out with rotation.
 * - `pendingApproval` (D12, #90): this boot is quarantined awaiting the
 *   fleet-table Approve (`requireStartApproval`); the agent keeps
 *   heartbeating but receives no leases.
 */
export const RackHeartbeatResponseType = StructType({
  stop: ArrayType(RackLeaseRefType),
  rotatedToken: OptionType(StringType),
  pendingApproval: BooleanType,
});
export type RackHeartbeatResponse = ValueTypeOf<typeof RackHeartbeatResponseType>;

/** POST /rack/lease/extend request — refresh a running lease's visibility. */
export const RackExtendRequestType = StructType({
  repo: StringType,
  leaseId: StringType,
});
export type RackExtendRequest = ValueTypeOf<typeof RackExtendRequestType>;

/**
 * POST /rack/complete request — terminal result for a lease. `resultJson`
 * carries the lease's result (e3-cloud-core's `RackLeaseResult`) as JSON.
 *
 * Output delivery (#74): a large output was already PUT via the presigned
 * target — `outputUploadId` makes the server verify-and-commit it (SHA-256
 * checked server-side; a tampered upload rejects the completion). A small
 * (≤4 KB) output rides `inlineOutput` instead and the server writes it
 * through the normal object-store normalization, computing the hash itself.
 */
export const RackCompleteRequestType = StructType({
  repo: StringType,
  leaseId: StringType,
  resultJson: StringType,
  outputUploadId: OptionType(StringType),
  inlineOutput: OptionType(BlobType),
});
export type RackCompleteRequest = ValueTypeOf<typeof RackCompleteRequestType>;

/** An object an agent declares or commits: its hash and size. */
export const RackObjectSizeType = StructType({ hash: StringType, size: IntegerType });
export type RackObjectSize = ValueTypeOf<typeof RackObjectSizeType>;

/** An object an agent PUT through a write target, and the version its PUT made. */
export const RackObjectCommitType = StructType({ hash: StringType, size: IntegerType, version: StringType });
export type RackObjectCommit = ValueTypeOf<typeof RackObjectCommitType>;

/**
 * POST /rack/storage request — storage descriptors for a claimed lease
 * (#74, #214):
 * - `need` lists the object hashes the agent's content-addressed cache
 *   lacks; every one must be in the lease's closure (server-validated —
 *   review F5);
 * - `output` declares a whole output for a staged PUT target (#210);
 * - `outputs` declares objects the lease's guest wrote, each for a PUT target
 *   at its content address bound to its SHA-256 (#214);
 * - `commits` names objects the agent PUT through those targets, and the
 *   versions its PUTs made, for the cloud to take in.
 */
export const RackStorageRequestType = StructType({
  repo: StringType,
  leaseId: StringType,
  need: ArrayType(StringType),
  output: OptionType(RackObjectSizeType),
  /** #94 Slice B: environment hash to resolve published layers for. Must
   *  equal the lease's own declared environment (F5). */
  envManifest: OptionType(StringType),
  outputs: ArrayType(RackObjectSizeType),
  commits: ArrayType(RackObjectCommitType),
});
export type RackStorageRequest = ValueTypeOf<typeof RackStorageRequestType>;

/**
 * One object descriptor: small (≤4 KB) objects live in DynamoDB and are
 * carried inline; large objects get a presigned S3 GET.
 */
export const RackObjectDescriptorType = VariantType({
  inline: StructType({ hash: StringType, data: BlobType }),
  url: StructType({ hash: StringType, url: StringType }),
});
export type RackObjectDescriptor = ValueTypeOf<typeof RackObjectDescriptorType>;

/** One published env layer: content digest + presigned GET (#94). */
export const RackEnvLayerType = StructType({
  digest: StringType,
  url: StringType,
  sizeBytes: IntegerType,
});

/**
 * Where an object a lease's guest wrote goes (#214): nowhere, when the store
 * holds it already (`held`), or a PUT at its content address, whose headers
 * the agent sends as given: they are signed into its URL.
 */
export const RackWriteTargetType = VariantType({
  held: NullType,
  put: StructType({ url: StringType, headers: DictType(StringType, StringType) }),
});
export type RackWriteTarget = ValueTypeOf<typeof RackWriteTargetType>;

/** POST /rack/storage response. */
export const RackStorageResponseType = StructType({
  objects: ArrayType(RackObjectDescriptorType),
  output: OptionType(StructType({ url: StringType, uploadId: StringType })),
  /** #94 Slice B: the env's published manifest (small JSON, inline) plus a
   *  presigned GET per delta layer — set iff `envManifest` was requested
   *  and the env is published. */
  env: OptionType(StructType({ manifestJson: StringType, layers: ArrayType(RackEnvLayerType) })),
  /** Each declared output's target, in the order declared */
  targets: ArrayType(StructType({ hash: StringType, target: RackWriteTargetType })),
  /** Whether each commit was taken in, in the order named */
  committed: ArrayType(StructType({ hash: StringType, committed: BooleanType })),
});
export type RackStorageResponse = ValueTypeOf<typeof RackStorageResponseType>;
export type RackEnvLayer = ValueTypeOf<typeof RackEnvLayerType>;

/** One streamed log chunk (agent batches ≥1 s or ≥32 KB per POST). */
export const RackLogChunkType = StructType({
  stream: VariantType({ stdout: NullType, stderr: NullType }),
  data: StringType,
});
export type RackLogChunk = ValueTypeOf<typeof RackLogChunkType>;

/** POST /rack/logs request — batched stdout/stderr for a claimed lease. */
export const RackLogsRequestType = StructType({
  repo: StringType,
  leaseId: StringType,
  chunks: ArrayType(RackLogChunkType),
});
export type RackLogsRequest = ValueTypeOf<typeof RackLogsRequestType>;

/**
 * POST /rack/complete response — accepted-and-discarded semantics:
 * - recorded: the result landed; the runner will pick it up
 * - idempotent: the lease was already completed (retry) — all good
 * - discarded: the lease was superseded/cancelled/reclaimed; the agent
 *   drops local state and moves on (never an error)
 */
export const RackCompleteResponseType = StructType({
  disposition: VariantType({
    recorded: NullType,
    idempotent: NullType,
    discarded: NullType,
  }),
});
export type RackCompleteResponse = ValueTypeOf<typeof RackCompleteResponseType>;

/**
 * The oldest rack agent the cloud leases work to (elaraai/e3-cloud#214): one
 * whose guest runs e3-core's own execution over its lease's staged closure,
 * and reads the v2 lease event, which names the runtime its work was built
 * with (#189). It subsumes the environment (0.3.0) and function (0.4.0)
 * capability gates. An older agent is refused at lease time and told to
 * upgrade; its work runs in the cloud.
 */
export const LEASE_MIN_AGENT = '0.5.0';

/**
 * Whether an agent version is at least another, under dotted-numeric semver:
 * pre-release and build suffixes are ignored, only the numeric core compared.
 *
 * @param version - The agent's version, as its registration reports it
 * @param min - The least version
 * @returns Whether `version` is `min` or later
 */
export function agentVersionAtLeast(version: string, min: string): boolean {
  const core = (v: string): number[] =>
    (v.split(/[-+]/)[0] ?? '').split('.').map((n) => parseInt(n, 10) || 0);
  const a = core(version);
  const b = core(min);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true; // equal
}
