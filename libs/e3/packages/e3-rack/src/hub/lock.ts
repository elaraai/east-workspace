/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { randomUUID } from 'node:crypto';
import { readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DateTimeType, IntegerType, StringType, StructType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, printFor, type ValueTypeOf } from '@elaraai/east';
import { ExecutionOwnerType, type ExecutionOwner } from '@elaraai/e3-types';
import { atomicWriteFile, isProcessAlive, processOwner } from '@elaraai/e3-core';
import { ensureRackHome, HUB_LOCK_FILE, hubSocketPath, rackHome } from '../paths.js';
import { E3_RACK_VERSION, HUB_PROTOCOL } from '../version.js';

/** Records the one hub's process identity and the control protocol it serves. */
export const HubLockType = StructType({
  ownerId: StringType, pid: IntegerType, pidStartTime: IntegerType, bootId: StringType,
  version: StringType, protocol: IntegerType, controlSocket: StringType, startedAt: DateTimeType,
});
/** The process holding this user's hub. */
export type HubLock = ValueTypeOf<typeof HubLockType>;
const ClaimType = StructType({ owner: HubLockType, ticket: IntegerType });
const encodeClaim = encodeBeast2For(ClaimType);
const decodeClaim = decodeBeast2For(ClaimType);
const encodeLock = encodeBeast2For(HubLockType);
const decodeLock = decodeBeast2For(HubLockType);
const compareTicket = compareFor(IntegerType);
const compareOwner = compareFor(StringType);
const sameProcess = equalFor(ExecutionOwnerType);
const printProcess = printFor(ExecutionOwnerType);
const PREFIX = '.hub-claim-';
/**
 * How long one election trusts an answer about a claimant's liveness. On
 * macOS each answer spawns `sysctl` and `ps`, and every contender reads every
 * claim on every 20 ms poll: a dozen contenders asking afresh each time outran
 * the election's own deadline there.
 */
const LIVENESS_TTL_MS = 1000;

/** Test seams of {@link acquireHubLock}: a contender's identity and its liveness probe. */
export interface AcquireHubLockOptions {
  /** The contender's process identity; this process's unless given, as a test racing contenders of distinct identities gives it. */
  owner?: ExecutionOwner;
  /** Whether a claimant's process is alive; e3-core's process liveness unless given. */
  alive?: (claimant: ExecutionOwner) => Promise<boolean>;
}

/** A held hub lock; its release removes only files belonging to this holder. */
export interface HeldHubLock {
  /** Process identity used by sessions for execution ownership. */
  readonly record: HubLock;
  /** Releases ownership once the listeners have closed. */
  release(): Promise<void>;
}

async function remove(file: string): Promise<void> {
  await unlink(file).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; });
}

/**
 * Reads the hub's ownership record, without deleting an in-progress publication.
 * @param home - Private rack home
 * @returns The complete lock, or null if absent
 * @throws {Error} When a present lock is corrupt
 */
export async function readHubLock(home = rackHome()): Promise<HubLock | null> {
  try { return decodeLock(await readFile(join(home, HUB_LOCK_FILE))); } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Claims the single hub, including concurrent recovery of a crashed holder.
 *
 * @remarks
 * A shared lock name cannot safely be unlinked after an asynchronous liveness
 * check: another contender may already have replaced it. A bakery election
 * uses unique, atomically published claim files instead. Each contender first
 * announces that it is choosing (ticket zero), then publishes max(ticket)+1.
 * A live lower (ticket, UUID) wins. Only dead, uniquely named claims are
 * reclaimed, so no recovery deletes a new holder's lock. `hub.lock` is
 * published whole once the election is won, and is never observed empty.
 *
 * @param home - Private rack home
 * @param options - Test seams: the contender's identity and its liveness probe
 * @returns Ownership, or null when another live contender/holder wins
 * @throws {Error} When a claim cannot be read or startup exceeds ten seconds
 * @example
 * const lock = await acquireHubLock();
 * if (lock !== null) await lock.release();
 */
export async function acquireHubLock(home = rackHome(), options: AcquireHubLockOptions = {}): Promise<HeldHubLock | null> {
  ensureRackHome(home);
  const owner = options.owner ?? await processOwner();
  const probe = options.alive ?? ((claimant: ExecutionOwner) => isProcessAlive(Number(claimant.pid), Number(claimant.pidStartTime), claimant.bootId));
  // A claim of this process needs no asking; another claimant's answer holds
  // for LIVENESS_TTL_MS, so an election asks after each once in a while, not
  // once per claim per poll.
  const answered = new Map<string, { at: number; alive: boolean }>();
  const alive = async (lock: HubLock): Promise<boolean> => {
    const claimant: ExecutionOwner = { pid: lock.pid, pidStartTime: lock.pidStartTime, bootId: lock.bootId };
    if (sameProcess(claimant, owner)) return true;
    const key = printProcess(claimant);
    const known = answered.get(key);
    if (known !== undefined && Date.now() - known.at < LIVENESS_TTL_MS) return known.alive;
    const result = await probe(claimant);
    answered.set(key, { at: Date.now(), alive: result });
    return result;
  };
  const existing = await readHubLock(home);
  if (existing !== null && await alive(existing)) return null;
  const record: HubLock = {
    ...owner, ownerId: randomUUID(), version: E3_RACK_VERSION, protocol: BigInt(HUB_PROTOCOL),
    controlSocket: hubSocketPath(home), startedAt: new Date(),
  };
  const file = join(home, `${PREFIX}${record.ownerId}.beast2`);
  const deadline = Date.now() + 10_000;
  let held = false;
  const claims = async () => {
    const result: Array<ValueTypeOf<typeof ClaimType>> = [];
    for (const name of await readdir(home)) {
      if (!name.startsWith(PREFIX) || !name.endsWith('.beast2')) continue;
      const path = join(home, name);
      let claim: ValueTypeOf<typeof ClaimType>;
      try { claim = decodeClaim(await readFile(path)); } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw err; // Whole atomic publications: corrupt is never evidence of death.
      }
      if (await alive(claim.owner)) result.push(claim);
      else await remove(path);
    }
    return result;
  };
  try {
    await atomicWriteFile(file, encodeClaim({ owner: record, ticket: 0n }));
    let ticket = 1n;
    for (const claim of await claims()) if (compareTicket(claim.ticket, ticket) >= 0) ticket = claim.ticket + 1n;
    await atomicWriteFile(file, encodeClaim({ owner: record, ticket }));
    for (;;) {
      const others = (await claims()).filter((claim) => compareOwner(claim.owner.ownerId, record.ownerId) !== 0);
      if (others.some((claim) => compareTicket(claim.ticket, 0n) === 0)) {
        if (Date.now() >= deadline) throw new Error('Rack hub startup is waiting for another live contender');
        await delay(20);
        continue;
      }
      if (others.some((claim) => compareTicket(claim.ticket, ticket) < 0 ||
        (compareTicket(claim.ticket, ticket) === 0 && compareOwner(claim.owner.ownerId, record.ownerId) < 0))) return null;
      await atomicWriteFile(join(home, HUB_LOCK_FILE), encodeLock(record));
      held = true;
      let released = false;
      return { record, async release() {
        if (released) return;
        released = true;
        const current = await readHubLock(home);
        if (current !== null && compareOwner(current.ownerId, record.ownerId) === 0) await remove(join(home, HUB_LOCK_FILE));
        await remove(file);
      } };
    }
  } finally {
    if (!held) await remove(file);
  }
}
