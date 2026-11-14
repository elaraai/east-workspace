/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Server } from 'node:http';
import { createAdaptorServer } from '@hono/node-server';
import { BooleanType, decodeBeast2For, encodeBeast2For, none, some, variant, type EastType, type ValueTypeOf } from '@elaraai/east';
import { BEAST2_CONTENT_TYPE } from '@elaraai/e3-types';
import { uuidv7 } from '@elaraai/e3-core';
import { InMemoryMachineIdentityStore } from '../identity/in-memory-identity-store.js';
import { generateEnrollmentToken, ROTATION_AGE_MS, ROTATION_GRACE_MS } from '../identity/machine-identity.js';
import { InMemoryRackRegistry } from '../registry/rack-registry.js';
import { InMemoryRackLeaseStore } from '../lease/in-memory-lease-store.js';
import { InMemoryLeaseCoordinator } from '../lease/coordinator.js';
import { StoreRackDispatch, bundledE3Version } from './dispatch.js';
import { createRackRoutes, type RackAttemptStore, type RackRouteOptions } from './rack-routes.js';
import type { RackStorageBridge } from './storage-bridge.js';
import {
  RackEnrollRequestType, RackEnrollResponseType, RackHeartbeatRequestType, RackHeartbeatResponseType,
  RackLeaseRequestType, RackLeaseGrantType, RackCompleteRequestType, RackCompleteResponseType,
  RackStorageRequestType, RackStorageResponseType, RackLogsRequestType,
  RACK_PROTOCOL, RACK_PROTOCOL_HEADER, readRackHello, readRackRefusal,
  type RackLeaseEvent, type RackLeaseResult, type RackOffer, type RackReport,
} from '../protocol/index.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
const input = 'a'.repeat(64);
const output = 'b'.repeat(64);
const taskHash = 'c'.repeat(64);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

it('reports initial source queue time without treating a reclaim as fresh pickup', async () => {
  const f = await fixture();
  await f.enroll();
  const empty = await f.claim();
  assert.equal(empty.status, 204);
  assert.equal(empty.headers.get('x-e3-rack-queue-ms'), null);
  await f.create();
  f.advance(250);
  const initial = await f.claim();
  await f.success(initial, RackLeaseGrantType);
  assert.equal(initial.headers.get('x-e3-rack-claim-kind'), 'initial');
  assert.equal(initial.headers.get('x-e3-rack-queue-ms'), '250');
  f.advance(60_001);
  await f.enroll();
  const reclaimed = await f.claim();
  await f.success(reclaimed, RackLeaseGrantType);
  assert.equal(reclaimed.headers.get('x-e3-rack-claim-kind'), 'reclaimed');
  assert.equal(reclaimed.headers.get('x-e3-rack-queue-ms'), null);
});

it('omits negative source clock observations and timings on unauthenticated requests', async () => {
  const f = await fixture();
  await f.enroll();
  await f.create();
  f.advance(-10);
  const response = await f.claim();
  await f.success(response, RackLeaseGrantType);
  assert.equal(response.headers.get('x-e3-rack-claim-kind'), 'initial');
  assert.equal(response.headers.get('x-e3-rack-queue-ms'), null);
  const refused = await f.raw('lease', RackLeaseRequestType, { tiers: ['node'], bootId: 'boot', offer: f.offer }, 'invalid');
  assert.equal(refused.status, 401);
  assert.equal(refused.headers.get('x-e3-rack-claim-kind'), null);
  assert.equal(refused.headers.get('x-e3-rack-queue-ms'), null);
});

async function fixture(options: RackRouteOptions = {}) {
  let time = Date.now();
  const now = () => time;
  const identities = new InMemoryMachineIdentityStore();
  const registry = new InMemoryRackRegistry();
  const leases = new InMemoryRackLeaseStore(now);
  const coordinator = new InMemoryLeaseCoordinator();
  const calls: string[] = [];
  let whole = true;
  let beforeOutcome = () => Promise.resolve();
  const attempts: RackAttemptStore = {
    closure: async () => [input],
    running: async (lease) => { calls.push(`running:${lease.attempt!.executionId}`); },
    stopped: async (_lease, how) => { calls.push(how); },
    outcome: async () => { await beforeOutcome(); calls.push('outcome'); },
    verifyOutput: async () => { calls.push('verify'); return whole; },
    logs: {
      append: async (_repo, _task, _inputs, execution, stream, data) => { calls.push(`log:${execution}:${stream}:${data}`); },
      flush: async () => { calls.push('flush'); },
    },
  };
  const unsupported = async (): Promise<never> => { throw new Error('Unexpected bridge operation'); };
  const bridge: RackStorageBridge = {
    readDescriptor: async () => ({ kind: 'inline', data: new Uint8Array([1, 2, 3]) }),
    writeTarget: async () => { calls.push('target'); return { url: 'http://upload.invalid/object', headers: {} }; },
    commitWrite: async () => { calls.push('commit'); return true; },
    discardWrites: async () => { calls.push('discard'); return 0; },
    stagedTarget: unsupported, commitStaged: unsupported, writeInline: unsupported,
    readEnvManifest: async () => null, presignEnvLayer: unsupported,
  };
  const dispatch = new StoreRackDispatch(leases, registry, { now, coordinator, endings: { stopped: attempts.stopped, writes: bridge } });
  const app = createRackRoutes(identities, registry, leases, bridge, attempts, {
    now, coordinator, leaseWindowMs: 15, pollIntervalMs: 5,
    onLeaseSignal: (signal) => { calls.push(signal.kind); }, ...options,
  });
  const server = createAdaptorServer({ fetch: app.fetch });
  assert(server instanceof Server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanups.push(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const address = server.address();
  assert(address !== null && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  let token = '';
  const raw = async <T extends EastType>(path: string, type: T, value: ValueTypeOf<T>, bearer = token, protocol: string | null = String(RACK_PROTOCOL)) => fetch(`${origin}/api/rack/${path}`, {
    method: 'POST', headers: { 'content-type': BEAST2_CONTENT_TYPE, authorization: `Bearer ${bearer}`, ...(protocol === null ? {} : { [RACK_PROTOCOL_HEADER]: protocol }) },
    body: encodeBeast2For(type)(value), signal: AbortSignal.timeout(5000),
  });
  /** A refusal: its status, and its code in the JSON body. */
  const refusal = async (response: Response, status: number, code: string): Promise<string> => {
    assert.equal(response.status, status);
    const body = readRackRefusal(await response.text());
    assert(body !== null, 'a refusal\'s body is JSON');
    assert.equal(body.code, code);
    return body.message;
  };
  const success = async <T extends EastType>(response: Response, type: T): Promise<ValueTypeOf<T>> => {
    assert.equal(response.status, 200);
    return decodeBeast2For(type)(new Uint8Array(await response.arrayBuffer()));
  };
  const offer = JSON.stringify({ cores: 1, memoryBytes: 2 ** 40, gpus: 0 });
  const report = JSON.stringify({ features: [] });
  const enroll = async (version = '0.5.0+e3.1.0.85', activate = true, capacity = 2n) => {
    const mint = generateEnrollmentToken();
    await identities.putEnrollmentToken(mint.tokenHash, new Date(time + 60_000));
    const request = { enrollmentToken: mint.token, hostInfo: { label: 'test rack', tiers: ['node'], capacity, agentVersion: version } };
    const response = await success(await raw('enroll', RackEnrollRequestType, request), RackEnrollResponseType);
    token = response.rackToken;
    if (activate) await success(await raw('heartbeat', RackHeartbeatRequestType, {
      healthy: true, freeCapacity: capacity, runningLeases: [], agentVersion: version, bootId: 'boot', cacheBytes: 0n, report,
    }), RackHeartbeatResponseType);
    return { ...response, request };
  };
  const create = async () => {
    const event: RackLeaseEvent = {
      version: 2, workspace: 'dev', taskName: 'task', e3Version: '1.0.85', closure: { hashes: [input] },
      runnerEvent: { mode: 'task', repo: 'repo', taskHash, inputHashes: [input], launchId: uuidv7(), timeoutMs: 60_000 },
    };
    return dispatch.createLease(event, 'node');
  };
  const claim = (offered = offer) => raw('lease', RackLeaseRequestType, { tiers: ['node'], bootId: 'boot', offer: offered });
  const complete = (leaseId: string, result: RackLeaseResult = { taskName: 'task', status: 'success', outputHash: output }) =>
    raw('complete', RackCompleteRequestType, { repo: 'repo', leaseId, resultJson: JSON.stringify(result), outputUploadId: none, inlineOutput: none });
  const heartbeat = (leaseId?: string, bearer?: string) => raw('heartbeat', RackHeartbeatRequestType, {
    healthy: true, freeCapacity: 1n, runningLeases: leaseId ? [{ repo: 'repo', leaseId }] : [],
    agentVersion: '0.5.0+e3.1.0.85', bootId: 'boot', cacheBytes: 0n, report,
  }, bearer);
  return { origin, identities, registry, leases, coordinator, dispatch, attempts, bridge, calls, raw, refusal, success, enroll, create, claim, complete, heartbeat, offer, report,
    advance: (ms: number) => { time += ms; }, setWhole: (value: boolean) => { whole = value; },
    beforeOutcome: (operation: () => Promise<void>) => { beforeOutcome = operation; },
  };
}

it('enrolls once, authenticates machines only, rotates credentials and revokes immediately', async () => {
  const f = await fixture();
  const enrolled = await f.enroll();
  assert.equal((await f.raw('enroll', RackEnrollRequestType, enrolled.request)).status, 401);
  assert.equal((await f.heartbeat(undefined, 'human-jwt')).status, 401);
  f.advance(ROTATION_AGE_MS + 1);
  const beat = await f.success(await f.heartbeat(), RackHeartbeatResponseType);
  assert.equal(beat.rotatedToken.type, 'some');
  if (beat.rotatedToken.type !== 'some') throw new Error('rotation not offered');
  await f.success(await f.heartbeat(undefined, beat.rotatedToken.value), RackHeartbeatResponseType);
  await f.success(await f.heartbeat(), RackHeartbeatResponseType);
  f.advance(ROTATION_GRACE_MS + 1);
  assert.equal((await f.heartbeat()).status, 401);
  await f.registry.deleteRack(enrolled.rackId);
  assert.equal((await f.heartbeat(undefined, beat.rotatedToken.value)).status, 401);
});

it('claims one attempt, scopes reads, flushes logs and verifies the whole output before completing', async () => {
  const f = await fixture();
  await f.enroll();
  const lease = await f.create();
  const grant = await f.success(await f.claim(), RackLeaseGrantType);
  assert.equal(grant.leaseId, lease.leaseId);
  const attempt = (await f.leases.get('repo', lease.leaseId))!.attempt!;
  assert.deepEqual(f.calls, [`running:${attempt.executionId}`, 'claimed']);
  const request = { repo: 'repo', leaseId: lease.leaseId, need: [input], output: none, envManifest: none, outputs: [], commits: [] };
  const objects = await f.success(await f.raw('storage', RackStorageRequestType, request), RackStorageResponseType);
  assert.equal(objects.objects[0]!.type, 'inline');
  assert.equal((await f.raw('storage', RackStorageRequestType, { ...request, need: [output] })).status, 403);
  await f.success(await f.raw('logs', RackLogsRequestType, {
    repo: 'repo', leaseId: lease.leaseId, chunks: [{ stream: variant('stdout', null), data: 'hello' }],
  }), BooleanType);
  assert(f.calls.includes(`log:${attempt.executionId}:stdout:hello`));
  f.setWhole(false);
  // Not whole in the store: refused as content to put right, the lease kept.
  await f.refusal(await f.complete(lease.leaseId), 422, 'output-incomplete');
  assert.equal((await f.leases.get('repo', lease.leaseId))!.status, 'claimed');
  assert(!f.calls.includes('outcome'));
  f.setWhole(true);
  assert.equal((await f.success(await f.complete(lease.leaseId), RackCompleteResponseType)).disposition.type, 'recorded');
  assert.deepEqual(f.calls.slice(-4), ['verify', 'flush', 'outcome', 'completed']);
  assert.equal((await f.success(await f.complete(lease.leaseId), RackCompleteResponseType)).disposition.type, 'idempotent');
  assert.equal(f.calls.filter((call) => call === 'outcome').length, 1);
});

it('serializes completion and cancellation across the repository write and lease transition', async () => {
  const f = await fixture();
  await f.enroll();
  const lease = await f.create();
  await f.success(await f.claim(), RackLeaseGrantType);
  const entered = deferred();
  const release = deferred();
  f.beforeOutcome(async () => { entered.resolve(); await release.promise; });
  const completion = f.complete(lease.leaseId);
  await entered.promise;
  const cancellation = f.dispatch.cancel('repo', lease.leaseId);
  release.resolve();
  assert.equal((await f.success(await completion, RackCompleteResponseType)).disposition.type, 'recorded');
  assert.equal((await cancellation)!.status, 'completed');
  assert(!f.calls.includes('cancelled'));
  const cancelled = await f.create();
  await f.success(await f.claim(), RackLeaseGrantType);
  await f.dispatch.cancel('repo', cancelled.leaseId);
  const writes = f.calls.length;
  assert.equal((await f.success(await f.complete(cancelled.leaseId), RackCompleteResponseType)).disposition.type, 'discarded');
  assert.deepEqual(f.calls.slice(writes), ['completed']);
  const beat = await f.success(await f.heartbeat(cancelled.leaseId), RackHeartbeatResponseType);
  assert.deepEqual(beat.stop, [{ repo: 'repo', leaseId: cancelled.leaseId }]);
});

it('reclaims under a fresh attempt and refuses the previous claimant', async () => {
  const f = await fixture();
  const first = await f.enroll();
  const lease = await f.create();
  await f.success(await f.claim(), RackLeaseGrantType);
  const prior = (await f.leases.get('repo', lease.leaseId))!.attempt!;
  f.advance(60_001);
  await f.enroll();
  await f.success(await f.claim(), RackLeaseGrantType);
  const next = (await f.leases.get('repo', lease.leaseId))!.attempt!;
  assert.notEqual(next.executionId, prior.executionId);
  assert.deepEqual(f.calls.slice(-3), ['interrupted', `running:${next.executionId}`, 'claimed']);
  const response = await f.raw('complete', RackCompleteRequestType, {
    repo: 'repo', leaseId: lease.leaseId, resultJson: JSON.stringify({ taskName: 'task', status: 'failed' }),
    outputUploadId: none, inlineOutput: none,
  }, first.rackToken);
  assert.equal((await f.success(response, RackCompleteResponseType)).disposition.type, 'discarded');
});

it('refuses obsolete agents and checks compatibility when claiming', async () => {
  const f = await fixture({ canClaim: (rack, lease) => bundledE3Version(rack.agentVersion) === lease.event.e3Version });
  const old = await f.enroll('0.4.0');
  const lease = await f.create();
  assert.match(await f.refusal(await f.claim(), 426, 'upgrade-required'), /older than 0\.5\.0/);
  const record = (await f.registry.getRack(old.rackId))!;
  await f.registry.putRack({ ...record, agentVersion: '0.5.0+e3.1.0.84' });
  assert.equal((await f.claim()).status, 204);
  assert.equal((await f.leases.get('repo', lease.leaseId))!.status, 'pending');
  await f.registry.putRack({ ...record, agentVersion: '0.5.0+e3.1.0.85', approvedBootId: some('different-boot') });
  await f.registry.putRackSecurityPolicy({ requireStartApproval: true });
  assert.equal((await f.claim()).status, 204);
  await f.registry.putRack({ ...record, agentVersion: '0.5.0+e3.1.0.85', approvedBootId: some('boot') });
  assert.equal((await f.success(await f.claim(), RackLeaseGrantType)).leaseId, lease.leaseId);
});

it('rejects malformed completion metadata before writing an attempt outcome', async () => {
  const f = await fixture(); await f.enroll(); const lease = await f.create();
  await f.success(await f.claim(), RackLeaseGrantType);
  for (const invalid of [{ state: 'bogus' }, { state: 'failed' }, { exitCode: 0.5 }, { peakBytes: -1 }, { duration: -1 }, { outputHash: '../other' }, { cancelled: 'yes' }]) {
    const response = await f.raw('complete', RackCompleteRequestType, { repo: 'repo', leaseId: lease.leaseId,
      resultJson: JSON.stringify({ taskName: 'task', status: 'success', outputHash: output, ...invalid }), outputUploadId: none, inlineOutput: none });
    await f.refusal(response, 400, 'invalid-request');
  }
  assert(!f.calls.includes('outcome')); assert.equal((await f.leases.get('repo', lease.leaseId))!.status, 'claimed');
});

it('validates every output before issuing a capability and rejects oversized commit metadata', async () => {
  const f = await fixture(); await f.enroll(); const lease = await f.create();
  await f.success(await f.claim(), RackLeaseGrantType);
  const request = { repo: 'repo', leaseId: lease.leaseId, need: [], output: none, envManifest: none, outputs: [], commits: [] };
  const bad = await f.raw('storage', RackStorageRequestType, { ...request, outputs: [{ hash: output, size: 1n }, { hash: 'bad', size: 2n }] });
  await f.refusal(bad, 400, 'invalid-request'); assert(!f.calls.includes('target'));
  await f.success(await f.raw('storage', RackStorageRequestType, { ...request, outputs: [{ hash: output, size: 1n }] }), RackStorageResponseType);
  assert.deepEqual((await f.leases.get('repo', lease.leaseId))!.targets, [output]);
  const overflow = await f.raw('storage', RackStorageRequestType, { ...request, commits: [{ hash: output, size: 1n << 100n, version: 'receipt' }] });
  await f.refusal(overflow, 400, 'invalid-request'); assert(!f.calls.includes('commit'));
});

it('does not resurrect a rack when revocation overlaps an in-flight heartbeat update', async () => {
  const f = await fixture();
  const { rackId } = await f.enroll();
  const entered = deferred(); const release = deferred();
  const replace = f.registry.compareAndSetRack.bind(f.registry);
  f.registry.compareAndSetRack = async (expected, rack) => { entered.resolve(); await release.promise; return replace(expected, rack); };
  const heartbeat = f.heartbeat();
  await entered.promise;
  const revoked = f.coordinator.run('@rack', rackId, () => f.registry.deleteRack(rackId));
  release.resolve();
  await heartbeat;
  assert.equal(await revoked, true);
  assert.equal(await f.registry.getRack(rackId), null);
  assert.equal((await f.heartbeat()).status, 401);
});

it('does not recreate a rack revoked by another control-plane process during a heartbeat', async () => {
  const f = await fixture();
  const { rackId } = await f.enroll();
  const read = f.registry.getRack.bind(f.registry);
  let reads = 0;
  f.registry.getRack = async (id) => {
    const current = await read(id);
    if (++reads === 2) await f.registry.deleteRack(id);
    return current;
  };
  assert.equal((await f.heartbeat()).status, 401);
  assert.equal(await f.registry.getRack(rackId), null);
});

it('preserves a concurrent drain while updating a polling rack\'s advertised tiers', async () => {
  const f = await fixture();
  const { rackId } = await f.enroll();
  const read = f.registry.getRack.bind(f.registry);
  let reads = 0;
  f.registry.getRack = async (id) => {
    const current = await read(id);
    if (++reads === 2) await f.registry.putRack({ ...current!, healthy: false, capacity: 0n });
    return current;
  };
  assert.equal((await f.raw('lease', RackLeaseRequestType, { tiers: ['node', 'py'], bootId: 'boot', offer: f.offer })).status, 204);
  const current = (await f.registry.getRack(rackId))!;
  assert.equal(current.healthy, false);
  assert.equal(current.capacity, 0n);
  assert.deepEqual(current.tiers, ['node', 'py']);
});

it('activates zero-capacity enrollment, preserves busy capacity, and withdraws it on drain and stale heartbeats', async () => {
  const f = await fixture();
  const { rackId } = await f.enroll(undefined, false, 0n);
  const lease = await f.create();
  assert.equal(await f.dispatch.anyHealthyRackWithTier('node'), false);
  assert.equal((await f.claim()).status, 204);
  const heartbeat = { healthy: false, freeCapacity: 0n, runningLeases: [],
    agentVersion: '0.5.0+e3.1.0.85', bootId: 'boot', cacheBytes: 0n, report: f.report };
  await f.success(await f.raw('heartbeat', RackHeartbeatRequestType, heartbeat), RackHeartbeatResponseType);
  assert.equal((await f.claim()).status, 204, 'a fenced boot cannot claim');
  await f.success(await f.raw('heartbeat', RackHeartbeatRequestType, { ...heartbeat, healthy: true, freeCapacity: 1n }), RackHeartbeatResponseType);
  assert.equal((await f.registry.getRack(rackId))!.capacity, 1n);
  assert.equal(await f.dispatch.anyHealthyRackWithTier('node'), true);
  assert.equal((await f.success(await f.claim(), RackLeaseGrantType)).leaseId, lease.leaseId);
  const runningLeases = [{ repo: 'repo', leaseId: lease.leaseId }];
  await f.success(await f.raw('heartbeat', RackHeartbeatRequestType, { ...heartbeat, healthy: true, runningLeases }), RackHeartbeatResponseType);
  assert.equal((await f.registry.getRack(rackId))!.capacity, 1n, 'busy slots remain part of capacity');
  assert.equal(await f.dispatch.anyHealthyRackWithTier('node'), true);
  await f.success(await f.raw('heartbeat', RackHeartbeatRequestType, { ...heartbeat, runningLeases }), RackHeartbeatResponseType);
  assert.equal((await f.registry.getRack(rackId))!.capacity, 0n, 'drain withdraws capacity even with running work');
  assert.equal(await f.dispatch.anyHealthyRackWithTier('node'), false);
  await f.success(await f.complete(lease.leaseId), RackCompleteResponseType);
  const next = await f.create();
  assert.equal((await f.claim()).status, 204);
  await f.success(await f.raw('heartbeat', RackHeartbeatRequestType, { ...heartbeat, healthy: true, freeCapacity: 3n }), RackHeartbeatResponseType);
  assert.equal((await f.registry.getRack(rackId))!.capacity, 3n, 'resume refreshes the allocation without another identity');
  f.advance(45_001);
  assert.equal((await f.claim()).status, 204, 'polling cannot keep stale heartbeat capacity alive');
  assert.equal(await f.dispatch.anyHealthyRackWithTier('node'), false);
  await f.success(await f.raw('heartbeat', RackHeartbeatRequestType, { ...heartbeat, healthy: true, freeCapacity: 3n }), RackHeartbeatResponseType);
  assert.equal((await f.success(await f.claim(), RackLeaseGrantType)).leaseId, next.leaseId);
  assert.equal((await f.registry.listRacks()).length, 1);
});

it('rejects invalid capacity reports without changing the registration', async () => {
  const f = await fixture();
  const { rackId } = await f.enroll();
  const before = await f.registry.getRack(rackId);
  const heartbeat = { healthy: true, freeCapacity: 1n, runningLeases: [],
    agentVersion: '0.5.0+e3.1.0.85', bootId: 'boot', cacheBytes: 0n, report: f.report };
  const ref = { repo: 'repo', leaseId: 'lease' };
  for (const invalid of [
    { freeCapacity: -1n }, { freeCapacity: BigInt(Number.MAX_SAFE_INTEGER) + 1n },
    { freeCapacity: BigInt(Number.MAX_SAFE_INTEGER), runningLeases: [ref] }, { runningLeases: [ref, ref] },
  ]) {
    const response = await f.raw('heartbeat', RackHeartbeatRequestType, { ...heartbeat, ...invalid });
    await f.refusal(response, 400, 'invalid-request');
    assert.deepEqual(await f.registry.getRack(rackId), before);
  }
});

it('allows cloud hosts to back off idle reads while retaining a bounded pickup interval', async () => {
  const f = await fixture({ leaseWindowMs: 1000, pollIntervalMs: 25, pollMaxMs: 200, policyRecheckMs: 400 });
  await f.enroll();
  let checks = 0;
  let policies = 0;
  const list = f.leases.listClaimable.bind(f.leases);
  const policy = f.registry.getRackSecurityPolicy.bind(f.registry);
  f.leases.listClaimable = (...args) => { checks++; return list(...args); };
  f.registry.getRackSecurityPolicy = () => { policies++; return policy(); };
  assert.equal((await f.claim()).status, 204);
  assert(checks >= 5 && checks <= 12, `${checks} queue reads in a one-second idle window`);
  assert(policies >= 2 && policies <= 4, `${policies} policy reads in a one-second idle window`);
});

for (const change of ['policy', 'drain', 'revoke'] as const) {
  it(`rechecks ${change} before granting work even when idle permission was cached`, async () => {
    const f = await fixture({ policyRecheckMs: 60_000 });
    const { rackId } = await f.enroll();
    const registration = (await f.registry.getRack(rackId))!;
    await f.registry.putRack({ ...registration, approvedBootId: some('another-boot') });
    const lease = await f.create();
    const list = f.leases.listClaimable.bind(f.leases);
    f.leases.listClaimable = async (...args) => {
      const candidates = await list(...args);
      if (change === 'policy') await f.registry.putRackSecurityPolicy({ requireStartApproval: true });
      if (change === 'drain') await f.registry.putRack({ ...registration, healthy: false, capacity: 0n });
      if (change === 'revoke') await f.registry.deleteRack(rackId);
      return candidates;
    };
    assert.equal((await f.claim()).status, change === 'revoke' ? 401 : 204);
    assert.equal((await f.leases.get('repo', lease.leaseId))!.status, 'pending');
    assert(!f.calls.some(call => call.startsWith('running:')));
  });
}

it('reads a closure with bounded concurrency and preserves descriptor order', async () => {
  const f = await fixture();
  await f.enroll();
  const lease = await f.create();
  await f.success(await f.claim(), RackLeaseGrantType);
  const hashes = Array.from({ length: 12 }, (_, i) => i.toString(16).padStart(64, '0'));
  f.attempts.closure = async () => hashes;
  const entered = deferred();
  const release = deferred();
  let reads = 0;
  f.bridge.readDescriptor = async (_repo, hash) => {
    if (++reads === 8) entered.resolve();
    await release.promise;
    return { kind: 'url', url: `https://objects.invalid/${hash}` };
  };
  const response = f.raw('storage', RackStorageRequestType, {
    repo: 'repo', leaseId: lease.leaseId, need: hashes, output: none, envManifest: none, outputs: [], commits: [],
  });
  await entered.promise;
  assert.equal(reads, 8, 'additional reads wait for a slot');
  release.resolve();
  const result = await f.success(await response, RackStorageResponseType);
  assert.deepEqual(result.objects.map(object => object.value.hash), hashes);
  assert.equal(reads, hashes.length);
});

it('holds the lease fence until every started target operation settles after a failure', async () => {
  const f = await fixture();
  await f.enroll();
  const lease = await f.create();
  await f.success(await f.claim(), RackLeaseGrantType);
  const hashes = Array.from({ length: 12 }, (_, i) => i.toString(16).padStart(64, '0'));
  const entered = deferred();
  const release = deferred();
  let writes = 0;
  f.bridge.writeTarget = async (_repo, _lease, hash) => {
    const reserved = (await f.leases.get('repo', lease.leaseId))!.targets;
    assert.deepEqual(reserved, hashes, 'reserve the whole batch before issuing any target');
    if (++writes === 8) entered.resolve();
    await entered.promise;
    if (hash === hashes[0]) throw new Error('target signing failed');
    await release.promise;
    return { url: `https://objects.invalid/${hash}`, headers: {} };
  };
  const response = f.raw('storage', RackStorageRequestType, {
    repo: 'repo', leaseId: lease.leaseId, need: [], output: none, envManifest: none,
    outputs: hashes.map(hash => ({ hash, size: 1n })), commits: [],
  });
  await entered.promise;
  let cancelled = false;
  const cancellation = f.dispatch.cancel('repo', lease.leaseId).then(result => { cancelled = true; return result; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(cancelled, false, 'cleanup cannot pass an outstanding target operation');
  release.resolve();
  assert.equal((await response).status, 500);
  assert.equal((await cancellation)!.status, 'cancelled');
  assert.equal(writes, 8, 'stop scheduling when the first operation fails');
});

it('answers the hello with the deployment\'s release and its transfer limit, and tells its host what each rack reports and what each poll offers', async () => {
  const reports: Array<[string, RackReport]> = [];
  const offers: RackOffer[] = [];
  const f = await fixture({ e3Version: '1.0.85', transfersAtOnce: 3,
    onReport: (rackId, report) => { reports.push([rackId, report]); },
    canClaim: (_rack, _lease, offer) => { offers.push(offer); return true; } });
  assert.deepEqual(readRackHello(await (await fetch(`${f.origin}/api/rack/hello`)).text()), { protocol: RACK_PROTOCOL, e3: '1.0.85', limits: { transfersAtOnce: 3 } });

  const { rackId } = await f.enroll();
  assert.deepEqual(reports, [[rackId, { features: [] }]], 'the enrolment\'s first heartbeat');
  const said = { features: ['resources', 'environments'], target: 'x86_64-manylinux_2_28',
    resources: { cores: 8, memoryBytes: 2 ** 34, gpus: 1 }, free: { cores: 5, memoryBytes: 2 ** 33, gpus: 0 } };
  // A field this build does not know is ignored, here and in an offer.
  await f.success(await f.raw('heartbeat', RackHeartbeatRequestType, { healthy: true, freeCapacity: 1n, runningLeases: [],
    agentVersion: '0.5.0+e3.1.0.85', bootId: 'boot', cacheBytes: 0n, report: JSON.stringify({ ...said, later: { anything: true } }) }), RackHeartbeatResponseType);
  assert.deepEqual(reports.at(-1), [rackId, said]);

  await f.create();
  await f.success(await f.claim(JSON.stringify({ cores: 2, memoryBytes: 4096, gpus: 1, later: 'ignored' })), RackLeaseGrantType);
  assert.deepEqual(offers, [{ cores: 2, memoryBytes: 4096, gpus: 1 }]);
});

it('refuses a rack that names another protocol, tells its host which rack and what it named, and never reads its body', async () => {
  const refusedRacks: Array<[string, string | undefined]> = [];
  const f = await fixture({ onIncompatible: (rackId, named) => { refusedRacks.push([rackId, named]); } });
  const { rackId } = await f.enroll();
  const heartbeat = { healthy: true, freeCapacity: 1n, runningLeases: [], agentVersion: '0.5.0+e3.1.0.85', bootId: 'boot', cacheBytes: 0n, report: f.report };
  const before = await f.registry.getRack(rackId);
  assert.match(await f.refusal(await f.raw('heartbeat', RackHeartbeatRequestType, heartbeat, undefined, null), 426, 'upgrade-required'), /names none: update the rack's agent/);
  assert.match(await f.refusal(await f.raw('heartbeat', RackHeartbeatRequestType, heartbeat, undefined, '2'), 426, 'upgrade-required'), /names 2: update the rack's agent/);
  assert.deepEqual(refusedRacks, [[rackId, undefined], [rackId, '2']]);
  assert.deepEqual(await f.registry.getRack(rackId), before, 'a refused heartbeat refreshes nothing');
  // An enrolment names no rack yet: refused all the same, and no one is told.
  await f.refusal(await f.raw('enroll', RackEnrollRequestType, { enrollmentToken: 'e3rk_enroll_x', hostInfo: { label: 'old', tiers: ['node'], capacity: 1n, agentVersion: '0.4.0' } }, '', null), 426, 'upgrade-required');
  assert.equal(refusedRacks.length, 2);
});

it('answers what its host could not do now as a request to send again, and keeps the lease', async () => {
  const f = await fixture(); await f.enroll(); const lease = await f.create();
  await f.success(await f.claim(), RackLeaseGrantType);
  f.attempts.closure = async () => { throw new Error('the session did not answer'); };
  const need = { repo: 'repo', leaseId: lease.leaseId, need: [input], output: none, envManifest: none, outputs: [], commits: [] };
  assert.match(await f.refusal(await f.raw('storage', RackStorageRequestType, need), 503, 'source-unavailable'), /the session did not answer/);
  f.attempts.logs.append = async () => { throw new Error('the log store is away'); };
  await f.refusal(await f.raw('logs', RackLogsRequestType, { repo: 'repo', leaseId: lease.leaseId, chunks: [{ stream: variant('stdout', null), data: 'x' }] }), 503, 'source-unavailable');
  f.beforeOutcome(async () => { throw new Error('the record was not written'); });
  assert.match(await f.refusal(await f.complete(lease.leaseId), 503, 'source-unavailable'), /outcome was not recorded/);
  assert.equal((await f.leases.get('repo', lease.leaseId))!.status, 'claimed');
  // An environment that is not the lease's is not the caller's to read; one
  // that is, and has no layers published, is not there.
  await f.refusal(await f.raw('storage', RackStorageRequestType, { ...need, need: [], envManifest: some('e'.repeat(64)) }), 403, 'forbidden');
});
