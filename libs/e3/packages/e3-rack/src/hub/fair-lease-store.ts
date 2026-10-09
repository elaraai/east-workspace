/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type { RackLeaseAttempt, RackLeaseResult } from '../protocol/task-envelope.js';
import type { RackLeaseRecord, RackLeaseStore } from '../lease/lease-store.js';

/**
 * Rotates claim priority across session owners while retaining FIFO per owner.
 * Only successful claims advance the pointer; a losing poll does not consume
 * another session's turn. All state transitions remain the backend's.
 * @example
 * const leases = new FairLeaseStore(store, (lease) => owners.get(lease.leaseId) ?? '');
 */
export class FairLeaseStore implements RackLeaseStore {
  private lastOwner: string | undefined;
  /**
   * @param store - Conditional lease persistence
   * @param owner - Resolves the current session owner, including takeover
   */
  constructor(private readonly store: RackLeaseStore, private readonly owner: (lease: RackLeaseRecord) => string) {}

  put(record: RackLeaseRecord) { return this.store.put(record); }
  get(repo: string, id: string) { return this.store.get(repo, id); }
  findByTask(repo: string, task: string, inputs: string) { return this.store.findByTask(repo, task, inputs); }
  recordTargets(repo: string, id: string, rack: string, hashes: readonly string[]) { return this.store.recordTargets(repo, id, rack, hashes); }
  listRecentByRack(rack: string, limit: number) { return this.store.listRecentByRack(rack, limit); }
  extend(repo: string, id: string, rack: string, deadline: number) { return this.store.extend(repo, id, rack, deadline); }
  complete(repo: string, id: string, rack: string, result: RackLeaseResult) { return this.store.complete(repo, id, rack, result); }
  supersede(repo: string, id: string) { return this.store.supersede(repo, id); }
  cancel(repo: string, id: string) { return this.store.cancel(repo, id); }

  async claim(repo: string, id: string, rack: string, deadline: number, attempt?: RackLeaseAttempt) {
    const claimed = await this.store.claim(repo, id, rack, deadline, attempt);
    if (claimed !== null) this.lastOwner = this.owner(claimed);
    return claimed;
  }

  async listClaimable(tiers: string[], now: number, limit: number): Promise<RackLeaseRecord[]> {
    // Limiting before grouping would let one large session hide every other
    // owner. The hub's store is in memory and its queue is already bounded.
    const candidates = await this.store.listClaimable(tiers, now, Number.MAX_SAFE_INTEGER);
    const groups = new Map<string, RackLeaseRecord[]>();
    for (const lease of candidates) {
      const id = this.owner(lease);
      const group = groups.get(id) ?? [];
      group.push(lease);
      groups.set(id, group);
    }
    const owners = [...groups.keys()].sort();
    const next = this.lastOwner === undefined ? 0 : owners.findIndex((id) => id > this.lastOwner!);
    const offset = next < 0 ? 0 : next;
    const order = [...owners.slice(offset), ...owners.slice(0, offset)];
    const result: RackLeaseRecord[] = [];
    for (let round = 0; result.length < limit; round++) {
      let added = false;
      for (const id of order) {
        const lease = groups.get(id)![round];
        if (lease !== undefined) { result.push(lease); added = true; }
        if (result.length >= limit) break;
      }
      if (!added) break;
    }
    return result;
  }
}
