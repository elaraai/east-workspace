/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BooleanType, StringType, decodeBeast2For, encodeBeast2For, none, some, variant, type EastType, type ValueTypeOf } from '@elaraai/east';
import { BEAST2_CONTENT_TYPE, ResponseType } from '@elaraai/e3-types';
import { uuidv7 } from '@elaraai/e3-core';
import type { RackDispatch } from '../lease/rack-dispatch.js';
import { E3_RACK_VERSION } from '../version.js';
import { ROTATION_AGE_MS, ROTATION_GRACE_MS } from '../identity/machine-identity.js';
import { RackEnrollRequestType, RackEnrollResponseType, RackLeaseRequestType, RackLeaseGrantType,
  RackHeartbeatRequestType, RackHeartbeatResponseType, RackExtendRequestType,
  RackCompleteRequestType, RackCompleteResponseType, RackStorageRequestType, RackStorageResponseType,
  RackLogsRequestType, type RackLeaseRef, type RackLeaseResult } from '../protocol/index.js';

/** Supplies a fresh real-listener control plane for each protocol case. */
export interface RackProtocolFixture {
  /** Origin serving /api/rack. */
  baseUrl: string;
  /** Repository identifier; defaults to 'repo'. */
  repo?: string;
  /** Optional transport for non-HTTP object URLs in a test bridge. */
  fetch?: typeof fetch;
  /** Mints one unconsumed enrollment credential. */
  mintEnrollmentToken(): Promise<string>;
  /** Creates, cancels and inspects leases through the host's real dispatch. */
  dispatch: RackDispatch;
  /** Writes a committed input object. */
  seedObject(repo: string, bytes: Uint8Array): Promise<string>;
  /** Reads a committed output, or null when absent. */
  readObject(repo: string, hash: string): Promise<Uint8Array | null>;
  /** Reads the attempt's persisted stream. */
  readLog(repo: string, taskHash: string, inputsHash: string, executionId: string, stream: 'stdout' | 'stderr'): Promise<string>;
  /** Advances the host's identity clock when supported. */
  advanceClock?(ms: number): void;
  /** Closes the listener and removes temporary state. */
  teardown(): Promise<void>;
}

/**
 * Registers shared v2 wire, auth, transfer and attempt-log contracts.
 * Each case uses a fresh fixture and always tears it down, even on failure.
 * @param label - Host implementation under test
 * @param setup - Starts an isolated control plane; use a short empty poll window
 * @example
 * rackProtocolSuite('local', () => startProtocolFixture());
 */
export function rackProtocolSuite(label: string, setup: () => Promise<RackProtocolFixture>): void {
  const fixture = async (t: TestContext) => {
    const f = await setup(); t.after(() => f.teardown());
    const request = f.fetch ?? fetch; const repo = f.repo ?? 'repo';
    const raw = <T extends EastType>(path: string, type: T, value: ValueTypeOf<T>, token = '') => request(`${f.baseUrl}/api/rack/${path}`, {
      method: 'POST', headers: { 'content-type': BEAST2_CONTENT_TYPE, authorization: `Bearer ${token}` },
      body: encodeBeast2For(type)(value), signal: AbortSignal.timeout(30000),
    });
    const success = async <T extends EastType>(response: Response, type: T): Promise<ValueTypeOf<T>> => {
      assert.equal(response.status, 200);
      const value = decodeBeast2For(ResponseType(type))(new Uint8Array(await response.arrayBuffer()));
      assert(value.type === 'success'); return value.value;
    };
    const enroll = async (enrollmentToken?: string) => success(await raw('enroll', RackEnrollRequestType, {
      enrollmentToken: enrollmentToken ?? await f.mintEnrollmentToken(), hostInfo: { label: 'contract', tiers: ['node'], capacity: 1n, agentVersion: `0.5.0+e3.${E3_RACK_VERSION}` },
    }), RackEnrollResponseType);
    const claim = (token: string) => raw('lease', RackLeaseRequestType, { tiers: ['node'], bootId: 'contract-boot' }, token);
    const heartbeat = (token: string, runningLeases: RackLeaseRef[] = []) => raw('heartbeat', RackHeartbeatRequestType, {
      healthy: true, freeCapacity: 1n, runningLeases, bootId: 'contract-boot', cacheBytes: 0n, agentVersion: `0.5.0+e3.${E3_RACK_VERSION}`,
    }, token);
    const create = async () => {
      const hash = await f.seedObject(repo, encodeBeast2For(StringType)('input'));
      return f.dispatch.createLease({ version: 2, workspace: 'dev', taskName: 'contract', e3Version: E3_RACK_VERSION,
        closure: { hashes: [hash] }, runnerEvent: { mode: 'task', repo, taskHash: hash, inputHashes: [], launchId: uuidv7(), timeoutMs: 60000 } }, 'node');
    };
    const complete = (token: string, leaseId: string, result: RackLeaseResult = { taskName: 'contract', status: 'failed', state: 'failed', exitCode: 1 }) =>
      raw('complete', RackCompleteRequestType, { repo, leaseId, resultJson: JSON.stringify(result), outputUploadId: none, inlineOutput: none }, token);
    return { ...f, repo, request, raw, success, enroll, claim, heartbeat, create, complete };
  };
  void describe(`rack protocol (${label})`, () => {
    void it('consumes enrollment once and refuses missing or bad machine credentials', async (t) => {
      const f = await fixture(t); const token = await f.mintEnrollmentToken(); await f.enroll(token);
      await assert.rejects(f.enroll(token));
      for (const bearer of ['', 'e3rk_bad']) assert.equal((await f.heartbeat(bearer)).status, 401);
    });
    void it('returns 204 from an empty poll and grants one claimant exclusive extension rights', async (t) => {
      const f = await fixture(t); const a = await f.enroll(); const b = await f.enroll();
      assert.equal((await f.claim(a.rackToken)).status, 204);
      const lease = await f.create();
      const grants = await Promise.all([f.claim(a.rackToken), f.claim(b.rackToken)]);
      assert.deepEqual(grants.map((response) => response.status).sort(), [200, 204]);
      const winner = grants[0]!.status === 200 ? a : b; const loser = Object.is(winner, a) ? b : a;
      for (const [peer, allowed] of [[winner, true], [loser, false]] as const) {
        assert.equal(await f.success(await f.raw('lease/extend', RackExtendRequestType, { repo: f.repo, leaseId: lease.leaseId }, peer.rackToken), BooleanType), allowed);
      }
    });
    void it('computes inline output hashes and makes completion idempotent', async (t) => {
      const f = await fixture(t); const a = await f.enroll(); const lease = await f.create(); await f.success(await f.claim(a.rackToken), RackLeaseGrantType);
      const bytes = encodeBeast2For(StringType)('result'); const hash = createHash('sha256').update(bytes).digest('hex');
      const response = await f.raw('complete', RackCompleteRequestType, { repo: f.repo, leaseId: lease.leaseId,
        resultJson: JSON.stringify({ taskName: 'contract', status: 'success' }), outputUploadId: none, inlineOutput: some(bytes) }, a.rackToken);
      assert.equal((await f.success(response, RackCompleteResponseType)).disposition.type, 'recorded');
      assert.deepEqual(new Uint8Array((await f.readObject(f.repo, hash))!), bytes);
      assert.equal((await f.success(await f.complete(a.rackToken, lease.leaseId), RackCompleteResponseType)).disposition.type, 'idempotent');
    });
    void it('checks large PUT checksums and commit receipts before exposing output', async (t) => {
      const f = await fixture(t); const a = await f.enroll(); const lease = await f.create(); await f.success(await f.claim(a.rackToken), RackLeaseGrantType);
      const bytes = encodeBeast2For(StringType)('large'.repeat(2000)); const hash = createHash('sha256').update(bytes).digest('hex'); const size = BigInt(bytes.length);
      const storage = { repo: f.repo, leaseId: lease.leaseId, need: [], output: none, envManifest: none, outputs: [], commits: [] };
      const declared = await f.success(await f.raw('storage', RackStorageRequestType, { ...storage, outputs: [{ hash, size }] }, a.rackToken), RackStorageResponseType);
      const target = declared.targets[0]!.target; assert(target.type === 'put');
      const headers = Object.fromEntries(target.value.headers);
      const bad = await f.request(target.value.url, { method: 'PUT', headers, body: new Uint8Array(bytes.length) }); assert(!bad.ok); await bad.arrayBuffer();
      const put = await f.request(target.value.url, { method: 'PUT', headers, body: bytes }); assert(put.ok); await put.arrayBuffer();
      const version = put.headers.get('x-amz-version-id'); assert(version);
      assert.equal(await f.readObject(f.repo, hash), null);
      for (const receipt of ['wrong', version, version]) {
        const result = await f.success(await f.raw('storage', RackStorageRequestType, { ...storage, commits: [{ hash, size, version: receipt }] }, a.rackToken), RackStorageResponseType);
        assert.equal(result.committed[0]!.committed, receipt === version);
      }
      assert.equal((await f.success(await f.complete(a.rackToken, lease.leaseId, { taskName: 'contract', status: 'success', state: 'success', outputHash: hash }), RackCompleteResponseType)).disposition.type, 'recorded');
      assert.deepEqual(new Uint8Array((await f.readObject(f.repo, hash))!), bytes);
    });
    for (const how of ['cancel', 'supersede'] as const) void it(`stops a ${how} lease and discards its late completion`, async (t) => {
      const f = await fixture(t); const a = await f.enroll(); const lease = await f.create(); await f.success(await f.claim(a.rackToken), RackLeaseGrantType);
      await f.dispatch[how](f.repo, lease.leaseId);
      assert.equal((await f.success(await f.complete(a.rackToken, lease.leaseId), RackCompleteResponseType)).disposition.type, 'discarded');
      const ref = { repo: f.repo, leaseId: lease.leaseId };
      assert.deepEqual((await f.success(await f.heartbeat(a.rackToken, [ref]), RackHeartbeatResponseType)).stop, [ref]);
    });
    void it('scopes objects and logs to held leases, and addresses logs by the claim-time attempt', async (t) => {
      const f = await fixture(t); const a = await f.enroll(); const b = await f.enroll(); const lease = await f.create(); await f.success(await f.claim(a.rackToken), RackLeaseGrantType);
      const ref = { repo: f.repo, leaseId: lease.leaseId };
      assert.equal((await f.raw('storage', RackStorageRequestType, { ...ref, need: ['f'.repeat(64)], output: none, envManifest: none, outputs: [], commits: [] }, a.rackToken)).status, 403);
      const logs = { ...ref, chunks: [{ stream: variant('stdout', null), data: 'contract log\n' }] };
      assert.equal((await f.raw('logs', RackLogsRequestType, logs, b.rackToken)).status, 403);
      assert.equal(await f.success(await f.raw('logs', RackLogsRequestType, logs, a.rackToken), BooleanType), true);
      const current = await f.dispatch.getLease(f.repo, lease.leaseId); assert(current?.attempt);
      assert.equal(await f.readLog(f.repo, lease.taskHash, lease.inputsHash, current.attempt.executionId, 'stdout'), 'contract log\n');
    });
    void it('offers rotation, promotes a successor and expires the old credential grace', async (t) => {
      const f = await fixture(t); if (!f.advanceClock) { t.skip('host has no injectable clock'); return; }
      const a = await f.enroll(); f.advanceClock(ROTATION_AGE_MS + 1);
      const beat = await f.success(await f.heartbeat(a.rackToken), RackHeartbeatResponseType); assert(beat.rotatedToken.type === 'some');
      await f.success(await f.heartbeat(beat.rotatedToken.value), RackHeartbeatResponseType);
      await f.success(await f.heartbeat(a.rackToken), RackHeartbeatResponseType);
      f.advanceClock(ROTATION_GRACE_MS + 1); assert.equal((await f.heartbeat(a.rackToken)).status, 401);
    });
  });
}
