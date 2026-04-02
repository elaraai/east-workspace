/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, example } from "@elaraai/east";
import { Parallel } from "@elaraai/east-node-std";

export const parallelMap = example({
    keywords: ["parallel", "Parallel", "map", "concurrent", "worker"],
    description: "Apply a function to each element of an array in parallel",
    fn: East.asyncFunction([], IntegerType, ($) => {
        const input = $.let(East.value([1n, 2n, 3n, 4n, 5n]));
        const double = $.const(East.function([IntegerType], IntegerType, ($, x) => {
            return x.multiply(2n);
        }));
        const result = $.let(Parallel.map([IntegerType, IntegerType], input, double));
        return result.get(4n);
    }),
    inputs: [],
    returns: 10n,
});
