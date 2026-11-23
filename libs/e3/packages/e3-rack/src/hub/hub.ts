/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { createHash, randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { Server } from 'node:http';
import { Server as HttpsServer, createServer as createHttpsServer } from 'node:https';
import { hostname } from 'node:os';
import { isAbsolute } from 'node:path';
import { Hono } from 'hono';
import { createAdaptorServer } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { IntegerType, StringType, compareFor, equalFor, none, some, variant, type ValueTypeOf } from '@elaraai/east';
import { inputsHash, isObjectHash, isProcessAlive, readTierManifest, tierManifestDigest } from '@elaraai/e3-core';
import { answer, decodeBody } from '../server/beast2.js';
import { FileMachineIdentityStore } from '../identity/file-identity-store.js';
import { generateEnrollmentToken } from '../identity/machine-identity.js';
import { FileRackRegistry } from '../registry/file-rack-registry.js';
import { InMemoryRackLeaseStore } from '../lease/in-memory-lease-store.js';
import type { RackLeaseRecord } from '../lease/lease-store.js';
import { StoreRackDispatch, bootPendingApproval, bundledE3Version, agentVersionAtLeast, DEFAULT_HEALTHY_WINDOW_MS } from '../server/dispatch.js';
import { createRackRoutes, type RackLeaseSignal } from '../server/rack-routes.js';
import { envManifestKey, envManifestName, type EnvIndexStore, type EnvLayerManifest } from '../server/env-publication.js';
import { RackRegistrationType, RackSecurityPolicyType } from '../protocol/registration.js';
import { RACK_ENVIRONMENTS_OVER_TIER, RACK_LISTENER_IDLE_MS, RACK_PROTOCOL, RACK_SCOPES_ENDED_MAX, RACK_SPLIT_SCOPES, type RackReport } from '../protocol/rack-json.js';
import { describeRackReason, isFunctionLease, isLeaseEventV2, leaseInputs, leaseReserve, leaseTaskHash, rackEverHolds, readRackLeaseResources, readRackLeaseScope,
  type RackLeaseEvent, type RackLeaseScope } from '../protocol/task-envelope.js';
import { decodeRunnerEvent } from '../runner-event.js';
import { ApproveRackType, AttachLeaseResultType, CancelLeaseResultType, CreateLeaseResultType, CreateLeaseType, EmptyType, EndScopeType, FetchCostRequestType,
  FetchCostResultType, HubConfigType, HubEnrollResultType, HubEnrollType, HubHelloType, HubOutcomeType, HubStatusType, OpenSessionResultType, OpenSessionType,
  RemoveRackResultType, SessionPollResultType, SessionPollType, TierManifestRequestType, TierManifestResultType,
  type CapacitySnapshot, type OpenSession, type SessionEvent } from '../protocol/control.js';
import { closeSocketServer, RackHubError, REQUEST_BODY_TIMEOUT_MS, serveOnSocket } from '../client/local-http.js';
import { rackHome, hubSocketPath } from '../paths.js';
import { E3_RACK_VERSION, HUB_PROTOCOL } from '../version.js';
import { certificateSha256 } from '../tls/tls.js';
import { MutationQueue } from '../state-file.js';
import { listenerProblem, loadHubCertificate, loadHubConfig, saveHubConfig, wildcardHost, type HubConfig } from './config.js';
import { acquireHubLock, type HeldHubLock } from './lock.js';
import { FairLeaseStore } from './fair-lease-store.js';
import { SessionLeaseCoordinator, SessionProxyStorageBridge, type SessionEndpoint } from './session-bridge.js';
import { RackLinkMeter } from './link-meter.js';
import { ScopeWrites } from './scope-writes.js';

interface Session {
  id: string;
  alias: string;
  registration: OpenSession;
  lastSeen: number;
  dead: boolean;
  seq: bigint;
  events: SessionEvent[];
  waiters: Set<() => void>;
  /** The scopes of the session's that have ended, the latest
   *  {@link MOST_SCOPES}: a lease that names one later is granted without it */
  endedScopes: Set<string>;
}
interface Subscription {
  repo: string;
  id: string;
  /** What identical work shares, by which a session joins it: none for a
   *  call's lease, which no other call shares. */
  key?: string;
  version: string;
  owner: string;
  subscribers: Set<string>;
  claimants: Set<string>;
  /** The keys of the manifests of the work's environment its sessions keep:
   *  the builds a rack may be served, as each session said when it leased or
   *  joined the work. */
  envManifests: Set<string>;
  endedAt?: number;
}
const equalString = equalFor(StringType);
const compareString = compareFor(StringType);
const compareInteger = compareFor(IntegerType);
/** How many of its last leases' ends a hub keeps for its status. */
const LAST_OUTCOMES = 20;
/** The most builds of its environment a lease names: one for each platform
 *  and tier image of the racks its session saw. */
const MOST_ENV_MANIFESTS = 64;
/** The builds of an environment a session says it keeps, each a key of a
 *  manifest of that environment's layers. */
function envManifestsOf(keys: readonly string[], environment: string | undefined): string[] {
  if (keys.length > MOST_ENV_MANIFESTS || keys.some((key) => environment === undefined || envManifestName(key)?.startsWith(`${environment}-`) !== true)) {
    throw new Error('Invalid environment manifests: each names a build of the work\'s environment');
  }
  return [...keys];
}
const nonterminal = (lease: RackLeaseRecord) => lease.status === 'pending' || lease.status === 'claimed';
/** The most scopes the hub keeps open at once, of all its sessions: a lease
 *  that names another past it is granted without its scope. */
const MOST_SCOPES = 16384;
/** The most ended scopes a rack is yet to be told of: the oldest past it are
 *  let go, and the rack's own bound on how long it keeps a scope applies. */
const MOST_SCOPES_ENDED = 4 * RACK_SCOPES_ENDED_MAX;
/**
 * How long a lease of a scope waits for a rack that holds some of what it
 * reads, written there by the scope's earlier leases, in ms, before another
 * rack is granted it: a merge goes where its pieces are, and a task where its
 * inputs were made, when that rack has room for it soon.
 */
export const SCOPE_AFFINITY_MS = 5000;
/** A scope the sessions' leases name — a split task's execution, or a whole
 *  session's under a policy that keeps it for the session: the session whose
 *  leases name it, and the racks granted a lease of it, which are told its
 *  end. What each rack holds of it is {@link ScopeWrites}'. */
interface Scope {
  session: string;
  racks: Set<string>;
}
/**
 * What a lease's work reads that a scope's earlier leases may have written:
 * what it stages — a task's inputs, a unit's inputs, or the range and the
 * parts a merge merges — and its closure, where the lease carries it inline.
 */
function leaseReads(event: RackLeaseEvent): string[] {
  const run = event.runnerEvent;
  const staged = run.mode === 'task' ? run.inputHashes
    : run.mode === 'unit' ? (run.unit.merge === null ? run.unit.inputs : [...(run.unit.merge.range === null ? [] : [run.unit.merge.range]), ...run.unit.merge.parts])
      : [];
  return [...staged, ...('hashes' in event.closure ? event.closure.hashes : [])];
}
const normalizedAddress = (address: string) => address.replace(/^::ffff:/, '');

/** Configures a shared hub and its deterministic lifecycle tests. */
export interface RackHubOptions {
  /** Private state home; defaults to E3_RACK_HOME or ~/.e3/rack. */
  home?: string;
  /** Disables idle exit for an interactive foreground hub. */
  foreground?: boolean;
  /** Overrides the idle lifetime, including in foreground mode. */
  idleExitMinutes?: number;
  /** Supplies lifecycle diagnostics. */
  log?: (line: string) => void;
  /** Clock for leases, health and idle exit. */
  now?: () => number;
  /** Test tuning; production uses sixty seconds. */
  visibilityMs?: number;
  /** Test tuning; production holds an idle rack's poll for the routes' own window. */
  leaseWindowMs?: number;
  /** Test tuning; production retries a failed listener every ten seconds. */
  listenerRetryMs?: number;
  /** Test tuning; production sweeps every five seconds. */
  sweepMs?: number;
  /** Measures each rack's link from the reads the hub serves it; the hub's
   *  own unless given, as a test gives one whose clock it sets. */
  linkMeter?: RackLinkMeter;
}

/**
 * Hosts one user's rack queue, fleet and repository-owning sessions.
 * The hub interprets the rack/control protocol only. A live session of the
 * same repository and exact e3 release performs every repository operation.
 *
 * Work that declares an environment is leased to a rack that composes
 * environments, for whose platform the work's session keeps the
 * environment's layers: its lease names the builds it keeps, and a session
 * that joins the work adds those it keeps. The hub keeps no layer: it serves
 * them from the session through its data plane, as it serves objects.
 *
 * A rack that composes environments built over a tier reports the manifest
 * of each tier image it boots them over. The hub keeps what its racks last
 * reported, tells a session which each rack names, and answers a manifest by
 * its digest, so a session builds an environment over the image that will
 * run it. Such a rack is served the layers built over its tier when the
 * work's sessions keep them, and the whole environment's otherwise.
 *
 * The hub measures each rack's link from the reads it serves it, and keeps
 * which objects it served each rack whole ({@link RackLinkMeter}), for as
 * long as it runs: a session asks it what a unit would fetch
 * (`/v1/sessions/:id/fetch-costs`) before it leases the unit.
 *
 * A unit's lease may name its split task's execution, its scope; and under a
 * policy that keeps what work wrote for the session, every task's and unit's
 * lease names the session's own scope. A rack whose report names
 * `split-scopes` is granted the lease with it, keeps what the scope's leases
 * wrote for its later ones, and is told with its next heartbeat once the
 * scope ends: when its session says so of a split task's, or the session
 * ends. The hub notes which rack each completed lease of a scope that feeds
 * it wrote its objects on ({@link ScopeWrites}), and a lease of the scope goes
 * first, for {@link SCOPE_AFFINITY_MS}, to a rack that holds some of what that
 * lease reads, and is weighed as fetching none of it there: by input, so a
 * session's work is not piled onto one rack. The hub keeps no more of a scope
 * than its id, its racks, and the writers of at most `SCOPE_WRITES_MAX` of
 * its objects.
 * @example
 * const hub = new RackHub({ foreground: true });
 * if (await hub.start()) await hub.closed;
 */
export class RackHub {
  /** Resolves after listeners, file stores and ownership have been closed. */
  readonly closed: Promise<void>;
  private resolveClosed!: () => void;
  private readonly home: string;
  private readonly now: () => number;
  private readonly sessions = new Map<string, Session>();
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly dedupe = new Map<string, string>();
  /** What each rack last reported of itself, by rack: kept here, since a
   *  registration is a stored value whose shape does not grow. */
  private readonly reports = new Map<string, RackReport>();
  /** Why a rack cannot be used, by rack: it asked in another rack protocol. */
  private readonly problems = new Map<string, string>();
  /** The text of each tier manifest a rack's last report names, by its
   *  digest: checked against it, and read as a manifest, as it arrived. */
  private readonly tierManifests = new Map<string, string>();
  /** The texts refused of each tier manifest, by the digest it was reported
   *  under: each by the digest of the text. The same text is refused again
   *  with nothing said; one whose own digest it is was refused for its bytes,
   *  which every rack that names it sends alike. */
  private readonly refusedTierManifests = new Map<string, Set<string>>();
  /** By rack, the digests it sent a text of that is not the bytes the digest
   *  names: it is not asked for that text again, and another rack that names
   *  the digest is. */
  private readonly mismatchedTierManifests = new Map<string, Set<string>>();
  /** How the last leases ended, the latest first: what the status lists. */
  private readonly outcomes: Array<ValueTypeOf<typeof HubOutcomeType>> = [];
  /** The scopes the sessions' leases name, by id, until each ends. */
  private readonly scopes = new Map<string, Scope>();
  /** Of each scope, the rack each of its objects was written on: what a
   *  later lease of it reads there. */
  private readonly writes = new ScopeWrites();
  /** By rack, the scopes it was granted a lease of that have ended, which its
   *  next heartbeat's answer names, in the order they ended. */
  private readonly scopesEnded = new Map<string, Set<string>>();
  private readonly mutations = new MutationQueue();
  private readonly coordinator = new SessionLeaseCoordinator();
  private readonly backend: InMemoryRackLeaseStore;
  private readonly leases: FairLeaseStore;
  private readonly abort = new AbortController();
  private lock?: HeldHubLock;
  private identity!: FileMachineIdentityStore;
  private registry!: FileRackRegistry;
  private config!: HubConfig;
  private bridge!: SessionProxyStorageBridge;
  /** Each rack's link, as the reads the hub serves it measure it, and what
   *  it was served whole: for as long as the hub runs. */
  private readonly meter: RackLinkMeter;
  private dispatch!: StoreRackDispatch;
  private control?: Server;
  private rack?: Server | HttpsServer;
  private listener: ValueTypeOf<typeof HubStatusType>['rackListener'] = variant('disabled', null);
  private retry?: NodeJS.Timeout;
  private sweeper?: NodeJS.Timeout;
  private stopping?: Promise<void>;
  private draining = false;
  private idleSince: number;
  /**
   * Where the shared routes find a lease's environment: the manifest its
   * session keeps, built with the lease's e3 release for the platform of the
   * rack that holds the lease. The hub publishes none of its own.
   */
  private readonly envIndex: EnvIndexStore = {
    put: () => Promise.reject(new Error('A rack hub publishes no environment: each session keeps its own')),
    get: async (envHash, e3Version) => {
      const { repo, leaseId } = this.coordinator.lease();
      const lease = await this.leases.get(repo, leaseId);
      if (lease?.claimedBy === undefined || lease.event.environment !== envHash || (lease.event.e3Version ?? e3Version) !== e3Version) return null;
      const manifestKey = await this.bridge.envManifestKeyOf(repo, leaseId, lease.claimedBy);
      const json = manifestKey === null ? null : await this.bridge.readEnvManifest(manifestKey);
      if (manifestKey === null || json === null) return null;
      const manifest = JSON.parse(json) as EnvLayerManifest;
      return { envHash, e3Version, baseImage: manifest.baseImage, baseTier: manifest.baseTier, manifestKey, layerCount: manifest.layers.length, publishedAtMs: 0 };
    },
  };

  /**
   * The keys of the manifests of a lease's environment a rack may be served,
   * the first the one it is: of the builds the lease's sessions keep, for a
   * rack that composes environments built over a tier and names the image of
   * the lease's tier, the layers built over that image; then the whole
   * environment's. None for a rack that composes no environment.
   */
  private envManifestKeys(rackId: string, lease: RackLeaseRecord): string[] {
    const report = this.reports.get(rackId);
    const environment = lease.event.environment;
    const kept = this.subscriptions.get(lease.leaseId)?.envManifests;
    if (environment === undefined || kept === undefined || report?.target === undefined || !report.features.includes('environments')) return [];
    const release = lease.event.e3Version ?? '';
    const tier = report.features.includes(RACK_ENVIRONMENTS_OVER_TIER) ? report.tiers?.[lease.tier] : undefined;
    return [
      ...(tier === undefined ? [] : [envManifestKey(environment, release, report.target, { tier: lease.tier, manifest: tier.digest })]),
      envManifestKey(environment, release, report.target),
    ].filter((key) => kept.has(key));
  }

  /**
   * Takes in what a rack reports of itself: the report, and the text of each
   * tier manifest it carries, kept by its digest once it is the manifest the
   * digest names. A manifest no rack's last report names any more is let go.
   * One that is refused is said once in the log: an agent that sends a
   * manifest's text with each heartbeat sends it again, until it reports
   * another.
   *
   * @returns The digests of the manifests the report names whose text is held
   *   nowhere, sorted: what the rack is asked to send with its next heartbeat.
   *   Not one whose own bytes were refused, which every rack would send
   *   alike; nor one this rack sent a text of that is not the bytes the digest
   *   names, which it would send again. Another rack that names that digest
   *   is asked for it.
   */
  private reported(rackId: string, report: RackReport): string[] {
    this.reports.set(rackId, report);
    this.problems.delete(rackId);
    for (const [tier, said] of Object.entries(report.tiers ?? {})) {
      if (said.manifest === undefined || this.tierManifests.has(said.digest)) continue;
      const bytes = new TextEncoder().encode(said.manifest);
      const actual = tierManifestDigest(bytes);
      // A text that is not the bytes its digest names says nothing of the
      // manifest the digest names: its rack alone is not asked for it again
      if (actual !== said.digest) this.mismatchedTierManifests.set(rackId, (this.mismatchedTierManifests.get(rackId) ?? new Set<string>()).add(said.digest));
      const refused = this.refusedTierManifests.get(said.digest);
      if (refused?.has(actual) === true) continue;
      try {
        if (actual !== said.digest) throw new Error('its text is not the bytes its digest names');
        readTierManifest(bytes);
        this.tierManifests.set(said.digest, said.manifest);
      } catch (error) {
        this.refusedTierManifests.set(said.digest, (refused ?? new Set<string>()).add(actual));
        this.options.log?.(`rack ${rackId}: the manifest it reports of its tier '${tier}' was not kept: ${messageOf(error)}`);
      }
    }
    this.forgetTierManifests();
    // A manifest whose own bytes were refused: every rack that names it sends those
    const unread = (digest: string): boolean => this.refusedTierManifests.get(digest)?.has(digest) === true;
    const sentWrongly = this.mismatchedTierManifests.get(rackId);
    return [...new Set(Object.values(report.tiers ?? {}).map((tier) => tier.digest))]
      .filter((digest) => !this.tierManifests.has(digest) && !unread(digest) && sentWrongly?.has(digest) !== true).sort(compareString);
  }

  /** Lets go of each tier manifest no rack's last report names, of each
   *  refusal of one, and of what a rack sent wrongly of one its last report
   *  does not name. */
  private forgetTierManifests(): void {
    const named = new Set([...this.reports.values()].flatMap((report) => Object.values(report.tiers ?? {}).map((tier) => tier.digest)));
    for (const digest of this.tierManifests.keys()) if (!named.has(digest)) this.tierManifests.delete(digest);
    for (const digest of this.refusedTierManifests.keys()) if (!named.has(digest)) this.refusedTierManifests.delete(digest);
    for (const [rackId, digests] of this.mismatchedTierManifests) {
      const its = new Set(Object.values(this.reports.get(rackId)?.tiers ?? {}).map((tier) => tier.digest));
      for (const digest of digests) if (!its.has(digest)) digests.delete(digest);
      if (digests.size === 0) this.mismatchedTierManifests.delete(rackId);
    }
  }

  /**
   * The scope a session's lease names, as the hub keeps it: one the session
   * opened with its first lease that names it, which no other session's lease
   * shares. None of one another session's leases name, of one that has ended,
   * or past {@link MOST_SCOPES}: the lease is the same work without it.
   */
  private scopeOf(session: Session, named: unknown): RackLeaseScope | undefined {
    const scope = readRackLeaseScope(named);
    if (scope === undefined || session.endedScopes.has(scope.id)) return undefined;
    const known = this.scopes.get(scope.id);
    if (known !== undefined) return known.session === session.id ? scope : undefined;
    if (this.scopes.size >= MOST_SCOPES) return undefined;
    this.scopes.set(scope.id, { session: session.id, racks: new Set() });
    return scope;
  }

  /**
   * Ends a scope: each rack granted a lease of it is told so with its next
   * heartbeat, a lease that still names it is granted without it, and what
   * its racks were noted to hold of it is let go.
   */
  private endScope(id: string): void {
    const scope = this.scopes.get(id);
    if (scope === undefined) return;
    this.scopes.delete(id);
    this.writes.end(id);
    const ended = this.sessions.get(scope.session)?.endedScopes;
    if (ended !== undefined) {
      ended.add(id);
      for (const oldest of ended) { if (ended.size <= MOST_SCOPES) break; ended.delete(oldest); }
    }
    for (const rackId of scope.racks) {
      const ended = this.scopesEnded.get(rackId) ?? new Set<string>();
      ended.add(id);
      for (const oldest of ended) { if (ended.size <= MOST_SCOPES_ENDED) break; ended.delete(oldest); }
      this.scopesEnded.set(rackId, ended);
    }
  }

  /**
   * Whether a rack is granted a lease with its scope: its report names
   * {@link RACK_SPLIT_SCOPES}, and the scope has not ended. Such a rack is
   * then one the scope's end is told to.
   */
  private scopeGranted(rackId: string, scope: RackLeaseScope): boolean {
    if (this.reports.get(rackId)?.features.includes(RACK_SPLIT_SCOPES) !== true) return false;
    const known = this.scopes.get(scope.id);
    if (known === undefined) return false;
    known.racks.add(rackId);
    return true;
  }

  /**
   * Notes what a lease of a scope that feeds it wrote on its rack, as it
   * completes with success: its output, and every object it was given a
   * target for. Not of a rack the scope was never granted to, which keeps
   * none of it.
   */
  private scopeWrote(lease: RackLeaseRecord): void {
    const scope = readRackLeaseScope(lease.event.scope);
    const rackId = lease.claimedBy;
    const outputHash = lease.result?.outputHash;
    if (scope?.feeds !== true || rackId === undefined || lease.result?.status !== 'success' || outputHash === undefined) return;
    if (this.scopes.get(scope.id)?.racks.has(rackId) !== true) return;
    this.writes.wrote(scope.id, rackId, [outputHash, ...(lease.targets ?? [])]);
  }

  /** The scopes of a rack's that ended, each named once, at most
   *  {@link RACK_SCOPES_ENDED_MAX}: those past it with its next heartbeat. */
  private scopesEndedFor(rackId: string): string[] {
    const ended = this.scopesEnded.get(rackId);
    if (ended === undefined) return [];
    const told = [...ended].slice(0, RACK_SCOPES_ENDED_MAX);
    for (const id of told) ended.delete(id);
    if (ended.size === 0) this.scopesEnded.delete(rackId);
    return told;
  }

  /**
   * Whether a lease of a scope waits for a rack that holds some of what it
   * reads, which the scope's earlier leases wrote there: one is healthy, the
   * rack asking is none of them, and the lease has waited less than
   * {@link SCOPE_AFFINITY_MS}. A lease that reads nothing the scope's leases
   * wrote waits for no rack.
   */
  private async waitsForHolder(rackId: string, lease: RackLeaseRecord): Promise<boolean> {
    const scope = readRackLeaseScope(lease.event.scope);
    if (scope === undefined || !this.scopes.has(scope.id) || this.now() - lease.createdAtMs >= SCOPE_AFFINITY_MS) return false;
    const holders = this.writes.writersOf(scope.id, leaseReads(lease.event));
    if (holders.size === 0 || holders.has(rackId)) return false;
    for (const holder of holders) {
      const rack = await this.registry.getRack(holder);
      if (rack !== null && rack.healthy && this.now() - rack.lastSeenAt.getTime() <= DEFAULT_HEALTHY_WINDOW_MS) return true;
    }
    return false;
  }

  /** @param options - State home, idle policy, diagnostics and lifecycle clocks */
  constructor(private readonly options: RackHubOptions = {}) {
    this.home = options.home ?? rackHome();
    this.now = options.now ?? Date.now;
    this.idleSince = this.now();
    this.meter = options.linkMeter ?? new RackLinkMeter();
    this.backend = new InMemoryRackLeaseStore(this.now);
    this.leases = new FairLeaseStore(this.backend, (lease) => this.subscriptions.get(lease.leaseId)?.owner ?? '');
    this.closed = new Promise((resolve) => { this.resolveClosed = resolve; });
  }

  /**
   * Acquires ownership, loads state, and starts both listeners and sweepers.
   * @returns False when another live hub owns this home
   * @throws {Error} When private state or the control socket cannot be opened
   */
  async start(): Promise<boolean> {
    if (this.lock !== undefined || this.stopping !== undefined) throw new Error('Rack hub has already started or stopped');
    const lock = await acquireHubLock(this.home);
    if (lock === null) { this.options.log?.('rack hub already running'); this.resolveClosed(); return false; }
    this.lock = lock;
    try {
      this.config = await loadHubConfig(this.home);
      this.identity = new FileMachineIdentityStore(this.home);
      this.registry = new FileRackRegistry(this.home, this.now);
      await Promise.all([this.identity.getRackToken('startup'), this.registry.listRacks()]);
      this.bridge = new SessionProxyStorageBridge({ leases: this.leases, coordinator: this.coordinator,
        session: (repo, id) => this.endpoint(repo, id), owner: lock.record, now: this.now,
        subscribers: (repo, id) => {
          const sub = this.subscriptions.get(id);
          if (sub?.repo !== repo) return [];
          return [...sub.subscribers].flatMap((id) => {
            const session = this.sessions.get(id);
            return session !== undefined && !session.dead ? [session.registration] : [];
          });
        },
        advertiseOrigin: () => this.config.advertiseUrl.type === 'some' ? this.config.advertiseUrl.value : undefined,
        envManifestKeys: (rackId, lease) => this.envManifestKeys(rackId, lease), meter: this.meter });
      this.dispatch = new StoreRackDispatch(this.leases, this.registry, { coordinator: this.coordinator, now: this.now,
        visibilityMs: this.options.visibilityMs, endings: { stopped: this.bridge.attempts.stopped, writes: this.bridge } });
      // The rack listener binds before the control socket answers: a client
      // that connects to a hub starting in the background, and enrolls at
      // once, finds the listener up or down with its reason, never still
      // binding. A bind that fails leaves the listener down and the control
      // socket up, so e3 rack config can still change it.
      await this.bindRack();
      const socket = hubSocketPath(this.home);
      if (process.platform !== 'win32') await unlink(socket).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; });
      this.control = await serveOnSocket(this.controlApp(), socket);
      this.sweeper = setInterval(() => { void this.sweep().catch((err: unknown) => this.options.log?.(`rack sweep: ${messageOf(err)}`)); }, this.options.sweepMs ?? 5000);
      this.sweeper.unref();
      this.options.log?.(`rack hub started (pid ${process.pid}, e3 ${E3_RACK_VERSION})`);
      return true;
    } catch (err) { await this.stop(); throw err; }
  }

  private hello(): ValueTypeOf<typeof HubHelloType> {
    return { version: E3_RACK_VERSION, protocol: BigInt(HUB_PROTOCOL), pid: BigInt(process.pid), draining: this.draining };
  }

  private endpoint(repo: string, id: string): SessionEndpoint {
    const sub = this.subscriptions.get(id);
    if (sub === undefined || sub.repo !== repo) throw new RackHubError('no_session', 'No live session for repository');
    const usable = (s: Session | undefined): s is Session => s !== undefined && !s.dead && s.alias === repo && equalString(s.registration.e3Version, sub.version);
    const owner = this.sessions.get(sub.owner);
    const session = usable(owner) ? owner : [...this.sessions.values()].find(usable);
    if (session === undefined) throw new RackHubError('no_session', 'No live session for repository and e3 version');
    return session.registration;
  }

  private session(id: string): Session {
    const session = this.sessions.get(id);
    if (session === undefined || session.dead) throw new RackHubError('unknown_session', 'Rack session no longer exists');
    return session;
  }

  private emit(session: Session, event: SessionEvent['event']): void {
    session.events.push({ seq: ++session.seq, event });
    // A non-polling client is disconnected by the sweeper. Bound its replay
    // queue too; a cursor gap is explicit, never a silently dropped outcome.
    if (session.events.length > 32768) session.events.splice(0, session.events.length - 32768);
    for (const wake of session.waiters) wake();
  }

  private publish(sub: Subscription, event: SessionEvent['event']): void {
    for (const id of sub.subscribers) { const session = this.sessions.get(id); if (session !== undefined) this.emit(session, event); }
  }

  /** A claim's event: the rack, and the attempt the claim runs, which a call's lease has none of. */
  private async claimedEvent(lease: RackLeaseRecord): Promise<SessionEvent['event']> {
    if (lease.claimedBy === undefined) throw new Error('Claim has no rack');
    const rack = await this.registry.getRack(lease.claimedBy);
    return variant('claimed', { leaseId: lease.leaseId, rackId: lease.claimedBy, rackLabel: rack?.label ?? lease.claimedBy,
      attempt: lease.attempt === undefined ? none : some({ executionId: lease.attempt.executionId, startedAt: new Date(lease.attempt.startedAtMs) }) });
  }

  private async finish(sub: Subscription): Promise<void> {
    sub.endedAt ??= this.now();
    if (sub.key !== undefined && this.dedupe.get(sub.key) === sub.id) this.dedupe.delete(sub.key);
    await this.bridge.discardWrites(sub.repo, sub.id, []).catch((error: unknown) => this.options.log?.(`rack cleanup: ${messageOf(error)}`));
  }

  private async signal(signal: RackLeaseSignal): Promise<void> {
    const sub = this.subscriptions.get(signal.leaseId);
    if (sub === undefined) return;
    const lease = await this.leases.get(signal.repo, signal.leaseId);
    if (lease === null) return;
    if (signal.kind === 'claimed') {
      sub.claimants.add(lease.claimedBy!);
      // Reclaim invalidates every prior-attempt data URL before its new grant.
      await this.bridge.discardWrites(lease.repo, lease.leaseId, lease.targets ?? []);
      const event = await this.claimedEvent(lease);
      const attempt = lease.attempt;
      if (event.type === 'claimed' && attempt !== undefined) {
        // A line of the attempt's log, best effort: the claim stands, and its
        // grant is answered, whether or not the session stored the line. A
        // call's lease runs no attempt, and keeps no log.
        try {
          await this.bridge.attempts.logs.append(lease.repo, lease.taskHash, lease.inputsHash, attempt.executionId,
            'stdout', `e3: running on rack ${event.value.rackLabel} (lease ${lease.leaseId})\n`);
          await this.bridge.attempts.logs.flush?.(lease.repo, lease.taskHash, lease.inputsHash, attempt.executionId);
        } catch (error) { this.options.log?.(`rack lease ${lease.leaseId}: its first log line was not stored: ${messageOf(error)}`); }
      }
      this.publish(sub, event);
    } else if (signal.kind === 'completed' && signal.disposition === 'recorded') {
      await this.finish(sub);
      this.scopeWrote(lease);
      const result = lease.result;
      const rack = lease.claimedBy === undefined ? null : await this.registry.getRack(lease.claimedBy);
      this.outcomes.unshift({ at: new Date(lease.completedAtMs!), workspace: lease.workspace, taskName: lease.event.taskName,
        rackLabel: rack?.label ?? lease.claimedBy ?? '', outcome: result?.state ?? result?.status ?? 'error',
        reason: result?.reason === undefined ? none : some(describeRackReason(result.reason)) });
      this.outcomes.length = Math.min(this.outcomes.length, LAST_OUTCOMES);
      this.publish(sub, variant('completed', { leaseId: lease.leaseId,
        attempt: lease.attempt === undefined ? none : some({ executionId: lease.attempt.executionId, startedAt: new Date(lease.attempt.startedAtMs) }),
        resultJson: JSON.stringify(lease.result), at: new Date(lease.completedAtMs!) }));
    }
  }

  /**
   * Attaches the session to identical work already queued or held, or queues
   * the work; attach-only queues nothing. A call's lease is never attached to
   * another: two calls of one program differ by their arguments alone, which
   * no key of the work names, so each is its own lease.
   */
  private async submit(session: Session, request: ValueTypeOf<typeof CreateLeaseType>, attachOnly: boolean): Promise<ValueTypeOf<typeof CreateLeaseResultType> | null> {
    if (this.draining) throw new RackHubError('draining', 'Rack hub is draining');
    const value: unknown = JSON.parse(request.eventJson);
    if (!isLeaseEventV2(value)) throw new Error('Expected a v2 rack lease');
    const runner = decodeRunnerEvent(value.runnerEvent);
    if (runner.mode === 'intake') throw new Error('Local rack delegation runs tasks, units and calls: an intake runs where its delivery is');
    // A call's program is an object of the repository, staged with its closure
    if (runner.mode === 'run-detached' && (typeof value.program !== 'string' || !isObjectHash(value.program))) throw new Error('A call\'s lease names its program');
    if (value.environment !== undefined && (typeof value.environment !== 'string' || !isObjectHash(value.environment))) throw new Error('Invalid environment');
    // A unit goes only to a rack that caps it at what its lease asks, so its
    // lease says what that is
    if (readRackLeaseResources(value.resources)?.kind !== 'unit' && runner.mode === 'unit') throw new Error('A unit\'s lease names what it asks of a rack, as a unit');
    if (!['node', 'py', 'py-datascience', 'c', 'full'].includes(request.tier) || !['serverless', 'small', 'medium', 'large', 'xlarge'].includes(request.computeSize)) throw new Error('Invalid rack tier or compute size');
    const closure = value.closure;
    if ('hashes' in closure) {
      if (!Array.isArray(closure.hashes) || closure.hashes.length > 512 || !closure.hashes.every((hash) => typeof hash === 'string' && isObjectHash(hash))) throw new Error('Invalid inline closure');
    } else if (!isObjectHash(closure.object) || !Number.isSafeInteger(closure.count) || closure.count < 0) throw new Error('Invalid closure object');
    // A lease's scope is the session's own, and a call has none: it writes
    // nothing a later lease reads
    const { scope: named, ...work } = value;
    const scope = runner.mode === 'run-detached' ? undefined : this.scopeOf(session, named);
    const event: RackLeaseEvent = { ...work, runnerEvent: { ...runner, repo: session.alias },
      workspace: session.registration.workspace, e3Version: session.registration.e3Version, ...(scope !== undefined && { scope }) };
    const key = isFunctionLease(event) ? undefined
      : JSON.stringify([session.alias, leaseTaskHash(event), inputsHash(leaseInputs(event)), session.registration.e3Version]);
    const existingId = key === undefined ? undefined : this.dedupe.get(key);
    const existing = existingId === undefined ? null : await this.leases.get(session.alias, existingId);
    if (existing !== null && nonterminal(existing)) {
      const sub = this.subscriptions.get(existing.leaseId)!;
      // It built the work's layers for the racks it saw, in the same repository
      for (const kept of envManifestsOf(request.envManifests, existing.event.environment)) sub.envManifests.add(kept);
      sub.subscribers.add(session.id);
      if (existing.status === 'claimed') this.emit(session, await this.claimedEvent(existing));
      return { leaseId: existing.leaseId, attached: true,
        attempt: existing.attempt === undefined ? none : some({ executionId: existing.attempt.executionId, startedAt: new Date(existing.attempt.startedAtMs) }) };
    }
    if (attachOnly) return null;
    if (this.subscriptions.size >= 16384) throw new RackHubError('capacity', 'Rack hub queue is full');
    const envManifests = new Set(envManifestsOf(request.envManifests, event.environment));
    const lease = await this.dispatch.createLease(event, request.tier, request.computeSize);
    this.subscriptions.set(lease.leaseId, { repo: session.alias, id: lease.leaseId, ...(key !== undefined && { key }), version: session.registration.e3Version,
      owner: session.id, subscribers: new Set([session.id]), claimants: new Set(), envManifests });
    if (key !== undefined) this.dedupe.set(key, lease.leaseId);
    return { leaseId: lease.leaseId, attached: false, attempt: none };
  }

  private async unsubscribe(session: Session, id: string): Promise<string> {
    const sub = this.subscriptions.get(id);
    if (sub === undefined || sub.repo !== session.alias || !sub.subscribers.has(session.id)) return 'unknown';
    if (sub.subscribers.size === 1 && sub.endedAt === undefined) {
      const lease = await this.dispatch.cancel(sub.repo, id);
      if (lease?.status === 'cancelled') { await this.finish(sub); this.publish(sub, variant('cancelled', { leaseId: id })); }
    }
    sub.subscribers.delete(session.id);
    if (sub.owner === session.id && sub.subscribers.size > 0) {
      await this.coordinator.run(sub.repo, id, () => {
        this.bridge.interrupt(sub.repo, id);
        sub.owner = sub.subscribers.values().next().value!;
        return Promise.resolve();
      });
    }
    return (await this.leases.get(sub.repo, id))?.status ?? 'unknown';
  }

  private async endSession(session: Session): Promise<void> {
    for (const sub of this.subscriptions.values()) if (sub.subscribers.has(session.id)) await this.unsubscribe(session, sub.id);
    // No lease of the session's runs again: every scope its leases named ends
    for (const [id, scope] of [...this.scopes]) if (scope.session === session.id) this.endScope(id);
    this.sessions.delete(session.id);
    this.idleSince = this.now();
    for (const wake of session.waiters) wake();
  }

  private async capacity(sessionId?: string): Promise<CapacitySnapshot> {
    const active: Readonly<RackLeaseRecord>[] = [];
    let pending = 0; let claimed = 0;
    for (const sub of this.subscriptions.values()) {
      if (sub.endedAt !== undefined) continue;
      // Read in place: a copy of every live lease on every poll reply would
      // cost the hub its time.
      const lease = this.backend.peek(sub.repo, sub.id);
      if (lease === null || !nonterminal(lease)) continue;
      active.push(lease);
      if (sessionId !== undefined && sub.subscribers.has(sessionId)) { if (lease.status === 'pending') pending++; else claimed++; }
    }
    const healthy = new Set((await this.dispatch.listHealthyRacks()).map((rack) => rack.rackId));
    const approval = (await this.registry.getRackSecurityPolicy())?.requireStartApproval ?? false;
    return { racks: (await this.registry.listRacks()).map((rack) => {
      const bundled = bundledE3Version(rack.agentVersion);
      const report = this.reports.get(rack.rackId);
      const problem = this.problems.get(rack.rackId);
      const held = active.filter((lease) => lease.claimedBy === rack.rackId && lease.status === 'claimed');
      // What is free is the less of what the rack last said and what this
      // hub's own leases leave of all it has: a rack's report lags a grant
      // by up to a heartbeat, and it may serve other sources too.
      const all = report?.resources;
      const free = all === undefined ? undefined : (() => {
        let { cores, memoryBytes, gpus } = all;
        for (const lease of held) {
          let needs: ReturnType<typeof readRackLeaseResources>;
          try { needs = readRackLeaseResources(lease.event.resources); } catch { needs = undefined; }
          if (needs === undefined) continue;
          cores -= needs.cores; memoryBytes -= leaseReserve(needs); if (needs.gpu) gpus -= 1;
        }
        const said = report?.free ?? all;
        const count = (ours: number, theirs: number) => BigInt(Math.max(0, Math.min(ours, theirs)));
        return { cores: count(cores, said.cores), memoryBytes: count(memoryBytes, said.memoryBytes), gpus: count(gpus, said.gpus) };
      })();
      return { rackId: rack.rackId, label: rack.label, tiers: rack.tiers, capacity: rack.capacity,
        busy: BigInt(held.length),
        healthy: healthy.has(rack.rackId), bundledE3: bundled === null ? none : some(bundled), pendingApproval: approval && bootPendingApproval(rack),
        reported: report !== undefined, features: [...(report?.features ?? [])], target: report?.target === undefined ? none : some(report.target),
        problem: problem === undefined ? none : some(problem),
        resources: all === undefined ? none : some({ cores: BigInt(all.cores), memoryBytes: BigInt(all.memoryBytes), gpus: BigInt(all.gpus) }),
        free: free === undefined ? none : some(free),
        // The tiers it composes environments over, whose manifest's text is
        // held: a session can ask for no other
        tierManifests: report?.features.includes(RACK_ENVIRONMENTS_OVER_TIER) !== true ? []
          : Object.entries(report.tiers ?? {}).filter(([, tier]) => this.tierManifests.has(tier.digest))
            .map(([tier, said]) => ({ tier, manifest: said.digest })).sort((a, b) => compareString(a.tier, b.tier)) };
    }), queued: BigInt(active.filter((lease) => lease.status === 'pending').length), mine: { pending: BigInt(pending), claimed: BigInt(claimed) } };
  }

  private controlApp(): Hono {
    const app = new Hono();
    app.onError((err, c) => c.text(messageOf(err), 500));
    app.post('/v1/hello', () => answer(HubHelloType, this.hello()));
    app.post('/v1/sessions', async (c) => {
      const registration = await decodeBody(c, OpenSessionType);
      return this.mutations.run(async () => {
        if (this.draining) return c.text('Rack hub is draining', 409);
        if (compareInteger(registration.protocol, BigInt(HUB_PROTOCOL)) !== 0) return c.text('Rack session protocol must match the hub exactly', 409);
        if (!isAbsolute(registration.repoPath) || !registration.dataSocket || registration.dataToken.length < 16 || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(registration.e3Version)) throw new Error('Invalid session registration');
        if (this.sessions.size >= 1024) throw new Error('Rack hub session limit reached');
        const owner = registration.owner;
        if (!await isProcessAlive(Number(owner.pid), Number(owner.pidStartTime), owner.bootId)) throw new Error('Rack session owner is not alive');
        const id = randomUUID();
        const alias = `r-${createHash('sha256').update(`${hostname()}\0${registration.repoPath}`).digest('hex').slice(0, 16)}`;
        this.sessions.set(id, { id, alias, registration, lastSeen: this.now(), dead: false, seq: 0n, events: [], waiters: new Set(), endedScopes: new Set() });
        this.idleSince = this.now();
        return answer(OpenSessionResultType, { sessionId: id, repoAlias: alias });
      });
    });
    app.delete('/v1/sessions/:id', (c) => this.mutations.run(async () => {
      const session = this.sessions.get(c.req.param('id'));
      if (session !== undefined) await this.endSession(session);
      return answer(EmptyType, {});
    }));
    app.post('/v1/sessions/:id/leases', async (c) => {
      const request = await decodeBody(c, CreateLeaseType);
      return this.mutations.run(async () => answer(CreateLeaseResultType, (await this.submit(this.session(c.req.param('id')), request, false))!));
    });
    // Attaches to identical work already queued or held, which costs the racks
    // no further capacity, and queues nothing otherwise: how a full fleet is
    // spilled without first offering it the work.
    app.post('/v1/sessions/:id/leases/attach', async (c) => {
      const request = await decodeBody(c, CreateLeaseType);
      return this.mutations.run(async () => {
        const attached = await this.submit(this.session(c.req.param('id')), request, true);
        return answer(AttachLeaseResultType, attached === null ? none : some(attached));
      });
    });
    app.post('/v1/sessions/:id/leases/:leaseId/cancel', (c) => this.mutations.run(async () => answer(CancelLeaseResultType, {
      status: await this.unsubscribe(this.session(c.req.param('id')), c.req.param('leaseId')),
    })));
    // The session's split task's execution ended: so does its scope. The
    // session's own scope ends with the session
    app.post('/v1/sessions/:id/scopes/end', async (c) => {
      const request = await decodeBody(c, EndScopeType);
      return this.mutations.run(() => {
        const session = this.session(c.req.param('id'));
        if (this.scopes.get(request.scope)?.session === session.id) this.endScope(request.scope);
        return Promise.resolve(answer(EmptyType, {}));
      });
    });
    app.post('/v1/sessions/:id/events', async (c) => {
      const session = this.session(c.req.param('id'));
      const request = await decodeBody(c, SessionPollType);
      if (compareInteger(request.after, 0n) < 0 || compareInteger(request.after, session.seq) > 0) throw new Error('Invalid rack event cursor');
      const oldest = session.events[0]?.seq;
      if (oldest !== undefined && compareInteger(request.after, oldest - 1n) < 0) throw new Error('Rack session event replay expired');
      session.lastSeen = this.now();
      session.events = session.events.filter((event) => compareInteger(event.seq, request.after) > 0);
      const wait = Math.min(20_000, Math.max(0, Number(request.waitMs)));
      if (session.events.length === 0 && wait > 0) await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); session.waiters.delete(done); c.req.raw.signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, wait); timer.unref();
        session.waiters.add(done); c.req.raw.signal.addEventListener('abort', done, { once: true });
        if (c.req.raw.signal.aborted) done();
      });
      this.session(session.id);
      session.lastSeen = this.now();
      return answer(SessionPollResultType, { events: [...session.events], capacity: await this.capacity(session.id) });
    });
    app.get('/v1/status', async () => answer(HubStatusType, { hello: this.hello(), rackListener: this.listener,
      racks: await this.registry.listRacks(), sessions: await Promise.all([...this.sessions.values()].map(async (session) => ({ sessionId: session.id, repoAlias: session.alias,
        workspace: session.registration.workspace, label: session.registration.label, e3Version: session.registration.e3Version,
        ...(await this.capacity(session.id)).mine }))), capacity: await this.capacity(), outcomes: [...this.outcomes] }));
    // The text of a tier image's manifest, as a rack that boots the tier
    // reported it: what a session builds an environment over
    app.post('/v1/tier-manifests', async (c) => {
      const text = this.tierManifests.get((await decodeBody(c, TierManifestRequestType)).digest);
      return answer(TierManifestResultType, text === undefined ? none : some(text));
    });
    // What a session's work would fetch from each rack the hub has served,
    // or its scope's leases wrote on: the link's rate, and which of its
    // objects the rack holds, served it whole or written there by a lease of
    // the work's scope
    app.post('/v1/sessions/:id/fetch-costs', async (c) => {
      const session = this.session(c.req.param('id'));
      const request = await decodeBody(c, FetchCostRequestType);
      const scope = request.scope.type === 'some' && this.scopes.get(request.scope.value)?.session === session.id ? request.scope.value : undefined;
      const racks = new Set([...this.meter.racks(), ...(scope === undefined ? [] : this.writes.writersOf(scope, request.hashes))]);
      return answer(FetchCostResultType, [...racks].map((rackId) => {
        const link = this.meter.link(rackId);
        return { rackId, bytesPerSecond: link.bytesPerSecond === null ? none : some(link.bytesPerSecond),
          held: request.hashes.map((hash) => link.holds(session.alias, hash) || (scope !== undefined && this.writes.writer(scope, hash) === rackId)) };
      }));
    });
    app.get('/v1/config', () => answer(HubConfigType, this.config));
    app.post('/v1/config', async (c) => {
      const config = await decodeBody(c, HubConfigType);
      return this.mutations.run(async () => {
        await saveHubConfig(config, this.home);
        const changed = !equalFor(HubConfigType)({ ...this.config, allow: config.allow, advertiseUrl: config.advertiseUrl, idleExitMinutes: config.idleExitMinutes }, config);
        this.config = config;
        // A listener that is not up binds again on any change: an --allow it
        // lacked, or a port that has since come free.
        if (changed || this.listener.type !== 'up') { await this.closeRack(); await this.bindRack(); }
        return answer(HubConfigType, this.config);
      });
    });
    // Whether a rack's boots after its first need approval before it is leased
    // work: e3 rack config --require-approval, and e3 rack approve.
    app.get('/v1/security', async () => answer(RackSecurityPolicyType, await this.registry.getRackSecurityPolicy() ?? { requireStartApproval: false }));
    app.post('/v1/security', async (c) => {
      const policy = await decodeBody(c, RackSecurityPolicyType);
      return this.mutations.run(async () => {
        await this.registry.putRackSecurityPolicy(policy);
        return answer(RackSecurityPolicyType, policy);
      });
    });
    app.post('/v1/enroll', async (c) => {
      const request = await decodeBody(c, HubEnrollType);
      if (this.listener.type !== 'up' || this.config.listen.type === 'none') throw new Error('Configure a reachable rack listener before enrollment');
      // A wildcard bind's origin names no address a rack could reach.
      if (this.config.advertiseUrl.type === 'none' && wildcardHost(this.config.listen.value.host)) {
        throw new Error('The rack listener binds every address; set --advertise-url to the origin the rack reaches');
      }
      const ttl = request.ttlMinutes.type === 'some' ? Number(request.ttlMinutes.value) : 15;
      if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 1440) throw new Error('Enrollment TTL must be 1–1440 minutes');
      const { token, tokenHash } = generateEnrollmentToken();
      const expiresAt = new Date(this.now() + ttl * 60000);
      await this.identity.putEnrollmentToken(tokenHash, expiresAt);
      return answer(HubEnrollResultType, { enrollmentToken: token, apiUrl: this.config.advertiseUrl.type === 'some' ? this.config.advertiseUrl.value : this.listener.value.origin,
        expiresAt, e3Version: E3_RACK_VERSION, certificateSha256: this.listener.value.certificateSha256 });
    });
    app.delete('/v1/racks/:id', (c) => this.mutations.run(async () => {
      const id = c.req.param('id');
      const removed = await this.coordinator.run('@rack', id, () => this.registry.deleteRack(id));
      await this.identity.deleteRackTokens(id);
      this.reports.delete(id);
      this.problems.delete(id);
      this.meter.forget(id);
      this.forgetTierManifests();
      // It is told nothing more, and holds no scope
      this.scopesEnded.delete(id);
      for (const scope of this.scopes.values()) scope.racks.delete(id);
      this.writes.forget(id);
      for (const sub of this.subscriptions.values()) {
        const lease = this.backend.peek(sub.repo, sub.id);
        if (lease?.status === 'claimed' && lease.claimedBy === id) await this.lose(sub, 'rack deregistered');
      }
      return answer(RemoveRackResultType, { removed });
    }));
    app.post('/v1/racks/:id/approve', async (c) => {
      const request = await decodeBody(c, ApproveRackType);
      return this.coordinator.run('@rack', c.req.param('id'), async () => {
        const rack = await this.registry.getRack(c.req.param('id'));
        if (rack === null) return c.notFound();
        if (rack.lastBootId.type !== 'some' || !equalString(rack.lastBootId.value, request.bootId)) return c.text('Rack rebooted; refresh before approving', 409);
        const approved = { ...rack, approvedBootId: some(request.bootId) };
        await this.registry.putRack(approved);
        return answer(RackRegistrationType, approved);
      });
    });
    app.post('/v1/drain', () => { this.draining = true; return answer(EmptyType, {}); });
    app.post('/v1/stop', () => {
      this.draining = true;
      setImmediate(() => { void this.stop().catch((err: unknown) => this.options.log?.(messageOf(err))); });
      return answer(EmptyType, {});
    });
    return app;
  }

  private async bindRack(): Promise<void> {
    if (this.stopping !== undefined || this.config.listen.type === 'none') { this.listener = variant('disabled', null); return; }
    const listen = this.config.listen.value;
    // A saved listener that may no longer be served stays down, with its
    // reason in the status, until e3 rack config changes it.
    const refused = listenerProblem(this.config);
    if (refused !== undefined) {
      this.listener = variant('down', { reason: refused });
      this.options.log?.(`rack listener refused: ${refused}`);
      return;
    }
    const app = new Hono();
    app.use('/api/rack/*', async (c, next) => {
      const address = normalizedAddress(getConnInfo(c).remote.address ?? '');
      if (this.config.allow.length > 0 && !this.config.allow.some((allowed) => equalString(normalizedAddress(allowed), address))) return c.text('Rack address is not allowed', 403);
      await this.bridge.origin.run(new URL(c.req.url).origin, next);
    });
    app.route('/', this.bridge.dataRoutes());
    app.route('/', createRackRoutes(this.identity, this.registry, this.leases, this.bridge, this.bridge.attempts, {
      coordinator: this.coordinator, now: this.now, signal: this.abort.signal, visibilityMs: this.options.visibilityMs,
      leaseWindowMs: this.options.leaseWindowMs,
      envIndex: this.envIndex, e3Version: E3_RACK_VERSION,
      // A session reads a call's value from the object its completion commits
      callValueObjects: true,
      // A session builds an environment over the tier image a rack reports
      tierManifests: true,
      // The hub reads each object's bytes from its session: a small one rides
      // the reply that asked for it, in place of a URL to be read in another
      // round trip of the rack's link
      inlineObjects: true,
      onLeaseSignal: (signal) => this.signal(signal),
      // A unit's lease carries its scope to a rack that keeps a scope's
      // outputs, which is told the scope's end with its next heartbeat
      splitScopes: { granted: (rackId, scope) => this.scopeGranted(rackId, scope), ended: (rackId) => this.scopesEndedFor(rackId) },
      // A heartbeat that was read is of this protocol: what was wrong is not.
      onReport: (rackId, report) => this.reported(rackId, report),
      // Said once in the log, and for as long as it holds in the status.
      onIncompatible: (rackId, named) => {
        const problem = `speaks ${named === undefined ? 'a rack protocol from before it was named' : `rack protocol ${named}`}, not ${RACK_PROTOCOL}; update the rack`;
        if (this.problems.get(rackId) !== problem) this.options.log?.(`rack ${rackId} refused: it ${problem}`);
        this.problems.set(rackId, problem);
      },
      // The queue is in memory: a poll looks well down it for work its rack's
      // offer holds. A rack that reports its resources could hold what they
      // hold; one that reports none, or has not reported to this hub yet,
      // holds whole tasks and no unit, which it would not cap.
      claimLookahead: 64,
      canEverHold: (rack, needs) => rackEverHolds(needs, this.reports.get(rack.rackId)?.resources),
      canClaim: async (rack, lease) => {
        const sub = this.subscriptions.get(lease.leaseId);
        if (sub === undefined || sub.endedAt !== undefined || sub.subscribers.size === 0) return false;
        // v2 completion does not carry an attempt id. A previous claimant
        // must never reclaim this lease: its delayed reply is ambiguous.
        if (sub.claimants.has(rack.rackId)) return false;
        if (!rack.healthy || this.now() - rack.lastSeenAt.getTime() > DEFAULT_HEALTHY_WINDOW_MS) return false;
        const bundled = bundledE3Version(rack.agentVersion);
        if (bundled === null || !agentVersionAtLeast(bundled, sub.version)) return false;
        // A unit of a split scope goes first to a rack that holds what the
        // scope's leases wrote, which it then reads there
        if (await this.waitsForHolder(rack.rackId, lease)) return false;
        // Work that declares an environment is a rack's that composes
        // environments, when its sessions keep the layers built for that
        // rack's platform: another rack is never granted it.
        if (lease.event.environment === undefined) return true;
        return await this.bridge.envManifestKeyOf(lease.repo, lease.leaseId, rack.rackId) !== null;
      },
    }));
    let server: Server | HttpsServer | undefined;
    try {
      let pin: string | undefined;
      let created: unknown;
      if (this.config.tls) {
        const tls = await loadHubCertificate(this.home);
        pin = certificateSha256(tls.certificatePem);
        created = createAdaptorServer({ fetch: app.fetch, createServer: createHttpsServer,
          serverOptions: { cert: tls.certificatePem, key: tls.privateKeyPem, requestTimeout: REQUEST_BODY_TIMEOUT_MS, keepAliveTimeout: RACK_LISTENER_IDLE_MS } });
      } else created = createAdaptorServer({ fetch: app.fetch, serverOptions: { requestTimeout: REQUEST_BODY_TIMEOUT_MS, keepAliveTimeout: RACK_LISTENER_IDLE_MS } });
      if (!(created instanceof Server) && !(created instanceof HttpsServer)) throw new Error('Rack listener requires HTTP/1');
      const listening = server = created;
      await new Promise<void>((resolve, reject) => {
        listening.once('error', reject);
        listening.listen(Number(listen.port), listen.host, () => { listening.off('error', reject); resolve(); });
      });
      this.rack = listening;
      const address = listening.address();
      if (address === null || typeof address === 'string') throw new Error('Rack listener has no network address');
      const host = listen.host.includes(':') ? `[${listen.host}]` : listen.host;
      this.listener = variant('up', { origin: `${pin === undefined ? 'http' : 'https'}://${host}:${address.port}`, certificateSha256: pin === undefined ? none : some(pin) });
    } catch (err) {
      server?.close();
      this.listener = variant('down', { reason: messageOf(err) });
      this.options.log?.(`rack listener unavailable: ${messageOf(err)}`);
      this.retry = setTimeout(() => { this.retry = undefined; void this.mutations.run(() => this.bindRack()).catch((error: unknown) => this.options.log?.(messageOf(error))); }, this.options.listenerRetryMs ?? 10000);
      this.retry.unref();
    }
  }

  private async closeRack(): Promise<void> {
    if (this.retry !== undefined) { clearTimeout(this.retry); this.retry = undefined; }
    if (this.rack !== undefined) { const server = this.rack; this.rack = undefined; await closeSocketServer(server); }
  }

  private async lose(sub: Subscription, reason: string): Promise<void> {
    const lease = await this.dispatch.supersede(sub.repo, sub.id);
    if (lease?.status === 'completed') return;
    await this.finish(sub);
    this.publish(sub, variant('lost', { leaseId: sub.id, reason }));
  }

  /** Sweeps dead sessions, lost attempts and expired replay; deterministic in tests. */
  async sweep(): Promise<void> {
    await this.mutations.run(async () => {
      if (this.stopping !== undefined) return;
      for (const session of this.sessions.values()) {
        const { owner } = session.registration;
        const alive = await isProcessAlive(Number(owner.pid), Number(owner.pidStartTime), owner.bootId);
        if (!alive || this.now() - session.lastSeen > 45000) {
          session.dead = !alive;
          await this.endSession(session);
        }
      }
      for (const sub of this.subscriptions.values()) {
        if (sub.endedAt !== undefined) {
          if (this.now() - sub.endedAt > 15 * 60000) { this.backend.forget(sub.repo, sub.id); this.subscriptions.delete(sub.id); }
        } else if (await this.dispatch.getLease(sub.repo, sub.id) === null) await this.lose(sub, 'lease lost on the rack');
      }
      const active = [...this.subscriptions.values()].some((sub) => sub.endedAt === undefined);
      if (this.sessions.size > 0 || active) this.idleSince = this.now();
      else {
        const idle = this.options.idleExitMinutes ?? (this.options.foreground ? 0 : Number(this.config.idleExitMinutes));
        if (this.draining || (idle > 0 && this.now() - this.idleSince >= idle * 60000)) {
          setImmediate(() => { void this.stop().catch((err: unknown) => this.options.log?.(messageOf(err))); });
        }
      }
    });
  }

  /** Cancels outstanding work, flushes state and releases the hub lock once. */
  stop(): Promise<void> {
    return this.stopping ??= (async () => {
      this.draining = true;
      this.abort.abort();
      if (this.sweeper !== undefined) clearInterval(this.sweeper);
      const failures: unknown[] = [];
      try {
        await this.mutations.run(async () => {
          for (const session of this.sessions.values()) {
            try { await this.endSession(session); } catch (error) { failures.push(error); }
          }
        });
        this.bridge?.close();
        const results = await Promise.allSettled([this.closeRack(), this.control === undefined ? Promise.resolve() : closeSocketServer(this.control, hubSocketPath(this.home)), this.registry?.flush()]);
        for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
      } finally {
        try { await this.lock?.release(); } finally { this.resolveClosed(); }
      }
      if (failures.length > 0) throw new AggregateError(failures, 'Rack hub shutdown failed');
    })();
  }
}

function messageOf(err: unknown): string { return err instanceof Error ? err.message : String(err); }
