/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * An object's hash on Node: the `computeHash` of `objects.ts`, computed by
 * Node's own SHA-256, which the root entry exports in its place.
 *
 * @packageDocumentation
 */

import { createHash } from 'node:crypto';

/**
 * Calculate SHA256 hash of data, with Node's own SHA-256.
 *
 * @remarks
 * The same digest as the portable entry's `computeHash` (`objects.ts`), East's
 * SHA-256, which names an object as every runtime's Writer names it, computed
 * natively, at the speed a store that names every write by it needs. The root
 * entry exports this one as `computeHash`, so a backend on Node that names its
 * writes by the root entry's hashes natively, the local store among them; the
 * shared modules keep the portable one, which runs wherever e3 does.
 *
 * @param data - Data to hash
 * @returns SHA256 hash as a hex string
 */
export function computeHash(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
