/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Machine-authenticated /api/rack routes (epic #67 design §9).
 *
 * #72 ships the identity half: the enrollment exchange (`POST /rack/enroll`,
 * authenticated by the single-use enrollment token itself) and the
 * **machine-auth middleware** every other /rack/* route sits behind.
 * #73 adds the dispatch protocol behind that middleware:
 * - `POST /rack/lease` — long-poll claim of the next matching task
 * - `POST /rack/heartbeat` — liveness + stop signals for dead leases
 * - `POST /rack/lease/extend` — visibility refresh while running
 * - `POST /rack/complete` — terminal result (accepted-and-discarded)
 * #74 adds the data plane:
 * - `POST /rack/storage` — inline bytes / presigned URLs for a claimed
 *   lease's objects (scope-validated, review F5) + the output PUT targets
 * - `POST /rack/logs` — batched stdout/stderr → LogStore
 *
 * #214 moves the guest onto e3-core's own execution:
 * - a lease is refused to an agent older than `LEASE_MIN_AGENT`;
 * - the claim of a task or unit lease mints its attempt and records it
 *   `running`, stamped with the rack launch; the completion records its
 *   outcome, discards what it wrote and never committed, and wakes a run
 *   parked on it (#208);
 * - `/rack/storage` admits exactly the lease's closure, and takes the objects
 *   its guest wrote in by checksum-bound PUTs and their commits.
 *
 * A rack token authenticates ONLY these routes — it is invisible to the
 * human `jwtAuthorizer`, so it can never reach the human/admin API.
 */

import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { BooleanType, none, some, variant } from '@elaraai/east';
import { isObjectHash, uuidv7, type LogStore } from '@elaraai/e3-core';
import {
  RackEnrollRequestType,
  RackEnrollResponseType,
  RackLeaseRequestType,
  RackLeaseGrantType,
  RackHeartbeatRequestType,
  RackHeartbeatResponseType,
  RackExtendRequestType,
  RackCompleteRequestType,
  RackCompleteResponseType,
  RackStorageRequestType,
  RackStorageResponseType,
  RackLogsRequestType,
  type RackCompleteRequest,
  type RackEnrollRequest,
  type RackHeartbeatRequest,
  type RackHeartbeatResponse,
  type RackLeaseRef,
  type RackLogsRequest,
  type RackObjectDescriptor,
  type RackRegistration,
  type RackStorageRequest,
  type RackStorageResponse,
  type RackWriteTarget,
} from '../protocol/index.js';
import { sendSuccess, sendError, decodeBody } from '@elaraai/e3-api-server/beast2';
import type { RackRegistry } from '../registry/rack-registry.js';
import type { RunnerRun } from '../runner-event.js';
import { MAX_LEASE_TARGETS, type RackLeaseStore, type RackLeaseRecord } from '../lease/lease-store.js';
import type { RackStorageBridge } from './storage-bridge.js';
import { envLayerBlobKey, type EnvIndexStore, type EnvLayerManifest } from './env-publication.js';
import { isFunctionLease, isLeaseEventV2, leaseRun, type RackLeaseResult } from '../protocol/task-envelope.js';
import { DEFAULT_VISIBILITY_MS, leaseRefusal } from './dispatch.js';
import { backendLeaseCoordinator, type LeaseCoordinator } from '../lease/coordinator.js';
import {
  hashToken,
  generateRackToken,
  RACK_TOKEN_PREFIX,
  ROTATION_AGE_MS,
  ROTATION_REOFFER_MS,
  ROTATION_GRACE_MS,
  type MachineIdentityStore,
} from '../identity/machine-identity.js';

/**
 * Hono env for rack routes: the middleware resolves the caller's identity
 * and stashes what the routes need — the registration (quarantine checks)
 * and the presented token's pre-activation state (rotation decisions).
 */
export type RackEnv = {
  Variables: {
    rackId: string;
    registration: RackRegistration;
    tokenIssuedAt: Date;
    /** The presented token's status BEFORE any activation this request. */
    tokenStatus: 'current' | 'pending' | 'grace';
  };
};

/** Dispatch tuning — injectable so route tests run in milliseconds. */
export interface RackRouteOptions {
  /** Shares the dispatcher's fence for record, transfer and lease transitions. */
  coordinator?: LeaseCoordinator;
  /** Clock for identity, health and visibility (not the long-poll deadline). */
  now?: () => number;
  /** Stops outstanding lease polls when their host shuts down. */
  signal?: AbortSignal;
  /** Optional per-candidate compatibility gate, checked at claim time too. */
  canClaim?: (rack: RackRegistration, lease: RackLeaseRecord) => boolean | Promise<boolean>;
  /** Notifies session waiters after a transition and its record writes. */
  onLeaseSignal?: (signal: RackLeaseSignal) => void | Promise<void>;
  /**
   * Long-poll window for /rack/lease. Must sit comfortably inside API
   * Gateway's hard 29 s response cap (design picks ≤ ~25 s; each idle agent
   * holds ~1 API-Lambda invocation continuously — the documented standing
   * cost of the pull model).
   */
  leaseWindowMs?: number;
  /** Claim re-check interval while long-polling. */
  pollIntervalMs?: number;
  /** Visibility window granted on claim and per extension. */
  visibilityMs?: number;
  /** #94 Slice B: published-env index — absent means env resolution is
   *  unavailable (requests for it error; racks fall back to cloud). */
  envIndex?: EnvIndexStore;
  /** The deployment's e3 version (selects which published env build). */
  e3Version?: string;
  /**
   * Wakes a dataflow's parked run once a rack attempt's outcome is recorded
   * (#208): `wakeRun` over the run's pointer, which asks the deployment's
   * waker. Absent, only the park's backstop wakes it.
   */
  wake?: (repo: string, run: RunnerRun) => Promise<boolean>;
}

/** A committed route transition that waiters may observe. */
export type RackLeaseSignal =
  | { kind: 'claimed'; repo: string; leaseId: string; rackId: string }
  | { kind: 'extended'; repo: string; leaseId: string }
  | { kind: 'completed'; repo: string; leaseId: string; disposition: 'recorded' | 'idempotent' | 'discarded' };

/**
 * Where the rack routes keep a lease's attempt (#214): its records, its log
 * lines, and the store its output is checked whole in.
 */
export interface RackAttemptStore {
  /** Computes/reads the admitted closure in the repository-owning session. */
  closure(lease: RackLeaseRecord): Promise<readonly string[]>;
  /** Records an owner, then the newly claimed attempt as running. */
  running(lease: RackLeaseRecord, bootId: string): Promise<void>;
  /** Ends a prior attempt when reclaimed, superseded or cancelled. */
  stopped(lease: RackLeaseRecord, how: 'interrupted' | 'cancelled', cause: string): Promise<void>;
  /** Records the outcome after flushing the attempt's logs. */
  outcome(lease: RackLeaseRecord, result: RackLeaseResult): Promise<void>;
  /** Verifies and re-references the complete output graph before success. */
  verifyOutput(lease: RackLeaseRecord, outputHash: string): Promise<boolean>;
  /** Repository-session log sink. A flush is per attempt. */
  readonly logs: Pick<LogStore, 'append'> & Partial<Pick<LogStore, 'flush'>>;
}

/** The most objects one `/rack/storage` request declares or commits. */
export const MAX_STORAGE_OBJECTS = 256;

/** The largest object a write target is issued for: one checksum-bound PUT. */
export const MAX_RACK_OBJECT_BYTES = 5 * 1024 ** 3;

/** The leases whose closures a route keeps read, the least recently used forgotten first. */
const CLOSURE_CACHE_LIMIT = 64;

const DEFAULT_LEASE_WINDOW_MS = 20_000;
/** Claim re-check cadence inside a held window. 250 ms keeps interactive
 *  function calls (#83) snappy — pickup is bounded by this, not the window —
 *  at the cost of ~4 small listClaimable queries/s per idle agent (cents/day
 *  on DynamoDB on-demand; the held API-Lambda invocation dominates cost
 *  either way). */
const DEFAULT_POLL_INTERVAL_MS = 250;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function unauthorized(message: string): Response {
  return new Response(
    JSON.stringify({ success: false, error: { type: 'unauthorized', message } }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  );
}

/**
 * Machine-auth middleware for /rack/* routes: validates the bearer rack
 * token (by at-rest hash) and re-resolves the rack's registration so a
 * deregistered rack is rejected immediately — revocation needs no token
 * bookkeeping.
 *
 * Rotation activation (D12, #90) lives here: the FIRST authenticated use
 * of a `pending` successor promotes it to `current` and puts the token it
 * replaces on the ROTATION_GRACE fuse — on any rack route, so activation
 * is observed wherever the agent switches.
 *
 * @param identityStore - Machine-credential persistence
 * @param settingsStore - Rack registry (registration existence = not revoked)
 * @param now - Clock for token rotation and grace expiry
 * @returns Machine authentication middleware
 * @example
 * app.use('/api/rack/*', createRackAuth(identities, registry));
 */
export function createRackAuth(
  identityStore: MachineIdentityStore,
  settingsStore: RackRegistry,
  now: () => number = Date.now,
) {
  return async (c: Context<RackEnv>, next: Next): Promise<Response | void> => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (!token.startsWith(RACK_TOKEN_PREFIX)) {
      return unauthorized('Rack token required');
    }
    const tokenHash = hashToken(token);
    const record = await identityStore.getRackToken(tokenHash);
    if (record === null) {
      return unauthorized('Unknown rack token');
    }
    if (record.graceUntil !== undefined && record.graceUntil.getTime() <= now()) {
      return unauthorized('Superseded rack token (rotation grace elapsed)');
    }
    const registration = await settingsStore.getRack(record.rackId);
    if (registration === null) {
      return unauthorized('Rack is deregistered');
    }
    if (record.status === 'pending') {
      await identityStore.promoteRackToken(
        record.rackId,
        tokenHash,
        new Date(now() + ROTATION_GRACE_MS),
      );
    }
    c.set('rackId', record.rackId);
    c.set('registration', registration);
    c.set('tokenIssuedAt', record.issuedAt);
    c.set('tokenStatus', record.status);
    await next();
  };
}

/**
 * Create the /api/rack routes: the enrollment exchange (#72), the dispatch
 * protocol (#73), the data plane (#74), and a lease's attempt (#214).
 *
 * @param identityStore - Machine-credential persistence
 * @param settingsStore - Rack registry
 * @param leaseStore - Lease persistence (the pull queue)
 * @param bridge - Object data-plane (presign/inline/commit)
 * @param attempts - Where a lease's attempt is kept: its records, its log
 *   lines, and the store its output is checked whole in
 * @param options - Long-poll/visibility tuning, and the waker
 * @returns The rack machine API
 * @example
 * const app = createRackRoutes(identities, registry, leases, bridge, attempts);
 */
export function createRackRoutes(
  identityStore: MachineIdentityStore,
  settingsStore: RackRegistry,
  leaseStore: RackLeaseStore,
  bridge: RackStorageBridge,
  attempts: RackAttemptStore,
  options?: RackRouteOptions,
) {
  const now = options?.now ?? Date.now;
  const coordinator = options?.coordinator ?? backendLeaseCoordinator;
  const leaseWindowMs = options?.leaseWindowMs ?? DEFAULT_LEASE_WINDOW_MS;
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const visibilityMs = options?.visibilityMs ?? DEFAULT_VISIBILITY_MS;
  const envIndex = options?.envIndex;
  const e3Version = options?.e3Version;
  const { logs } = attempts;
  const app = new Hono<RackEnv>();

  const auth = createRackAuth(identityStore, settingsStore, now);
  app.use('/api/rack/lease', auth);
  app.use('/api/rack/heartbeat', auth);
  app.use('/api/rack/lease/extend', auth);
  app.use('/api/rack/complete', auth);
  app.use('/api/rack/storage', auth);
  app.use('/api/rack/logs', auth);

  /**
   * Resolve a lease the caller actively holds — the scope gate for the
   * data-plane routes (review F5): storage/logs are per-lease capabilities,
   * not rack-wide ones.
   */
  const heldLease = async (repo: string, leaseId: string, rackId: string): Promise<RackLeaseRecord | null> => {
    const lease = await leaseStore.get(repo, leaseId);
    if (lease === null || lease.status !== 'claimed' || lease.claimedBy !== rackId) return null;
    return lease;
  };

  const forbidden = (message: string): Response =>
    new Response(
      JSON.stringify({ success: false, error: { type: 'permission_denied', message } }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );

  /**
   * Every object a held lease may read: its closure (#214), and, for one
   * recorded as an object, that object. A closure never changes, so the
   * hashes of the leases asked after most recently are kept.
   */
  const closures = new Map<string, Promise<Set<string>>>();
  const admitted = (lease: RackLeaseRecord): Promise<Set<string>> => {
    const key = `${lease.repo} ${lease.leaseId}`;
    let hashes = closures.get(key);
    if (hashes === undefined) {
      hashes = attempts.closure(lease).then((list) => new Set(list));
      hashes.catch(() => closures.delete(key));
    } else {
      closures.delete(key);
    }
    closures.set(key, hashes);
    if (closures.size > CLOSURE_CACHE_LIMIT) closures.delete(closures.keys().next().value!);
    return hashes;
  };

  /** Refresh the caller's lastSeenAt — polling/heartbeating proves liveness. */
  const touchRack = (rackId: string, patch: (registration: RackRegistration) => Partial<RackRegistration> = () => ({})): Promise<RackRegistration | null> =>
    coordinator.run('@rack', rackId, async () => {
      const registration = await settingsStore.getRack(rackId);
      if (registration === null) return null;
      const updated = { ...registration, ...patch(registration), lastSeenAt: new Date(now()) };
      await settingsStore.putRack(updated);
      return updated;
    });

  // POST /api/rack/enroll — exchange a single-use enrollment token for a
  // long-lived rack token. The enrollment token is the sole authentication.
  app.post('/api/rack/enroll', async (c) => {
    let request: RackEnrollRequest;
    try {
      request = (await decodeBody(c, RackEnrollRequestType)) as RackEnrollRequest;
    } catch {
      return unauthorized('Invalid enrollment request body');
    }
    const consumed = await identityStore.consumeEnrollmentToken(
      hashToken(request.enrollmentToken),
      new Date(now()),
    );
    if (!consumed) {
      return unauthorized('Invalid, expired, or already-used enrollment token');
    }

    const rackId = uuidv7();
    const { token: rackToken, tokenHash } = generateRackToken();
    const enrolledAt = new Date(now());
    await identityStore.putRackToken(tokenHash, rackId, enrolledAt, 'current');

    // Boot identity starts empty: the first heartbeat's bootId is ADOPTED
    // as approved (the admin authorized this start by minting the token
    // moments ago); only later restarts can differ and quarantine.
    const registration: RackRegistration = {
      rackId,
      label: request.hostInfo.label,
      enrolledAt,
      tiers: request.hostInfo.tiers,
      capacity: request.hostInfo.capacity,
      lastSeenAt: enrolledAt,
      agentVersion: request.hostInfo.agentVersion,
      healthy: true,
      lastBootId: none,
      approvedBootId: none,
    };
    await settingsStore.putRack(registration);

    return sendSuccess(RackEnrollResponseType, { rackId, rackToken });
  });

  // POST /api/rack/lease — long-poll claim of the next task matching the
  // agent's tiers. 204 when the window closes with nothing claimable.
  app.post('/api/rack/lease', async (c) => {
    const rackId = c.get('rackId');
    let tiers: string[];
    let bootId: string;
    try {
      const request = (await decodeBody(c, RackLeaseRequestType)) as { tiers: string[]; bootId: string };
      tiers = request.tiers;
      bootId = request.bootId;
    } catch {
      return sendError(RackLeaseGrantType, variant('internal', { message: 'Invalid lease request body' }));
    }
    // Converge the ADVERTISED tiers into the registration (found live: a
    // re-install with widened --tiers left the registry on the enrollment-
    // time tier set forever — heartbeats never carry tiers, so routing and
    // the fleet UI kept refusing c/full work the agent could run). The
    // tier list the agent POLLS with is exactly what it can execute.
    if (await touchRack(rackId, () => ({ tiers })) === null) return unauthorized('Rack is deregistered');
    // #214: an agent older than LEASE_MIN_AGENT cannot run a v2 lease: it is
    // refused, and told to upgrade. The registration's version is refreshed
    // by every heartbeat; the dispatch routes no work at such a rack either
    const refusal = leaseRefusal(c.get('registration').agentVersion);
    if (refusal !== null) {
      return sendError(RackLeaseGrantType, variant('internal', { message: refusal }));
    }

    const deadline = Date.now() + leaseWindowMs;
    for (;;) {
      if (c.req.raw.signal.aborted || options?.signal?.aborted) return c.body(null, 204);
      const currentRack = await settingsStore.getRack(rackId);
      if (currentRack === null) return unauthorized('Rack is deregistered');
      // Start-approval quarantine (D12): only the APPROVED boot receives
      // work, judged against the request's own bootId — no heartbeat
      // ordering can leak a grant to an unapproved restart. The check
      // lives INSIDE the poll loop: a quarantined agent holds its window
      // open like any idle agent (same pacing, no hot 204 loop) and an
      // approval landing mid-window grants within one poll interval.
      let quarantined = false;
      const security = await settingsStore.getRackSecurityPolicy();
      if (security?.requireStartApproval === true) {
        const approved = (await settingsStore.getRack(rackId))?.approvedBootId;
        quarantined = !(approved !== undefined && approved.type === 'some' && approved.value === bootId);
      }

      if (!quarantined) {
        const candidates = await leaseStore.listClaimable(tiers, now(), 10);
        for (const candidate of candidates) {
          const grant = await coordinator.run(candidate.repo, candidate.leaseId, async () => {
          const current = await leaseStore.get(candidate.repo, candidate.leaseId);
          if (current === null) return null;
          // A lease written before #214 is no work this build runs
          if (!isLeaseEventV2(current.event)) return null;
          if (options?.canClaim !== undefined && !(await options.canClaim(currentRack, current))) return null;
          // A task or unit lease's claim runs an attempt, which the cloud
          // records: the rack cannot (#214)
          const attempt = isFunctionLease(candidate.event) ? undefined : { executionId: uuidv7(), startedAtMs: now() };
          const claimed = await leaseStore.claim(
            candidate.repo,
            candidate.leaseId,
            rackId,
            now() + visibilityMs,
            attempt,
          );
          if (claimed !== null) {
            if (attempt !== undefined) {
              // A rack that went quiet past the lease's visibility runs its
              // attempt no more: this claim's takes over
              if (current.attempt !== undefined) {
                await attempts.stopped(current, 'interrupted',
                  `its rack ${current.claimedBy ?? ''} went quiet past its lease's visibility, and rack ${rackId} took the lease up`)
                  .catch((err: unknown) => console.warn(`rack lease ${candidate.leaseId}: its earlier attempt was not recorded interrupted: ${messageOf(err)}`));
              }
              await attempts.running(claimed, bootId);
            }
            await options?.onLeaseSignal?.({ kind: 'claimed', repo: claimed.repo, leaseId: claimed.leaseId, rackId });
            return sendSuccess(RackLeaseGrantType, {
              repo: claimed.repo,
              workspace: claimed.workspace,
              leaseId: claimed.leaseId,
              tier: claimed.tier,
              computeSize: claimed.computeSize ?? 'serverless',
              eventJson: JSON.stringify(claimed.event),
              visibilityDeadline: new Date(claimed.visibilityDeadlineMs!),
            });
          }
          return null;
          });
          if (grant !== null) return grant;
        }
      }
      if (Date.now() + pollIntervalMs >= deadline) {
        return c.body(null, 204);
      }
      await sleep(pollIntervalMs);
    }
  });

  // POST /api/rack/heartbeat — liveness + which running leases to abandon,
  // plus the D12 lifecycle: boot-identity reporting (first heartbeat after
  // enrollment ADOPTS its bootId as approved — the mint authorized that
  // start), start-approval status, and token-rotation offers.
  app.post('/api/rack/heartbeat', async (c) => {
    const rackId = c.get('rackId');
    let heartbeat: RackHeartbeatRequest;
    try {
      heartbeat = (await decodeBody(c, RackHeartbeatRequestType)) as RackHeartbeatRequest;
    } catch {
      return sendError(RackHeartbeatResponseType, variant('internal', { message: 'Invalid heartbeat body' }));
    }

    const registration = await touchRack(rackId, (current) => ({
      healthy: heartbeat.healthy,
      agentVersion: heartbeat.agentVersion,
      lastBootId: some(heartbeat.bootId),
      approvedBootId: current.approvedBootId.type === 'none' && current.lastBootId.type === 'none'
        ? some(heartbeat.bootId) : current.approvedBootId,
    }));
    if (registration === null) return unauthorized('Rack is deregistered');
    const { approvedBootId } = registration;

    // A lease is dead to this agent when it is terminal-for-someone-else:
    // cancelled, superseded, gone, or reclaimed by another rack after expiry.
    const stop: RackLeaseRef[] = [];
    for (const ref of heartbeat.runningLeases) {
      const lease = await leaseStore.get(ref.repo, ref.leaseId);
      if (
        lease === null ||
        lease.status === 'cancelled' ||
        lease.status === 'superseded' ||
        (lease.status === 'claimed' && lease.claimedBy !== rackId)
      ) {
        stop.push({ repo: ref.repo, leaseId: ref.leaseId });
      }
    }

    const security = await settingsStore.getRackSecurityPolicy();
    const pendingApproval =
      security?.requireStartApproval === true &&
      (approvedBootId.type !== 'some' || approvedBootId.value !== heartbeat.bootId);

    // Rotation offer (D12): only the rack's CURRENT token ages into an
    // offer — a pending successor was just activated by the middleware
    // (fresh clock), and a grace token proves the agent already holds a
    // newer one. Offers repeat with a FRESH successor at most every
    // ROTATION_REOFFER until first use activates one.
    let rotatedToken: RackHeartbeatResponse['rotatedToken'] = none;
    if (
      c.get('tokenStatus') === 'current' &&
      now() - c.get('tokenIssuedAt').getTime() > ROTATION_AGE_MS
    ) {
      const tokens = await identityStore.listRackTokens(rackId);
      const pending = tokens.find((t) => t.status === 'pending');
      const staleOffer =
        pending !== undefined && now() - pending.issuedAt.getTime() > ROTATION_REOFFER_MS;
      if (pending === undefined || staleOffer) {
        if (pending !== undefined) await identityStore.deleteRackToken(pending.tokenHash);
        const successor = generateRackToken();
        await identityStore.putRackToken(successor.tokenHash, rackId, new Date(now()), 'pending');
        rotatedToken = some(successor.token);
      }
    }

    return sendSuccess(RackHeartbeatResponseType, { stop, rotatedToken, pendingApproval });
  });

  // POST /api/rack/lease/extend — visibility refresh (the running lease's
  // own heartbeat). False when the lease is no longer this rack's.
  app.post('/api/rack/lease/extend', async (c) => {
    const rackId = c.get('rackId');
    try {
      const request = (await decodeBody(c, RackExtendRequestType)) as { repo: string; leaseId: string };
      const extended = await coordinator.run(request.repo, request.leaseId,
        () => leaseStore.extend(request.repo, request.leaseId, rackId, now() + visibilityMs));
      if (extended) await options?.onLeaseSignal?.({ kind: 'extended', repo: request.repo, leaseId: request.leaseId });
      return sendSuccess(BooleanType, extended);
    } catch {
      return sendError(BooleanType, variant('internal', { message: 'Invalid extend body' }));
    }
  });

  // POST /api/rack/complete — terminal result. Accepted-and-discarded: a
  // late completion after supersede/cancel/reclaim is a 200 telling the
  // agent to drop local state, never a retryable error. A success's output
  // is in the store FIRST, every object it names (#214), so a completion only
  // ever records an output hash that resolves. The attempt's outcome is
  // recorded before the lease ends, so no reader finds the lease ended and
  // the attempt still running; then what the lease wrote and never committed
  // is discarded, and a run parked on it is woken (#208).
  app.post('/api/rack/complete', async (c) => {
    const rackId = c.get('rackId');
    let request: RackCompleteRequest;
    let result: RackLeaseResult;
    try {
      request = (await decodeBody(c, RackCompleteRequestType)) as RackCompleteRequest;
      result = JSON.parse(request.resultJson) as RackLeaseResult;
      if (typeof result.taskName !== 'string' || (result.status !== 'success' && result.status !== 'failed')) {
        throw new Error('malformed result');
      }
      if (result.state !== undefined && !['success', 'failed', 'error'].includes(result.state)) throw new Error('invalid state');
      if (result.state !== undefined && (result.state === 'success') !== (result.status === 'success')) throw new Error('inconsistent outcome');
      if (result.exitCode !== undefined && !Number.isSafeInteger(result.exitCode)) throw new Error('invalid exit code');
      if (result.peakBytes !== undefined && (!Number.isSafeInteger(result.peakBytes) || result.peakBytes < 0)) throw new Error('invalid peak');
      if (result.duration !== undefined && (!Number.isFinite(result.duration) || result.duration < 0)) throw new Error('invalid duration');
      if (result.outputHash !== undefined && (typeof result.outputHash !== 'string' || !isObjectHash(result.outputHash))) throw new Error('invalid output hash');
      if (result.cancelled !== undefined && typeof result.cancelled !== 'boolean') throw new Error('invalid cancellation');
      if (result.error !== undefined && typeof result.error !== 'string') throw new Error('invalid error');
    } catch {
      return sendError(RackCompleteResponseType, variant('internal', { message: 'Invalid completion body' }));
    }

    return coordinator.run(request.repo, request.leaseId, async () => {
    // Land the output before any lease transition. Only the lease holder
    // may commit; a fenced-out agent's completion falls through to the
    // state machine below, which discards it without touching storage.
    const held = await heldLease(request.repo, request.leaseId, rackId);
    // A task or unit lease's attempt, which the cloud records (#214)
    const attempt = held !== null && !isFunctionLease(held.event) ? held.attempt : undefined;
    if (held !== null && result.status === 'success') {
      if (request.inlineOutput.type === 'some') {
        // Small output: server computes the hash — the agent's is ignored.
        result.outputHash = await bridge.writeInline(request.repo, request.inlineOutput.value);
      } else if (request.outputUploadId.type === 'some') {
        if (result.outputHash === undefined) {
          return sendError(RackCompleteResponseType, variant('internal', { message: 'outputUploadId without outputHash' }));
        }
        // A whole output, staged: taken in once the store's copy of it hashes
        // to its hash (#210)
        const verified = await bridge.commitStaged(request.repo, result.outputHash, request.outputUploadId.value);
        if (!verified) {
          // Tampered/corrupt upload: reject — the lease stays claimed, so
          // the agent may retry; otherwise visibility expiry → cloud.
          return sendError(RackCompleteResponseType, variant('internal', { message: 'Output verification failed' }));
        }
      }
      if (attempt !== undefined) {
        const outputHash = result.outputHash;
        if (outputHash === undefined || !isObjectHash(outputHash)) {
          return sendError(RackCompleteResponseType, variant('internal', { message: 'A success names its output\'s hash' }));
        }
        // Every object the output names is in the store, committed by the
        // lease or held already, and re-referenced until the loop roots it
        let whole: boolean;
        try {
          whole = await attempts.verifyOutput(held, outputHash);
        } catch (err) {
          return sendError(RackCompleteResponseType, variant('internal', { message: `The output could not be checked: ${messageOf(err)}` }));
        }
        if (!whole) {
          return sendError(RackCompleteResponseType, variant('internal', {
            message: `Output ${outputHash} is not whole in the store: commit every object it names before completing`,
          }));
        }
      }
    }
    if (held !== null && attempt !== undefined) {
      try {
        await logs.flush?.(held.repo, held.taskHash, held.inputsHash, attempt.executionId);
        await attempts.outcome(held, result);
      } catch (err) {
        // The lease stays claimed: the agent completes it again
        return sendError(RackCompleteResponseType, variant('internal', { message: `The attempt's outcome was not recorded: ${messageOf(err)}` }));
      }
    }

    const disposition = await leaseStore.complete(request.repo, request.leaseId, rackId, result);
    if (held !== null) {
      // What the lease wrote and nothing committed leaves no version at a
      // content address (#214)
      if ((held.targets?.length ?? 0) > 0) {
        await bridge.discardWrites(request.repo, request.leaseId, held.targets!).catch((err: unknown) => {
          console.warn(`rack lease ${request.leaseId}: the versions it wrote and never committed were not discarded: ${messageOf(err)}`);
        });
      }
      // A run parked on the attempt runs its next cycle at once (#208): the
      // waker finds its outcome recorded
      const run = attempt !== undefined ? leaseRun(held.event) : undefined;
      if (run !== undefined && options?.wake !== undefined) {
        await options.wake(request.repo, run).catch((err: unknown) => {
          console.warn(`rack lease ${request.leaseId}: could not wake run ${run.id}, which its park's backstop wakes: ${messageOf(err)}`);
        });
      }
    }
    await options?.onLeaseSignal?.({ kind: 'completed', repo: request.repo, leaseId: request.leaseId, disposition });
    return sendSuccess(RackCompleteResponseType, { disposition: variant(disposition, null) });
    });
  });

  // POST /api/rack/storage — data-plane descriptors for a HELD lease. The
  // request's `need` set must be within the lease's closure (F5, #214): the
  // objects its guest reads, as the cloud computed them when it granted the
  // lease. Anything else is a hard 403 — a compromised agent must not walk
  // the repo's object store. The objects its guest wrote go in by PUTs at
  // their content addresses, bound to their SHA-256 and the lease, which
  // their commits take in.
  app.post('/api/rack/storage', async (c) => {
    const rackId = c.get('rackId');
    let request: RackStorageRequest;
    try {
      request = (await decodeBody(c, RackStorageRequestType)) as RackStorageRequest;
    } catch {
      return sendError(RackStorageResponseType, variant('internal', { message: 'Invalid storage request body' }));
    }
    return coordinator.run(request.repo, request.leaseId, async () => {
    const lease = await heldLease(request.repo, request.leaseId, rackId);
    if (lease === null) {
      return forbidden('No such lease held by this rack');
    }
    if (!isLeaseEventV2(lease.event)) {
      return forbidden(`Lease ${lease.leaseId} is no work this deployment runs`);
    }

    if (request.need.length > 0) {
      let allowed: Set<string>;
      try {
        allowed = await admitted(lease);
      } catch (err) {
        return sendError(RackStorageResponseType, variant('internal', { message: `The lease's closure could not be read: ${messageOf(err)}` }));
      }
      for (const hash of request.need) {
        if (!allowed.has(hash)) {
          return forbidden(`Hash ${hash} is not part of lease ${lease.leaseId}`);
        }
      }
    }

    const objects: RackObjectDescriptor[] = [];
    for (const hash of request.need) {
      const descriptor = await bridge.readDescriptor(request.repo, hash);
      objects.push(
        descriptor.kind === 'inline'
          ? (variant('inline', { hash, data: descriptor.data }) as RackObjectDescriptor)
          : (variant('url', { hash, url: descriptor.url }) as RackObjectDescriptor),
      );
    }

    // A whole output, staged (#210)
    let output: RackStorageResponse['output'] = none;
    if (request.output.type === 'some') {
      output = some(await bridge.stagedTarget(
        request.repo, lease.workspace, request.output.value.hash, request.output.value.size,
      ));
    }

    // #94 Slice B: published env layers for the lease's OWN environment.
    // Scope (F5): the requested hash must equal the lease's declared env —
    // the index/manifest are deployment-global, so this check is the only
    // thing between a rack credential and every published environment.
    let env: RackStorageResponse['env'] = none;
    if (request.envManifest.type === 'some') {
      const envHash = request.envManifest.value;
      if (lease.event.environment !== envHash) {
        return forbidden(`Environment ${envHash} is not part of lease ${lease.leaseId}`);
      }
      const record = envIndex !== undefined && e3Version !== undefined
        ? await envIndex.get(envHash, e3Version)
        : null;
      const manifestJson = record === null ? null : await bridge.readEnvManifest(record.manifestKey);
      if (manifestJson === null) {
        return sendError(RackStorageResponseType, variant('internal', {
          message: `Environment ${envHash} has no published layers (build it, or the deployment predates publication)`,
        }));
      }
      const manifest = JSON.parse(manifestJson) as EnvLayerManifest;
      const layers = [];
      for (const layer of manifest.layers) {
        layers.push({
          digest: layer.digest,
          url: await bridge.presignEnvLayer(envLayerBlobKey(layer.digest)),
          sizeBytes: BigInt(layer.sizeBytes),
        });
      }
      env = some({ manifestJson, layers });
    }

    // #214: a PUT target for each object the guest wrote, at its content
    // address; the keys issued are recorded on the lease before the answer,
    // so its end finds every version it may have made
    const issued = new Set(lease.targets ?? []);
    const targets: RackStorageResponse['targets'] = [];
    if (request.outputs.length > 0 || request.commits.length > 0) {
      if (isFunctionLease(lease.event)) {
        return forbidden(`Lease ${lease.leaseId} is a function call's, which writes nothing to the store`);
      }
      if (request.outputs.length > MAX_STORAGE_OBJECTS || request.commits.length > MAX_STORAGE_OBJECTS) {
        return sendError(RackStorageResponseType, variant('internal', { message: `A request declares or commits at most ${MAX_STORAGE_OBJECTS} objects` }));
      }
    }
    // Validate and reserve the complete batch before issuing any capability.
    // A rejected batch must leave no untracked upload for a later cleanup.
    for (const { hash, size } of [...request.outputs, ...request.commits]) {
      if (!isObjectHash(hash) || size < 0n || size > BigInt(MAX_RACK_OBJECT_BYTES)) {
        return sendError(RackStorageResponseType, variant('internal', {
          message: `Output ${hash} is not an object this lease can write: a SHA-256, of at most ${MAX_RACK_OBJECT_BYTES} bytes`,
        }));
      }
    }
    const fresh = [...new Set(request.outputs.map(({ hash }) => hash))].filter((hash) => !issued.has(hash));
    if (issued.size + fresh.length > MAX_LEASE_TARGETS) {
      return sendError(RackStorageResponseType, variant('internal', { message: `The lease writes more than ${MAX_LEASE_TARGETS} objects` }));
    }
    if (fresh.length > 0 && !await leaseStore.recordTargets(request.repo, lease.leaseId, rackId, fresh)) {
      return forbidden('No such lease held by this rack');
    }
    for (const hash of fresh) issued.add(hash);
    for (const { hash, size } of request.outputs) {
      const target = await bridge.writeTarget(request.repo, lease.leaseId, hash, Number(size));
      targets.push({
        hash,
        target: target === null
          ? variant('held', null) as RackWriteTarget
          : variant('put', { url: target.url, headers: new Map(Object.entries(target.headers)) }) as RackWriteTarget,
      });
    }

    // #214: an object PUT through a target is taken in once the version it
    // made is checked: never a body read
    const committed: RackStorageResponse['committed'] = [];
    for (const { hash, size, version } of request.commits) {
      const ok = issued.has(hash) && await bridge.commitWrite(request.repo, lease.leaseId, rackId, hash, Number(size), version);
      committed.push({ hash, committed: ok });
    }
    return sendSuccess(RackStorageResponseType, { objects, output, env, targets, committed });
    });
  });

  // POST /api/rack/logs — batched stdout/stderr for a HELD lease → LogStore
  // under its attempt's execution id (visible in the task UI live, #214).
  app.post('/api/rack/logs', async (c) => {
    const rackId = c.get('rackId');
    let request: RackLogsRequest;
    try {
      request = (await decodeBody(c, RackLogsRequestType)) as RackLogsRequest;
    } catch {
      return sendError(BooleanType, variant('internal', { message: 'Invalid logs body' }));
    }
    return coordinator.run(request.repo, request.leaseId, async () => {
    const lease = await heldLease(request.repo, request.leaseId, rackId);
    if (lease === null) {
      return forbidden('No such lease held by this rack');
    }
    const executionId = lease.attempt?.executionId;
    if (executionId === undefined) {
      // Refused for good, so the rack posts it no more
      return forbidden(`Lease ${lease.leaseId} runs no attempt whose log is kept: a function call's output rides its completion`);
    }
    try {
      try {
        for (const chunk of request.chunks) {
          await logs.append(request.repo, lease.taskHash, lease.inputsHash, executionId, chunk.stream.type, chunk.data);
        }
      } finally {
        // A sink that buffers stores the batch before the rack is answered: a
        // serverless host is frozen once it answers, and the rack's next post
        // may reach another host
        await logs.flush?.(request.repo, lease.taskHash, lease.inputsHash, executionId);
      }
    } catch (err) {
      // Told its lines were not stored, a rack posts them again while it
      // holds the lease. Its batches carry one stream each, so a re-post
      // repeats no line of another stream.
      return sendError(BooleanType, variant('internal', {
        message: `Logs not stored: ${err instanceof Error ? err.message : String(err)}`,
      }));
    }
    return sendSuccess(BooleanType, true);
    });
  });

  return app;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
