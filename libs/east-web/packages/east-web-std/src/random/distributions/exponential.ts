/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Vendored from npm package 'random' (https://github.com/transitive-bullshit/random)
 * Originally by Travis Fischer, distributed under MIT license
 *
 * Ported verbatim from east-node-std's src/random/distributions/exponential.ts
 * (libs/east-node/packages/east-node-std/src/random/distributions/exponential.ts):
 * a seeded stream must stay bit-identical to east-node-std's, which
 * test/random.spec.ts checks.
 */

import type RNG from "../rng.js";

export default (random: RNG, lambda: number) => {
    if (lambda <= 0) {
        throw new Error(`Expected lambda to be positive, got ${lambda}`);
    }

    return () => {
        return -Math.log(1 - random.next()) / lambda;
    };
};
