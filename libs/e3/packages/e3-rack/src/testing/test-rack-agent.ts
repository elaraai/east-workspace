/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { BooleanType, decodeBeast2For, encodeBeast2For, none, printFor, variant, type EastType, type ValueTypeOf } from '@elaraai/east';
import { BEAST2_CONTENT_TYPE, ErrorType, ResponseType } from '@elaraai/e3-types';
import { LocalStorage, gcObjectReaders, markReachable, repoInit, taskExecute, taskExecuteUnit } from '@elaraai/e3-core';
import { closureHashes } from '../lease/closure.js';
import { decodeRunnerEvent, splitUnitFromWire } from '../runner-event.js';
import { E3_RACK_VERSION } from '../version.js';
import { RackCompleteRequestType, RackCompleteResponseType, RackEnrollRequestType, RackEnrollResponseType,
  RackExtendRequestType, RackHeartbeatRequestType, RackHeartbeatResponseType, RackLeaseGrantType, RackLeaseRequestType,
  RackLogsRequestType, RackStorageRequestType, RackStorageResponseType, type RackLeaseGrant, type RackLeaseRef,
  type RackLogChunk, type RackObjectCommit, type RackStorageRequest } from '../protocol/rack-wire.js';
import type { RackLeaseEvent, RackLeaseResult } from '../protocol/task-envelope.js';

/** Configures deterministic failures of an in-process protocol peer. */
export interface TestRackAgentFaults {
  /** Completes this many claims with an infrastructure failure, without an exit code. */
  infraFailNext?: number;
  /** Completes this many claims with exit code 1 without executing the task. */
  taskFailNext?: number;
  /** Holds this many claims silently until the agent stops. */
  hangNext?: number;
  /** Executes this many claims but never posts their completion. */
  dropCompletionNext?: number;
  /** Delays every claim request. */
  claimDelayMs?: number;
}

/** Configures a protocol peer backed by a real local runner repository. */
export interface TestRackAgentOptions {
  /** Origin hosting /api/rack. */
  apiUrl: string;
  /** Transports control requests and object transfers. */
  fetch?: typeof fetch;
  /** Advertises supported runner tiers. */
  tiers?: string[];
  /** Limits concurrent executions. */
  capacity?: number;
  /** Labels the rack registration. */
  label?: string;
  /** Reports the agent and bundled e3 version. */
  agentVersion?: string;
  /** Holds the isolated scratch repository in its repo subdirectory. */
  workDir: string;
  /** Overrides heartbeat and lease-extension intervals. */
  timings?: { heartbeatMs?: number; extendMs?: number };
  /** Consumes counters in place, permitting faults to be armed during a test. */
  faults?: TestRackAgentFaults;
}

/**
 * Exercises the real rack HTTP protocol over an isolated local runner store.
 * It runs e3-core task/unit execution instead of a microVM; it is not a
 * security or isolation boundary, or a substitute for the pinned e3-cloud agent's VM/installer acceptance test.
 * Every input travels through storage descriptors and every output through
 * checksum-bound PUTs and per-object commits.
 * @example
 * const agent = await TestRackAgent.enroll(origin, token);
 * await agent.runOne();
 * await agent.close();
 */
export class TestRackAgent {
  /** Stable identity assigned by enrollment. */
  rackId = '';
  /** Boot identity reported in every poll and heartbeat. */
  readonly bootId = randomUUID();
  /** Runs against a separate repository, like the guest's staged store. */
  readonly repo: string;
  /** Consumes deterministic faults before executing each claim. */
  readonly faults: TestRackAgentFaults;
  private readonly storage = new LocalStorage();
  private token = '';
  private readonly abort = new AbortController();
  private readonly transport: typeof fetch;
  private readonly tiers: string[];
  private readonly version: string;
  private readonly capacity: number;
  private readonly active = new Map<string, { lease: RackLeaseRef; stop: AbortController; done: Promise<RackLeaseResult>; silent: boolean }>();
  private loop: Promise<void> | undefined;
  private loopError: unknown;
  private temporaryHome: string | undefined;

  /** Creates an unenrolled peer; enroll before starting its claim loop.
   * @param options - Transport, scratch directory, capacity and deterministic faults.
   */
  constructor(private readonly options: TestRackAgentOptions) {
    this.repo = join(options.workDir, 'repo');
    this.transport = options.fetch ?? fetch;
    this.tiers = options.tiers ?? ['node'];
    this.version = options.agentVersion ?? `0.5.0+e3.${E3_RACK_VERSION}`;
    this.capacity = options.capacity ?? 1;
    if (!Number.isSafeInteger(this.capacity) || this.capacity < 1) throw new Error('Test rack capacity must be a positive integer');
    for (const ms of [options.timings?.heartbeatMs ?? 15000, options.timings?.extendMs ?? 20000]) {
      if (!Number.isFinite(ms) || ms <= 0) throw new Error('Test rack intervals must be positive');
    }
    this.faults = options.faults ?? {};
  }

  /** Enrolls one protocol peer with an automatically cleaned temporary store. */
  static async enroll(origin: string, enrollmentToken: string,
    options: Omit<TestRackAgentOptions, 'apiUrl' | 'workDir' | 'agentVersion'> & { version?: string } = {}): Promise<TestRackAgent> {
    const home = await mkdtemp(join(tmpdir(), 'e3a-'));
    const agent = new TestRackAgent({ ...options, apiUrl: origin, workDir: home, agentVersion: options.version });
    agent.temporaryHome = home;
    try { await agent.enroll(enrollmentToken); return agent; }
    catch (err) { await rm(home, { recursive: true, force: true }); throw err; }
  }

  /** Consumes a single-use token and publishes this boot's health.
   * @param enrollmentToken - Token minted by the control plane.
   */
  async enroll(enrollmentToken: string): Promise<void> {
    if (this.token) throw new Error('Test rack is already enrolled');
    if (!repoInit(this.repo).success) throw new Error('Could not initialize test rack repository');
    const enrolled = await this.post('enroll', RackEnrollRequestType, { enrollmentToken,
      hostInfo: { label: this.options.label ?? 'test rack', tiers: this.tiers, capacity: BigInt(this.capacity), agentVersion: this.version } }, RackEnrollResponseType);
    this.rackId = enrolled.rackId; this.token = enrolled.rackToken;
    await this.heartbeat();
  }

  /** Starts long-polling while slots are free; stop drains all active runners. */
  start(): void {
    if (!this.token || this.abort.signal.aborted) throw new Error('Test rack must be enrolled and not stopped');
    if (this.loop) return;
    this.loop = this.poll().catch((error: unknown) => { if (!this.abort.signal.aborted) this.loopError = error; this.abort.abort(); });
  }

  private async poll(): Promise<void> {
    const heartbeat = setInterval(() => { void this.heartbeat().catch(() => this.abort.abort()); }, this.options.timings?.heartbeatMs ?? 15000);
    try {
      while (!this.abort.signal.aborted) {
        if (this.active.size >= this.capacity) { await Promise.race([...this.active.values()].map((value) => value.done)); continue; }
        const lease = await this.claim();
        if (lease) void this.execute(lease).catch((error: unknown) => {
          if (!this.abort.signal.aborted) this.loopError = error;
          this.abort.abort();
        });
      }
    } finally { clearInterval(heartbeat); }
  }

  /** Posts a typed agent request with a finite transport deadline. */
  async raw<T extends EastType>(path: string, type: T, value: ValueTypeOf<T>): Promise<Response> {
    return this.transport(`${this.options.apiUrl}/api/rack/${path}`, { method: 'POST',
      headers: { 'content-type': BEAST2_CONTENT_TYPE, ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
      body: encodeBeast2For(type)(value), signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(25000)]) });
  }

  /** Decodes one standard response, raising its typed error. */
  async post<Req extends EastType, Res extends EastType>(path: string, type: Req, value: ValueTypeOf<Req>, responseType: Res): Promise<ValueTypeOf<Res>> {
    const response = await this.raw(path, type, value);
    if (response.status !== 200) throw new Error(`Rack ${path}: HTTP ${response.status}`);
    const envelope = decodeBeast2For(ResponseType(responseType))(new Uint8Array(await response.arrayBuffer()));
    if (envelope.type === 'error') throw new Error(printFor(ErrorType)(envelope.value));
    return envelope.value;
  }

  /** Reports health and returns the leases the hub asks this agent to stop. */
  async heartbeat(runningLeases: RackLeaseRef[] = [...this.active.values()].filter((value) => !value.silent).map((value) => value.lease)): Promise<ValueTypeOf<typeof RackHeartbeatResponseType>> {
    const response = await this.post('heartbeat', RackHeartbeatRequestType, { healthy: true, freeCapacity: BigInt(Math.max(0, this.capacity - Math.max(this.active.size, runningLeases.length))),
      runningLeases, agentVersion: this.version, bootId: this.bootId, cacheBytes: 0n }, RackHeartbeatResponseType);
    if (response.rotatedToken.type === 'some') this.token = response.rotatedToken.value;
    for (const lease of response.stop) this.active.get(lease.leaseId)?.stop.abort();
    return response;
  }

  /** Claims a lease, or answers null after an idle poll window. */
  async claim(): Promise<RackLeaseGrant | null> {
    if (this.faults.claimDelayMs) await delay(this.faults.claimDelayMs, undefined, { signal: this.abort.signal });
    const response = await this.raw('lease', RackLeaseRequestType, { tiers: this.tiers, bootId: this.bootId });
    if (response.status === 204) return null;
    if (response.status !== 200) throw new Error(`Rack claim: HTTP ${response.status}`);
    const envelope = decodeBeast2For(ResponseType(RackLeaseGrantType))(new Uint8Array(await response.arrayBuffer()));
    if (envelope.type === 'error') throw new Error(printFor(ErrorType)(envelope.value));
    return envelope.value;
  }

  /** Resolves storage descriptors and write receipts for a held lease. */
  storageRequest(lease: RackLeaseRef, request: Partial<Omit<RackStorageRequest, 'repo' | 'leaseId'>> = {}): Promise<ValueTypeOf<typeof RackStorageResponseType>> {
    return this.post('storage', RackStorageRequestType, { repo: lease.repo, leaseId: lease.leaseId,
      need: [], output: none, envManifest: none, outputs: [], commits: [], ...request }, RackStorageResponseType);
  }

  /** Streams an ordered log batch through the rack endpoint. */
  logs(lease: RackLeaseRef, chunks: RackLogChunk[]) {
    return this.post('logs', RackLogsRequestType, { repo: lease.repo, leaseId: lease.leaseId, chunks }, BooleanType);
  }

  /** Posts an outcome without hiding accepted-and-discarded semantics. */
  complete(lease: RackLeaseRef, result: RackLeaseResult): Promise<ValueTypeOf<typeof RackCompleteResponseType>> {
    return this.post('complete', RackCompleteRequestType, { repo: lease.repo, leaseId: lease.leaseId,
      resultJson: JSON.stringify(result), inlineOutput: none, outputUploadId: none }, RackCompleteResponseType);
  }

  /** Fetches a closure through inline descriptors or capability URLs. */
  private async fetchObjects(lease: RackLeaseRef, hashes: readonly string[]): Promise<void> {
    for (let from = 0; from < hashes.length; from += 256) {
      const need: string[] = [];
      for (const hash of hashes.slice(from, from + 256)) if (!await this.storage.objects.exists(this.repo, hash)) need.push(hash);
      if (need.length === 0) continue;
      const response = await this.storageRequest(lease, { need });
      for (const object of response.objects) {
        const bytes = object.type === 'inline' ? object.value.data : await (async () => {
          const response = await this.transport(object.value.url, { signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(30000)]) });
          if (!response.ok) throw new Error(`Rack input GET: HTTP ${response.status}`);
          return new Uint8Array(await response.arrayBuffer());
        })();
        if (await this.storage.objects.write(this.repo, bytes) !== object.value.hash) throw new Error('Rack input checksum mismatch');
      }
    }
  }

  /** Executes one claimed task/unit with the production core over the fetched closure. */
  execute(lease: RackLeaseGrant): Promise<RackLeaseResult> {
    if (this.active.has(lease.leaseId)) throw new Error('Test rack lease is already executing');
    const stop = new AbortController();
    const done = this.executeClaim(lease, stop).finally(() => { this.active.delete(lease.leaseId); });
    this.active.set(lease.leaseId, { lease, stop, done, silent: false });
    return done;
  }

  private consume(fault: keyof Omit<TestRackAgentFaults, 'claimDelayMs'>): boolean {
    const count = this.faults[fault] ?? 0;
    if (count <= 0) return false;
    this.faults[fault] = count - 1;
    return true;
  }

  private async executeClaim(lease: RackLeaseGrant, stop: AbortController): Promise<RackLeaseResult> {
    // Let execute register the active slot before starting callbacks or faults.
    await Promise.resolve();
    const event = JSON.parse(lease.eventJson) as RackLeaseEvent;
    const signal = AbortSignal.any([stop.signal, this.abort.signal]);
    if (this.consume('hangNext')) {
      this.active.get(lease.leaseId)!.silent = true;
      await delay(2147483647, undefined, { signal }).catch(() => {});
      return { taskName: event.taskName, status: 'failed', state: 'error', cancelled: true, error: 'Test rack stopped a silent claim' };
    }
    const infra = this.consume('infraFailNext');
    if (infra || this.consume('taskFailNext')) {
      const result: RackLeaseResult = { taskName: event.taskName, status: 'failed', state: infra ? 'error' : 'failed',
        ...(infra ? {} : { exitCode: 1 }), error: infra ? 'Injected infrastructure failure' : 'Injected task failure' };
      await this.complete(lease, result); return result;
    }
    const run = decodeRunnerEvent(event.runnerEvent);
    if (run.mode !== 'task' && run.mode !== 'unit') throw new Error('Test agent runs tasks and units');
    const heartbeat = setInterval(() => {
      void this.heartbeat().catch(() => stop.abort());
    }, this.options.timings?.heartbeatMs ?? 15000);
    const extend = setInterval(() => { void this.post('lease/extend', RackExtendRequestType,
      { repo: lease.repo, leaseId: lease.leaseId }, BooleanType).then((held) => { if (!held) stop.abort(); }).catch(() => stop.abort());
    }, this.options.timings?.extendMs ?? 20000);
    heartbeat.unref(); extend.unref();
    const chunks: RackLogChunk[] = [];
    try {
      if ('object' in event.closure) await this.fetchObjects(lease, [event.closure.object]);
      await this.fetchObjects(lease, await closureHashes(event.closure, (hash) => this.storage.objects.read(this.repo, hash)));
      const options = { force: true, signal, timeout: run.timeoutMs, verbose: run.verbose,
        onStdout: (data: string) => { chunks.push({ stream: variant('stdout', null), data }); },
        onStderr: (data: string) => { chunks.push({ stream: variant('stderr', null), data }); } };
      const result = run.mode === 'task'
        ? await taskExecute(this.storage, this.repo, run.taskHash, [...run.inputHashes], options)
        : await taskExecuteUnit(this.storage, this.repo, run.taskHash, splitUnitFromWire(run.unit), options);
      if (chunks.length > 0) await this.logs(lease, chunks);
      if (result.state === 'success' && result.outputHash !== null) {
        const readers = gcObjectReaders(this.storage, this.repo);
        const hashes = [...await markReachable(readers.readObject, new Set([result.outputHash]), { readHead: readers.readHead })];
        for (const hash of hashes) {
          const bytes = await this.storage.objects.read(this.repo, hash);
          const size = BigInt(bytes.length);
          const targets = await this.storageRequest(lease, { outputs: [{ hash, size }] });
          const target = targets.targets[0]!.target;
          if (target.type === 'held') continue;
          const put = await this.transport(target.value.url, { method: 'PUT', headers: Object.fromEntries(target.value.headers), body: bytes,
            signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
          if (!put.ok) throw new Error(`Rack output PUT: HTTP ${put.status}`);
          const version = put.headers.get('x-amz-version-id');
          await put.arrayBuffer();
          if (version === null) throw new Error('Rack upload has no receipt');
          const commit: RackObjectCommit = { hash, size, version };
          if (!(await this.storageRequest(lease, { commits: [commit] })).committed[0]?.committed) throw new Error('Rack output commit refused');
        }
      }
      const output: RackLeaseResult = { taskName: event.taskName, status: result.state === 'success' ? 'success' : 'failed',
        state: result.state, ...(result.outputHash === null ? {} : { outputHash: result.outputHash }),
        ...(result.exitCode == null ? {} : { exitCode: result.exitCode }), ...(result.error == null ? {} : { error: result.error }),
        ...(result.peakBytes === undefined ? {} : { peakBytes: result.peakBytes }), cancelled: signal.aborted };
      if (!this.consume('dropCompletionNext') && !this.abort.signal.aborted) await this.complete(lease, output);
      return output;
    } finally { clearInterval(heartbeat); clearInterval(extend); }
  }

  /** Claims and executes the next task. */
  async runOne(): Promise<RackLeaseResult | null> { const lease = await this.claim(); return lease === null ? null : this.execute(lease); }

  /** Aborts requests and removes the isolated guest store. */
  async close(): Promise<void> {
    try { await this.stop(); }
    finally { await rm(this.temporaryHome ?? this.repo, { recursive: true, force: true }); }
  }

  /** Stops polling, aborts active executions and waits for runner cleanup. */
  async stop(): Promise<void> {
    this.abort.abort();
    await this.loop;
    await Promise.allSettled([...this.active.values()].map((value) => value.done));
    if (this.loopError) throw this.loopError;
  }
}
