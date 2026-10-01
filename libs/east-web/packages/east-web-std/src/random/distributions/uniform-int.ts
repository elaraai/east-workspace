/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Vendored from npm package 'random' (https://github.com/transitive-bullshit/random)
 * Originally by Travis Fischer, distributed under MIT license
 *
 * Ported verbatim from east-node-std's src/random/distributions/uniform-int.ts
 * (libs/east-node/packages/east-node-std/src/random/distributions/uniform-int.ts):
 * a seeded stream must stay bit-identical to east-node-std's, which
 * test/random.spec.ts checks.
 */

import type RNG from "../rng.js";

export default (random: RNG, min: bigint, max: bigint) => {
    if (!Number.isInteger(Number(min))) {
        throw new Error(`Expected min to be an integer, got ${min}`);
    }
    if (!Number.isInteger(Number(max))) {
        throw new Error(`Expected max to be an integer, got ${max}`);
    }

    return () => {
        return Math.floor(random.next() * (Number(max) - Number(min) + 1) + Number(min));
    };
};
