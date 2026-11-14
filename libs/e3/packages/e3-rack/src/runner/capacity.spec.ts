/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { none, some } from '@elaraai/east';
import { E3_RACK_VERSION } from '../version.js';
import { compatibleRacks, rackCouldHold, rackRoom, type SnapshotRack } from './capacity.js';

const GiB = 1024 ** 3;

/** A healthy rack of a snapshot that admits by its resources: all it has, and what of it is free. */
function rack(all: number, free: number, overrides: Partial<SnapshotRack> = {}): SnapshotRack {
  const resources = (memoryBytes: number) => ({ cores: 8n, memoryBytes: BigInt(memoryBytes), gpus: 0n });
  return { rackId: 'r1', label: 'rack-a', tiers: ['node'], capacity: 4n, busy: 0n, healthy: true, bundledE3: some(E3_RACK_VERSION),
    pendingApproval: false, features: ['resources'], target: none, problem: none,
    resources: some(resources(all)), free: some(resources(free)), ...overrides };
}

it('counts the leases a rack holds now by what each reserves, not its cap, as the local budget does', () => {
  // Pieces capped at 3 GiB that reserve 2 GiB: 10 GiB free holds five, where their caps would hold three.
  const piece = { kind: 'unit' as const, cores: 1, memoryBytes: 3 * GiB, reserveBytes: 2 * GiB, gpu: false };
  assert.equal(rackRoom(rack(16 * GiB, 10 * GiB), piece), 5);
  // A lease that names no reservation reserves its cap.
  assert.equal(rackRoom(rack(16 * GiB, 10 * GiB), { kind: 'unit', cores: 1, memoryBytes: 3 * GiB, gpu: false }), 3);
  // Cores bound it as well.
  assert.equal(rackRoom(rack(16 * GiB, 10 * GiB), { ...piece, cores: 4 }), 2);
  // Too little free for one reservation holds none.
  assert.equal(rackRoom(rack(16 * GiB, GiB), piece), 0);
  // A rack that admits by its slots holds its free slots.
  assert.equal(rackRoom(rack(16 * GiB, 10 * GiB, { resources: none, free: none, capacity: 4n, busy: 1n }), piece), 3);
});

it('holds work on a rack only when its whole memory holds the work\'s cap, whatever it reserves, so the work can grow to its cap there', () => {
  const piece = { kind: 'unit' as const, cores: 1, memoryBytes: 6 * GiB, reserveBytes: 2 * GiB, gpu: false };
  assert.equal(rackCouldHold(rack(8 * GiB, 0), piece), true, 'a busy rack could hold it once it is free');
  assert.equal(rackCouldHold(rack(4 * GiB, 4 * GiB), piece), false, 'its reservation fits, its cap does not');
  assert.equal(rackCouldHold(rack(4 * GiB, 4 * GiB, { resources: none, free: none }), piece), true, 'a rack that admits by its slots is taken to');
});

it('selects the racks that are healthy, approved, run the tier, and boot this release of e3 or later', () => {
  const racks = [rack(GiB, GiB), rack(GiB, GiB, { rackId: 'sick', healthy: false }), rack(GiB, GiB, { rackId: 'unapproved', pendingApproval: true }),
    rack(GiB, GiB, { rackId: 'python', tiers: ['python'] }), rack(GiB, GiB, { rackId: 'old', bundledE3: some('0.0.1') }),
    rack(GiB, GiB, { rackId: 'unknown', bundledE3: none }), rack(GiB, GiB, { rackId: 'empty', capacity: 0n })];
  const snapshot = { racks, queued: 0n, mine: { pending: 0n, claimed: 0n } };
  assert.deepEqual(compatibleRacks(snapshot, 'node').map((held) => held.rackId), ['r1']);
  assert.deepEqual(compatibleRacks(snapshot).map((held) => held.rackId), ['r1', 'python']);
});
