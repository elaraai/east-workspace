/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Vendored from npm package 'random' (https://github.com/transitive-bullshit/random)
 * Originally by Travis Fischer, distributed under MIT license
 *
 * Ported verbatim from east-node-std's src/random/distributions/binomial.ts
 * (libs/east-node/packages/east-node-std/src/random/distributions/binomial.ts):
 * a seeded stream must stay bit-identical to east-node-std's, which
 * test/random.spec.ts checks.
 */

import type RNG from "../rng.js";

export default (random: RNG, n: bigint, p: number) => {
    if (!Number.isInteger(Number(n)) || n <= 0n) {
        throw new Error(`Expected n to be a positive integer, got ${n}`);
    }
    if (p < 0 || p >= 1) {
        throw new Error(`Expected p to be in [0, 1), got ${p}`);
    }

    return () => {
        let i = 0;
        let x = 0;
        const trials = Number(n);

        while (i++ < trials) {
            if (random.next() < p) {
                x++;
            }
        }
        return x;
    };
};
