/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Vendored from npm package 'random' (https://github.com/transitive-bullshit/random)
 * Originally by Travis Fischer, distributed under MIT license
 * Uses Marsaglia polar method for generating normal distribution
 */

import type RNG from "../rng.js";

export default (random: RNG, mu = 0, sigma = 1) => {
    return () => {
        let x: number, y: number, r: number;

        do {
            x = random.next() * 2 - 1;
            y = random.next() * 2 - 1;
            r = x * x + y * y;
        } while (!r || r > 1);

        return mu + sigma * y * Math.sqrt((-2 * Math.log(r)) / r);
    };
};
