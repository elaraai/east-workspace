/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Vendored from npm package 'random' (https://github.com/transitive-bullshit/random)
 * Originally by Travis Fischer, distributed under MIT license
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
