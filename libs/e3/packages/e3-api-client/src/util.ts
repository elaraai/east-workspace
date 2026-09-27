/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { sha256Hex } from '@elaraai/east';

/**
 * Calculate SHA256 hash of data for content-addressed transfers.
 *
 * This is a browser-safe version, used because e3-api-client must be
 * browser-compatible (used by e3-ui-components in webview builds). The
 * canonical sync implementation lives in @elaraai/e3-core (objects.ts) but uses
 * Node.js `crypto.createHash`, which is not available in browser environments.
 *
 * It uses the Web Crypto API (`crypto.subtle`) where the context has it:
 * Node.js (>=15), and a browser page served over https or from localhost. A
 * browser provides it only in a secure context, so a page served over plain
 * http from any other address hashes with east's own SHA-256, which produces
 * the same digest.
 *
 * @param data - Data to hash
 * @returns SHA256 hash as a hex string
 */
export async function computeHash(data: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) return sha256Hex(data);
  const hashBuffer = await subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
