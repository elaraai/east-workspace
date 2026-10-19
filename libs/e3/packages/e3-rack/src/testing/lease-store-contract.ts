/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { uuidv7 } from '@elaraai/e3-core';
import { makeLeaseId, type RackLeaseRecord, type RackLeaseStore } from '../lease/lease-store.js';

/**
 * Tests the conditional lease transitions every backend implements.
 * @param label - The backend's name
 * @param makeStore - Creates an empty store for each case
 * @example
 * leaseStoreContract('memory', () => new InMemoryRackLeaseStore());
 */
export function leaseStoreContract(label: string, makeStore: () => RackLeaseStore | Promise<RackLeaseStore>): void {
  const pending = (tier = 'node'): RackLeaseRecord => ({
    leaseId: makeLeaseId('a'.repeat(64), 'b'.repeat(64)), repo: 'repo', workspace: 'dev',
    taskHash: 'a'.repeat(64), inputsHash: 'b'.repeat(64), tier, status: 'pending', createdAtMs: Date.now(),
    event: { version: 2, workspace: 'dev', taskName: 'test', closure: { hashes: [] },
      runnerEvent: { mode: 'task', repo: 'repo', launchId: uuidv7(), taskHash: 'a'.repeat(64), inputHashes: [], timeoutMs: 60_000 } },
  });
  void describe(`lease store (${label})`, () => {
    void it('grants exactly one concurrent claim and accepts only its extensions and completion', async () => {
      const store = await makeStore();
      const lease = pending();
      await store.put(lease);
      const claims = await Promise.all(Array.from({ length: 12 }, (_, n) => store.claim('repo', lease.leaseId, `rack${n}`, Date.now() + 60_000)));
      assert.equal(claims.filter(Boolean).length, 1);
      const winner = claims.find((c) => c !== null)!;
      assert.equal(await store.extend('repo', lease.leaseId, 'intruder', Date.now() + 60_000), false);
      assert.equal(await store.complete('repo', lease.leaseId, 'intruder', { taskName: 'test', status: 'success' }), 'discarded');
      assert.equal(await store.extend('repo', lease.leaseId, winner.claimedBy!, Date.now() + 60_000), true);
      assert.equal(await store.complete('repo', lease.leaseId, winner.claimedBy!, { taskName: 'test', status: 'success' }), 'recorded');
      assert.equal(await store.complete('repo', lease.leaseId, winner.claimedBy!, { taskName: 'test', status: 'success' }), 'idempotent');
      assert.equal((await store.supersede('repo', lease.leaseId))?.status, 'completed');
      assert.equal((await store.cancel('repo', lease.leaseId))?.status, 'completed');
    });

    void it('reclaims expired visibility under a fresh attempt and discards the previous claimant', async () => {
      const store = await makeStore();
      const lease = pending();
      await store.put(lease);
      const first = { executionId: uuidv7(), startedAtMs: Date.now() };
      await store.claim('repo', lease.leaseId, 'first', Date.now() - 1, first);
      const second = { executionId: uuidv7(), startedAtMs: Date.now() };
      assert.deepEqual((await store.claim('repo', lease.leaseId, 'second', Date.now() + 60_000, second))?.attempt, second);
      assert.equal(await store.complete('repo', lease.leaseId, 'first', { taskName: 'test', status: 'success' }), 'discarded');
      assert.equal(await store.recordTargets('repo', lease.leaseId, 'first', ['c'.repeat(64)]), false);
      assert.equal(await store.recordTargets('repo', lease.leaseId, 'second', ['c'.repeat(64), 'c'.repeat(64)]), true);
      assert.deepEqual((await store.get('repo', lease.leaseId))?.targets, ['c'.repeat(64)]);
    });

    for (const stop of ['cancel', 'supersede'] as const) {
      void it(`discards late completions after ${stop}`, async () => {
        const store = await makeStore();
        const lease = pending();
        await store.put(lease);
        await store.claim('repo', lease.leaseId, 'rack', Date.now() + 60_000);
        await store[stop]('repo', lease.leaseId);
        assert.equal(await store.complete('repo', lease.leaseId, 'rack', { taskName: 'test', status: 'success' }), 'discarded');
        assert.equal(await store.findByTask('repo', lease.taskHash, lease.inputsHash), null);
      });
    }

    void it('orders claimable leases oldest first and reattaches to the newest usable lease', async () => {
      const store = await makeStore();
      const old = { ...pending(), createdAtMs: 10 };
      const newer = { ...pending(), createdAtMs: 20 };
      const py = { ...pending('py'), createdAtMs: 1 };
      await store.put(newer); await store.put(py); await store.put(old);
      assert.deepEqual((await store.listClaimable(['node'], Date.now(), 5)).map((r) => r.leaseId), [old.leaseId, newer.leaseId]);
      assert.equal((await store.findByTask('repo', old.taskHash, old.inputsHash))?.leaseId, newer.leaseId);
      await store.supersede('repo', newer.leaseId);
      assert.equal((await store.findByTask('repo', old.taskHash, old.inputsHash))?.leaseId, old.leaseId);
    });
  });
}
