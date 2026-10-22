/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Vendored from npm package 'random' (https://github.com/transitive-bullshit/random)
 * Originally by Travis Fischer, distributed under MIT license
 * Uses Marsaglia polar method for generating normal distribution
 *
 * Ported verbatim from east-node-std's src/random/distributions/normal.ts
 * (libs/east-node/packages/east-node-std/src/random/distributions/normal.ts):
 * a seeded stream must stay bit-identical to east-node-std's, which
 * test/random.spec.ts checks.
 */

import type RNG from "../rng.js";
import { fdlibmLog } from "../fdlibm-log.js";

export default (random: RNG, mu = 0, sigma = 1) => {
    return () => {
        let x: number, y: number, r: number;

        // The first draw of the pair, a pair on the unit circle rejected: what
        // east-node-std (and every other runtime) returns from the same stream.
        // Its logarithm is fdlibm's, computed here, not Math.log's: the same bits on every host.
        do {
            x = random.next() * 2 - 1;
            y = random.next() * 2 - 1;
            r = x * x + y * y;
        } while (r <= 0 || r >= 1);

        return mu + sigma * x * Math.sqrt((-2 * fdlibmLog(r)) / r);
    };
};
