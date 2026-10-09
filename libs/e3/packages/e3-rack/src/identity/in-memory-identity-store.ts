/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { DateTimeType, DictType, NullType, OptionType, StringType, StructType, VariantType, compareFor, decodeBeast2For, encodeBeast2For, none, some, variant, type ValueTypeOf } from '@elaraai/east';
import { MutationQueue } from '../state-file.js';
import type { MachineIdentityStore, RackTokenRecord } from './machine-identity.js';

/** The hub's credentials, hashed at rest. */
export const IdentityFileType = StructType({
  enrollmentTokens: DictType(StringType, DateTimeType),
  rackTokens: DictType(StringType, StructType({
    rackId: StringType,
    status: VariantType({ current: NullType, pending: NullType, grace: NullType }),
    issuedAt: DateTimeType,
    graceUntil: OptionType(DateTimeType),
  })),
});
/** The credentials' persisted value. */
export type IdentityFile = ValueTypeOf<typeof IdentityFileType>;
const encode = encodeBeast2For(IdentityFileType);
const decode = decodeBeast2For(IdentityFileType);
const compareTime = compareFor(DateTimeType);

/**
 * Keeps machine identities in memory, with atomic single-use enrollment.
 * @example
 * const store = new InMemoryMachineIdentityStore();
 * await store.putEnrollmentToken(hashToken(token), expiresAt);
 */
export class InMemoryMachineIdentityStore implements MachineIdentityStore {
  protected state: IdentityFile = { enrollmentTokens: new Map(), rackTokens: new Map() };
  protected readonly mutations = new MutationQueue();
  protected ready: Promise<void> = Promise.resolve();

  /** Persists a candidate state before it becomes visible. @internal */
  protected persist(_state: IdentityFile): Promise<void> { return Promise.resolve(); }

  private change<T>(edit: (state: IdentityFile) => T, now = new Date()): Promise<T> {
    return this.mutations.run(async () => {
      await this.ready;
      const next = decode(encode(this.state));
      const prune = () => {
        for (const [hash, expires] of next.enrollmentTokens) if (compareTime(expires, now) <= 0) next.enrollmentTokens.delete(hash);
      };
      prune();
      const result = edit(next);
      prune();
      await this.persist(next);
      this.state = decode(encode(next));
      return result;
    });
  }

  putEnrollmentToken(hash: string, expiresAt: Date): Promise<void> {
    return this.change((state) => { state.enrollmentTokens.set(hash, expiresAt); });
  }

  consumeEnrollmentToken(hash: string, now: Date): Promise<boolean> {
    return this.change((state) => state.enrollmentTokens.delete(hash), now);
  }

  putRackToken(hash: string, rackId: string, issuedAt: Date, status: 'current' | 'pending'): Promise<void> {
    return this.change((state) => {
      state.rackTokens.set(hash, { rackId, issuedAt, status: variant(status, null), graceUntil: none });
    });
  }

  async getRackToken(hash: string): Promise<RackTokenRecord | null> {
    await this.ready;
    await this.mutations.idle();
    const record = this.state.rackTokens.get(hash);
    return record === undefined ? null : {
      rackId: record.rackId, status: record.status.type, issuedAt: new Date(record.issuedAt),
      ...(record.graceUntil.type === 'some' && { graceUntil: new Date(record.graceUntil.value) }),
    };
  }

  async listRackTokens(rackId: string): Promise<Array<RackTokenRecord & { tokenHash: string }>> {
    await this.ready;
    await this.mutations.idle();
    return [...this.state.rackTokens].flatMap(([tokenHash, record]) => record.rackId !== rackId ? [] : [{
      tokenHash, rackId, status: record.status.type, issuedAt: new Date(record.issuedAt),
      ...(record.graceUntil.type === 'some' && { graceUntil: new Date(record.graceUntil.value) }),
    }]);
  }

  promoteRackToken(rackId: string, hash: string, graceUntil: Date): Promise<void> {
    return this.change((state) => {
      if (state.rackTokens.get(hash)?.rackId !== rackId) throw new Error('Cannot promote an unknown rack token');
      for (const [key, record] of state.rackTokens) {
        if (record.rackId !== rackId) continue;
        if (key === hash) state.rackTokens.set(key, { ...record, status: variant('current', null), graceUntil: none });
        else if (record.status.type !== 'grace') state.rackTokens.set(key, { ...record, status: variant('grace', null), graceUntil: some(graceUntil) });
      }
    });
  }

  deleteRackToken(hash: string): Promise<void> {
    return this.change((state) => { state.rackTokens.delete(hash); });
  }

  deleteRackTokens(rackId: string): Promise<void> {
    return this.change((state) => {
      for (const [hash, record] of state.rackTokens) if (record.rackId === rackId) state.rackTokens.delete(hash);
    });
  }
}
