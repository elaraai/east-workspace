/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { decodeBeast2For, encodeBeast2For, equalFor } from '@elaraai/east';
import { RackRegistrationType, RackSecurityPolicyType, type RackRegistration, type RackSecurityPolicy } from '../protocol/registration.js';

/** The rack subset of the cloud's DeploymentSettingsStore, structurally compatible. */
export interface RackRegistry {
  /** Lists enrolled racks. */
  listRacks(): Promise<RackRegistration[]>;
  /** Reads a registration, or null if deregistered. */
  getRack(rackId: string): Promise<RackRegistration | null>;
  /** Persists a registration or heartbeat. */
  putRack(registration: RackRegistration): Promise<void>;
  /**
   * Replaces exactly the observed registration atomically, without recreating
   * a revoked identity. Both values name the same rack.
   * @param expected - Independently read registration
   * @param registration - Replacement for that exact value
   * @returns Whether the conditional replacement succeeded
   * @throws {Error} If the replacement changes the rack identity
   */
  compareAndSetRack(expected: RackRegistration, registration: RackRegistration): Promise<boolean>;
  /** Deregisters a rack, revoking its credential; returns whether it existed. */
  deleteRack(rackId: string): Promise<boolean>;
  /** Reads the security policy, or null for its defaults. */
  getRackSecurityPolicy(): Promise<RackSecurityPolicy | null>;
  /** Persists a security policy before resolving. */
  putRackSecurityPolicy(policy: RackSecurityPolicy): Promise<void>;
}

/** Makes an independent East value, preserving variants and options. @internal */
export const copyRegistration = (value: RackRegistration): RackRegistration => decodeBeast2For(RackRegistrationType)(encodeBeast2For(RackRegistrationType)(value));
/** Makes an independent security policy. @internal */
export const copySecurity = (value: RackSecurityPolicy): RackSecurityPolicy => decodeBeast2For(RackSecurityPolicyType)(encodeBeast2For(RackSecurityPolicyType)(value));

/**
 * Patches the latest registration without losing concurrent updates or revocation.
 * Recomputes a pure patch after contention; does not recreate a missing rack.
 * @param store - Registration persistence with conditional replacement
 * @param rackId - Identity being updated
 * @param patch - Pure patch computed from the latest registration
 * @returns The committed value, or null after revocation
 * @throws {Error} After repeated contention or a storage failure
 * @example
 * await updateRack(registry, rackId, () => ({ healthy: false, capacity: 0n }));
 */
export async function updateRack(
  store: Pick<RackRegistry, 'getRack' | 'compareAndSetRack'>,
  rackId: string,
  patch: (current: RackRegistration) => Partial<RackRegistration>,
): Promise<RackRegistration | null> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await store.getRack(rackId);
    if (current === null) return null;
    const updated = { ...current, ...patch(current) };
    if (await store.compareAndSetRack(current, updated)) return updated;
  }
  throw new Error('Rack registration changed repeatedly; retry the request');
}

/**
 * Keeps the rack registry in memory, returning independent copies.
 * @example
 * const registry = new InMemoryRackRegistry();
 * await registry.putRack(registration);
 */
export class InMemoryRackRegistry implements RackRegistry {
  private readonly racks = new Map<string, RackRegistration>();
  private security: RackSecurityPolicy | null = null;

  listRacks(): Promise<RackRegistration[]> { return Promise.resolve([...this.racks.values()].map(copyRegistration)); }
  getRack(id: string): Promise<RackRegistration | null> {
    const rack = this.racks.get(id);
    return Promise.resolve(rack === undefined ? null : copyRegistration(rack));
  }
  putRack(registration: RackRegistration): Promise<void> {
    this.racks.set(registration.rackId, copyRegistration(registration));
    return Promise.resolve();
  }
  /** {@inheritDoc RackRegistry.compareAndSetRack} */
  compareAndSetRack(expected: RackRegistration, registration: RackRegistration): Promise<boolean> {
    if (expected.rackId !== registration.rackId) return Promise.reject(new Error('Rack identity cannot change'));
    const current = this.racks.get(expected.rackId);
    if (current === undefined || !equalFor(RackRegistrationType)(current, expected)) return Promise.resolve(false);
    this.racks.set(registration.rackId, copyRegistration(registration));
    return Promise.resolve(true);
  }
  deleteRack(id: string): Promise<boolean> { return Promise.resolve(this.racks.delete(id)); }
  getRackSecurityPolicy(): Promise<RackSecurityPolicy | null> { return Promise.resolve(this.security === null ? null : copySecurity(this.security)); }
  putRackSecurityPolicy(policy: RackSecurityPolicy): Promise<void> { this.security = copySecurity(policy); return Promise.resolve(); }
}
