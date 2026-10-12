/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { equalFor, none, some } from '@elaraai/east';
import { RackRegistrationType, type RackRegistration } from '../protocol/registration.js';
import { updateRack, type RackRegistry } from '../registry/rack-registry.js';

/**
 * Tests conditional registration updates against a persistence implementation.
 * @param label - Backend name included in the suite title
 * @param setup - Fresh registry per case; registers cleanup with the test context
 * @example
 * rackRegistryContract('memory', () => new InMemoryRackRegistry());
 */
export function rackRegistryContract(label: string, setup: (t: TestContext) => RackRegistry | Promise<RackRegistry>): void {
  const registration = (): RackRegistration => ({ rackId: 'rack-1', label: 'fixture', enrolledAt: new Date(1000),
    tiers: ['node'], capacity: 2n, lastSeenAt: new Date(2000), agentVersion: '1.0.86', healthy: true,
    lastBootId: some('boot-1'), approvedBootId: none });
  void describe(`rack registry (${label})`, () => {
    void it('round-trips independent values and replaces exactly the observed registration', async (t) => {
      const store = await setup(t); const initial = registration();
      await store.putRack(initial);
      initial.tiers.push('py'); initial.lastSeenAt.setTime(0);
      const expected = (await store.getRack(initial.rackId))!;
      assert.ok(equalFor(RackRegistrationType)(expected, registration()));
      const next = { ...expected, healthy: false, capacity: 0n };
      assert.equal(await store.compareAndSetRack(expected, next), true);
      next.tiers.push('full');
      assert.equal((await store.getRack(initial.rackId))!.healthy, false);
      assert.deepEqual((await store.getRack(initial.rackId))!.tiers, ['node']);
      assert.equal(await store.compareAndSetRack(expected, { ...expected, label: 'stale' }), false);
    });
    void it('allows one winner among concurrent writes and never recreates a revoked identity', async (t) => {
      const store = await setup(t); const expected = registration(); await store.putRack(expected);
      const results = await Promise.all([
        store.compareAndSetRack(expected, { ...expected, healthy: false }),
        store.compareAndSetRack(expected, { ...expected, approvedBootId: some('boot-1') }),
      ]);
      assert.equal(results.filter(Boolean).length, 1);
      const current = (await store.getRack(expected.rackId))!;
      assert.equal(await store.deleteRack(expected.rackId), true);
      assert.equal(await store.compareAndSetRack(current, expected), false);
      assert.equal(await updateRack(store, expected.rackId, () => ({ healthy: true })), null);
      assert.equal(await store.getRack(expected.rackId), null);
      await assert.rejects(store.compareAndSetRack(expected, { ...expected, rackId: 'other' }), /identity/);
    });
    void it('recomputes tier patches after a concurrent drain and keeps heartbeat health, capacity and time', async (t) => {
      const store = await setup(t); const initial = registration(); await store.putRack(initial);
      const cas = store.compareAndSetRack.bind(store); let race = true;
      store.compareAndSetRack = async (expected, next) => {
        if (race) { race = false; await cas(expected, { ...expected, healthy: false, capacity: 0n, lastSeenAt: new Date(3000) }); }
        return cas(expected, next);
      };
      const next = await updateRack(store, initial.rackId, () => ({ tiers: ['node', 'py'] }));
      assert.ok(next);
      assert.equal(next.healthy, false); assert.equal(next.capacity, 0n); assert.equal(next.lastSeenAt.getTime(), 3000);
      assert.deepEqual(next.tiers, ['node', 'py']);
    });
    void it('rechecks first-boot approval and revocation after conflicting writes', async (t) => {
      const store = await setup(t); const initial = { ...registration(), lastBootId: none };
      await store.putRack(initial);
      const cas = store.compareAndSetRack.bind(store); let race = true;
      store.compareAndSetRack = async (expected, next) => {
        if (race) { race = false; await cas(expected, { ...expected, lastBootId: some('boot-a'), approvedBootId: some('boot-a') }); }
        return cas(expected, next);
      };
      const next = await updateRack(store, initial.rackId, current => ({ lastBootId: some('boot-b'),
        approvedBootId: current.lastBootId.type === 'none' && current.approvedBootId.type === 'none' ? some('boot-b') : current.approvedBootId }));
      assert.deepEqual(next?.approvedBootId, some('boot-a'));
      store.compareAndSetRack = async (expected, next) => { await store.deleteRack(expected.rackId); return cas(expected, next); };
      assert.equal(await updateRack(store, initial.rackId, () => ({ healthy: true })), null);
      assert.equal(await store.getRack(initial.rackId), null);
    });
    void it('bounds contention and propagates storage failures', async (t) => {
      const store = await setup(t); const initial = registration(); await store.putRack(initial); let attempts = 0;
      store.compareAndSetRack = () => { attempts++; return Promise.resolve(false); };
      await assert.rejects(updateRack(store, initial.rackId, () => ({ healthy: false })), /retry/);
      assert.equal(attempts, 8);
      store.compareAndSetRack = () => Promise.reject(new Error('offline'));
      await assert.rejects(updateRack(store, initial.rackId, () => ({ healthy: false })), /offline/);
    });
  });
}
