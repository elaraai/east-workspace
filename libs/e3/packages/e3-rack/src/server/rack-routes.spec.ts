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
import { BEAST2_CONTENT_TYPE, ResponseType } from '@elaraai/e3-types';
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
  type RackLeaseEvent, type RackLeaseResult,
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
  const raw = async <T extends EastType>(path: string, type: T, value: ValueTypeOf<T>, bearer = token) => fetch(`${origin}/api/rack/${path}`, {
    method: 'POST', headers: { 'content-type': BEAST2_CONTENT_TYPE, authorization: `Bearer ${bearer}` },
    body: encodeBeast2For(type)(value), signal: AbortSignal.timeout(5000),
  });
  const envelope = async <T extends EastType>(response: Response, type: T) => {
    assert.equal(response.status, 200);
    return decodeBeast2For(ResponseType(type))(new Uint8Array(await response.arrayBuffer()));
  };
  const success = async <T extends EastType>(response: Response, type: T): Promise<ValueTypeOf<T>> => {
    const result = await envelope(response, type);
    assert.equal(result.type, 'success');
    if (result.type !== 'success') throw new Error('Expected success');
    return result.value;
  };
  const enroll = async (version = '0.5.0+e3.1.0.85') => {
    const mint = generateEnrollmentToken();
    await identities.putEnrollmentToken(mint.tokenHash, new Date(time + 60_000));
    const request = { enrollmentToken: mint.token, hostInfo: { label: 'test rack', tiers: ['node'], capacity: 2n, agentVersion: version } };
    const response = await success(await raw('enroll', RackEnrollRequestType, request), RackEnrollResponseType);
    token = response.rackToken;
    return { ...response, request };
  };
  const create = async () => {
    const event: RackLeaseEvent = {
      version: 2, workspace: 'dev', taskName: 'task', e3Version: '1.0.85', closure: { hashes: [input] },
      runnerEvent: { mode: 'task', repo: 'repo', taskHash, inputHashes: [input], launchId: uuidv7(), timeoutMs: 60_000 },
    };
    return dispatch.createLease(event, 'node');
  };
  const claim = () => raw('lease', RackLeaseRequestType, { tiers: ['node'], bootId: 'boot' });
  const complete = (leaseId: string, result: RackLeaseResult = { taskName: 'task', status: 'success', outputHash: output }) =>
    raw('complete', RackCompleteRequestType, { repo: 'repo', leaseId, resultJson: JSON.stringify(result), outputUploadId: none, inlineOutput: none });
  const heartbeat = (leaseId?: string, bearer?: string) => raw('heartbeat', RackHeartbeatRequestType, {
    healthy: true, freeCapacity: 1n, runningLeases: leaseId ? [{ repo: 'repo', leaseId }] : [],
    agentVersion: '0.5.0+e3.1.0.85', bootId: 'boot', cacheBytes: 0n,
  }, bearer);
  return { identities, registry, leases, coordinator, dispatch, calls, raw, envelope, success, enroll, create, claim, complete, heartbeat,
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
  assert.equal((await f.envelope(await f.complete(lease.leaseId), RackCompleteResponseType)).type, 'error');
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
  assert.equal((await f.envelope(await f.claim(), RackLeaseGrantType)).type, 'error');
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
    assert.equal((await f.envelope(response, RackCompleteResponseType)).type, 'error');
  }
  assert(!f.calls.includes('outcome')); assert.equal((await f.leases.get('repo', lease.leaseId))!.status, 'claimed');
});

it('validates every output before issuing a capability and rejects oversized commit metadata', async () => {
  const f = await fixture(); await f.enroll(); const lease = await f.create();
  await f.success(await f.claim(), RackLeaseGrantType);
  const request = { repo: 'repo', leaseId: lease.leaseId, need: [], output: none, envManifest: none, outputs: [], commits: [] };
  const bad = await f.raw('storage', RackStorageRequestType, { ...request, outputs: [{ hash: output, size: 1n }, { hash: 'bad', size: 2n }] });
  assert.equal((await f.envelope(bad, RackStorageResponseType)).type, 'error'); assert(!f.calls.includes('target'));
  await f.success(await f.raw('storage', RackStorageRequestType, { ...request, outputs: [{ hash: output, size: 1n }] }), RackStorageResponseType);
  assert.deepEqual((await f.leases.get('repo', lease.leaseId))!.targets, [output]);
  const overflow = await f.raw('storage', RackStorageRequestType, { ...request, commits: [{ hash: output, size: 1n << 100n, version: 'receipt' }] });
  assert.equal((await f.envelope(overflow, RackStorageResponseType)).type, 'error'); assert(!f.calls.includes('commit'));
});

it('does not resurrect a rack when revocation overlaps an in-flight heartbeat update', async () => {
  const f = await fixture();
  const { rackId } = await f.enroll();
  const entered = deferred(); const release = deferred();
  const put = f.registry.putRack.bind(f.registry);
  f.registry.putRack = async (rack) => { entered.resolve(); await release.promise; await put(rack); };
  const heartbeat = f.heartbeat();
  await entered.promise;
  const revoked = f.coordinator.run('@rack', rackId, () => f.registry.deleteRack(rackId));
  release.resolve();
  await heartbeat;
  assert.equal(await revoked, true);
  assert.equal(await f.registry.getRack(rackId), null);
  assert.equal((await f.heartbeat()).status, 401);
});
