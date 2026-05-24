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
    if (p < 0 || p >= 1) {
        throw new Error(`Expected p to be in [0, 1), got ${p}`);
    }

    return () => {
        return Math.floor(random.next() + p);
    };
};
