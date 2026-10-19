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

        // The first draw of the pair, and a pair on the unit circle rejected:
        // what east-py-std and east-c-std return from the same stream, so a
        // seeded program draws the same normals on every runtime
        // (test/random.spec.ts pins the first 1,000).
        do {
            x = random.next() * 2 - 1;
            y = random.next() * 2 - 1;
            r = x * x + y * y;
        } while (r <= 0 || r >= 1);

        return mu + sigma * x * Math.sqrt((-2 * Math.log(r)) / r);
    };
};
