/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Whether a domain draws (east-workspace#1726): both bounds finite numbers,
 * the max past the min — East's order stands NaN past every number, so an
 * order alone would draw a domain whose max is NaN. Bounds written as numbers
 * that draw no scale are refused as a Trace or a Sparkline is built; bounds an
 * expression gives are read as they come.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { East, FloatType } from "@elaraai/east";
import { Sparkline, Trace, UIComponentType, drawsDomain } from "@elaraai/east-ui/internal";

describe("whether a domain draws (east-workspace#1726)", () => {
    test("it does where both bounds are finite numbers and the max is past the min", () => {
        assert.deepEqual([[0, 40], [-5, -1], [0.5, 0.75]].map(([min, max]) => drawsDomain(min!, max!)), [true, true, true]);
    });

    test("it doesn't for a max at or under its min, nor for a bound that is no finite number — NaN at either end, or an infinity", () => {
        const bounds = [[40, 0], [10, 10], [0, NaN], [NaN, 40], [NaN, NaN], [-Infinity, 40], [0, Infinity]];
        assert.deepEqual(bounds.map(([min, max]) => drawsDomain(min!, max!)), bounds.map(() => false));
    });

    test("a Trace or a Sparkline given bounds written as numbers that draw no scale is refused as it is built, naming them; bounds an expression gives build", () => {
        const runs = "runs from its min to a max past it, both finite numbers";
        assert.throws(() => East.function([], UIComponentType, (_$) => Trace.Root([{ name: "Load", values: [1, 2] }], { domain: [40, 0] })),
            { message: `Trace has the domain [40, 0] — one scale for every track ${runs}` });
        assert.throws(() => East.function([], UIComponentType, (_$) => Sparkline.Root([1, 2], { domain: [5, 5] })),
            { message: `Sparkline has the domain [5, 5] — one vertical scale ${runs}` });
        assert.throws(() => East.function([], UIComponentType, (_$) => Sparkline.Root([1, 2], { domain: [0, NaN] })),
            { message: `Sparkline has the domain [0, NaN] — one vertical scale ${runs}` });
        // Bounds an expression gives are read as the page runs: one that draws no scale places nothing then.
        assert.doesNotThrow(() => East.function([FloatType], UIComponentType, (_$, max) => Sparkline.Root([1, 2], { domain: [5, max] })));
        assert.doesNotThrow(() => East.function([], UIComponentType, (_$) => Trace.Root([{ name: "Load", values: [1, 2] }], { domain: [0, 40] })));
    });
});
