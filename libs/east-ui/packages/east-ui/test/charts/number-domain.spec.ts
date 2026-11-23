/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Whether a domain draws (east-workspace#1726): both bounds finite numbers,
 * the max past the min — East's order stands NaN past every number, so an
 * order alone would draw a domain whose max is NaN.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { drawsDomain } from "@elaraai/east-ui/internal";

describe("whether a domain draws (east-workspace#1726)", () => {
    test("it does where both bounds are finite numbers and the max is past the min", () => {
        assert.deepEqual([[0, 40], [-5, -1], [0.5, 0.75]].map(([min, max]) => drawsDomain(min!, max!)), [true, true, true]);
    });

    test("it doesn't for a max at or under its min, nor for a bound that is no finite number — NaN at either end, or an infinity", () => {
        const bounds = [[40, 0], [10, 10], [0, NaN], [NaN, 40], [NaN, NaN], [-Infinity, 40], [0, Infinity]];
        assert.deepEqual(bounds.map(([min, max]) => drawsDomain(min!, max!)), bounds.map(() => false));
    });
});
