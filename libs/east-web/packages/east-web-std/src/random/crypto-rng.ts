/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * Vendored from npm package 'random' (https://github.com/transitive-bullshit/random)
 * Originally by Travis Fischer, distributed under MIT license
 *
 * Ported from east-node-std's src/random/crypto-rng.ts
 * (libs/east-node/packages/east-node-std/src/random/crypto-rng.ts), modified
 * to draw from the web-standard `crypto.getRandomValues` where east-node-std
 * reads `node:crypto`'s `randomBytes`. It reads the same 48 bits the same
 * way, so the two draw from the same distribution; an unseeded draw is never
 * reproducible on either.
 */

import RNG, { type SeedType } from "./rng.js";

/**
 * Cryptographically secure RNG using the web-standard crypto.getRandomValues
 *
 * Note: Seeding is not supported for cryptographic RNG as it uses the host's entropy source.
 * The seed/clone methods are provided for API compatibility but have no effect.
 */
export default class CryptoRNG extends RNG {
    get name(): string {
        return "crypto";
    }

    /**
     * Generate a random number in [0, 1) using crypto.getRandomValues
     */
    next(): number {
        // Use 6 bytes (48 bits) for good precision
        const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
        // Read them as one big-endian unsigned integer, as east-node-std's
        // `readUIntBE(0, 6)` does; 2^48 is well inside a double's exact range
        let value = 0;
        for (const byte of bytes) {
            value = value * 256 + byte;
        }
        // Divide by 2^48 to get [0, 1)
        return value / 0x1000000000000;
    }

    /**
     * Seeding is not supported for cryptographic RNG (no-op for API compatibility)
     */
    seed(_seed?: SeedType, _opts?: Record<string, unknown>): void {
        // No-op: crypto RNG uses the host's entropy source
    }

    /**
     * Clone returns a new instance (seeding not supported)
     */
    clone(_seed?: SeedType, _opts?: Record<string, unknown>): RNG {
        return new CryptoRNG();
    }
}
