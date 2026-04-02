/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Vendored from npm package 'random' (https://github.com/transitive-bullshit/random)
 * Originally by Travis Fischer, distributed under MIT license
 */

import type RNG from "../rng.js";

export default (random: RNG, p: number) => {
    if (p <= 0 || p >= 1) {
        throw new Error(`Expected p to be in (0, 1), got ${p}`);
    }
    const invLogP = 1.0 / Math.log(1.0 - p);

    return () => {
        return Math.floor(1 + Math.log(random.next()) * invLogP);
    };
};
