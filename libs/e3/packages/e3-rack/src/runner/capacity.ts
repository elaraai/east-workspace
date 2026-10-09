/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type { CapacitySnapshot } from '../protocol/control.js';
import { agentVersionAtLeast } from '../protocol/index.js';
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
