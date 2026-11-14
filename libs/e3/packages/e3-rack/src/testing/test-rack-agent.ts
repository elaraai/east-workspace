/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { BooleanType, decodeBeast2For, encodeBeast2For, none, some, variant, type EastType, type ValueTypeOf } from '@elaraai/east';
import { BEAST2_CONTENT_TYPE } from '@elaraai/e3-types';
import { ENVIRONMENT_LAYER_ROOT, LocalStorage, gcObjectReaders, hostEnvironmentPlatform, linkPrebuiltEnvironment, markReachable, repoInit,
  taskExecute, taskExecuteUnit, unpackEnvironmentLayer } from '@elaraai/e3-core';
import type { EnvLayerManifest } from '../server/env-publication.js';
import { closureHashes } from '../lease/closure.js';
import { decodeRunnerEvent, splitUnitFromWire } from '../runner-event.js';
import { E3_RACK_VERSION } from '../version.js';
import { pinnedFetch } from '../tls/tls.js';
import { RackCompleteRequestType, RackCompleteResponseType, RackEnrollRequestType, RackEnrollResponseType,
  RackExtendRequestType, RackHeartbeatRequestType, RackHeartbeatResponseType, RackLeaseGrantType, RackLeaseRequestType,
  RackLogsRequestType, RackStorageRequestType, RackStorageResponseType, type RackLeaseGrant, type RackLeaseRef,
  type RackLogChunk, type RackObjectCommit, type RackStorageRequest } from '../protocol/rack-wire.js';
import { RACK_PROTOCOL, RACK_PROTOCOL_HEADER, RACK_TRANSFERS_AT_ONCE, RACK_WAITING_HEADER, readRackHello, readRackRefusal, readRackWaiting,
  type RackHello, type RackOffer, type RackReport, type RackResources, type RackWaiting } from '../protocol/rack-json.js';
import { readRackLeaseResources, type RackLeaseEvent, type RackLeaseResources, type RackLeaseResult, type RackTransferRetry } from '../protocol/task-envelope.js';

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
  /** Fails this many tries of an object transfer before a byte of them is
   *  sent, as a link that is down does. */
  failTransferNext?: number;
}

/** What an agent's object transfers came to, counted as they ran. */
export interface TestRackAgentTransfers {
  /** The most transfers the agent had in flight at once */
  peak: number;
  /** The times its source told it to wait: it had too many in flight there */
  busy: number;
  /** The tries that followed a failed one */
  retried: number;
  /** The tries its source answered from the byte the one before reached */
  resumed: number;
}

/** The tries a transfer is given before its lease is failed. */
const TRANSFER_TRIES = 5;

/** A transfer its source refused for good: the same request is not sent again. */
class TransferRefused extends Error {}

/** A transfer that failed every try it was given. */
class TransferFailed extends Error {
  constructor(message: string, readonly transfer: 'input' | 'output', readonly attempts: number, readonly why: string) { super(message); }
}

/** One lease's transfers: which way they go, and the retries they made. */
interface Transfers { transfer: 'input' | 'output'; retries: RackTransferRetry[] }

/** Configures a protocol peer backed by a real local runner repository. */
export interface TestRackAgentOptions {
  /** Origin hosting /api/rack. */
  apiUrl: string;
  /** Transports control requests and object transfers. */
  fetch?: typeof fetch;
  /** Pins a TLS hub's certificate by its SHA-256, as a worker does; ignored when fetch is given. */
  certificateSha256?: string;
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
  /** Overrides heartbeat and lease-extension intervals, the deadline of one
   *  try of an object transfer (thirty seconds), and the first wait between
   *  two tries (a second), which doubles up to thirty seconds. */
  timings?: { heartbeatMs?: number; extendMs?: number; transferMs?: number; retryMs?: number };
  /** Consumes counters in place, permitting faults to be armed during a test. */
  faults?: TestRackAgentFaults;
  /** What the agent says it is and has, with each heartbeat; by default that
   *  it composes environments for the platform of the machine it runs on
   *  (where e3-core installs one for it), and, with {@link resources}, them. */
  report?: RackReport;
  /**
   * What a lease's runner is taken to have peaked at, in bytes, given what it
   * measured: how a test has work outgrow its cap. The agent stands in for a
   * cap by it: work whose peak is above the cap its lease asked is completed
   * `outgrew-cap`, with nothing it wrote sent. It is asked once the runner has
   * ended and before anything is sent, and may take its time: a test holds a
   * lease's end by it until what it waits for has happened.
   */
  peak?: (lease: RackLeaseGrant, measured: number | undefined) => number | undefined | Promise<number | undefined>;
  /**
   * All the agent has. With it the agent admits work by its resources: it
   * books each lease it holds at what the lease asks, offers a poll what is
   * left, and reports both with each heartbeat (the `resources` feature). Its
   * capacity is then its cores, unless set.
   */
  resources?: RackResources;
  /** The rack protocol its requests name: this build's by default, another to
   *  stand for an agent of another release, and null for one from before the
   *  protocol was named, which sends no header. */
  protocol?: number | null;
  /** The object transfers it has in flight at once: by default what its
   *  source's hello allows, and more to stand for an agent that does not hold
   *  itself to it. */
  transfersAtOnce?: number;
}

/**
 * Exercises the real rack HTTP protocol over an isolated local runner store.
 * It runs e3-core task/unit execution instead of a microVM; it is not a
 * security or isolation boundary, or a substitute for the pinned e3-cloud agent's VM/installer acceptance test.
 * Every input travels through storage descriptors and every output through
 * checksum-bound PUTs and per-object commits. It has no more transfers in
 * flight than its source's hello allows, waits when told its source is busy,
 * and gives a transfer that failed five tries, each read going on from the
 * byte the one before reached.
 *
 * For a lease that names an environment it asks its source for the manifest
 * and its layers, checks each layer's digest and size, unpacks them, and runs
 * the work with the tree linked where e3-core looks for a built environment:
 * nothing is installed on it.
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
  /** What its object transfers came to so far. */
  readonly transfers: TestRackAgentTransfers = { peak: 0, busy: 0, retried: 0, resumed: 0 };
  /** The transfers its source serves it at once, as its hello said. */
  private sourceTransfers = RACK_TRANSFERS_AT_ONCE;
  private inFlight = 0;
  private readonly waiting: Array<() => void> = [];
  /** What each lease the agent holds books of its resources, by lease. */
  private readonly booked = new Map<string, RackLeaseResources>();
  /** The most the agent has held booked at once, when it admits by its
   *  resources: leases, cores and bytes of memory. */
  readonly bookedMost = { leases: 0, cores: 0, memoryBytes: 0 };
  /** What the last idle poll said waits for room on this rack, if anything. */
  waitingFor: RackWaiting | undefined;
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
    this.transport = options.fetch ?? (options.certificateSha256 === undefined ? fetch : pinnedFetch(options.certificateSha256));
    this.tiers = options.tiers ?? ['node'];
    this.version = options.agentVersion ?? `0.5.0+e3.${E3_RACK_VERSION}`;
    this.capacity = options.capacity ?? options.resources?.cores ?? 1;
    if (!Number.isSafeInteger(this.capacity) || this.capacity < 1) throw new Error('Test rack capacity must be a positive integer');
    for (const ms of [options.timings?.heartbeatMs ?? 15000, options.timings?.extendMs ?? 20000, options.timings?.transferMs ?? 30000, options.timings?.retryMs ?? 1000]) {
      if (!Number.isFinite(ms) || ms <= 0) throw new Error('Test rack intervals must be positive');
    }
    if (options.transfersAtOnce !== undefined && (!Number.isSafeInteger(options.transfersAtOnce) || options.transfersAtOnce < 1)) throw new Error('Test rack transfers at once must be a positive integer');
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

  /**
   * Asks the source what it speaks, before any credential is shown.
   * @returns The source's hello
   * @throws {Error} When the source answers no hello: it speaks a rack
   *   protocol from before the hello
   */
  async hello(): Promise<RackHello> {
    const response = await this.transport(`${this.options.apiUrl}/api/rack/hello`, { signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(25000)]) });
    if (!response.ok) {
      await response.arrayBuffer();
      throw new Error(`Rack hello: HTTP ${response.status}: the source speaks a rack protocol from before ${RACK_PROTOCOL}; update e3 on it`);
    }
    return readRackHello(await response.text());
  }

  /** Consumes a single-use token and publishes this boot's health, once the
   * source's hello says it speaks this agent's protocol: a token is not spent
   * on a source whose answer could not be read.
   * @param enrollmentToken - Token minted by the control plane.
   */
  async enroll(enrollmentToken: string): Promise<void> {
    if (this.token) throw new Error('Test rack is already enrolled');
    const hello = await this.hello();
    if (this.options.protocol === undefined && hello.protocol !== RACK_PROTOCOL) {
      throw new Error(`The source speaks rack protocol ${hello.protocol} (e3 ${hello.e3}), and this agent ${RACK_PROTOCOL}`);
    }
    this.sourceTransfers = hello.limits.transfersAtOnce;
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
        // No slot, or no core, is free: nothing to offer until an execution ends.
        if (this.active.size >= this.capacity || (this.active.size > 0 && this.offer().cores <= 0)) { await Promise.race([...this.active.values()].map((value) => value.done)); continue; }
        const lease = await this.claim();
        if (lease) void this.execute(lease).catch((error: unknown) => {
          if (!this.abort.signal.aborted) this.loopError = error;
          this.abort.abort();
        });
      }
    } finally { clearInterval(heartbeat); }
  }

  /**
   * Posts a typed agent request, naming its protocol, with a finite transport deadline.
   * @param path - The route under /api/rack
   * @param type - The request's type
   * @param value - The request
   * @param protocol - The rack protocol this one request names, when not the
   *   agent's own: another number, or null for no header
   * @returns The response, unread
   */
  async raw<T extends EastType>(path: string, type: T, value: ValueTypeOf<T>,
    protocol: number | null = this.options.protocol === undefined ? RACK_PROTOCOL : this.options.protocol): Promise<Response> {
    return this.transport(`${this.options.apiUrl}/api/rack/${path}`, { method: 'POST',
      headers: { 'content-type': BEAST2_CONTENT_TYPE, ...(protocol === null ? {} : { [RACK_PROTOCOL_HEADER]: String(protocol) }),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
      body: encodeBeast2For(type)(value), signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(25000)]) });
  }

  /** A reply that is no success, as an error naming its status, and its
   *  refusal's code and words when the body is one. */
  private async refused(path: string, response: Response): Promise<Error> {
    const refusal = readRackRefusal(await response.text());
    return new Error(`Rack ${path}: HTTP ${response.status}${refusal === null ? '' : ` ${refusal.code}: ${refusal.message}`}`);
  }

  /** Decodes one reply, the route's own type, raising a refusal as an error. */
  async post<Req extends EastType, Res extends EastType>(path: string, type: Req, value: ValueTypeOf<Req>, responseType: Res): Promise<ValueTypeOf<Res>> {
    const response = await this.raw(path, type, value);
    if (response.status !== 200) throw await this.refused(path, response);
    return decodeBeast2For(responseType)(new Uint8Array(await response.arrayBuffer()));
  }

  /** What of the agent's resources no lease it holds has booked. */
  private free(all: RackResources): RackResources {
    let { cores, memoryBytes, gpus } = all;
    for (const held of this.booked.values()) { cores -= held.cores; memoryBytes -= held.memoryBytes; if (held.gpu) gpus -= 1; }
    return { cores: Math.max(0, cores), memoryBytes: Math.max(0, memoryBytes), gpus: Math.max(0, gpus) };
  }

  /** What the agent is and has: what its options say; else its resources and
   *  what is free of them, when it admits by them, and that it composes
   *  environments for this machine's platform, when that is one e3-core
   *  installs an environment for. */
  private report(): RackReport {
    if (this.options.report !== undefined) return this.options.report;
    const all = this.options.resources;
    const target = hostEnvironmentPlatform();
    return { features: [...(all === undefined ? [] : ['resources']), ...(target === null ? [] : ['environments'])],
      ...(target !== null && { target }), ...(all !== undefined && { resources: all, free: this.free(all) }) };
  }

  /** What a poll may be answered with: what is free of the agent's
   *  resources. Without them the agent admits by its slots, as an agent did
   *  before leases said what they ask: no bound on cores or memory, and the
   *  GPUs its report says are free. */
  private offer(): RackOffer {
    if (this.options.resources !== undefined) return this.free(this.options.resources);
    const free = this.report().free ?? this.report().resources;
    return { cores: free?.cores ?? Number.MAX_SAFE_INTEGER, memoryBytes: free?.memoryBytes ?? Number.MAX_SAFE_INTEGER, gpus: free?.gpus ?? 0 };
  }

  /** What the agent has booked for a lease it holds, when it admits by its resources. */
  bookedFor(leaseId: string): RackLeaseResources | undefined { return this.booked.get(leaseId); }

  /** Reports health and returns the leases the hub asks this agent to stop. */
  async heartbeat(runningLeases: RackLeaseRef[] = [...this.active.values()].filter((value) => !value.silent).map((value) => value.lease)): Promise<ValueTypeOf<typeof RackHeartbeatResponseType>> {
    const response = await this.post('heartbeat', RackHeartbeatRequestType, { healthy: true, freeCapacity: BigInt(Math.max(0, this.capacity - Math.max(this.active.size, runningLeases.length))),
      runningLeases, agentVersion: this.version, bootId: this.bootId, cacheBytes: 0n, report: JSON.stringify(this.report()) }, RackHeartbeatResponseType);
    if (response.rotatedToken.type === 'some') this.token = response.rotatedToken.value;
    for (const lease of response.stop) this.active.get(lease.leaseId)?.stop.abort();
    return response;
  }

  /** Claims a lease, or answers null after an idle poll window. */
  async claim(): Promise<RackLeaseGrant | null> {
    if (this.faults.claimDelayMs) await delay(this.faults.claimDelayMs, undefined, { signal: this.abort.signal });
    const response = await this.raw('lease', RackLeaseRequestType, { tiers: this.tiers, bootId: this.bootId, offer: JSON.stringify(this.offer()) });
    this.waitingFor = readRackWaiting(response.headers.get(RACK_WAITING_HEADER));
    if (response.status === 204) return null;
    if (response.status !== 200) throw await this.refused('claim', response);
    const grant = decodeBeast2For(RackLeaseGrantType)(new Uint8Array(await response.arrayBuffer()));
    // Booked from the claim until the lease is completed or its execution ends.
    const needs = this.options.resources === undefined ? undefined : readRackLeaseResources((JSON.parse(grant.eventJson) as RackLeaseEvent).resources);
    if (needs !== undefined) {
      this.booked.set(grant.leaseId, needs);
      const held = [...this.booked.values()];
      this.bookedMost.leases = Math.max(this.bookedMost.leases, held.length);
      this.bookedMost.cores = Math.max(this.bookedMost.cores, held.reduce((sum, lease) => sum + lease.cores, 0));
      this.bookedMost.memoryBytes = Math.max(this.bookedMost.memoryBytes, held.reduce((sum, lease) => sum + lease.memoryBytes, 0));
    }
    return grant;
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
  async complete(lease: RackLeaseRef, result: RackLeaseResult): Promise<ValueTypeOf<typeof RackCompleteResponseType>> {
    try {
      return await this.post('complete', RackCompleteRequestType, { repo: lease.repo, leaseId: lease.leaseId,
        resultJson: JSON.stringify(result), inlineOutput: none, outputUploadId: none }, RackCompleteResponseType);
    } finally { this.booked.delete(lease.leaseId); }
  }

  /**
   * Runs one object transfer, when the agent has one free: it has no more in
   * flight than its source serves it at once.
   */
  private async transfer<T>(run: () => Promise<T>): Promise<T> {
    const limit = this.options.transfersAtOnce ?? this.sourceTransfers;
    while (this.inFlight >= limit) await new Promise<void>((resolve) => { this.waiting.push(resolve); });
    this.inFlight++;
    this.transfers.peak = Math.max(this.transfers.peak, this.inFlight);
    try { return await run(); } finally { this.inFlight--; this.waiting.shift()?.(); }
  }

  /**
   * Gives one transfer its tries, by what its source answers: one that says
   * it is busy (429) is waited for, for as long as it says, and that is no
   * try; a request it refuses (another 4xx but 408) is not sent again; and a
   * try that otherwise fails is followed by another after a wait that
   * doubles, five in all.
   * @param what - The transfer, for the error
   * @param signal - Ends the transfer with its lease
   * @param of - The lease's transfers, which take note of each retry
   * @param attempt - One try: nothing once the transfer is done, else the
   *   response that was no success
   * @throws {TransferFailed} When the last try has failed
   */
  private async tries(what: string, signal: AbortSignal, of: Transfers | undefined, attempt: (deadline: AbortSignal) => Promise<Response | void>): Promise<void> {
    let cause: unknown;
    for (let failed = 0; failed < TRANSFER_TRIES;) {
      if (signal.aborted) throw new Error(`${what} was stopped`);
      try {
        if (this.consume('failTransferNext')) throw new Error('injected transfer failure');
        const response = await attempt(AbortSignal.any([signal, AbortSignal.timeout(this.options.timings?.transferMs ?? 30000)]));
        if (response === undefined) return;
        const text = await response.text();
        if (response.status === 429) {
          this.transfers.busy++;
          await delay(readRackRefusal(text)?.retryAfterMs ?? 500, undefined, { signal });
          continue;
        }
        if (response.status >= 400 && response.status < 500 && response.status !== 408) throw new TransferRefused(`${what}: HTTP ${response.status}${text === '' ? '' : ` ${text.slice(0, 200)}`}`);
        throw new Error(`HTTP ${response.status}`);
      } catch (error) {
        if (signal.aborted || error instanceof TransferRefused) throw error;
        cause = error;
        failed++;
        if (failed < TRANSFER_TRIES) {
          this.transfers.retried++;
          of?.retries.push({ transfer: of.transfer, attempt: failed + 1, of: TRANSFER_TRIES, cause: error instanceof Error ? error.message : String(error) });
          await delay(Math.min(30_000, (this.options.timings?.retryMs ?? 1000) * 2 ** (failed - 1)), undefined, { signal });
        }
      }
    }
    const why = cause instanceof Error ? cause.message : String(cause);
    throw new TransferFailed(`${what} failed after ${TRANSFER_TRIES} tries: ${why}`, of?.transfer ?? 'input', TRANSFER_TRIES, why);
  }

  /**
   * Reads one object, or one layer of an environment, through its data URL.
   * A try that a link cut short keeps the bytes it carried, and the next asks
   * for the rest from the byte after them; a URL whose time ended is asked
   * for again.
   * @param again - Asks for the URL anew: an object's, unless given
   */
  private async download(lease: RackLeaseRef, hash: string, firstUrl: string, signal: AbortSignal, of?: Transfers,
    again: () => Promise<string | undefined> = async () => {
      const object = (await this.storageRequest(lease, { need: [hash] })).objects[0];
      return object?.type === 'url' ? object.value.url : undefined;
    }): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    let have = 0;
    let url = firstUrl;
    await this.transfer(() => this.tries(`Rack input ${hash}`, signal, of, async (deadline) => {
      const response = await this.transport(url, { headers: have > 0 ? { range: `bytes=${have}-` } : {}, signal: deadline });
      if (response.status === 404 || response.status === 410) {
        // The URL's fifteen minutes ended, or its session went: the same
        // bytes are asked for again, which mints their URL anew.
        await response.arrayBuffer();
        const issued = await again();
        if (issued === undefined) throw new Error(`HTTP ${response.status}, and no new URL`);
        url = issued;
        throw new Error(`HTTP ${response.status}: its URL was issued again`);
      }
      // A source that does not resume answers the whole object again.
      if (have > 0 && response.status === 200) { parts.length = 0; have = 0; }
      else if (response.status !== (have > 0 ? 206 : 200)) return response;
      if (response.status === 206) this.transfers.resumed++;
      if (response.body === null) throw new Error('no body');
      for await (const chunk of response.body) { parts.push(chunk); have += chunk.length; }
    }));
    return Buffer.concat(parts);
  }

  /**
   * Fetches objects of a held lease into the agent's own store, through
   * inline descriptors or capability URLs, each checked against its hash.
   * @param lease - The lease that may read them
   * @param hashes - The objects; one the store holds already is not fetched
   * @param signal - Ends the transfers with the lease
   * @param of - The lease's transfers, which take note of each retry
   */
  async fetch(lease: RackLeaseRef, hashes: readonly string[], signal: AbortSignal = this.abort.signal, of?: Transfers): Promise<void> {
    for (let from = 0; from < hashes.length; from += 256) {
      const need: string[] = [];
      for (const hash of hashes.slice(from, from + 256)) if (!await this.storage.objects.exists(this.repo, hash)) need.push(hash);
      if (need.length === 0) continue;
      const response = await this.storageRequest(lease, { need });
      await Promise.all(response.objects.map(async (object) => {
        const bytes = object.type === 'inline' ? object.value.data : await this.download(lease, object.value.hash, object.value.url, signal, of);
        if (await this.storage.objects.write(this.repo, bytes) !== object.value.hash) throw new Error('Rack input checksum mismatch');
      }));
    }
  }

  /** Whether the agent's store holds an object: what a fetch left there. */
  holds(hash: string): Promise<boolean> { return this.storage.objects.exists(this.repo, hash); }

  /** The directory a lease's environment is composed in: under it, where a
   *  guest finds one. */
  composedAt(envHash: string): string {
    return join(this.options.workDir, 'env', envHash, ...ENVIRONMENT_LAYER_ROOT.split('/'));
  }

  /**
   * Composes a held lease's environment from the layers its source keeps, and
   * links it where e3-core looks for a built environment, so the lease's work
   * installs nothing. Each layer is checked against its digest and its size
   * before it is unpacked, and an environment composed for an earlier lease
   * is used as it is.
   * @param lease - The lease that names the environment
   * @param envHash - The environment spec's hash
   * @param signal - Ends the transfers with the lease
   * @param of - The lease's transfers, which take note of each retry
   * @throws {Error} When the source publishes no layers for it, or a layer is
   *   not the bytes its manifest names
   */
  async compose(lease: RackLeaseRef, envHash: string, signal: AbortSignal = this.abort.signal, of?: Transfers): Promise<void> {
    const root = join(this.options.workDir, 'env', envHash);
    const composed = join(root, '.composed');
    if (!await access(composed).then(() => true, () => false)) {
      const published = async () => {
        const { env } = await this.storageRequest(lease, { envManifest: some(envHash) });
        if (env.type !== 'some') throw new Error(`The source answered no layers for the environment ${envHash}`);
        return env.value;
      };
      const { manifestJson, layers } = await published();
      if ((JSON.parse(manifestJson) as EnvLayerManifest).envHash !== envHash) throw new Error(`The source answered another environment's manifest for ${envHash}`);
      await rm(root, { recursive: true, force: true });
      await mkdir(root, { recursive: true });
      for (const layer of layers) {
        const bytes = await this.download(lease, layer.digest, layer.url, signal, of,
          async () => (await published()).layers.find((candidate) => candidate.digest === layer.digest)?.url);
        if (bytes.length !== Number(layer.sizeBytes) || `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== layer.digest) {
          throw new Error(`Rack environment layer ${layer.digest} is not the bytes its manifest names`);
        }
        await unpackEnvironmentLayer(Readable.from([bytes]), root);
      }
      await writeFile(composed, '');
    }
    await linkPrebuiltEnvironment(this.repo, { hash: envHash, dir: this.composedAt(envHash) });
  }

  /** Executes one claimed task/unit with the production core over the fetched closure. */
  execute(lease: RackLeaseGrant): Promise<RackLeaseResult> {
    if (this.active.has(lease.leaseId)) throw new Error('Test rack lease is already executing');
    const stop = new AbortController();
    const done = this.executeClaim(lease, stop).finally(() => { this.active.delete(lease.leaseId); this.booked.delete(lease.leaseId); });
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
        ...(infra ? {} : { exitCode: 1 }), error: infra ? 'Injected infrastructure failure' : 'Injected task failure',
        reason: infra ? { code: 'guest-crashed', detail: 'Injected infrastructure failure' } : { code: 'task-error' } };
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
    // The lease's transfers, in and then out, and the retries they make.
    const transfers: Transfers = { transfer: 'input', retries: [] };
    const retries = () => (transfers.retries.length > 0 ? { retries: transfers.retries } : {});
    try {
      if ('object' in event.closure) await this.fetch(lease, [event.closure.object], signal, transfers);
      await this.fetch(lease, await closureHashes(event.closure, (hash) => this.storage.objects.read(this.repo, hash)), signal, transfers);
      if (event.environment !== undefined) {
        try {
          await this.compose(lease, event.environment, signal, transfers);
        } catch (error) {
          // An environment the rack could not compose is the rack's fault,
          // with its reason, for its source to place the work elsewhere.
          if (error instanceof TransferFailed || signal.aborted) throw error;
          const detail = error instanceof Error ? error.message : String(error);
          const failed: RackLeaseResult = { taskName: event.taskName, status: 'failed', state: 'error', error: detail,
            reason: { code: 'environment-failed', detail }, ...retries() };
          if (!this.abort.signal.aborted) await this.complete(lease, failed);
          return failed;
        }
      }
      const options = { force: true, signal, timeout: run.timeoutMs, verbose: run.verbose,
        onStdout: (data: string) => { chunks.push({ stream: variant('stdout', null), data }); },
        onStderr: (data: string) => { chunks.push({ stream: variant('stderr', null), data }); } };
      const result = run.mode === 'task'
        ? await taskExecute(this.storage, this.repo, run.taskHash, [...run.inputHashes], options)
        : await taskExecuteUnit(this.storage, this.repo, run.taskHash, splitUnitFromWire(run.unit), options);
      if (chunks.length > 0) await this.logs(lease, chunks);
      // The cap the lease asked, stood in for by the peak its runner is taken
      // to have reached: above it, the work was stopped, and nothing is sent.
      const peakBytes = this.options.peak === undefined ? result.peakBytes : await this.options.peak(lease, result.peakBytes);
      const needs = readRackLeaseResources(event.resources);
      if (needs !== undefined && peakBytes !== undefined && peakBytes > needs.memoryBytes) {
        const stopped: RackLeaseResult = { taskName: event.taskName, status: 'failed', state: 'error', peakBytes: needs.memoryBytes,
          error: `the runner outgrew its cap of ${needs.memoryBytes} bytes`, reason: { code: 'outgrew-cap', capBytes: needs.memoryBytes, peakBytes }, ...retries() };
        if (!this.abort.signal.aborted) await this.complete(lease, stopped);
        return stopped;
      }
      if (result.state === 'success' && result.outputHash !== null) {
        transfers.transfer = 'output';
        const readers = gcObjectReaders(this.storage, this.repo);
        const hashes = [...await markReachable(readers.readObject, new Set([result.outputHash]), { readHead: readers.readHead })];
        for (const hash of hashes) {
          const bytes = await this.storage.objects.read(this.repo, hash);
          const size = BigInt(bytes.length);
          const targets = await this.storageRequest(lease, { outputs: [{ hash, size }] });
          const target = targets.targets[0]!.target;
          if (target.type === 'held') continue;
          // A PUT is sent whole each try: its source answers one it has
          // already taken with the same receipt.
          let version: string | null = null;
          await this.transfer(() => this.tries(`Rack output ${hash}`, signal, transfers, async (deadline) => {
            const put = await this.transport(target.value.url, { method: 'PUT', headers: Object.fromEntries(target.value.headers), body: bytes, signal: deadline });
            if (!put.ok) return put;
            version = put.headers.get('x-amz-version-id');
            await put.arrayBuffer();
          }));
          if (version === null) throw new Error('Rack upload has no receipt');
          const commit: RackObjectCommit = { hash, size, version };
          if (!(await this.storageRequest(lease, { commits: [commit] })).committed[0]?.committed) throw new Error('Rack output commit refused');
        }
      }
      const output: RackLeaseResult = { taskName: event.taskName, status: result.state === 'success' ? 'success' : 'failed',
        state: result.state, ...(result.outputHash === null ? {} : { outputHash: result.outputHash }),
        ...(result.exitCode == null ? {} : { exitCode: result.exitCode }), ...(result.error == null ? {} : { error: result.error }),
        ...(peakBytes === undefined ? {} : { peakBytes }), cancelled: signal.aborted,
        ...(result.state === 'failed' ? { reason: { code: 'task-error' } } : {}), ...retries() };
      if (!this.consume('dropCompletionNext') && !this.abort.signal.aborted) await this.complete(lease, output);
      return output;
    } catch (error) {
      // A transfer that failed its last try ends the lease: the rack's
      // fault, with its reason, for its source to place the work elsewhere.
      if (!(error instanceof TransferFailed) || signal.aborted) throw error;
      const output: RackLeaseResult = { taskName: event.taskName, status: 'failed', state: 'error', error: error.message,
        reason: { code: `${error.transfer}-transfer-failed`, attempts: error.attempts, cause: error.why }, ...retries() };
      if (!this.abort.signal.aborted) await this.complete(lease, output);
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
