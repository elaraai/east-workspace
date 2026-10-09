/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { join } from 'node:path';
import { DictType, OptionType, StringType, StructType, decodeBeast2For, encodeBeast2For, equalFor, none, some, type ValueTypeOf } from '@elaraai/east';
import { RackRegistrationType, RackSecurityPolicyType, type RackRegistration, type RackSecurityPolicy } from '../protocol/registration.js';
import { ensureRackHome, RACKS_FILE } from '../paths.js';
import { MutationQueue, readStateFile, writeStateFile } from '../state-file.js';
import { copyRegistration, copySecurity, type RackRegistry } from './rack-registry.js';

/** Stores the fleet and its security policy as one atomic value. */
export const RacksFileType = StructType({ racks: DictType(StringType, RackRegistrationType), security: OptionType(RackSecurityPolicyType) });
type RacksFile = ValueTypeOf<typeof RacksFileType>;
const encode = encodeBeast2For(RacksFileType);
const decode = decodeBeast2For(RacksFileType);
const equal = equalFor(RackRegistrationType);

/**
 * Persists the registry, coalescing heartbeat-only changes for 30 seconds.
 * Enrollment, revocation and security changes are durable before resolving.
 * The hub is the sole writer and calls `flush` before releasing its lock.
 * @example
 * const registry = new FileRackRegistry(rackHome());
 * await registry.putRack(registration);
 * await registry.flush();
 */
export class FileRackRegistry implements RackRegistry {
  private readonly file: string;
  private readonly queue = new MutationQueue();
  private readonly ready: Promise<void>;
  private state: RacksFile = { racks: new Map(), security: none };
  private lastWrite = -Infinity;
  private dirty = false;
  private timer?: ReturnType<typeof setTimeout>;
  private failure: unknown;

  /**
   * @param home - The private rack home owned by this hub
   * @param now - Clock for coalescing (default: Date.now)
   */
  constructor(home: string, private readonly now: () => number = Date.now) {
    this.file = join(ensureRackHome(home), RACKS_FILE);
    this.ready = readStateFile(this.file).then((bytes) => { if (bytes !== null) this.state = decode(bytes); });
    void this.ready.catch(() => undefined);
  }

  private async read(): Promise<void> { await this.ready; await this.queue.idle(); }

  async listRacks(): Promise<RackRegistration[]> { await this.read(); return [...this.state.racks.values()].map(copyRegistration); }
  async getRack(id: string): Promise<RackRegistration | null> {
    await this.read();
    const rack = this.state.racks.get(id);
    return rack === undefined ? null : copyRegistration(rack);
  }

  putRack(registration: RackRegistration): Promise<void> {
    const rack = copyRegistration(registration);
    return this.queue.run(async () => {
      await this.ready;
      const old = this.state.racks.get(rack.rackId);
      const heartbeatOnly = old !== undefined && equal(old, { ...rack, lastSeenAt: old.lastSeenAt, healthy: old.healthy, agentVersion: old.agentVersion });
      const next = decode(encode(this.state));
      next.racks.set(rack.rackId, rack);
      if (!heartbeatOnly || this.now() - this.lastWrite >= 30_000) await this.write(next);
      else {
        this.state = next;
        this.dirty = true;
        this.timer ??= setTimeout(() => {
          this.timer = undefined;
          void this.flush().catch((err: unknown) => { this.failure = err; });
        }, Math.max(1, 30_000 - (this.now() - this.lastWrite)));
        this.timer.unref();
      }
    });
  }

  deleteRack(id: string): Promise<boolean> {
    return this.queue.run(async () => {
      await this.ready;
      const next = decode(encode(this.state));
      const existed = next.racks.delete(id);
      await this.write(next);
      return existed;
    });
  }

  async getRackSecurityPolicy(): Promise<RackSecurityPolicy | null> {
    await this.read();
    return this.state.security.type === 'some' ? copySecurity(this.state.security.value) : null;
  }

  putRackSecurityPolicy(policy: RackSecurityPolicy): Promise<void> {
    const security = some(copySecurity(policy));
    return this.queue.run(async () => {
      await this.ready;
      await this.write({ ...this.state, security });
    });
  }

  /**
   * Flushes coalesced heartbeats and cancels their timer.
   * @returns Once all preceding mutations are durable
   */
  flush(): Promise<void> {
    return this.queue.run(async () => {
      await this.ready;
      if (this.timer !== undefined) clearTimeout(this.timer);
      this.timer = undefined;
      if (this.dirty || this.failure !== undefined) await this.write(this.state);
    });
  }

  private async write(next: RacksFile): Promise<void> {
    await writeStateFile(this.file, encode(next));
    this.state = next;
    this.lastWrite = this.now();
    this.dirty = false;
    this.failure = undefined;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
