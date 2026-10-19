/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, some, none, example } from "@elaraai/east";
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
            solver: none,
            max_time_seconds: none,
            relative_gap_limit: none,
            hints: none,
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

export const linearSolveMipRelativeGapLimit = example({
    keywords: ["google or", "linear", "linearSolve", "MIP", "mixed integer", "relative_gap_limit", "gap", "early stop", "optimality gap", "SCIP", "knapsack"],
    description: "Solve a 0/1 knapsack MIP with a 1% relative optimality-gap early-stop (relative_gap_limit)",
    fn: East.function([], BooleanType, ($) => {
        // 0/1 knapsack: values [6, 10, 12], weights [2, 4, 6], capacity 10.
        // Optimum picks items 1 and 2 (value 22, weight 10).
        const model = $.let({
            variables: [
                { name: "x0", lower_bound: 0.0, upper_bound: 1.0, is_integer: true },
                { name: "x1", lower_bound: 0.0, upper_bound: 1.0, is_integer: true },
                { name: "x2", lower_bound: 0.0, upper_bound: 1.0, is_integer: true },
            ],
            constraints: [
                {
                    terms: [
                        { var: "x0", coeff: 2.0 },
                        { var: "x1", coeff: 4.0 },
                        { var: "x2", coeff: 6.0 },
                    ],
                    lower_bound: -1e20,
                    upper_bound: 10.0,
                },
            ],
            objective: {
                terms: [
                    { var: "x0", coeff: 6.0 },
                    { var: "x1", coeff: 10.0 },
                    { var: "x2", coeff: 12.0 },
                ],
                maximize: true,
            },
        }, GoogleOr.Types.LinearModelType);

        // relative_gap_limit stops branch-and-bound once the proven gap is
        // within 1% — for this small instance the incumbent is the true optimum.
        const config = $.let({
            solver: none,
            max_time_seconds: none,
            relative_gap_limit: some(0.01),
            hints: none,
        }, GoogleOr.Types.LinearConfigType);

        const result = $.let(GoogleOr.linearSolve(model, config));

        // Optimum objective is 22 (items 1 + 2).
        return result.objective_value.match({
            some: ($, v) => v.greaterThanOrEqual(22.0),
            none: ($) => false,
        });
    }),
    inputs: [],
    returns: true,
});

export const linearSolveMipWarmStart = example({
    keywords: ["google or", "linear", "linearSolve", "MIP", "warm start", "solution hint", "hints", "SetHint", "SCIP", "receding horizon", "re-solve", "knapsack"],
    description: "Warm-start a knapsack MIP re-solve by hinting the previous solution (hints are advisory: the optimum is unchanged)",
    fn: East.function([], BooleanType, ($) => {
        // Same 0/1 knapsack: values [6, 10, 12], weights [2, 4, 6], capacity 10.
        // Optimum picks items 1 and 2 (value 22, weight 10).
        const model = $.let({
            variables: [
                { name: "x0", lower_bound: 0.0, upper_bound: 1.0, is_integer: true },
                { name: "x1", lower_bound: 0.0, upper_bound: 1.0, is_integer: true },
                { name: "x2", lower_bound: 0.0, upper_bound: 1.0, is_integer: true },
            ],
            constraints: [
                {
                    terms: [
                        { var: "x0", coeff: 2.0 },
                        { var: "x1", coeff: 4.0 },
                        { var: "x2", coeff: 6.0 },
                    ],
                    lower_bound: -1e20,
                    upper_bound: 10.0,
                },
            ],
            objective: {
                terms: [
                    { var: "x0", coeff: 6.0 },
                    { var: "x1", coeff: 10.0 },
                    { var: "x2", coeff: 12.0 },
                ],
                maximize: true,
            },
        }, GoogleOr.Types.LinearModelType);

        // A receding-horizon loop re-solves a near-identical model each epoch:
        // the previous epoch's solution is a near-feasible partial hint. "x9"
        // names a variable that dropped out of this epoch's model — unknown
        // names are ignored, not errors.
        const config = $.let({
            solver: none,
            max_time_seconds: none,
            relative_gap_limit: none,
            hints: some([
                { var: "x0", value: 0.0 },
                { var: "x1", value: 1.0 },
                { var: "x2", value: 1.0 },
                { var: "x9", value: 1.0 },
            ]),
        }, GoogleOr.Types.LinearConfigType);

        const result = $.let(GoogleOr.linearSolve(model, config));

        // Hints only guide the search: the returned optimum is still 22.
        return result.objective_value.match({
            some: ($, v) => v.equal(22.0),
            none: ($) => false,
        });
    }),
    inputs: [],
    returns: true,
});

export const linearSolveColumns = example({
    keywords: ["google or", "linear", "linearSolveColumns", "columns", "columnar", "vectors", "bulk", "LP", "production", "sparse rows"],
    description: "Allocate production hours with the linear program given in columns: the variables' bounds, the constraint rows and the objective as vectors",
    fn: East.function([], BooleanType, ($) => {
        // The resource allocation of linearSolveResourceAllocation, as columns:
        // variables A, B, C are indices 0, 1, 2; the two constraint rows hold
        // their terms at row_ptr[r] .. row_ptr[r + 1] of col_ix and coeff.
        const model = $.let({
            var_lower: new Float64Array([0.0, 0.0, 0.0]),
            var_upper: new Float64Array([100.0, 100.0, 100.0]),
            var_integer: new Uint8ClampedArray([0, 0, 0]),
            // machine hours: 2A + 3B + 1C <= 18; labor hours: 1A + 2B + 2C <= 12
            row_lower: new Float64Array([-1e20, -1e20]),
            row_upper: new Float64Array([18.0, 12.0]),
            row_ptr: new BigInt64Array([0n, 3n, 6n]),
            col_ix: new BigInt64Array([0n, 1n, 2n, 0n, 1n, 2n]),
            coeff: new Float64Array([2.0, 3.0, 1.0, 1.0, 2.0, 2.0]),
            // profit: 5A + 8B + 6C, maximized
            objective: new Float64Array([5.0, 8.0, 6.0]),
            maximize: true,
        }, GoogleOr.Types.LinearModelColumnsType);

        const config = $.let({
            solver: none,
            max_time_seconds: none,
            relative_gap_limit: none,
            hints: none,
        }, GoogleOr.Types.LinearColumnsConfigType);

        const result = $.let(GoogleOr.linearSolveColumns(model, config));

        // The optimum the named form finds, and one value per variable
        return result.objective_value.match({
            some: ($, v) => v.greaterThan(0.0).and(() => result.values.length().equal(3n)),
            none: ($) => false,
        });
    }),
    inputs: [],
    returns: true,
});
