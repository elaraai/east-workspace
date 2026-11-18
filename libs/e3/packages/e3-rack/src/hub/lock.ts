/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DateTimeType, IntegerType, StringType, StructType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, printFor, type ValueTypeOf } from '@elaraai/east';
import { ExecutionOwnerType, type ExecutionOwner } from '@elaraai/e3-types';
import { atomicWriteFile, isProcessAlive, isTransientFsError, processOwner, readReplacedFile, unlinkWithRetry } from '@elaraai/e3-core';
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

/** Test seams of {@link acquireHubLock}: a contender's identity, its liveness probe and how it reads a claim. */
export interface AcquireHubLockOptions {
  /** The contender's process identity; this process's unless given, as a test racing contenders of distinct identities gives it. */
  owner?: ExecutionOwner;
  /** Whether a claimant's process is alive; e3-core's process liveness unless given. */
  alive?: (claimant: ExecutionOwner) => Promise<boolean>;
  /** Reads a claim's file; e3-core's `readReplacedFile` unless given, as a test refusing reads as Windows does gives it. */
  read?: (file: string) => Promise<Uint8Array>;
}

/** A held hub lock; its release removes only files belonging to this holder. */
export interface HeldHubLock {
  /** Process identity used by sessions for execution ownership. */
  readonly record: HubLock;
  /** Releases ownership once the listeners have closed. */
  release(): Promise<void>;
}

/** Removes a file, if it is there. On Windows an unlink a reader's open
 *  handle refuses a moment is tried again, as e3-core's are. */
async function remove(file: string): Promise<void> {
  await unlinkWithRetry(file).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; });
}

/**
 * Reads the hub's ownership record, without deleting an in-progress publication.
 * @param home - Private rack home
 * @returns The complete lock, or null if absent
 * @throws {Error} When a present lock is corrupt
 */
export async function readHubLock(home = rackHome()): Promise<HubLock | null> {
  // In its turn: a replacement of it by this process never meets the read
  try { return decodeLock(await readReplacedFile(join(home, HUB_LOCK_FILE))); } catch (err) {
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
 * @param options - Test seams: the contender's identity, its liveness probe and its reads
 * @returns Ownership, or null when another live contender/holder wins
 * @throws {Error} When a claim cannot be read — corrupt, or still refused once
 *   startup has taken ten seconds — or startup exceeds ten seconds
 * @example
 * const lock = await acquireHubLock();
 * if (lock !== null) await lock.release();
 */
export async function acquireHubLock(home = rackHome(), options: AcquireHubLockOptions = {}): Promise<HeldHubLock | null> {
  ensureRackHome(home);
  const owner = options.owner ?? await processOwner();
  const probe = options.alive ?? ((claimant: ExecutionOwner) => isProcessAlive(Number(claimant.pid), Number(claimant.pidStartTime), claimant.bootId));
  const read = options.read ?? readReplacedFile;
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
  // Every live claim. Windows refuses a moment to open a claim another handle
  // is replacing or removing (e3-core's transient errors): the claims are read
  // again until each reads or is gone, and an election never goes on without
  // one, since a contender that chose its ticket past a live claim it could
  // not read could be elected beside that claim's holder.
  const claims = async () => {
    for (;;) {
      const result: Array<ValueTypeOf<typeof ClaimType>> = [];
      let refused: unknown;
      for (const name of await readdir(home)) {
        if (!name.startsWith(PREFIX) || !name.endsWith('.beast2')) continue;
        const path = join(home, name);
        let claim: ValueTypeOf<typeof ClaimType>;
        try { claim = decodeClaim(await read(path)); } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
          if (isTransientFsError(err)) { refused = err; continue; }
          throw err; // Whole atomic publications: corrupt is never evidence of death.
        }
        if (await alive(claim.owner)) result.push(claim);
        else await remove(path);
      }
      if (refused === undefined) return result;
      if (Date.now() >= deadline) throw refused;
      await delay(20);
    }
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
