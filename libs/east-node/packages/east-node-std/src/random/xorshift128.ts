/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Seedable RNG implementation using xorshift128+ algorithm.
 *
 * Fast, high-quality PRNG suitable for simulations.
 * Period: 2^128 - 1
 */

import RNG, { type SeedType } from "./rng.js";

export default class XorShift128RNG extends RNG {
    private state0: bigint;
    private state1: bigint;

    constructor(seed?: SeedType) {
        super();
        // Initialize with default state
        this.state0 = 0n;
        this.state1 = 0n;

        if (seed !== undefined) {
            this.seed(seed);
        } else {
            // Default seed based on current time
            this.seed(Date.now());
        }
    }

    get name(): string {
        return "xorshift128+";
    }

    /**
     * Generate next random number in [0, 1)
     */
    next(): number {
        // xorshift128+ algorithm
        let s1 = this.state0;
        const s0 = this.state1;
        const result = s0 + s1;

        this.state0 = s0;
        s1 ^= s1 << 23n;
        this.state1 = s1 ^ s0 ^ (s1 >> 17n) ^ (s0 >> 26n);

        // Convert to [0, 1) range
        // Use upper 53 bits for double precision
        const upper53 = (result >> 11n) & ((1n << 53n) - 1n);
        return Number(upper53) / (2 ** 53);
    }

    /**
     * Seed the RNG for reproducible sequences
     */
    seed(seed?: SeedType, _opts?: Record<string, unknown>): void {
        let seedNum: bigint;

        if (typeof seed === "bigint") {
            seedNum = seed;
        } else if (typeof seed === "number") {
            seedNum = BigInt(Math.floor(seed));
        } else if (typeof seed === "string") {
            // Hash the string to a number
            let hash = 0n;
            for (let i = 0; i < seed.length; i++) {
                hash = ((hash << 5n) - hash) + BigInt(seed.charCodeAt(i));
                hash = hash & 0xFFFFFFFFFFFFFFFFn; // Keep as 64-bit
            }
            seedNum = hash;
        } else if (seed instanceof RNG) {
            // Use another RNG to generate seed
            seedNum = BigInt(Math.floor(seed.next() * Number.MAX_SAFE_INTEGER));
        } else if (typeof seed === "function") {
            seedNum = BigInt(Math.floor(seed() * Number.MAX_SAFE_INTEGER));
        } else {
            seedNum = BigInt(Date.now());
        }

        // Initialize state using splitmix64 to ensure good initial state
        // even from poor seeds
        this.state0 = this.splitmix64(seedNum);
        this.state1 = this.splitmix64(this.state0);

        // Ensure state is never all zeros
        if (this.state0 === 0n && this.state1 === 0n) {
            this.state0 = 1n;
        }
    }

    /**
     * Clone this RNG with optional new seed
     */
    clone(seed?: SeedType, opts?: Record<string, unknown>): RNG {
        const cloned = new XorShift128RNG();
        if (seed !== undefined) {
            cloned.seed(seed, opts);
        } else {
            // Copy current state
            cloned.state0 = this.state0;
            cloned.state1 = this.state1;
        }
        return cloned;
    }

    /**
     * SplitMix64 for state initialization
     * Ensures good distribution even from sequential seeds
     */
    private splitmix64(x: bigint): bigint {
        x = (x + 0x9E3779B97F4A7C15n) & 0xFFFFFFFFFFFFFFFFn;
        x = ((x ^ (x >> 30n)) * 0xBF58476D1CE4E5B9n) & 0xFFFFFFFFFFFFFFFFn;
        x = ((x ^ (x >> 27n)) * 0x94D049BB133111EBn) & 0xFFFFFFFFFFFFFFFFn;
        return (x ^ (x >> 31n)) & 0xFFFFFFFFFFFFFFFFn;
    }
}
