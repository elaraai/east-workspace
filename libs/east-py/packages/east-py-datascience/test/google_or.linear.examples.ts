/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, variant, example } from "@elaraai/east";
import { GoogleOr } from "@elaraai/east-py-datascience";

export const linearSolveResourceAllocation = example({
    keywords: ["google or", "linear", "linearSolve", "LP", "resource allocation", "production", "throughput", "mixed integer"],
    description: "Allocate production hours across product lines to maximize throughput given machine and labor constraints",
    fn: East.function([], BooleanType, ($) => {
        // 3 products: A, B, C
        // Profit: A=$5, B=$8, C=$6 per unit
        // Machine hours: A=2h, B=3h, C=1h — available: 18h
        // Labor hours: A=1h, B=2h, C=2h — available: 12h
        // Maximize profit
        const model = $.let({
            variables: [
                { name: "A", lower_bound: 0.0, upper_bound: 100.0, is_integer: false },
                { name: "B", lower_bound: 0.0, upper_bound: 100.0, is_integer: false },
                { name: "C", lower_bound: 0.0, upper_bound: 100.0, is_integer: false },
            ],
            constraints: [
                // Machine hours: 2A + 3B + 1C <= 18
                {
                    terms: [
                        { var: "A", coeff: 2.0 },
                        { var: "B", coeff: 3.0 },
                        { var: "C", coeff: 1.0 },
                    ],
                    lower_bound: -1e20,
                    upper_bound: 18.0,
                },
                // Labor hours: 1A + 2B + 2C <= 12
                {
                    terms: [
                        { var: "A", coeff: 1.0 },
                        { var: "B", coeff: 2.0 },
                        { var: "C", coeff: 2.0 },
                    ],
                    lower_bound: -1e20,
                    upper_bound: 12.0,
                },
            ],
            objective: {
                terms: [
                    { var: "A", coeff: 5.0 },
                    { var: "B", coeff: 8.0 },
                    { var: "C", coeff: 6.0 },
                ],
                maximize: true,
            },
        }, GoogleOr.Types.LinearModelType);

        const config = $.let({
            solver: variant('none', null),
            max_time_seconds: variant('none', null),
        }, GoogleOr.Types.LinearConfigType);

        const result = $.let(GoogleOr.linearSolve(model, config));

        // Should find optimal allocation with positive objective
        return result.objective_value.match({
            some: ($, v) => v.greaterThan(0.0),
            none: ($) => false,
        });
    }),
    inputs: [],
    returns: true,
});
