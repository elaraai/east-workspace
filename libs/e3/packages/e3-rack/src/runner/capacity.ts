/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type { CapacitySnapshot } from '../protocol/control.js';
import { agentVersionAtLeast, leaseFits, type RackLeaseResources, type RackResources } from '../protocol/index.js';
import { E3_RACK_VERSION } from '../version.js';

/**
 * Selects healthy, approved racks able to boot this run's e3 release.
 * @param capacity - The hub's current fleet
 * @param tier - Required runtime, or every runtime when omitted
 * @returns Compatible registrations in their reported order
 */
export function compatibleRacks(capacity: CapacitySnapshot, tier?: string): CapacitySnapshot['racks'] {
  return capacity.racks.filter((rack) => rack.healthy && !rack.pendingApproval &&
    rack.bundledE3.type === 'some' && agentVersionAtLeast(rack.bundledE3.value, E3_RACK_VERSION) &&
    (tier === undefined || rack.tiers.includes(tier)) && Number(rack.capacity) > 0);
}

/** A rack of the fleet's snapshot. */
export type SnapshotRack = CapacitySnapshot['racks'][number];

/** A snapshot's resources as numbers. */
function numbers(value: { cores: bigint; memoryBytes: bigint; gpus: bigint }): RackResources {
  return { cores: Number(value.cores), memoryBytes: Number(value.memoryBytes), gpus: Number(value.gpus) };
}

/**
 * All a rack has, when it admits work by its resources.
 * @param rack - A rack of the snapshot
 * @returns Its resources, or undefined for a rack that admits by its slots
 */
export function rackResources(rack: SnapshotRack): RackResources | undefined {
  return rack.resources.type === 'some' ? numbers(rack.resources.value) : undefined;
}

/**
 * What of a rack nothing has booked, when it admits work by its resources.
 * @param rack - A rack of the snapshot
 * @returns What is free, or undefined for a rack that admits by its slots
 */
export function rackFree(rack: SnapshotRack): RackResources | undefined {
  return rack.free.type === 'some' ? numbers(rack.free.value) : undefined;
}

/**
 * How many more leases asking this much a rack holds now: what its free
 * cores, memory and GPUs each hold, the least of them. A rack that admits by
 * its slots holds its free slots.
 *
 * @param rack - A rack of the snapshot
 * @param needs - What one lease asks
 * @returns The count, zero or more
 * @example
 * const room = compatibleRacks(snapshot, tier).reduce((sum, rack) => sum + rackRoom(rack, needs), 0);
 */
export function rackRoom(rack: SnapshotRack, needs: RackLeaseResources): number {
  const free = rackFree(rack);
  if (free === undefined) return Math.max(0, Number(rack.capacity) - Number(rack.busy));
  if (!leaseFits(needs, free)) return 0;
  return Math.min(Math.floor(free.cores / needs.cores), Math.floor(free.memoryBytes / needs.memoryBytes), needs.gpu ? free.gpus : Infinity);
}

/**
 * Whether a rack could hold a lease's work with nothing else on it. A rack
 * that admits by its slots is taken to.
 *
 * @param rack - A rack of the snapshot
 * @param needs - What the lease asks
 * @returns Whether its whole resources hold it
 */
export function rackCouldHold(rack: SnapshotRack, needs: RackLeaseResources): boolean {
  const all = rackResources(rack);
  return all === undefined || leaseFits(needs, all);
}

/**
 * The work a rack can hold at once, for a run's width: its cores when it
 * admits by its resources, else its slots.
 *
 * @param rack - A rack of the snapshot
 * @returns The count
 */
export function rackWidth(rack: SnapshotRack): number {
  return rackResources(rack)?.cores ?? Number(rack.capacity);
}
