/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * Vendored from npm package 'random' (https://github.com/transitive-bullshit/random)
 * Originally by Travis Fischer, distributed under MIT license
 */

import * as crypto from "crypto";
import RNG, { type SeedType } from "./rng.js";

/**
 * Cryptographically secure RNG using Node.js crypto.randomBytes
 *
 * Note: Seeding is not supported for cryptographic RNG as it uses the OS entropy source.
 * The seed/clone methods are provided for API compatibility but have no effect.
 */
export default class CryptoRNG extends RNG {
    get name(): string {
        return "crypto";
    }

    /**
     * Generate a random number in [0, 1) using crypto.randomBytes
     */
    next(): number {
        // Use 6 bytes (48 bits) for good precision
        const bytes = crypto.randomBytes(6);
        const value = bytes.readUIntBE(0, 6);
        // Divide by 2^48 to get [0, 1)
        return value / 0x1000000000000;
    }

    /**
     * Seeding is not supported for cryptographic RNG (no-op for API compatibility)
     */
    seed(_seed?: SeedType, _opts?: Record<string, unknown>): void {
        // No-op: crypto RNG uses OS entropy source
    }

    /**
     * Clone returns a new instance (seeding not supported)
     */
    clone(_seed?: SeedType, _opts?: Record<string, unknown>): RNG {
        return new CryptoRNG();
    }
}
