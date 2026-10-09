/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { decodeBeast2For, encodeBeast2For } from '@elaraai/east';
import { RackRegistrationType, RackSecurityPolicyType, type RackRegistration, type RackSecurityPolicy } from '../protocol/registration.js';

/** The rack subset of the cloud's DeploymentSettingsStore, structurally compatible. */
export interface RackRegistry {
  /** Lists enrolled racks. */
  listRacks(): Promise<RackRegistration[]>;
  /** Reads a registration, or null if deregistered. */
  getRack(rackId: string): Promise<RackRegistration | null>;
  /** Persists a registration or heartbeat. */
  putRack(registration: RackRegistration): Promise<void>;
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
  deleteRack(id: string): Promise<boolean> { return Promise.resolve(this.racks.delete(id)); }
  getRackSecurityPolicy(): Promise<RackSecurityPolicy | null> { return Promise.resolve(this.security === null ? null : copySecurity(this.security)); }
  putRackSecurityPolicy(policy: RackSecurityPolicy): Promise<void> { this.security = copySecurity(policy); return Promise.resolve(); }
}
