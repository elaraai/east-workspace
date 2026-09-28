/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The hash a download checks each object against. A browser provides WebCrypto
 * only in a secure context, so a page served over plain http from any address
 * but localhost has `crypto` without `crypto.subtle`, and must still hash.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeHash } from './util.js';

describe('computeHash', () => {
  const abc = new TextEncoder().encode('abc');
  const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  // Two blocks and a partial third, so the fallback's padding is exercised.
  const long = Uint8Array.from({ length: 150 }, (_, i) => i);

  it('hashes with WebCrypto where the context has it', async () => {
    assert.equal(await computeHash(abc), ABC);
  });

  it('hashes where the context has no WebCrypto digest, to the same digest', async () => {
    const expected = await computeHash(long);
    const own = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true, writable: true });
    try {
      assert.equal(await computeHash(abc), ABC);
      assert.equal(await computeHash(long), expected);
    } finally {
      Object.defineProperty(globalThis, 'crypto', own);
    }
  });
});
