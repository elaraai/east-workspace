/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What the hub's specs share: a hub of a test's own, its repository and
 * sessions, the racks it enrolls, and the leases' events they submit.
 */

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IntegerType, encodeBeast2For, none, some, variant, type ValueTypeOf } from '@elaraai/east';
import { LocalStorage, processOwner, repoInit, tierManifestDigest, uuidv7 } from '@elaraai/e3-core';
import { RackHub, type RackHubOptions } from './hub.js';
import { defaultHubConfig, loadHubCertificate, saveHubConfig, type HubConfig } from './config.js';
import { socketRequest } from '../client/local-http.js';
import { startSessionDataServer } from '../client/session-data-server.js';
import { hubSocketPath } from '../paths.js';
import { E3_RACK_VERSION, HUB_PROTOCOL } from '../version.js';
import { AttachLeaseResultType, CancelLeaseResultType, CreateLeaseType, CreateLeaseResultType, EmptyType, HubEnrollResultType, HubEnrollType, HubStatusType,
  OpenSessionType, OpenSessionResultType, SessionPollType, SessionPollResultType } from '../protocol/control.js';
import { TestRackAgent, type TestRackAgentOptions } from '../testing/test-rack-agent.js';
import { SlowLink, type SlowLinkOptions } from '../testing/slow-link.js';
import { certificateSha256, pinnedFetch } from '../tls/tls.js';
import { type RackLeaseEvent, type RackLeaseResources } from '../protocol/task-envelope.js';
import { detachedSpecToWire } from '../runner-event.js';

/** What each test leaves to close, the last first: closed after it. */
export const cleanup: Array<() => Promise<void>> = [];

/** Closes what a test left, the last first: each spec's `afterEach`. */
export async function closeAll(): Promise<void> {
  for (const close of cleanup.splice(0).reverse()) await close();
}

/** The hub's status, decoded from the control wire. */
export type HubStatus = ValueTypeOf<typeof HubStatusType>;
/** A lease's creation, decoded from the control wire. */
export type CreateLeaseResult = ValueTypeOf<typeof CreateLeaseResultType>;
/** An attach-only request's answer, decoded from the control wire. */
export type AttachLeaseResult = ValueTypeOf<typeof AttachLeaseResultType>;
/** A session's events and fleet, decoded from the control wire. */
export type SessionPollResult = ValueTypeOf<typeof SessionPollResultType>;
/** A session's leaving of a lease, decoded from the control wire. */
export type CancelLeaseResult = ValueTypeOf<typeof CancelLeaseResultType>;

/** A session a test opened on its hub, and how it leases work. */
export interface HubSession {
  readonly sessionId: string;
  readonly repoAlias: string;
  /** Ends the session, and its data socket */
  close(): Promise<void>;
  /** Leases work, naming the builds of its environment the session keeps, of a tier (`node` unless given) */
  create(event: RackLeaseEvent, envManifests?: string[], tier?: string): Promise<CreateLeaseResult>;
  /** Joins identical work queued or held, naming the builds of its environment the session keeps; queues nothing */
  attach(event: RackLeaseEvent, envManifests?: string[]): Promise<AttachLeaseResult>;
  /** The session's events since the last asked for, and the fleet */
  events(): Promise<SessionPollResult>;
  /** Leaves a lease */
  cancel(leaseId: string): Promise<CancelLeaseResult>;
  /** What the session was told of its leases' logs */
  readonly logs: string[];
}

/** What enrolls a test's rack: the agent's options, and the release its version names. */
export type HubAgentOptions = Pick<TestRackAgentOptions, 'report' | 'protocol' | 'capacity' | 'transfersAtOnce' | 'timings' | 'faults' | 'resources' | 'label' | 'manifestEveryHeartbeat' | 'splitScopes' | 'hubKeyedScopes' | 'hubScopeIdleMs' | 'tiers'>
  & { version?: string };

/** A hub of a test's own, and how the test reaches it. */
export interface HubFixture {
  readonly home: string;
  readonly hub: RackHub;
  /** The hub's control socket */
  readonly socket: string;
  /** The repository its sessions serve */
  readonly repo: string;
  readonly storage: LocalStorage;
  status(): Promise<HubStatus>;
  /** Opens a session of a repository, at an e3 release: the fixture's, at this one's, unless given */
  session(repoPath?: string, version?: string): Promise<HubSession>;
  /** Enrolls a rack, reaching the hub at its listener or the origin given */
  agent(as?: HubAgentOptions, origin?: string): Promise<TestRackAgent>;
  /** A slow link to the hub's listener, and the origin an agent reaches the hub at through it */
  link(faults: Omit<SlowLinkOptions, 'target'>): Promise<{ link: SlowLink; origin: string }>;
  /** Objects of random bytes in the session's repository, by hash */
  objects(count: number, size: number): Promise<Map<string, Buffer>>;
  readonly config: HubConfig;
  /** The certificate a rack pins, when the listener serves TLS */
  readonly pin: string | undefined;
  /** Fetches from the listener, pinning its certificate */
  readonly fetch: typeof fetch;
}

/** A hub of its own, its repository, and how a test opens sessions, enrolls racks and reaches the hub. */
export async function fixture(options: RackHubOptions = {}, port = 0, overrides: Partial<HubConfig> = {}): Promise<HubFixture> {
  const home = await mkdtemp(join(tmpdir(), 'e3h-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const config: HubConfig = { ...defaultHubConfig(), listen: some({ host: '127.0.0.1', port: BigInt(port) }), ...overrides };
  await saveHubConfig(config, home);
  const hub = new RackHub({ foreground: true, ...options, home });
  assert(await hub.start());
  cleanup.push(() => hub.stop());
  // A TLS listener made its certificate as it bound, whether or not the bind succeeded.
  const pin = config.tls ? certificateSha256((await loadHubCertificate(home)).certificatePem) : undefined;
  const fetch = pin === undefined ? globalThis.fetch : pinnedFetch(pin);
  const socket = hubSocketPath(home);
  const status = (): Promise<HubStatus> => socketRequest(socket, 'GET', '/v1/status', { responseType: HubStatusType });
  const storage = new LocalStorage();
  const repo = join(home, 'repo'); assert(repoInit(repo).success);
  const session = async (repoPath = repo, version = E3_RACK_VERSION): Promise<HubSession> => {
    const dataToken = randomUUID();
    const logs: string[] = [];
    const data = await startSessionDataServer({ storage, repoPath, home, dataToken, onLog: (_id, _stream, text) => { logs.push(text); } });
    const opened = await socketRequest(socket, 'POST', '/v1/sessions', { requestType: OpenSessionType, responseType: OpenSessionResultType, body: {
      protocol: BigInt(HUB_PROTOCOL), e3Version: version, owner: await processOwner(), repoPath: await realpath(repoPath),
      workspace: 'dev', label: 'test session', dataSocket: data.socketPath, dataToken,
    } });
    const path = `/v1/sessions/${opened.sessionId}`;
    const close = async () => { await socketRequest(socket, 'DELETE', path, { responseType: EmptyType }).catch(() => {}); await data.close(); };
    cleanup.push(close);
    const create = (event: RackLeaseEvent, envManifests: string[] = [], tier = 'node'): Promise<CreateLeaseResult> => socketRequest(socket, 'POST', `${path}/leases`, {
      requestType: CreateLeaseType, body: { eventJson: JSON.stringify(event), tier, computeSize: 'large', envManifests }, responseType: CreateLeaseResultType,
    });
    const attach = (event: RackLeaseEvent, envManifests: string[] = []): Promise<AttachLeaseResult> => socketRequest(socket, 'POST', `${path}/leases/attach`, {
      requestType: CreateLeaseType, body: { eventJson: JSON.stringify(event), tier: 'node', computeSize: 'large', envManifests }, responseType: AttachLeaseResultType,
    });
    let after = 0n;
    const events = async (): Promise<SessionPollResult> => {
      const response = await socketRequest(socket, 'POST', `${path}/events`, {
        requestType: SessionPollType, body: { after, waitMs: 0n }, responseType: SessionPollResultType,
      });
      after = response.events.at(-1)?.seq ?? after;
      return response;
    };
    const cancel = (id: string) => socketRequest(socket, 'POST', `${path}/leases/${encodeURIComponent(id)}/cancel`, { responseType: CancelLeaseResultType });
    return { ...opened, close, create, attach, events, cancel, logs };
  };
  const agent = async (as: HubAgentOptions = {}, origin?: string): Promise<TestRackAgent> => {
    const mint = await socketRequest(socket, 'POST', '/v1/enroll', { requestType: HubEnrollType,
      body: { label: none, ttlMinutes: none }, responseType: HubEnrollResultType });
    assert.equal(mint.certificateSha256.type === 'some' ? mint.certificateSha256.value : undefined, pin);
    const agent = await TestRackAgent.enroll(origin ?? mint.apiUrl, mint.enrollmentToken, { certificateSha256: pin, ...as });
    cleanup.push(() => agent.close());
    return agent;
  };
  /** A slow link to the hub's listener, and the origin an agent reaches the hub at through it. */
  const link = async (faults: Omit<SlowLinkOptions, 'target'>) => {
    const listener = (await status()).rackListener; assert(listener.type === 'up');
    const url = new URL(listener.value.origin);
    const link = await SlowLink.open({ target: { host: url.hostname, port: Number(url.port) }, ...faults });
    cleanup.push(() => link.close());
    return { link, origin: `${url.protocol}//${url.hostname}:${link.port}` };
  };
  /** Objects of random bytes in the session's repository, by hash. */
  const objects = async (count: number, size: number) => {
    const written = new Map<string, Buffer>();
    for (let n = 0; n < count; n++) { const bytes = randomBytes(size); written.set(await storage.objects.write(repo, bytes), bytes); }
    return written;
  };
  return { home, hub, socket, repo, storage, status, session, agent, link, objects, config, pin, fetch };
}

/** A tier image's manifest, as its script writes it, of the Python and the
 *  distributions given: its text, and its digest. */
export function tierImage(python = '3.11.2', distributions: Array<{ name: string; version: string; files: string }> = []): { text: string; digest: string } {
  const text = `${JSON.stringify({ distributions, namespaces: [], python: { base: '/usr/bin/python3', executable: '/opt/venv/bin/python',
    site: '/opt/venv/lib/python3.11/site-packages', version: python }, version: 1 })}\n`;
  return { text, digest: tierManifestDigest(new TextEncoder().encode(text)) };
}

/** A task's lease event, of the inputs given, asking what is given of a rack. */
export function event(input: string[] = [], resources?: RackLeaseResources): RackLeaseEvent {
  return { version: 2, taskName: 'task', workspace: 'dev', closure: { hashes: input }, ...(resources !== undefined && { resources }),
    runnerEvent: { mode: 'task', repo: 'replaced-by-hub', taskHash: 'a'.repeat(64), inputHashes: input, launchId: uuidv7(), timeoutMs: 30000 } };
}

/** A call of a program, by its hash, with one integer argument: its lease's event. */
export function call(program: string, argument: bigint): RackLeaseEvent {
  return { version: 2, taskName: 'fn:double', workspace: 'dev', program, closure: { hashes: [program] },
    resources: { kind: 'task', cores: 1, memoryBytes: 1024 ** 3, gpu: false },
    runnerEvent: { mode: 'run-detached', repo: 'replaced-by-hub', launchId: uuidv7(), timeoutMs: 30000,
      spec: detachedSpecToWire({ bodyIr: new Uint8Array(), args: [encodeBeast2For(IntegerType)(argument)],
        runner: variant('east_node', { platforms: [], decode: variant('lazy', null) }), limits: { timeoutMs: 30000, maxResultBytes: 1024, maxLogBytes: 1024 } }) } };
}
