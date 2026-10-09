/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { createHash, randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { Server } from 'node:http';
import { hostname } from 'node:os';
import { isAbsolute } from 'node:path';
import { Hono } from 'hono';
import { createAdaptorServer } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { IntegerType, StringType, compareFor, equalFor, none, some, variant, type ValueTypeOf } from '@elaraai/east';
import { inputsHash, isObjectHash, isProcessAlive } from '@elaraai/e3-core';
import { decodeBody, sendSuccess } from '@elaraai/e3-api-server/beast2';
import { FileMachineIdentityStore } from '../identity/file-identity-store.js';
import { generateEnrollmentToken } from '../identity/machine-identity.js';
import { FileRackRegistry } from '../registry/file-rack-registry.js';
import { InMemoryRackLeaseStore } from '../lease/in-memory-lease-store.js';
import type { RackLeaseRecord } from '../lease/lease-store.js';
import { StoreRackDispatch, bootPendingApproval, bundledE3Version, agentVersionAtLeast, DEFAULT_HEALTHY_WINDOW_MS } from '../server/dispatch.js';
import { createRackRoutes, type RackLeaseSignal } from '../server/rack-routes.js';
import { RackRegistrationType } from '../protocol/registration.js';
import { isLeaseEventV2, leaseInputs, leaseTaskHash, type RackLeaseEvent } from '../protocol/task-envelope.js';
import { decodeRunnerEvent } from '../runner-event.js';
import { ApproveRackType, CancelLeaseResultType, CreateLeaseResultType, CreateLeaseType, EmptyType, HubConfigType,
  HubEnrollResultType, HubEnrollType, HubHelloType, HubStatusType, OpenSessionResultType, OpenSessionType,
  RemoveRackResultType, SessionPollResultType, SessionPollType, type CapacitySnapshot, type OpenSession, type SessionEvent } from '../protocol/control.js';
import { closeSocketServer, RackHubError, serveOnSocket } from '../client/local-http.js';
import { rackHome, hubSocketPath } from '../paths.js';
import { E3_RACK_VERSION, HUB_PROTOCOL } from '../version.js';
import { MutationQueue } from '../state-file.js';
import { loadHubConfig, saveHubConfig, type HubConfig } from './config.js';
import { acquireHubLock, type HeldHubLock } from './lock.js';
import { FairLeaseStore } from './fair-lease-store.js';
import { SessionLeaseCoordinator, SessionProxyStorageBridge, type SessionEndpoint } from './session-bridge.js';

interface Session {
  id: string;
  alias: string;
  registration: OpenSession;
  lastSeen: number;
  dead: boolean;
  seq: bigint;
  events: SessionEvent[];
  waiters: Set<() => void>;
}
interface Subscription {
  repo: string;
  id: string;
  key: string;
  version: string;
  owner: string;
  subscribers: Set<string>;
  claimants: Set<string>;
  endedAt?: number;
}
const equalString = equalFor(StringType);
const compareInteger = compareFor(IntegerType);
const nonterminal = (lease: RackLeaseRecord) => lease.status === 'pending' || lease.status === 'claimed';
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
  /** Test tuning; production retries a failed listener every ten seconds. */
  listenerRetryMs?: number;
  /** Test tuning; production sweeps every five seconds. */
  sweepMs?: number;
}

/**
 * Hosts one user's rack queue, fleet and repository-owning sessions.
 * The hub interprets the rack/control protocol only. A live session of the
 * same repository and exact e3 release performs every repository operation.
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
  private dispatch!: StoreRackDispatch;
  private control?: Server;
  private rack?: Server;
  private listener: ValueTypeOf<typeof HubStatusType>['rackListener'] = variant('disabled', null);
  private retry?: NodeJS.Timeout;
  private sweeper?: NodeJS.Timeout;
  private stopping?: Promise<void>;
  private draining = false;
  private idleSince: number;

  /** @param options - State home, idle policy, diagnostics and lifecycle clocks */
  constructor(private readonly options: RackHubOptions = {}) {
    this.home = options.home ?? rackHome();
    this.now = options.now ?? Date.now;
    this.idleSince = this.now();
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
        advertiseOrigin: () => this.config.advertiseUrl.type === 'some' ? this.config.advertiseUrl.value : undefined });
      this.dispatch = new StoreRackDispatch(this.leases, this.registry, { coordinator: this.coordinator, now: this.now,
        visibilityMs: this.options.visibilityMs, endings: { stopped: this.bridge.attempts.stopped, writes: this.bridge } });
      const socket = hubSocketPath(this.home);
      if (process.platform !== 'win32') await unlink(socket).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; });
      this.control = await serveOnSocket(this.controlApp(), socket);
      await this.bindRack();
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

  private async claimedEvent(lease: RackLeaseRecord): Promise<SessionEvent['event']> {
    if (lease.attempt === undefined || lease.claimedBy === undefined) throw new Error('Claim has no attempt');
    const rack = await this.registry.getRack(lease.claimedBy);
    return variant('claimed', { leaseId: lease.leaseId, rackId: lease.claimedBy, rackLabel: rack?.label ?? lease.claimedBy,
      attempt: { executionId: lease.attempt.executionId, startedAt: new Date(lease.attempt.startedAtMs) } });
  }

  private async finish(sub: Subscription): Promise<void> {
    sub.endedAt ??= this.now();
    if (this.dedupe.get(sub.key) === sub.id) this.dedupe.delete(sub.key);
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
      if (event.type === 'claimed') {
        await this.bridge.attempts.logs.append(lease.repo, lease.taskHash, lease.inputsHash, lease.attempt!.executionId,
          'stdout', `e3: running on rack ${event.value.rackLabel} (lease ${lease.leaseId})\n`);
        await this.bridge.attempts.logs.flush?.(lease.repo, lease.taskHash, lease.inputsHash, lease.attempt!.executionId);
      }
      this.publish(sub, event);
    } else if (signal.kind === 'completed' && signal.disposition === 'recorded') {
      await this.finish(sub);
      this.publish(sub, variant('completed', { leaseId: lease.leaseId,
        attempt: lease.attempt === undefined ? none : some({ executionId: lease.attempt.executionId, startedAt: new Date(lease.attempt.startedAtMs) }),
        resultJson: JSON.stringify(lease.result), at: new Date(lease.completedAtMs!) }));
    }
  }

  private async submit(session: Session, request: ValueTypeOf<typeof CreateLeaseType>): Promise<ValueTypeOf<typeof CreateLeaseResultType>> {
    if (this.draining) throw new RackHubError('draining', 'Rack hub is draining');
    const value: unknown = JSON.parse(request.eventJson);
    if (!isLeaseEventV2(value)) throw new Error('Expected a v2 rack lease');
    const runner = decodeRunnerEvent(value.runnerEvent);
    if (runner.mode !== 'task' && runner.mode !== 'unit') throw new Error('Local rack delegation supports tasks and units only');
    if (value.environment !== undefined) throw new Error('Local rack environments are not supported');
    if (!['node', 'py', 'py-datascience', 'c', 'full'].includes(request.tier) || !['serverless', 'small', 'medium', 'large', 'xlarge'].includes(request.computeSize)) throw new Error('Invalid rack tier or compute size');
    const closure = value.closure;
    if ('hashes' in closure) {
      if (!Array.isArray(closure.hashes) || closure.hashes.length > 512 || !closure.hashes.every((hash) => typeof hash === 'string' && isObjectHash(hash))) throw new Error('Invalid inline closure');
    } else if (!isObjectHash(closure.object) || !Number.isSafeInteger(closure.count) || closure.count < 0) throw new Error('Invalid closure object');
    const event: RackLeaseEvent = { ...value, runnerEvent: { ...runner, repo: session.alias },
      workspace: session.registration.workspace, e3Version: session.registration.e3Version };
    const key = JSON.stringify([session.alias, leaseTaskHash(event), inputsHash(leaseInputs(event)), session.registration.e3Version]);
    const existingId = this.dedupe.get(key);
    const existing = existingId === undefined ? null : await this.leases.get(session.alias, existingId);
    if (existing !== null && nonterminal(existing)) {
      const sub = this.subscriptions.get(existing.leaseId)!;
      sub.subscribers.add(session.id);
      if (existing.status === 'claimed') this.emit(session, await this.claimedEvent(existing));
      return { leaseId: existing.leaseId, attached: true,
        attempt: existing.attempt === undefined ? none : some({ executionId: existing.attempt.executionId, startedAt: new Date(existing.attempt.startedAtMs) }) };
    }
    if (this.subscriptions.size >= 16384) throw new RackHubError('capacity', 'Rack hub queue is full');
    const lease = await this.dispatch.createLease(event, request.tier, request.computeSize);
    this.subscriptions.set(lease.leaseId, { repo: session.alias, id: lease.leaseId, key, version: session.registration.e3Version, owner: session.id, subscribers: new Set([session.id]), claimants: new Set() });
    this.dedupe.set(key, lease.leaseId);
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
    this.sessions.delete(session.id);
    this.idleSince = this.now();
    for (const wake of session.waiters) wake();
  }

  private async capacity(sessionId?: string): Promise<CapacitySnapshot> {
    const active: RackLeaseRecord[] = [];
    let pending = 0; let claimed = 0;
    for (const sub of this.subscriptions.values()) {
      if (sub.endedAt !== undefined) continue;
      const lease = await this.leases.get(sub.repo, sub.id);
      if (lease === null || !nonterminal(lease)) continue;
      active.push(lease);
      if (sessionId !== undefined && sub.subscribers.has(sessionId)) { if (lease.status === 'pending') pending++; else claimed++; }
    }
    const healthy = new Set((await this.dispatch.listHealthyRacks()).map((rack) => rack.rackId));
    const approval = (await this.registry.getRackSecurityPolicy())?.requireStartApproval ?? false;
    return { racks: (await this.registry.listRacks()).map((rack) => {
      const bundled = bundledE3Version(rack.agentVersion);
      return { rackId: rack.rackId, label: rack.label, tiers: rack.tiers, capacity: rack.capacity,
        busy: BigInt(active.filter((lease) => lease.claimedBy === rack.rackId && lease.status === 'claimed').length),
        healthy: healthy.has(rack.rackId), bundledE3: bundled === null ? none : some(bundled), pendingApproval: approval && bootPendingApproval(rack) };
    }), queued: BigInt(active.filter((lease) => lease.status === 'pending').length), mine: { pending: BigInt(pending), claimed: BigInt(claimed) } };
  }

  private controlApp(): Hono {
    const app = new Hono();
    app.onError((err, c) => c.text(messageOf(err), 500));
    app.post('/v1/hello', () => sendSuccess(HubHelloType, this.hello()));
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
        this.sessions.set(id, { id, alias, registration, lastSeen: this.now(), dead: false, seq: 0n, events: [], waiters: new Set() });
        this.idleSince = this.now();
        return sendSuccess(OpenSessionResultType, { sessionId: id, repoAlias: alias });
      });
    });
    app.delete('/v1/sessions/:id', (c) => this.mutations.run(async () => {
      const session = this.sessions.get(c.req.param('id'));
      if (session !== undefined) await this.endSession(session);
      return sendSuccess(EmptyType, {});
    }));
    app.post('/v1/sessions/:id/leases', async (c) => {
      const request = await decodeBody(c, CreateLeaseType);
      return this.mutations.run(async () => sendSuccess(CreateLeaseResultType, await this.submit(this.session(c.req.param('id')), request)));
    });
    app.post('/v1/sessions/:id/leases/:leaseId/cancel', (c) => this.mutations.run(async () => sendSuccess(CancelLeaseResultType, {
      status: await this.unsubscribe(this.session(c.req.param('id')), c.req.param('leaseId')),
    })));
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
      return sendSuccess(SessionPollResultType, { events: [...session.events], capacity: await this.capacity(session.id) });
    });
    app.get('/v1/status', async () => sendSuccess(HubStatusType, { hello: this.hello(), rackListener: this.listener,
      racks: await this.registry.listRacks(), sessions: await Promise.all([...this.sessions.values()].map(async (session) => ({ sessionId: session.id, repoAlias: session.alias,
        workspace: session.registration.workspace, label: session.registration.label, e3Version: session.registration.e3Version,
        ...(await this.capacity(session.id)).mine }))), capacity: await this.capacity() }));
    app.get('/v1/config', () => sendSuccess(HubConfigType, this.config));
    app.post('/v1/config', async (c) => {
      const config = await decodeBody(c, HubConfigType);
      return this.mutations.run(async () => {
        await saveHubConfig(config, this.home);
        const changed = !equalFor(HubConfigType)({ ...this.config, allow: config.allow, advertiseUrl: config.advertiseUrl, idleExitMinutes: config.idleExitMinutes }, config);
        this.config = config;
        if (changed) { await this.closeRack(); await this.bindRack(); }
        return sendSuccess(HubConfigType, this.config);
      });
    });
    app.post('/v1/enroll', async (c) => {
      const request = await decodeBody(c, HubEnrollType);
      if (this.listener.type !== 'up') throw new Error('Configure a reachable rack listener before enrollment');
      const ttl = request.ttlMinutes.type === 'some' ? Number(request.ttlMinutes.value) : 15;
      if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 1440) throw new Error('Enrollment TTL must be 1–1440 minutes');
      const { token, tokenHash } = generateEnrollmentToken();
      const expiresAt = new Date(this.now() + ttl * 60000);
      await this.identity.putEnrollmentToken(tokenHash, expiresAt);
      return sendSuccess(HubEnrollResultType, { enrollmentToken: token, apiUrl: this.config.advertiseUrl.type === 'some' ? this.config.advertiseUrl.value : this.listener.value.origin, expiresAt, e3Version: E3_RACK_VERSION });
    });
    app.delete('/v1/racks/:id', (c) => this.mutations.run(async () => {
      const id = c.req.param('id');
      const removed = await this.coordinator.run('@rack', id, () => this.registry.deleteRack(id));
      await this.identity.deleteRackTokens(id);
      for (const sub of this.subscriptions.values()) {
        const lease = await this.leases.get(sub.repo, sub.id);
        if (lease?.status === 'claimed' && lease.claimedBy === id) await this.lose(sub, 'rack deregistered');
      }
      return sendSuccess(RemoveRackResultType, { removed });
    }));
    app.post('/v1/racks/:id/approve', async (c) => {
      const request = await decodeBody(c, ApproveRackType);
      return this.coordinator.run('@rack', c.req.param('id'), async () => {
        const rack = await this.registry.getRack(c.req.param('id'));
        if (rack === null) return c.notFound();
        if (rack.lastBootId.type !== 'some' || !equalString(rack.lastBootId.value, request.bootId)) return c.text('Rack rebooted; refresh before approving', 409);
        const approved = { ...rack, approvedBootId: some(request.bootId) };
        await this.registry.putRack(approved);
        return sendSuccess(RackRegistrationType, approved);
      });
    });
    app.post('/v1/drain', () => { this.draining = true; return sendSuccess(EmptyType, {}); });
    app.post('/v1/stop', () => {
      this.draining = true;
      setImmediate(() => { void this.stop().catch((err: unknown) => this.options.log?.(messageOf(err))); });
      return sendSuccess(EmptyType, {});
    });
    return app;
  }

  private async bindRack(): Promise<void> {
    if (this.stopping !== undefined || this.config.listen.type === 'none') { this.listener = variant('disabled', null); return; }
    const listen = this.config.listen.value;
    const app = new Hono();
    app.use('/api/rack/*', async (c, next) => {
      const address = normalizedAddress(getConnInfo(c).remote.address ?? '');
      if (this.config.allow.length > 0 && !this.config.allow.some((allowed) => normalizedAddress(allowed) === address)) return c.text('Rack address is not allowed', 403);
      await this.bridge.origin.run(new URL(c.req.url).origin, next);
    });
    app.route('/', this.bridge.dataRoutes());
    app.route('/', createRackRoutes(this.identity, this.registry, this.leases, this.bridge, this.bridge.attempts, {
      coordinator: this.coordinator, now: this.now, signal: this.abort.signal, visibilityMs: this.options.visibilityMs,
      onLeaseSignal: (signal) => this.signal(signal),
      canClaim: (rack, lease) => {
        const sub = this.subscriptions.get(lease.leaseId);
        if (sub === undefined || sub.endedAt !== undefined || sub.subscribers.size === 0) return false;
        // v2 completion does not carry an attempt id. A previous claimant
        // must never reclaim this lease: its delayed reply is ambiguous.
        if (sub.claimants.has(rack.rackId)) return false;
        if (!rack.healthy || this.now() - rack.lastSeenAt.getTime() > DEFAULT_HEALTHY_WINDOW_MS) return false;
        const bundled = bundledE3Version(rack.agentVersion);
        return bundled !== null && agentVersionAtLeast(bundled, sub.version);
      },
    }));
    const server = createAdaptorServer({ fetch: app.fetch });
    if (!(server instanceof Server)) throw new Error('Rack listener requires HTTP/1');
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(Number(listen.port), listen.host, () => { server.off('error', reject); resolve(); });
      });
      this.rack = server;
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('Rack listener has no network address');
      const host = listen.host.includes(':') ? `[${listen.host}]` : listen.host;
      this.listener = variant('up', { origin: `http://${host}:${address.port}` });
    } catch (err) {
      server.close();
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
