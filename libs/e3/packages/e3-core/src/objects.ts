/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Generic object utilities for e3.
 *
 * This module contains only storage-agnostic utilities.
 * Local filesystem operations are in storage/local/LocalObjectStore.ts, and
 * Node's own hash, which the root entry exports, in objects-node.ts
 */

import { sha256Hex } from '@elaraai/east';

/**
 * Calculate SHA256 hash of data: the portable hash.
 *
 * This is the core hashing function used throughout e3 for content addressing.
 * It's storage-agnostic and can be used with any backend.
 *
 * @remarks
 * East's SHA-256, which runs wherever e3 does, a browser among them, and names
 * an object as every runtime's Writer names it. The portable entry exports
 * this one, and e3's shared modules hash with it. The root entry's
 * `computeHash` is Node's own SHA-256 (`objects-node.ts`), which gives the
 * same digest natively: a backend on Node names its writes by that one, as the
 * local store does.
 *
 * @param data - Data to hash
 * @returns SHA256 hash as a hex string
 */
export function computeHash(data: Uint8Array): string {
  return sha256Hex(data);
}

/** An object's hash, as {@link computeHash} gives it: a SHA-256 in lowercase hex. */
const OBJECT_HASH = /^[0-9a-f]{64}$/;

/**
 * Whether a string is of the form e3 names objects by: a SHA-256 in lowercase
 * hex, as {@link computeHash} gives it — an object's hash, and an execution's
 * task and inputs hashes.
 *
 * @remarks
 * A client names objects by hash — a transfer's delivery, an object it reads —
 * and so does a package being imported, so a store checks one before it becomes
 * a path or a key, and refuses one that is not of this form with
 * `InvalidNameError` (`checkHash`). Every store checks the same form, so a hash
 * is valid on every backend or on none.
 *
 * @param value - The string
 * @returns Whether it is of that form
 */
export function isObjectHash(value: string): boolean {
  return OBJECT_HASH.test(value);
}
