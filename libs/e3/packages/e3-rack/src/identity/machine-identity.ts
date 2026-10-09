/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Rack machine identity (#72, epic #67 design §9.1) — the minimal
 * machine-credential scheme beside the human Cognito JWTs:
 *
 * - An admin mints a **single-use, short-TTL enrollment token** (Phase-1
 *   mint endpoint; `StoreEnrollmentTokenMinter` is its real implementation).
 * - The agent exchanges it once (`POST /rack/enroll`) for a **long-lived,
 *   revocable rack token** bound to a generated rackId.
 * - Both tokens are stored **hashed at rest** (SHA-256); the plaintext
 *   exists only in the mint/exchange responses.
 * - Revocation = deregister (delete the `RackRegistration`): the auth
 *   middleware re-resolves the registration on every request, so a token
 *   whose rack is gone is dead even if its hash row lingers.
 */

import { createHash, randomBytes } from 'node:crypto';


/** Prefix distinguishing rack machine tokens from human JWTs at a glance. */
export const RACK_TOKEN_PREFIX = 'e3rk_';
/** Prefix for single-use enrollment tokens. */
export const ENROLLMENT_TOKEN_PREFIX = 'e3rk_enroll_';

/** Default enrollment-token lifetime: long enough to paste one command. */
export const DEFAULT_ENROLLMENT_TTL_MS = 15 * 60_000;

/**
 * Token rotation (D12, #90). A current token older than ROTATION_AGE has a
 * successor minted and offered via the heartbeat response. The offer is
 * repeated (with a fresh successor) at most every ROTATION_REOFFER until
 * the agent demonstrably switches — the successor's FIRST authenticated use
 * promotes it and starts the old token's ROTATION_GRACE fuse. Activation-
 * based expiry means a lost heartbeat response can never strand an agent:
 * until the successor is seen, the old token remains fully valid.
 */
export const ROTATION_AGE_MS = 24 * 60 * 60_000;
export const ROTATION_REOFFER_MS = 60 * 60_000;
export const ROTATION_GRACE_MS = 15 * 60_000;

/**
 * One rack token's lifecycle state:
 * - `current` — the rack's working credential
 * - `pending` — a minted successor the agent has not used yet
 * - `grace` — superseded; valid only until `graceUntil`
 */
export interface RackTokenRecord {
  rackId: string;
  status: 'current' | 'pending' | 'grace';
  issuedAt: Date;
  /** Hard cutoff for `grace` tokens; absent otherwise. */
  graceUntil?: Date;
}

/**
 * Persistence for machine credentials, hashed at rest. Implementations:
 * `InMemoryMachineIdentityStore` (testing) and `DynamoMachineIdentityStore`
 * (e3-aws; `PK=ENROLLTOKEN|RACKTOKEN`, `SK={tokenHash}`).
 */
export interface MachineIdentityStore {
  /**
   * Record a freshly minted enrollment token.
   *
   * @param tokenHash - SHA-256 hex of the plaintext token
   * @param expiresAt - When the token stops being exchangeable
   */
  putEnrollmentToken(tokenHash: string, expiresAt: Date): Promise<void>;

  /**
   * Atomically consume an enrollment token: exactly one caller ever
   * receives `true` for a given token, and only before its expiry.
   *
   * @param tokenHash - SHA-256 hex of the presented token
   * @param now - Current time (injected for testability)
   * @returns Whether the token was valid, unexpired, and not yet used
   */
  consumeEnrollmentToken(tokenHash: string, now: Date): Promise<boolean>;

  /**
   * Bind a rack token (hashed) to a rack identity.
   *
   * @param tokenHash - SHA-256 hex of the plaintext rack token
   * @param rackId - The rack the token authenticates
   * @param issuedAt - Mint time (the rotation clock)
   * @param status - `current` at enrollment, `pending` for a rotation offer
   */
  putRackToken(tokenHash: string, rackId: string, issuedAt: Date, status: 'current' | 'pending'): Promise<void>;

  /**
   * Resolve a presented rack token. Validity (grace expiry) is the
   * caller's judgement — this returns the raw record.
   *
   * @param tokenHash - SHA-256 hex of the presented token
   * @returns The token record, or null when unknown
   */
  getRackToken(tokenHash: string): Promise<RackTokenRecord | null>;

  /**
   * All tokens bound to a rack (a handful: current + at most one pending
   * + expiring grace rows).
   *
   * @param rackId - The rack whose tokens are listed
   */
  listRackTokens(rackId: string): Promise<Array<RackTokenRecord & { tokenHash: string }>>;

  /**
   * Activate a successor: `tokenHash` becomes `current`; every OTHER
   * `current`/`pending` token of the rack drops to `grace` with the given
   * cutoff. Tokens already in grace keep their earlier cutoff.
   *
   * @param rackId - The rack rotating
   * @param tokenHash - The successor's hash (first use just observed)
   * @param graceUntil - When the superseded token(s) die
   */
  promoteRackToken(rackId: string, tokenHash: string, graceUntil: Date): Promise<void>;

  /**
   * Remove one token row (a stale pending offer being replaced).
   *
   * @param tokenHash - SHA-256 hex of the token to remove
   */
  deleteRackToken(tokenHash: string): Promise<void>;

  /**
   * Remove every token bound to a rack — deregistration hygiene. Security
   * does not depend on this (the middleware checks the registration), but
   * it keeps the credential table honest.
   *
   * @param rackId - The rack whose tokens are purged
   */
  deleteRackTokens(rackId: string): Promise<void>;
}

/**
 * Hash a token for at-rest storage and lookups.
 *
 * @param token - The plaintext token
 * @returns SHA-256 hex digest
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Generate a single-use enrollment token (256 bits of entropy).
 *
 * @returns The plaintext token and its at-rest hash
 */
export function generateEnrollmentToken(): { token: string; tokenHash: string } {
  const token = `${ENROLLMENT_TOKEN_PREFIX}${randomBytes(32).toString('hex')}`;
  return { token, tokenHash: hashToken(token) };
}

/**
 * Generate a long-lived rack token (256 bits of entropy).
 *
 * @returns The plaintext token and its at-rest hash
 */
export function generateRackToken(): { token: string; tokenHash: string } {
  const token = `${RACK_TOKEN_PREFIX}${randomBytes(32).toString('hex')}`;
  return { token, tokenHash: hashToken(token) };
}
