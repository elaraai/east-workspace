/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { ArrayType, BooleanType, StringType, variant, type EastType, type ValueTypeOf } from '@elaraai/east';
import type { ExecutionOwner } from '@elaraai/e3-types';
import { InMemoryLeaseCoordinator, type LeaseCoordinator } from '../lease/coordinator.js';
import type { RackLeaseStore } from '../lease/lease-store.js';
import type { RackAttemptStore } from '../server/rack-routes.js';
import type { RackPutTarget, RackStorageBridge } from '../server/storage-bridge.js';
import { RackHubError, socketRequest, socketStream } from '../client/local-http.js';
import { LeaseDataType, LeaseOutcomeType, LeaseRunningType, LeaseStoppedType, SessionLogsType,
  SessionUploadType, TouchObjectsType, VerifyOutputType, type SessionUpload } from '../protocol/session-data.js';
import type { RackLogChunk } from '../protocol/rack-wire.js';

/** Identifies the session that currently owns repository I/O for a lease. */
export interface SessionEndpoint {
  /** Private socket; never sent to a rack. */
  dataSocket: string;
  /** Private session credential; never sent to a rack. */
  dataToken: string;
}
interface LeaseContext { repo: string; leaseId: string }

/**
 * Shares one lease fence and its context across the routes and dispatcher.
 * Storage bridge signatures remain compatible with cloud backends; only the
 * local proxy needs the calling lease to scope a URL to its current attempt.
 */
export class SessionLeaseCoordinator implements LeaseCoordinator {
  private readonly serial = new InMemoryLeaseCoordinator();
  private readonly context = new AsyncLocalStorage<LeaseContext>();
  run<T>(repo: string, leaseId: string, operation: () => Promise<T>): Promise<T> {
    return this.serial.run(repo, leaseId, () => this.context.run({ repo, leaseId }, operation));
  }
  /** Returns the calling transition's identity, refusing unfenced access. */
  current(repo: string): LeaseContext {
    const context = this.context.getStore();
    if (context === undefined || context.repo !== repo) throw new Error('Rack storage requires a lease context');
    return context;
  }
}

interface Capability extends LeaseContext {
  id: string;
  hash: string;
  executionId: string | undefined;
  expires: number;
  revoked: boolean;
  abort: AbortController;
  upload?: SessionUpload;
}
interface LogBuffer extends LeaseContext {
  taskHash: string;
  inputsHash: string;
  executionId: string;
  chunks: RackLogChunk[];
  bytes: number;
  timer?: NodeJS.Timeout;
  pending?: Promise<void>;
}

/** Configures the hub's opaque pass-through to repository-owning sessions. */
export interface SessionBridgeOptions {
  /** Conditional lease state. */
  leases: RackLeaseStore;
  /** Shared route/dispatch fence. */
  coordinator: SessionLeaseCoordinator;
  /** Selects a live session of the lease's exact repository and e3 version. */
  session: (repo: string, leaseId: string) => SessionEndpoint;
  /** Returns every live subscriber for log tees; only session() persists. */
  subscribers?: (repo: string, leaseId: string) => SessionEndpoint[];
  /** Resolves the hub's process identity for execution liveness. */
  owner: ExecutionOwner;
  /** Provides an origin outside a rack request, when configured. */
  advertiseOrigin: () => string | undefined;
  /** Controls capability expiration in tests. */
  now?: () => number;
}

/**
 * Proxies objects and attempt records without opening a repository in the hub.
 * Capability URLs bind to one lease attempt, expire in fifteen minutes and
 * are aborted on reclaim or termination. PUT acknowledgments are repeatable
 * until cleanup so a lost HTTP response cannot force another body write.
 * @example
 * const bridge = new SessionProxyStorageBridge(options);
 * app.route('/', bridge.dataRoutes());
 */
export class SessionProxyStorageBridge implements RackStorageBridge {
  /** Carries the external request origin into generated data URLs. */
  readonly origin = new AsyncLocalStorage<string>();
  /** Forwards execution records and buffered logs to the repository session. */
  readonly attempts: RackAttemptStore;
  private readonly capabilities = new Map<string, Capability>();
  private readonly logs = new Map<string, LogBuffer>();
  private readonly now: () => number;

  /** @param options - Stores, session selection, ownership and URL origin */
  constructor(private readonly options: SessionBridgeOptions) {
    this.now = options.now ?? Date.now;
    this.attempts = {
      closure: (lease) => this.post(lease, '/v1/attempts/closure', LeaseDataType, { leaseJson: JSON.stringify(lease) }, ArrayType(StringType)),
      running: async (lease) => { await this.post(lease, '/v1/attempts/running', LeaseRunningType, { leaseJson: JSON.stringify(lease), owner: options.owner }, BooleanType); },
      stopped: async (lease, how, cause) => {
        await this.flush(lease.repo, lease.attempt?.executionId);
        await this.post(lease, '/v1/attempts/stopped', LeaseStoppedType, { leaseJson: JSON.stringify(lease), cancelled: how === 'cancelled', cause }, BooleanType);
      },
      outcome: async (lease, result) => {
        await this.flush(lease.repo, lease.attempt?.executionId);
        await this.post(lease, '/v1/attempts/outcome', LeaseOutcomeType, { leaseJson: JSON.stringify(lease), resultJson: JSON.stringify(result) }, BooleanType);
      },
      verifyOutput: (lease, hash) => this.post(lease, '/v1/verify', VerifyOutputType, { hash }, BooleanType),
      logs: {
        append: async (repo, taskHash, inputsHash, executionId, stream, data) => {
          const key = JSON.stringify([repo, executionId]);
          let buffer = this.logs.get(key);
          if (buffer === undefined) {
            buffer = { ...options.coordinator.current(repo), taskHash, inputsHash, executionId, chunks: [], bytes: 0 };
            this.logs.set(key, buffer);
          }
          buffer.chunks.push({ stream: variant(stream, null), data });
          buffer.bytes += Buffer.byteLength(data);
          if (buffer.bytes >= 32768) await this.flush(repo, executionId);
          else if (buffer.timer === undefined) {
            buffer.timer = setTimeout(() => {
              buffer!.timer = undefined;
              void this.flush(repo, executionId).catch((err: unknown) => console.warn('rack log flush:', err));
            }, 250);
            buffer.timer.unref();
          }
        },
        flush: (repo, _task, _inputs, id) => this.flush(repo, id),
      },
    };
  }

  private post<Req extends EastType, Res extends EastType>(context: LeaseContext, path: string, requestType: Req, body: ValueTypeOf<Req>, responseType: Res): Promise<ValueTypeOf<Res>> {
    const session = this.options.session(context.repo, context.leaseId);
    return socketRequest(session.dataSocket, 'POST', path, { bearer: session.dataToken, requestType, body, responseType });
  }

  private async flush(repo: string, executionId: string | undefined): Promise<void> {
    if (executionId === undefined) return;
    const key = JSON.stringify([repo, executionId]);
    const buffer = this.logs.get(key);
    if (buffer === undefined) return;
    if (buffer.timer !== undefined) { clearTimeout(buffer.timer); buffer.timer = undefined; }
    if (buffer.pending !== undefined) await buffer.pending;
    if (buffer.chunks.length === 0) return;
    const chunks = buffer.chunks.splice(0);
    buffer.bytes = 0;
    const body = {
      taskHash: buffer.taskHash, inputsHash: buffer.inputsHash, executionId, chunks,
    };
    const owner = this.options.session(buffer.repo, buffer.leaseId);
    const pending = socketRequest(owner.dataSocket, 'POST', '/v1/logs', {
      bearer: owner.dataToken, requestType: SessionLogsType, body, responseType: BooleanType,
    }).then(async () => {
      // A subscriber's display is best effort; it cannot cause persisted logs
      // to be retried, or prevent the owner from recording the outcome.
      await Promise.allSettled((this.options.subscribers?.(buffer.repo, buffer.leaseId) ?? [])
        .filter((session) => session.dataSocket !== owner.dataSocket)
        .map((session) => socketRequest(session.dataSocket, 'POST', '/v1/logs/tee', {
          bearer: session.dataToken, requestType: SessionLogsType, body, responseType: BooleanType, timeoutMs: 1000,
        })));
    }, (err: unknown) => {
      buffer.chunks.unshift(...chunks);
      buffer.bytes += chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.data), 0);
      throw err;
    });
    buffer.pending = pending;
    try { await pending; } finally { if (buffer.pending === pending) buffer.pending = undefined; }
    if (buffer.chunks.length === 0 && buffer.pending === undefined) this.logs.delete(key);
  }

  private async mint(context: LeaseContext, hash: string, upload?: SessionUpload): Promise<Capability> {
    this.prune();
    const lease = await this.options.leases.get(context.repo, context.leaseId);
    if (lease?.status !== 'claimed') throw new RackHubError('lease_ended', 'Rack lease is no longer claimed');
    for (const cap of this.capabilities.values()) {
      if (cap.repo === context.repo && cap.leaseId === context.leaseId && cap.hash === hash &&
        !cap.revoked && cap.executionId === lease.attempt?.executionId && (cap.upload === undefined) === (upload === undefined)) {
        if (upload !== undefined && Number(cap.upload!.size) !== Number(upload.size)) throw new Error('Upload size changed');
        if (cap.expires <= this.now()) { cap.expires = this.now() + 15 * 60_000; cap.abort = new AbortController(); }
        return cap;
      }
    }
    if (this.capabilities.size >= 65536) throw new RackHubError('capacity', 'Rack data capability limit reached');
    const cap: Capability = { ...context, id: randomUUID(), hash, executionId: lease.attempt?.executionId,
      expires: this.now() + 15 * 60_000, revoked: false, abort: new AbortController(), ...(upload === undefined ? {} : { upload }) };
    this.capabilities.set(cap.id, cap);
    return cap;
  }

  private url(cap: Capability): string {
    const origin = this.origin.getStore() ?? this.options.advertiseOrigin();
    if (origin === undefined) throw new Error('Rack listener has no reachable origin');
    return `${origin}/api/rack/data/${cap.id}`;
  }

  async readDescriptor(repo: string, hash: string) {
    const context = this.options.coordinator.current(repo);
    const session = this.options.session(repo, context.leaseId);
    const head = await socketStream(session.dataSocket, 'HEAD', `/v1/objects/${hash}`, { bearer: session.dataToken });
    head.resume();
    if (head.statusCode !== 200) throw new Error(`Rack input ${hash} is unavailable`);
    const size = Number(head.headers['content-length']);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid input object length');
    if (size > 4096) return { kind: 'url' as const, url: this.url(await this.mint(context, hash)) };
    const response = await socketStream(session.dataSocket, 'GET', `/v1/objects/${hash}`, { bearer: session.dataToken });
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of response) {
      length += (chunk as Buffer).length;
      if (length > 4096) { response.destroy(); throw new Error('Inline input exceeds 4096 bytes'); }
      chunks.push(chunk as Buffer);
    }
    if (response.statusCode !== 200 || length !== size) throw new Error('Input object read failed');
    return { kind: 'inline' as const, data: Buffer.concat(chunks) };
  }

  async writeTarget(repo: string, leaseId: string, hash: string, size: number): Promise<RackPutTarget | null> {
    const context = { repo, leaseId };
    if ((await this.post(context, '/v1/touch', TouchObjectsType, [hash], ArrayType(BooleanType)))[0]) return null;
    const cap = await this.mint(context, hash, { leaseId, hash, size: BigInt(size), receipt: randomUUID() });
    return { url: this.url(cap), headers: {} };
  }

  async commitWrite(repo: string, leaseId: string, rackId: string, hash: string, size: number, version: string): Promise<boolean> {
    const lease = await this.options.leases.get(repo, leaseId);
    if (lease?.status !== 'claimed' || lease.claimedBy !== rackId) return false;
    const cap = [...this.capabilities.values()].find((c) => c.repo === repo && c.leaseId === leaseId &&
      c.hash === hash && c.executionId === lease.attempt?.executionId && c.upload?.receipt === version && Number(c.upload.size) === size);
    if (cap?.upload === undefined || cap.revoked) return false;
    return this.post(cap, `/v1/uploads/${cap.id}/commit`, SessionUploadType, cap.upload, BooleanType);
  }

  async stagedTarget(repo: string, _workspace: string, hash: string, size: bigint) {
    const context = this.options.coordinator.current(repo);
    const cap = await this.mint(context, hash, { leaseId: context.leaseId, hash, size, receipt: randomUUID() });
    return { url: this.url(cap), uploadId: cap.id };
  }

  async commitStaged(repo: string, hash: string, uploadId: string): Promise<boolean> {
    const context = this.options.coordinator.current(repo);
    const cap = this.capabilities.get(uploadId);
    if (cap?.upload === undefined || cap.repo !== repo || cap.hash !== hash || cap.leaseId !== context.leaseId || !(await this.valid(cap))) return false;
    return this.post(cap, `/v1/uploads/${cap.id}/commit`, SessionUploadType, cap.upload, BooleanType);
  }

  async writeInline(repo: string, data: Uint8Array): Promise<string> {
    if (data.length > 4096) throw new Error('Inline rack output exceeds 4096 bytes');
    const context = this.options.coordinator.current(repo);
    const session = this.options.session(repo, context.leaseId);
    return socketRequest(session.dataSocket, 'POST', '/v1/objects', { bearer: session.dataToken, rawBody: data, responseType: StringType });
  }

  readEnvManifest(): Promise<null> { return Promise.resolve(null); }
  presignEnvLayer(): Promise<string> { return Promise.reject(new Error('Environments are not supported by the local rack hub')); }

  /** Aborts old-attempt streams immediately, before another session takes ownership. */
  revoke(repo: string, leaseId: string): void {
    for (const cap of this.capabilities.values()) if (cap.repo === repo && cap.leaseId === leaseId) { cap.revoked = true; cap.abort.abort(); }
  }

  /** Stops streams to a departing session while retaining acknowledged receipts. */
  interrupt(repo: string, leaseId: string): void {
    for (const cap of this.capabilities.values()) if (cap.repo === repo && cap.leaseId === leaseId) {
      cap.abort.abort();
      cap.abort = new AbortController();
    }
  }

  async discardWrites(repo: string, leaseId: string, _hashes: readonly string[]): Promise<number> {
    this.revoke(repo, leaseId);
    const caps = [...this.capabilities.values()].filter((cap) => cap.repo === repo && cap.leaseId === leaseId);
    for (const cap of caps) this.capabilities.delete(cap.id);
    const results = await Promise.allSettled(caps.map(async (cap) => {
      if (cap.upload !== undefined) {
        const session = this.options.session(repo, leaseId);
        await socketRequest(session.dataSocket, 'DELETE', `/v1/uploads/${cap.id}`, { bearer: session.dataToken, responseType: BooleanType });
      }
    }));
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    return caps.filter((cap) => cap.upload !== undefined).length;
  }

  private prune(): void {
    for (const cap of this.capabilities.values()) if (cap.expires <= this.now()) {
      cap.abort.abort();
      // Keep upload receipts until lease cleanup so acknowledged uploads can
      // still be committed after their URL expires; deny any further PUT.
      if (cap.upload === undefined) this.capabilities.delete(cap.id);
    }
  }

  private async valid(cap: Capability): Promise<boolean> {
    if (cap.revoked || cap.abort.signal.aborted || cap.expires <= this.now()) return false;
    const lease = await this.options.leases.get(cap.repo, cap.leaseId);
    return lease?.status === 'claimed' && lease.attempt?.executionId === cap.executionId;
  }

  /** Streams data URLs with backpressure, bounded deadlines and no rack bearer header. */
  dataRoutes(): Hono {
    const app = new Hono();
    app.on(['GET', 'PUT'], '/api/rack/data/:cap', async (c) => {
      if (c.req.header('authorization') !== undefined) return c.text('Capability URLs do not accept Authorization', 400);
      const cap = this.capabilities.get(c.req.param('cap'));
      if (cap === undefined || !await this.valid(cap) || (cap.upload === undefined ? 'GET' : 'PUT') !== c.req.method) return c.notFound();
      let session: SessionEndpoint;
      try { session = this.options.session(cap.repo, cap.leaseId); } catch { return c.text('No live repository session', 410); }
      const signal = AbortSignal.any([cap.abort.signal, c.req.raw.signal, AbortSignal.timeout(Math.max(1, Math.min(600_000, cap.expires - this.now())))]);
      const upload = cap.upload;
      const path = upload === undefined ? `/v1/objects/${cap.hash}` : `/v1/uploads/${cap.id}?${new URLSearchParams({
        lease: cap.leaseId, hash: cap.hash, size: `${upload.size}`, receipt: upload.receipt,
      })}`;
      const response = await socketStream(session.dataSocket, c.req.method, path, {
        bearer: session.dataToken, signal, timeoutMs: 600_000,
        ...(upload === undefined ? {} : { rawBody: c.req.raw.body === null ? new Uint8Array() : Readable.fromWeb(c.req.raw.body) }),
      });
      const headers = new Headers({ 'content-type': 'application/octet-stream' });
      for (const name of ['content-length', 'x-amz-version-id']) {
        const value = response.headers[name];
        if (typeof value === 'string') headers.set(name, value);
      }
      return new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, { status: response.statusCode ?? 502, headers });
    });
    return app;
  }

  /** Aborts outstanding transfers and clears unreferenced log timers on shutdown. */
  close(): void {
    for (const cap of this.capabilities.values()) cap.abort.abort();
    for (const buffer of this.logs.values()) if (buffer.timer !== undefined) clearTimeout(buffer.timer);
    this.capabilities.clear();
    this.logs.clear();
  }
}
