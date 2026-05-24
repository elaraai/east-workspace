/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Vendored from npm package 'random' (https://github.com/transitive-bullshit/random)
 * Originally by Travis Fischer, distributed under MIT license
 */

import type RNG from "../rng.js";

export default (random: RNG, n: bigint) => {
    if (!Number.isInteger(Number(n)) || n < 0n) {
        throw new Error(`Expected n to be a non-negative integer, got ${n}`);
    }

    return () => {
        let sum = 0;
        const iterations = Number(n);
        for (let i = 0; i < iterations; ++i) {
            sum += random.next();
        }

        return sum;
    };
};
