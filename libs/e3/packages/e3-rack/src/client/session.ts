/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { randomBytes } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { IntegerType, compareFor, type ValueTypeOf } from '@elaraai/east';
import { processOwner, readTierManifest, tierManifestDigest, type SplitScope, type StorageBackend, type TierManifest } from '@elaraai/e3-core';
import { E3_RACK_VERSION, HUB_PROTOCOL } from '../version.js';
import { CreateLeaseResultType, HubAttemptType, type CapacitySnapshot, type CreateLease, type SessionEvent } from '../protocol/control.js';
import type { RackLeaseResult, RackLeaseScope } from '../protocol/task-envelope.js';
import { startSessionDataServer } from './session-data-server.js';
import { RackHubUnavailableError } from './connect.js';
import type { HubClient } from './hub-client.js';

/** Names the claim-time attempt; absent until an agent claims the lease. */
export type LeaseAttempt = ValueTypeOf<typeof HubAttemptType>;
/** Reports one lease transition after its repository effects have completed.
 *  A claim names the attempt it runs: a call's lease runs none. */
export type LeaseUpdate =
  | { kind: 'claimed'; rackId: string; rackLabel: string; attempt: LeaseAttempt | null }
  | { kind: 'completed'; result: RackLeaseResult; attempt: LeaseAttempt | null; at: Date }
  | { kind: 'lost'; reason: string }
  | { kind: 'cancelled' };
/** A task, unit or call lease requested through the current control protocol. */
export type LeaseRequest = CreateLease;
/** One subscriber's ordered view of shared work. */
export interface LeaseHandle {
  /** Queue identity shared by all subscribers of identical work. */
  readonly leaseId: string;
  /** Whether the hub attached this request to work already queued. */
  readonly attached: boolean;
  /** Latest claim-time identity, including a fresh identity after reclaim. */
  readonly attempt: LeaseAttempt | null;
  /** Resolves with the next transition; terminal updates remain repeatable. */
  next(): Promise<LeaseUpdate>;
  /** Leaves this subscription; other subscribers continue to own shared work. */
  cancel(): Promise<void>;
}

class Handle implements LeaseHandle {
  attempt: LeaseAttempt | null;
  private readonly queue: LeaseUpdate[] = [];
  private readonly waiters: Array<(update: LeaseUpdate) => void> = [];
  private terminal?: LeaseUpdate;
  private lastClaim?: string;
  private cancelling?: Promise<void>;
  constructor(readonly leaseId: string, readonly attached: boolean, attempt: LeaseAttempt | null, private readonly unsubscribe: (handle: Handle) => Promise<void>) { this.attempt = attempt; }
  push(update: LeaseUpdate): void {
    if (this.terminal !== undefined) return;
    if (update.kind === 'claimed') {
      // A claim is one attempt's, or, for a call's lease, which runs none, one
      // rack's: a rack never claims a lease again once it has held it.
      const claim = update.attempt?.executionId ?? update.rackId;
      if (this.lastClaim === claim) return;
      this.lastClaim = claim;
      this.attempt = update.attempt;
    }
    else this.terminal = update;
    const waiter = this.waiters.shift();
    if (waiter === undefined) this.queue.push(update); else waiter(update);
    if (this.terminal !== undefined) for (const waiting of this.waiters.splice(0)) waiting(this.terminal);
  }
  next(): Promise<LeaseUpdate> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.terminal !== undefined) return Promise.resolve(this.terminal);
    return new Promise((resolve) => { this.waiters.push(resolve); });
  }
  cancel(): Promise<void> { return this.cancelling ??= this.unsubscribe(this); }
}

/** Configures one run's attachment and repository data endpoint. */
export interface RackSessionOptions {
  /** Backend belonging to the run's e3 release. */
  storage: StorageBackend;
  /** Repository path; canonicalized before registration. */
  repoPath: string;
  /** Workspace shown in rack status. */
  workspace: string;
  /** Description shown in rack status, usually the command and PID. */
  label: string;
  /** The run's exact e3 release, defaulting to the package release. */
  e3Version?: string;
}

/** How long a session waits before telling the hub again of a scope's end it
 *  did not take, in ms: first, and at most, doubling between. */
const END_RETRY_MIN_MS = 250;
const END_RETRY_MAX_MS = 30_000;

// One listener for every open session of this process, however many runs an
// API server keeps attached: the sessions it closes as the process ends.
const openSessions = new Set<RackSession>();
const closeOpenSessions = () => { for (const session of openSessions) void session.close(); };

/**
 * Keeps a run attached to the hub and serves its repository through a private
 * socket. A lost hub ends every pending wait; this session never reconnects
 * to a replacement whose in-memory leases cannot be the old ones.
 * @example
 * const session = await RackSession.open(client, { storage, repoPath, workspace: 'dev', label: 'run dev' });
 * try { const lease = await session.createLease(request); await lease.next(); }
 * finally { await session.close(); }
 */
export class RackSession {
  private lost = false;
  private closing?: Promise<void>;
  private readonly abort = new AbortController();
  private readonly handles = new Map<string, Set<Handle>>();
  private readonly early = new Map<string, LeaseUpdate[]>();
  private creating = 0;
  private snapshot: CapacitySnapshot = { racks: [], queued: 0n, mine: { pending: 0n, claimed: 0n } };
  private readonly tee = new Map<string, Set<(stream: 'stdout' | 'stderr', data: string) => void>>();
  private loop?: Promise<void>;
  /** The tier manifests asked of the hub, by digest: each asked once */
  private readonly tiers = new Map<string, Promise<TierManifest | null>>();
  /** The refresh in flight, which the callers that ask meanwhile share */
  private refreshing?: Promise<CapacitySnapshot>;
  /** When the last refresh was answered, by this process's clock */
  private refreshedAt = -Infinity;
  /** The split scopes the session's leases named that have not ended: each
   *  one's end is told to the hub once */
  private readonly scopes = new Set<string>();
  /** The split scopes that ended which the hub has not yet been told of, in
   *  the order they ended */
  private readonly endsPending = new Set<string>();
  /** The telling in flight, which ends that come meanwhile join */
  private ending?: Promise<void>;
  /** The wait before the hub is asked again, once it did not take an end, in
   *  ms; and the timer that asks it */
  private endRetryMs = END_RETRY_MIN_MS;
  private endRetry?: NodeJS.Timeout;

  private constructor(private readonly client: HubClient, readonly sessionId: string, readonly repoAlias: string,
    /** The e3 release the session's work is built with, which its leases name. */
    readonly e3Version: string,
    private readonly data: Awaited<ReturnType<typeof startSessionDataServer>>) {}

  /**
   * Starts a private data server, registers the live process and starts polling.
   * @param client - A connected, compatible hub
   * @param options - Repository backend, workspace, label and exact release
   * @returns The live session
   * @throws {Error} On registration failure, after removing the data socket
   */
  static async open(client: HubClient, options: RackSessionOptions): Promise<RackSession> {
    const dataToken = randomBytes(32).toString('hex');
    let session: RackSession | undefined;
    const data = await startSessionDataServer({ storage: options.storage, repoPath: await realpath(options.repoPath), home: client.home, dataToken,
      onLog: (id, stream, text) => { for (const sink of session?.tee.get(id) ?? []) sink(stream, text); } });
    try {
      const e3Version = options.e3Version ?? E3_RACK_VERSION;
      const opened = await client.openSession({ protocol: BigInt(HUB_PROTOCOL), e3Version,
        owner: await processOwner(), repoPath: await realpath(options.repoPath), workspace: options.workspace, label: options.label,
        dataSocket: data.socketPath, dataToken });
      session = new RackSession(client, opened.sessionId, opened.repoAlias, e3Version, data);
      const initial = await client.events(opened.sessionId, 0n, 0);
      session.snapshot = initial.capacity;
      session.loop = session.poll();
      if (openSessions.size === 0) process.on('beforeExit', closeOpenSessions);
      openSessions.add(session);
      return session;
    } catch (err) {
      if (session !== undefined) await client.closeSession(session.sessionId).catch(() => {});
      await data.close(); throw err;
    }
  }

  /** Whether the original hub has been lost; later creates refuse immediately. */
  get hubLost(): boolean { return this.lost; }
  /** Returns the latest capacity snapshot without a network round trip. */
  capacity(): CapacitySnapshot { return this.snapshot; }

  /**
   * Refreshes fleet capacity without disturbing the ordered event cursor.
   *
   * @remarks
   * Callers that ask while a refresh is in flight share it, and one that
   * accepts a snapshot of some age is given the last when it is no older: so
   * a stage's units that wait for a rack together ask the hub once between
   * them, not once each.
   *
   * @param maxAgeMs - The oldest refresh the caller accepts in place of a new
   *   one, in ms; none unless given
   * @returns The latest capacity snapshot
   * @throws {RackHubError} When the hub does not answer its status
   */
  refreshCapacity(maxAgeMs = 0): Promise<CapacitySnapshot> {
    if (this.lost || this.closing !== undefined) return Promise.resolve(this.snapshot);
    if (performance.now() - this.refreshedAt < maxAgeMs) return Promise.resolve(this.snapshot);
    return this.refreshing ??= (async () => {
      try {
        const status = await this.client.status();
        this.snapshot = { ...status.capacity, mine: this.snapshot.mine };
        this.refreshedAt = performance.now();
        return this.snapshot;
      } finally {
        this.refreshing = undefined;
      }
    })();
  }

  /**
   * The manifest of a tier image a rack boots environments over, by the
   * digest the rack's snapshot names: what an environment is built over.
   *
   * @remarks
   * The hub answers the text a rack reported, which is checked here against
   * the digest and read as a manifest. One the hub cannot give, or that is
   * not the manifest its digest names, answers null, and the environment is
   * built whole. A manifest is asked for once in a session; one that could
   * not be had is asked for again.
   *
   * @param digest - The manifest's digest, `sha256:<hex>`
   * @returns The manifest, or null
   */
  tierManifest(digest: string): Promise<TierManifest | null> {
    let asked = this.tiers.get(digest);
    if (asked === undefined) {
      asked = (async () => {
        if (this.lost || this.closing !== undefined) return null;
        try {
          const text = await this.client.tierManifest(digest);
          if (text === null) return null;
          const bytes = new TextEncoder().encode(text);
          return tierManifestDigest(bytes) === digest ? readTierManifest(bytes) : null;
        } catch {
          return null;
        }
      })();
      this.tiers.set(digest, asked);
      void asked.then((manifest) => { if (manifest === null) this.tiers.delete(digest); });
    }
    return asked;
  }

  /**
   * The scope a unit's lease names: the split task's execution it runs in,
   * and whether it feeds a later unit (`RackLeaseEvent.scope`).
   *
   * @remarks
   * The hub grants the lease with it to a rack that keeps what a scope's
   * leases wrote for its later ones. The execution's end is told to the hub
   * as it ends, and again until the hub has taken it ({@link tellEnds}), and
   * the hub tells each rack it granted a lease of the scope; a session that
   * closes ends every scope its leases named.
   *
   * @param scope - The execution the unit runs in, as e3-core gives it
   * @returns The lease's scope; none once the execution has ended, or the
   *   session has
   * @example
   * ```ts
   * const scope = request.options.splitScope === undefined ? undefined : session.scope(request.options.splitScope);
   * ```
   */
  scope(scope: SplitScope): RackLeaseScope | undefined {
    if (scope.ended.aborted || this.lost || this.closing !== undefined) return undefined;
    if (!this.scopes.has(scope.id)) {
      this.scopes.add(scope.id);
      scope.ended.addEventListener('abort', () => {
        this.scopes.delete(scope.id);
        // A session that closes ends every scope its leases named
        if (this.lost || this.closing !== undefined) return;
        this.endsPending.add(scope.id);
        void this.tellEnds();
      }, { once: true });
    }
    return { id: scope.id, feeds: scope.feeds };
  }

  /**
   * Tells the hub of the split scopes that ended, oldest first, until it has
   * taken each: an end it does not take is told again after a wait that
   * doubles from {@link END_RETRY_MIN_MS} to {@link END_RETRY_MAX_MS}, and as
   * the session's next poll is answered, so a scope a hub did not hear the
   * end of is not kept open, and counted among the session's, until the
   * session ends. Ends that come while it tells join it. A session that is
   * closed, or lost its hub, tells nothing more: the hub ends its scopes.
   *
   * @returns Once every end pending is told, or one was not taken
   */
  private tellEnds(): Promise<void> {
    return this.ending ??= (async () => {
      try {
        for (const id of this.endsPending) {
          if (this.lost || this.closing !== undefined) return;
          try {
            await this.client.endScope(this.sessionId, id);
          } catch {
            if (this.endRetry === undefined && !this.lost && this.closing === undefined) {
              this.endRetry = setTimeout(() => { this.endRetry = undefined; void this.tellEnds(); }, this.endRetryMs);
              this.endRetry.unref();
              this.endRetryMs = Math.min(END_RETRY_MAX_MS, 2 * this.endRetryMs);
            }
            return;
          }
          this.endsPending.delete(id);
          this.endRetryMs = END_RETRY_MIN_MS;
        }
      } finally {
        this.ending = undefined;
      }
    })();
  }

  /**
   * Submits work or attaches to an existing lease, handling events that race
   * the create response. Attempt identity is assigned at claim, never locally.
   * @param request - Current task/unit event and rack shape
   * @returns An ordered subscription to the lease
   */
  async createLease(request: LeaseRequest): Promise<LeaseHandle> {
    return (await this.subscribe((sessionId) => this.client.createLease(sessionId, request)))!;
  }

  /**
   * Attaches to identical work already queued or held, which costs the racks
   * no further capacity, and queues nothing otherwise: how a run spills work
   * locally when the racks are full, without first offering it to them.
   * @param request - Current task/unit event and rack shape
   * @returns An ordered subscription, or null when no such work is queued
   */
  attachLease(request: LeaseRequest): Promise<LeaseHandle | null> {
    return this.subscribe(async (sessionId) => {
      const attached = await this.client.attachLease(sessionId, request);
      return attached.type === 'some' ? attached.value : null;
    });
  }

  private async subscribe(ask: (sessionId: string) => Promise<ValueTypeOf<typeof CreateLeaseResultType> | null>): Promise<Handle | null> {
    if (this.lost || this.closing !== undefined) throw new RackHubUnavailableError('Rack session is closed or its hub is unreachable');
    this.creating++;
    try {
      const created = await ask(this.sessionId);
      if (created === null) return null;
      const handle = new Handle(created.leaseId, created.attached, created.attempt.type === 'some' ? created.attempt.value : null, (handle) => this.unsubscribe(handle));
      const handles = this.handles.get(created.leaseId) ?? new Set();
      handles.add(handle); this.handles.set(created.leaseId, handles);
      for (const update of this.early.get(created.leaseId) ?? []) handle.push(update);
      if (this.lost || this.closing !== undefined) handle.push({ kind: 'lost', reason: 'rack hub unreachable' });
      return handle;
    } finally {
      this.creating--;
      if (this.creating === 0) this.early.clear();
    }
  }

  private async unsubscribe(handle: Handle): Promise<void> {
    const handles = this.handles.get(handle.leaseId);
    if (handles === undefined || !handles.has(handle)) return;
    if (handles.size > 1) { handles.delete(handle); handle.push({ kind: 'cancelled' }); return; }
    try {
      if (!this.lost && this.closing === undefined) {
        const response = await this.client.cancelLease(this.sessionId, handle.leaseId);
        // Completion won the hub's fence. Its event remains authoritative and
        // may still be in the events response racing this cancellation reply.
        if (response.status === 'completed') return;
      }
      handle.push(this.lost ? { kind: 'lost', reason: 'rack hub unreachable' } : { kind: 'cancelled' });
      handles.delete(handle);
      if (handles.size === 0) this.handles.delete(handle.leaseId);
    } finally {
      // A completed handle can still receive the in-flight completion event.
      if (this.lost || this.closing !== undefined) this.handles.delete(handle.leaseId);
    }
  }

  /** Registers a live log tee; persistence remains the data server's job. */
  onLog(executionId: string, sink: (stream: 'stdout' | 'stderr', data: string) => void): () => void {
    const sinks = this.tee.get(executionId) ?? new Set(); sinks.add(sink); this.tee.set(executionId, sinks);
    return () => { sinks.delete(sink); if (sinks.size === 0) this.tee.delete(executionId); };
  }

  private update(event: SessionEvent['event']): LeaseUpdate {
    switch (event.type) {
      case 'claimed': return { kind: 'claimed', rackId: event.value.rackId, rackLabel: event.value.rackLabel,
        attempt: event.value.attempt.type === 'some' ? event.value.attempt.value : null };
      case 'completed': return { kind: 'completed', result: JSON.parse(event.value.resultJson) as RackLeaseResult,
        attempt: event.value.attempt.type === 'some' ? event.value.attempt.value : null, at: event.value.at };
      case 'lost': return { kind: 'lost', reason: event.value.reason };
      case 'cancelled': return { kind: 'cancelled' };
    }
  }

  private async poll(): Promise<void> {
    let after = 0n;
    let failures = 0;
    while (!this.abort.signal.aborted && !this.lost) {
      try {
        const response = await this.client.events(this.sessionId, after, 20000, this.abort.signal);
        failures = 0; this.snapshot = response.capacity;
        // The hub answers: what it did not take of the scopes' ends is told again
        if (this.endsPending.size > 0) void this.tellEnds();
        for (const event of response.events) {
          if (compareFor(IntegerType)(event.seq, after) <= 0) continue;
          after = event.seq;
          const update = this.update(event.event);
          const id = event.event.value.leaseId;
          const handles = this.handles.get(id);
          if (handles !== undefined) for (const handle of handles) handle.push(update);
          if (update.kind !== 'claimed') this.handles.delete(id);
          if (this.creating > 0) {
            const early = this.early.get(id) ?? []; early.push(update); this.early.set(id, early);
          }
        }
      } catch {
        if (this.abort.signal.aborted) break;
        if (++failures >= 2) {
          this.lost = true;
          this.snapshot = { racks: [], queued: 0n, mine: { pending: 0n, claimed: 0n } };
          for (const handles of this.handles.values()) for (const handle of handles) handle.push({ kind: 'lost', reason: 'rack hub unreachable' });
          break;
        }
        await delay(100, undefined, { signal: this.abort.signal }).catch(() => {});
      }
    }
  }

  /** Unregisters first, stops polling and removes the private data endpoint once. */
  close(): Promise<void> {
    return this.closing ??= (async () => {
      openSessions.delete(this);
      if (openSessions.size === 0) process.off('beforeExit', closeOpenSessions);
      // Its end ends every scope its leases named: none is told again
      if (this.endRetry !== undefined) clearTimeout(this.endRetry);
      this.endsPending.clear();
      await this.client.closeSession(this.sessionId).catch(() => {});
      this.abort.abort();
      await this.loop;
      for (const handles of this.handles.values()) for (const handle of handles) handle.push({ kind: 'cancelled' });
      this.handles.clear(); this.early.clear(); this.tee.clear();
      await this.data.close();
    })();
  }
}
