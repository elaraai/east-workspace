/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { randomBytes } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { IntegerType, compareFor, type ValueTypeOf } from '@elaraai/east';
import { processOwner, type StorageBackend } from '@elaraai/e3-core';
import { E3_RACK_VERSION, HUB_PROTOCOL } from '../version.js';
import { HubAttemptType, type CapacitySnapshot, type CreateLease, type SessionEvent } from '../protocol/control.js';
import type { RackLeaseResult } from '../protocol/task-envelope.js';
import { startSessionDataServer } from './session-data-server.js';
import { RackHubUnavailableError } from './connect.js';
import type { HubClient } from './hub-client.js';

/** Names the claim-time attempt; absent until an agent claims the lease. */
export type LeaseAttempt = ValueTypeOf<typeof HubAttemptType>;
/** Reports one lease transition after its repository effects have completed. */
export type LeaseUpdate =
  | { kind: 'claimed'; rackId: string; rackLabel: string; attempt: LeaseAttempt }
  | { kind: 'completed'; result: RackLeaseResult; attempt: LeaseAttempt | null; at: Date }
  | { kind: 'lost'; reason: string }
  | { kind: 'cancelled' };
/** A task/unit lease requested through the current control protocol. */
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
      if (this.lastClaim === update.attempt.executionId) return;
      this.lastClaim = update.attempt.executionId;
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
  private readonly beforeExit = () => { void this.close(); };

  private constructor(private readonly client: HubClient, readonly sessionId: string, readonly repoAlias: string,
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
      const opened = await client.openSession({ protocol: BigInt(HUB_PROTOCOL), e3Version: options.e3Version ?? E3_RACK_VERSION,
        owner: await processOwner(), repoPath: await realpath(options.repoPath), workspace: options.workspace, label: options.label,
        dataSocket: data.socketPath, dataToken });
      session = new RackSession(client, opened.sessionId, opened.repoAlias, data);
      const initial = await client.events(opened.sessionId, 0n, 0);
      session.snapshot = initial.capacity;
      session.loop = session.poll();
      process.once('beforeExit', session.beforeExit);
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

  /** Refreshes fleet capacity without disturbing the ordered event cursor. */
  async refreshCapacity(): Promise<CapacitySnapshot> {
    if (this.lost || this.closing !== undefined) return this.snapshot;
    const status = await this.client.status();
    this.snapshot = { ...status.capacity, mine: this.snapshot.mine };
    return this.snapshot;
  }

  /**
   * Submits work or attaches to an existing lease, handling events that race
   * the create response. Attempt identity is assigned at claim, never locally.
   * @param request - Current task/unit event and rack shape
   * @returns An ordered subscription to the lease
   */
  async createLease(request: LeaseRequest): Promise<LeaseHandle> {
    if (this.lost || this.closing !== undefined) throw new RackHubUnavailableError('Rack session is closed or its hub is unreachable');
    this.creating++;
    try {
      const created = await this.client.createLease(this.sessionId, request);
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
      case 'claimed': return { kind: 'claimed', rackId: event.value.rackId, rackLabel: event.value.rackLabel, attempt: event.value.attempt };
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
      process.off('beforeExit', this.beforeExit);
      await this.client.closeSession(this.sessionId).catch(() => {});
      this.abort.abort();
      await this.loop;
      for (const handles of this.handles.values()) for (const handle of handles) handle.push({ kind: 'cancelled' });
      this.handles.clear(); this.early.clear(); this.tee.clear();
      await this.data.close();
    })();
  }
}
