/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type { RackLeaseAttempt, RackLeaseResult } from '../protocol/task-envelope.js';
import { isClaimable, leaseIdPrefix, type CompleteDisposition, type RackLeaseRecord, type RackLeaseStore } from './lease-store.js';

/**
 * Keeps leases in memory with the cloud store's conditional transitions.
 * Each mutation completes synchronously before resolving its promise, so
 * concurrent claims have one winner. Returned records are independent copies.
 * @example
 * const leases = new InMemoryRackLeaseStore();
 * await leases.put(pending);
 */
export class InMemoryRackLeaseStore implements RackLeaseStore {
  private readonly records = new Map<string, RackLeaseRecord>();

  /** @param now - The clock for visibility and activity timestamps */
  constructor(private readonly now: () => number = Date.now) {}

  private key(repo: string, id: string): string { return JSON.stringify([repo, id]); }

  /** Forgets a terminal lease after its subscribers and retry window have ended. */
  forget(repo: string, id: string): void {
    const key = this.key(repo, id);
    const record = this.records.get(key);
    if (record !== undefined && record.status !== 'pending' && record.status !== 'claimed') this.records.delete(key);
  }

  put(record: RackLeaseRecord): Promise<void> {
    this.records.set(this.key(record.repo, record.leaseId), structuredClone(record));
    return Promise.resolve();
  }

  get(repo: string, id: string): Promise<RackLeaseRecord | null> {
    return Promise.resolve(structuredClone(this.records.get(this.key(repo, id)) ?? null));
  }

  findByTask(repo: string, taskHash: string, inputsHash: string): Promise<RackLeaseRecord | null> {
    const prefix = leaseIdPrefix(taskHash, inputsHash);
    const records = [...this.records.values()].filter((r) => r.repo === repo && r.leaseId.startsWith(prefix)
      && r.status !== 'superseded' && r.status !== 'cancelled');
    records.sort((a, b) => b.createdAtMs - a.createdAtMs || b.leaseId.localeCompare(a.leaseId));
    return Promise.resolve(structuredClone(records[0] ?? null));
  }

  listClaimable(tiers: string[], now: number, limit: number): Promise<RackLeaseRecord[]> {
    return Promise.resolve([...this.records.values()].filter((r) => tiers.includes(r.tier) && isClaimable(r, now))
      .sort((a, b) => a.createdAtMs - b.createdAtMs || a.leaseId.localeCompare(b.leaseId)).slice(0, limit).map((r) => structuredClone(r)));
  }

  claim(repo: string, id: string, rackId: string, deadline: number, attempt?: RackLeaseAttempt): Promise<RackLeaseRecord | null> {
    const record = this.records.get(this.key(repo, id));
    if (record === undefined || !isClaimable(record, this.now())) return Promise.resolve(null);
    record.status = 'claimed';
    record.claimedBy = rackId;
    record.claimedAtMs = this.now();
    record.visibilityDeadlineMs = deadline;
    if (attempt !== undefined) record.attempt = structuredClone(attempt);
    return Promise.resolve(structuredClone(record));
  }

  recordTargets(repo: string, id: string, rackId: string, hashes: readonly string[]): Promise<boolean> {
    const record = this.held(repo, id, rackId);
    if (record === null) return Promise.resolve(false);
    record.targets = [...new Set([...(record.targets ?? []), ...hashes])];
    return Promise.resolve(true);
  }

  extend(repo: string, id: string, rackId: string, deadline: number): Promise<boolean> {
    const record = this.held(repo, id, rackId);
    if (record === null) return Promise.resolve(false);
    record.visibilityDeadlineMs = deadline;
    return Promise.resolve(true);
  }

  complete(repo: string, id: string, rackId: string, result: RackLeaseResult): Promise<CompleteDisposition> {
    const record = this.records.get(this.key(repo, id));
    if (record?.status === 'completed') return Promise.resolve('idempotent');
    if (record === undefined || record.status !== 'claimed' || record.claimedBy !== rackId) return Promise.resolve('discarded');
    record.status = 'completed';
    record.result = structuredClone(result);
    record.completedAtMs = this.now();
    return Promise.resolve('recorded');
  }

  listRecentByRack(rackId: string, limit: number): Promise<RackLeaseRecord[]> {
    return Promise.resolve([...this.records.values()].filter((r) => r.claimedBy === rackId && r.claimedAtMs !== undefined)
      .sort((a, b) => b.claimedAtMs! - a.claimedAtMs!).slice(0, limit).map((r) => structuredClone(r)));
  }

  supersede(repo: string, id: string): Promise<RackLeaseRecord | null> {
    return this.terminal(repo, id, 'superseded');
  }

  cancel(repo: string, id: string): Promise<RackLeaseRecord | null> {
    return this.terminal(repo, id, 'cancelled');
  }

  private terminal(repo: string, id: string, status: 'superseded' | 'cancelled'): Promise<RackLeaseRecord | null> {
    const record = this.records.get(this.key(repo, id));
    if (record === undefined) return Promise.resolve(null);
    if (record.status === 'pending' || record.status === 'claimed') record.status = status;
    return Promise.resolve(structuredClone(record));
  }

  private held(repo: string, id: string, rackId: string): RackLeaseRecord | null {
    const record = this.records.get(this.key(repo, id));
    return record?.status === 'claimed' && record.claimedBy === rackId ? record : null;
  }
}
