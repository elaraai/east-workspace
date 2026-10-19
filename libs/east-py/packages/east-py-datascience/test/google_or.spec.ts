/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Google OR-Tools platform function tests.
 *
 * These tests use describeEast following east-node conventions.
 * Tests compile East functions and export IR for Python execution.
 *
 * Note: These tests require the ortools library to be installed in the Python environment.
 * Install with: pip install ortools
 */
import { East, variant, some, none } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import {
    GoogleOr,
    CpSatModelType,
    CpSatConfigType,
    CpSatModelColumnsType,
    CpSatColumnsConfigType,
    RoutingModelType,
    RoutingConfigType,
    LinearModelType,
    LinearConfigType,
    LinearModelColumnsType,
    LinearColumnsConfigType,
} from "@elaraai/east-py-datascience";
import * as cpsatEx from "./google_or.cpsat.examples.js";
import * as routingEx from "./google_or.routing.examples.js";
import * as linearEx from "./google_or.linear.examples.js";
import * as graphEx from "./google_or.graph.examples.js";

describeEast("GoogleOr platform functions", (test) => {


    // ========================================================================
    // CP-SAT Tests
    // ========================================================================

    Assert.examples(test, { cpsatScheduleJobs: cpsatEx.cpsatScheduleJobs, cpsatAssignShifts: cpsatEx.cpsatAssignShifts, cpsatSolveAll: cpsatEx.cpsatSolveAll, cpsatSolveWithHints: cpsatEx.cpsatSolveWithHints });

    test("cpsat solves simple integer optimization", $ => {
        // Maximize 2x + 3y subject to x + y <= 10, x,y in [0,10]
        const model = $.let({
            int_vars: [
                { name: "x", lower_bound: 0n, upper_bound: 10n },
                { name: "y", lower_bound: 0n, upper_bound: 10n },
            ],
            bool_vars: [
                { name: "_unused" },
            ],
            interval_vars: [
                { name: "_unused_iv", start: "x", size: "x", end: "x", is_present: variant('none', null) },
            ],
            constraints: [
                variant('linear', {
                    expr: {
                        terms: [
                            { var: "x", coeff: 1n },
                            { var: "y", coeff: 1n },
                        ],
                        constant: 0n,
                    },
                    op: variant('less_equal', null),
                    rhs: 10n,
                }),
            ],
            objective: variant('some', variant('maximize', {
                terms: [
                    { var: "x", coeff: 2n },
                    { var: "y", coeff: 3n },
                ],
                constant: 0n,
            })),
        }, CpSatModelType);

        const config = $.let({
            max_time_seconds: variant('none', null),
            num_workers: variant('none', null),
            log_search_progress: variant('none', null),
            seed: variant('some', 42n),
            max_solutions: variant('none', null),
            relative_gap_limit: variant('none', null),
            absolute_gap_limit: variant('none', null),
            hints: none,
        }, CpSatConfigType);

        const result = $.let(GoogleOr.cpsatSolve(model, config));

        // Objective: maximize 2x + 3y with x+y<=10 -> x=0,y=10 -> 30
        $.match(result.objective_value, {
            some: ($, v) => $(Assert.equal(v, East.value(30.0))),
            none: $ => $(Assert.fail(East.value("Expected objective value"))),
        });

        $(Assert.greater(result.wall_time, East.value(0.0)));
    });

    test("cpsat hints are advisory: a suboptimal hint never changes the optimum", $ => {
        // Same model as above (optimum 30 at x=0,y=10). The hint suggests the
        // feasible but suboptimal (x=10, y=0) -> 20, plus an unknown variable
        // and an interval variable - both ignored.
        const model = $.let({
            int_vars: [
                { name: "x", lower_bound: 0n, upper_bound: 10n },
                { name: "y", lower_bound: 0n, upper_bound: 10n },
            ],
            bool_vars: [
                { name: "_unused" },
            ],
            interval_vars: [
                { name: "_unused_iv", start: "x", size: "x", end: "x", is_present: none },
            ],
            constraints: [
                variant('linear', {
                    expr: {
                        terms: [
                            { var: "x", coeff: 1n },
                            { var: "y", coeff: 1n },
                        ],
                        constant: 0n,
                    },
                    op: variant('less_equal', null),
                    rhs: 10n,
                }),
            ],
            objective: variant('some', variant('maximize', {
                terms: [
                    { var: "x", coeff: 2n },
                    { var: "y", coeff: 3n },
                ],
                constant: 0n,
            })),
        }, CpSatModelType);

        const config = $.let({
            max_time_seconds: none,
            num_workers: none,
            log_search_progress: none,
            seed: none,
            max_solutions: none,
            relative_gap_limit: none,
            absolute_gap_limit: none,
            hints: some([
                { var: "x", value: 10n },
                { var: "y", value: 0n },
                { var: "dropped_out", value: 1n },
                { var: "_unused_iv", value: 0n },
            ]),
        }, CpSatConfigType);

        const result = $.let(GoogleOr.cpsatSolve(model, config));

        $.match(result.objective_value, {
            some: ($, v) => $(Assert.equal(v, East.value(30.0))),
            none: $ => $(Assert.fail(East.value("Expected objective value"))),
        });
    });

    test("cpsat all_different constraint", $ => {
        // 3 variables, each in [1,3], all must be different
        // Maximize a + 2b + 3c -> a=1,b=2,c=3 -> 1+4+9 = 14
        const model = $.let({
            int_vars: [
                { name: "a", lower_bound: 1n, upper_bound: 3n },
                { name: "b", lower_bound: 1n, upper_bound: 3n },
                { name: "c", lower_bound: 1n, upper_bound: 3n },
                { name: "_d", lower_bound: 0n, upper_bound: 0n },
            ],
            bool_vars: [
                { name: "_unused" },
            ],
            interval_vars: [
                { name: "_unused_iv", start: "_d", size: "_d", end: "_d", is_present: variant('none', null) },
            ],
            constraints: [
                variant('all_different', {
                    vars: ["a", "b", "c"],
                }),
            ],
            objective: variant('some', variant('maximize', {
                terms: [
                    { var: "a", coeff: 1n },
                    { var: "b", coeff: 2n },
                    { var: "c", coeff: 3n },
                ],
                constant: 0n,
            })),
        }, CpSatModelType);

        const config = $.let({
            max_time_seconds: variant('none', null),
            num_workers: variant('none', null),
            log_search_progress: variant('none', null),
            seed: variant('some', 42n),
            max_solutions: variant('none', null),
            relative_gap_limit: variant('none', null),
            absolute_gap_limit: variant('none', null),
            hints: none,
        }, CpSatConfigType);

        const result = $.let(GoogleOr.cpsatSolve(model, config));

        $.match(result.objective_value, {
            some: ($, v) => $(Assert.equal(v, East.value(14.0))),
            none: $ => $(Assert.fail(East.value("Expected objective value"))),
        });
    });

    // ========================================================================
    // Routing Tests
    // ========================================================================

    Assert.examples(test, { routingSolveVRP: routingEx.routingSolveVRP, routingSolveWithTimeWindows: routingEx.routingSolveWithTimeWindows, routingSolvePickupDelivery: routingEx.routingSolvePickupDelivery });

    test("routing solves simple TSP", $ => {
        // 4 cities, find shortest tour
        const model = $.let({
            distance_matrix: [
                [0n, 10n, 15n, 20n],
                [10n, 0n, 35n, 25n],
                [15n, 35n, 0n, 30n],
                [20n, 25n, 30n, 0n],
            ],
            num_vehicles: 1n,
            depot: 0n,
            demands: variant('some', [0n, 1n, 1n, 1n]),
            vehicle_capacities: variant('some', [100n]),
            time_matrix: variant('some', [
                [0n, 10n, 15n, 20n],
                [10n, 0n, 35n, 25n],
                [15n, 35n, 0n, 30n],
                [20n, 25n, 30n, 0n],
            ]),
            time_windows: variant('some', [
                { start: 0n, end: 1000n },
                { start: 0n, end: 1000n },
                { start: 0n, end: 1000n },
                { start: 0n, end: 1000n },
            ]),
            pickup_deliveries: variant('some', [
                { pickup: 1n, delivery: 2n },
            ]),
        }, RoutingModelType);

        const config = $.let({
            first_solution: variant('some', variant('path_cheapest_arc', null)),
            metaheuristic: variant('none', null),
            max_time_seconds: variant('some', 10.0),
        }, RoutingConfigType);

        const result = $.let(GoogleOr.routingSolve(model, config));

        // Should have exactly 1 route
        $(Assert.equal(result.routes.length(), 1n));
        // Total distance should be positive
        $(Assert.greater(result.total_distance, 0n));
        $(Assert.greater(result.wall_time, East.value(0.0)));
    });

    // ========================================================================
    // Linear Programming Tests
    // ========================================================================

    Assert.examples(test, { linearSolveResourceAllocation: linearEx.linearSolveResourceAllocation, linearSolveMipRelativeGapLimit: linearEx.linearSolveMipRelativeGapLimit, linearSolveMipWarmStart: linearEx.linearSolveMipWarmStart });

    test("linear solves simple LP", $ => {
        // Maximize 3x + 2y subject to x + y <= 4, x <= 3, y <= 3, x,y >= 0
        // Optimal: x=3, y=1 -> 11
        const model = $.let({
            variables: [
                { name: "x", lower_bound: 0.0, upper_bound: 3.0, is_integer: false },
                { name: "y", lower_bound: 0.0, upper_bound: 3.0, is_integer: false },
            ],
            constraints: [
                {
                    terms: [
                        { var: "x", coeff: 1.0 },
                        { var: "y", coeff: 1.0 },
                    ],
                    lower_bound: -1e20,
                    upper_bound: 4.0,
                },
            ],
            objective: {
                terms: [
                    { var: "x", coeff: 3.0 },
                    { var: "y", coeff: 2.0 },
                ],
                maximize: true,
            },
        }, LinearModelType);

        const config = $.let({
            solver: none,
            max_time_seconds: none,
            relative_gap_limit: none,
            hints: none,
        }, LinearConfigType);

        const result = $.let(GoogleOr.linearSolve(model, config));

        $.match(result.objective_value, {
            some: ($, v) => $(Assert.equal(v, East.value(11.0))),
            none: $ => $(Assert.fail(East.value("Expected objective value"))),
        });

        $(Assert.greater(result.wall_time, East.value(0.0)));
    });

    test("linear solves MIP with integer variables", $ => {
        // Maximize 5x + 4y, x+y <= 5, x,y integer >= 0
        // Optimal: x=5, y=0 -> 25
        const model = $.let({
            variables: [
                { name: "x", lower_bound: 0.0, upper_bound: 5.0, is_integer: true },
                { name: "y", lower_bound: 0.0, upper_bound: 5.0, is_integer: true },
            ],
            constraints: [
                {
                    terms: [
                        { var: "x", coeff: 1.0 },
                        { var: "y", coeff: 1.0 },
                    ],
                    lower_bound: -1e20,
                    upper_bound: 5.0,
                },
            ],
            objective: {
                terms: [
                    { var: "x", coeff: 5.0 },
                    { var: "y", coeff: 4.0 },
                ],
                maximize: true,
            },
        }, LinearModelType);

        const config = $.let({
            solver: none,
            max_time_seconds: none,
            relative_gap_limit: none,
            hints: none,
        }, LinearConfigType);

        const result = $.let(GoogleOr.linearSolve(model, config));

        $.match(result.objective_value, {
            some: ($, v) => $(Assert.equal(v, East.value(25.0))),
            none: $ => $(Assert.fail(East.value("Expected objective value"))),
        });
    });

    test("linear MIP hints are advisory: a suboptimal hint never changes the optimum", $ => {
        // Same MIP as above: maximize 5x + 4y, x+y <= 5, x,y integer >= 0.
        // Optimal: x=5, y=0 -> 25. The hint suggests the feasible but
        // suboptimal (x=0, y=5) -> 20, plus a variable that does not exist.
        const model = $.let({
            variables: [
                { name: "x", lower_bound: 0.0, upper_bound: 5.0, is_integer: true },
                { name: "y", lower_bound: 0.0, upper_bound: 5.0, is_integer: true },
            ],
            constraints: [
                {
                    terms: [
                        { var: "x", coeff: 1.0 },
                        { var: "y", coeff: 1.0 },
                    ],
                    lower_bound: -1e20,
                    upper_bound: 5.0,
                },
            ],
            objective: {
                terms: [
                    { var: "x", coeff: 5.0 },
                    { var: "y", coeff: 4.0 },
                ],
                maximize: true,
            },
        }, LinearModelType);

        const config = $.let({
            solver: none,
            max_time_seconds: none,
            relative_gap_limit: none,
            hints: some([
                { var: "x", value: 0.0 },
                { var: "y", value: 5.0 },
                { var: "dropped_out", value: 1.0 },
            ]),
        }, LinearConfigType);

        const result = $.let(GoogleOr.linearSolve(model, config));

        $.match(result.objective_value, {
            some: ($, v) => $(Assert.equal(v, East.value(25.0))),
            none: $ => $(Assert.fail(East.value("Expected objective value"))),
        });
    });

    // ========================================================================
    // Graph Algorithm Tests
    // ========================================================================

    Assert.examples(test, { minCostFlowSupplyChain: graphEx.minCostFlowSupplyChain, maxFlowNetwork: graphEx.maxFlowNetwork, assignmentWorkerTask: graphEx.assignmentWorkerTask, minCostAssignmentUnassignedPenalty: graphEx.minCostAssignmentUnassignedPenalty, minCostAssignmentTaskCapacity: graphEx.minCostAssignmentTaskCapacity });

    test("min cost flow finds cheapest flow", $ => {
        // Simple network: 0 -> 1 -> 3, 0 -> 2 -> 3
        // Supply at 0, demand at 3
        const input = $.let({
            start_nodes: [0n, 0n, 1n, 2n],
            end_nodes:   [1n, 2n, 3n, 3n],
            capacities:  [15n, 8n, 20n, 8n],
            unit_costs:  [4n,  4n, 2n,  6n],
            supplies:    [20n, 0n, 0n, -20n],
        });

        const result = $.let(GoogleOr.minCostFlow(input));

        $(Assert.greater(result.total_cost, 0n));
        $(Assert.equal(result.flows.length(), 4n));
        $(Assert.greater(result.wall_time, East.value(0.0)));
    });

    test("max flow finds maximum throughput", $ => {
        // Diamond network: 0 -> 1, 0 -> 2, 1 -> 3, 2 -> 3
        const input = $.let({
            start_nodes: [0n, 0n, 1n, 2n],
            end_nodes:   [1n, 2n, 3n, 3n],
            capacities:  [10n, 10n, 10n, 10n],
            source: 0n,
            sink: 3n,
        });

        const result = $.let(GoogleOr.maxFlow(input));

        // Max flow through diamond: 20 (10 + 10)
        $(Assert.equal(result.total_flow, 20n));
        $(Assert.equal(result.flows.length(), 4n));
    });

    test("assignment finds optimal matching", $ => {
        // 3 workers, 3 tasks, cost matrix
        const input = $.let({
            costs: [
                [90n, 76n, 75n],
                [35n, 85n, 55n],
                [125n, 95n, 90n],
            ],
        });

        const result = $.let(GoogleOr.assignment(input));

        // Should have 3 assignments
        $(Assert.equal(result.assignments.length(), 3n));
        // Optimal: worker 0 -> task 1 (76), worker 1 -> task 0 (35), worker 2 -> task 2 (90) = 201
        $(Assert.equal(result.total_cost, 201n));
    });

    test("min cost assignment omits workers it leaves unassigned", $ => {
        // 3 workers over 2 single-slot tasks; only worker 2 can reach task 1.
        const input = $.let({
            workers: [0n, 1n, 2n],
            tasks:   [0n, 0n, 1n],
            costs:   [5n, 8n, 4n],
            unassigned_penalty: some([50n, 50n, 50n]),
            task_capacity: none,
        }, GoogleOr.Types.MinCostAssignmentInputType);

        const result = $.let(GoogleOr.minCostAssignment(input));

        // 0 -> 0 (5) and 2 -> 1 (4); worker 1 waits at 50. Only the 2 matched
        // pairs come back, but total_cost carries the penalty: 5 + 4 + 50 = 59.
        $(Assert.equal(result.assignments.length(), 2n));
        $(Assert.equal(result.total_cost, 59n));
        $(Assert.greater(result.wall_time, East.value(0.0)));
    });

    test("min cost assignment is infeasible with no opt-out and too few slots", $ => {
        // 2 workers contend for 1 slot and unassigned_penalty is none, so the
        // loser has nowhere to go and the whole problem has no solution.
        const input = $.let({
            workers: [0n, 1n],
            tasks:   [0n, 0n],
            costs:   [3n, 7n],
            unassigned_penalty: none,
            task_capacity: none,
        }, GoogleOr.Types.MinCostAssignmentInputType);

        const result = $.let(GoogleOr.minCostAssignment(input));

        $(Assert.equal(result.status, variant('infeasible', null)));
        $(Assert.equal(result.assignments.length(), 0n));
    });

    // ========================================================================
    // Shared fixtures across runners: exact where the solver is deterministic,
    // the status and objective where it is not
    // ========================================================================

    test("cpsat on one worker answers a model's one solution exactly", $ => {
        // x + y = 10 and x - y = 2 fix x = 6, y = 4; 10·b + x ≥ 16 then fixes b.
        // A feasibility problem with one solution, so every runner, and every
        // OR-Tools release, answers the same assignments.
        const model = $.let({
            int_vars: [
                { name: "x", lower_bound: 0n, upper_bound: 10n },
                { name: "y", lower_bound: 0n, upper_bound: 10n },
            ],
            bool_vars: [{ name: "b" }],
            interval_vars: [],
            constraints: [
                variant('linear', {
                    expr: { terms: [{ var: "x", coeff: 1n }, { var: "y", coeff: 1n }], constant: 0n },
                    op: variant('equal', null),
                    rhs: 10n,
                }),
                variant('linear', {
                    expr: { terms: [{ var: "x", coeff: 1n }, { var: "y", coeff: -1n }], constant: 0n },
                    op: variant('equal', null),
                    rhs: 2n,
                }),
                variant('linear', {
                    expr: { terms: [{ var: "b", coeff: 10n }, { var: "x", coeff: 1n }], constant: 0n },
                    op: variant('greater_equal', null),
                    rhs: 16n,
                }),
            ],
            objective: none,
        }, CpSatModelType);
        const config = $.let({
            max_time_seconds: some(10.0),
            num_workers: some(1n),
            log_search_progress: none,
            seed: some(1n),
            max_solutions: none,
            relative_gap_limit: none,
            absolute_gap_limit: none,
            hints: none,
        }, CpSatConfigType);

        const result = $.let(GoogleOr.cpsatSolve(model, config));

        $(Assert.equal(result.status, variant('optimal', null)));
        $(Assert.equal(result.assignments, new Map([["b", 1n], ["x", 6n], ["y", 4n]])));
    });

    test("cpsat on several workers answers a model's status and objective exactly", $ => {
        // maximize x + y with x + y ≤ 10: many optima, one optimum. Several
        // workers may land on any of them, so the status and the objective
        // are what every runner answers alike.
        const model = $.let({
            int_vars: [
                { name: "x", lower_bound: 0n, upper_bound: 10n },
                { name: "y", lower_bound: 0n, upper_bound: 10n },
            ],
            bool_vars: [],
            interval_vars: [],
            constraints: [
                variant('linear', {
                    expr: { terms: [{ var: "x", coeff: 1n }, { var: "y", coeff: 1n }], constant: 0n },
                    op: variant('less_equal', null),
                    rhs: 10n,
                }),
            ],
            objective: some(variant('maximize', {
                terms: [{ var: "x", coeff: 1n }, { var: "y", coeff: 1n }],
                constant: 0n,
            })),
        }, CpSatModelType);
        const config = $.let({
            max_time_seconds: some(10.0),
            num_workers: some(4n),
            log_search_progress: none,
            seed: some(3n),
            max_solutions: none,
            relative_gap_limit: none,
            absolute_gap_limit: none,
            hints: none,
        }, CpSatConfigType);

        const result = $.let(GoogleOr.cpsatSolve(model, config));

        $(Assert.equal(result.status, variant('optimal', null)));
        $(Assert.equal(result.objective_value, some(10.0)));
        // Whichever optimum: the assignments it answers attain it.
        $(Assert.equal(result.assignments.get("x").add(result.assignments.get("y")), 10n));
    });

    test("linear answers an LP's status, objective and solution exactly on every backend", $ => {
        // Maximize 3x + 2y with x + y ≤ 4, x ≤ 3, y ≤ 3: one vertex, x = 3, y = 1.
        const model = $.let({
            variables: [
                { name: "x", lower_bound: 0.0, upper_bound: 3.0, is_integer: false },
                { name: "y", lower_bound: 0.0, upper_bound: 3.0, is_integer: false },
            ],
            constraints: [
                {
                    terms: [{ var: "x", coeff: 1.0 }, { var: "y", coeff: 1.0 }],
                    lower_bound: -1e20,
                    upper_bound: 4.0,
                },
            ],
            objective: {
                terms: [{ var: "x", coeff: 3.0 }, { var: "y", coeff: 2.0 }],
                maximize: true,
            },
        }, LinearModelType);

        for (const backend of ['glop', 'highs'] as const) {
            const config = $.let({
                solver: some(variant(backend, null)),
                max_time_seconds: none,
                relative_gap_limit: none,
                hints: none,
            }, LinearConfigType);
            const result = $.let(GoogleOr.linearSolve(model, config));
            $(Assert.equal(result.status, variant('optimal', null)));
            $(Assert.equal(result.objective_value, some(11.0)));
            $(Assert.less(result.assignments.get("x").subtract(3.0).abs(), East.value(1e-9)));
            $(Assert.less(result.assignments.get("y").subtract(1.0).abs(), East.value(1e-9)));
        }
    });

    // ========================================================================
    // The columnar forms: the same solves, the model as vectors
    // ========================================================================

    Assert.examples(test, { linearSolveColumns: linearEx.linearSolveColumns, cpsatSolveColumns: cpsatEx.cpsatSolveColumns });

    test("linear columns answer the LP the named form answers, exactly, on every backend", $ => {
        // Maximize 3x + 2y with x + y ≤ 4, x, y in [0, 3]: x = 3, y = 1, 11.
        const model = $.let({
            var_lower: new Float64Array([0.0, 0.0]),
            var_upper: new Float64Array([3.0, 3.0]),
            var_integer: new Uint8ClampedArray([0, 0]),
            row_lower: new Float64Array([-1e20]),
            row_upper: new Float64Array([4.0]),
            row_ptr: new BigInt64Array([0n, 2n]),
            col_ix: new BigInt64Array([0n, 1n]),
            coeff: new Float64Array([1.0, 1.0]),
            objective: new Float64Array([3.0, 2.0]),
            maximize: true,
        }, LinearModelColumnsType);

        for (const backend of ['glop', 'highs'] as const) {
            const config = $.let({
                solver: some(variant(backend, null)),
                max_time_seconds: none,
                relative_gap_limit: none,
                hints: none,
            }, LinearColumnsConfigType);
            const result = $.let(GoogleOr.linearSolveColumns(model, config));
            $(Assert.equal(result.status, variant('optimal', null)));
            $(Assert.equal(result.objective_value, some(11.0)));
            $(Assert.equal(result.values.length(), 2n));
            $(Assert.less(result.values.get(0n).subtract(3.0).abs(), East.value(1e-9)));
            $(Assert.less(result.values.get(1n).subtract(1.0).abs(), East.value(1e-9)));
            $(Assert.greater(result.wall_time, East.value(0.0)));
        }
    });

    test("linear columns solve a MIP, with a hint by index", $ => {
        // The 0/1 knapsack of linearSolveMipWarmStart: values [6, 10, 12],
        // weights [2, 4, 6], capacity 10 — items 1 and 2, 22. The hint names
        // an index the model has not, which is ignored.
        const model = $.let({
            var_lower: new Float64Array([0.0, 0.0, 0.0]),
            var_upper: new Float64Array([1.0, 1.0, 1.0]),
            var_integer: new Uint8ClampedArray([1, 1, 1]),
            row_lower: new Float64Array([-1e20]),
            row_upper: new Float64Array([10.0]),
            row_ptr: new BigInt64Array([0n, 3n]),
            col_ix: new BigInt64Array([0n, 1n, 2n]),
            coeff: new Float64Array([2.0, 4.0, 6.0]),
            objective: new Float64Array([6.0, 10.0, 12.0]),
            maximize: true,
        }, LinearModelColumnsType);
        const config = $.let({
            solver: none,
            max_time_seconds: none,
            relative_gap_limit: some(0.01),
            hints: some({ index: new BigInt64Array([0n, 1n, 2n, 9n]), value: new Float64Array([0.0, 1.0, 1.0, 1.0]) }),
        }, LinearColumnsConfigType);

        const result = $.let(GoogleOr.linearSolveColumns(model, config));

        $(Assert.equal(result.status, variant('optimal', null)));
        $(Assert.equal(result.objective_value, some(22.0)));
        $(Assert.less(result.values.get(0n).abs(), East.value(1e-9)));
        $(Assert.less(result.values.get(1n).subtract(1.0).abs(), East.value(1e-9)));
        $(Assert.less(result.values.get(2n).subtract(1.0).abs(), East.value(1e-9)));
    });

    test("linear columns refuse a row pointer that does not fit the rows", $ => {
        const model = $.let({
            var_lower: new Float64Array([0.0, 0.0]),
            var_upper: new Float64Array([3.0, 3.0]),
            var_integer: new Uint8ClampedArray([0, 0]),
            row_lower: new Float64Array([-1e20]),
            row_upper: new Float64Array([4.0]),
            row_ptr: new BigInt64Array([0n, 1n, 2n]),
            col_ix: new BigInt64Array([0n, 1n]),
            coeff: new Float64Array([1.0, 1.0]),
            objective: new Float64Array([3.0, 2.0]),
            maximize: true,
        }, LinearModelColumnsType);
        const config = $.let({
            solver: none,
            max_time_seconds: none,
            relative_gap_limit: none,
            hints: none,
        }, LinearColumnsConfigType);

        $(Assert.throws(GoogleOr.linearSolveColumns(model, config), /google_or_linear_solve_columns: row_ptr has 3 entries but there are 1 rows: it needs 2/));
    });

    test("cpsat columns answer the model the named form answers, exactly", $ => {
        // maximize 2x + 3y with x + y ≤ 10, x, y in [0, 10]: x = 0, y = 10, 30.
        const model = $.let({
            var_lower: new BigInt64Array([0n, 0n]),
            var_upper: new BigInt64Array([10n, 10n]),
            row_lower: new BigInt64Array([-9223372036854775808n]),
            row_upper: new BigInt64Array([10n]),
            row_ptr: new BigInt64Array([0n, 2n]),
            col_ix: new BigInt64Array([0n, 1n]),
            coeff: new BigInt64Array([1n, 1n]),
            objective: some({ coeff: new BigInt64Array([2n, 3n]), maximize: true }),
            names: none,
            interval_vars: [],
            constraints: [],
        }, CpSatModelColumnsType);
        const config = $.let({
            max_time_seconds: some(10.0),
            num_workers: some(1n),
            log_search_progress: none,
            seed: some(42n),
            relative_gap_limit: none,
            absolute_gap_limit: none,
            hints: some({ index: new BigInt64Array([0n, 1n, 7n]), value: new BigInt64Array([0n, 10n, 1n]) }),
        }, CpSatColumnsConfigType);

        const result = $.let(GoogleOr.cpsatSolveColumns(model, config));

        $(Assert.equal(result.status, variant('optimal', null)));
        $(Assert.equal(result.objective_value, some(30.0)));
        $(Assert.equal(result.values, new BigInt64Array([0n, 10n])));
        $(Assert.greater(result.wall_time, East.value(0.0)));
    });

    test("cpsat columns take the other constraint kinds over named variables", $ => {
        // a, b, c in [1, 3], all different, maximize a + 2b + 3c: 1, 2, 3 — 14.
        const model = $.let({
            var_lower: new BigInt64Array([1n, 1n, 1n]),
            var_upper: new BigInt64Array([3n, 3n, 3n]),
            row_lower: new BigInt64Array([]),
            row_upper: new BigInt64Array([]),
            row_ptr: new BigInt64Array([0n]),
            col_ix: new BigInt64Array([]),
            coeff: new BigInt64Array([]),
            objective: some({ coeff: new BigInt64Array([1n, 2n, 3n]), maximize: true }),
            names: some(["a", "b", "c"]),
            interval_vars: [],
            constraints: [variant('all_different', { vars: ["a", "b", "c"] })],
        }, CpSatModelColumnsType);
        const config = $.let({
            max_time_seconds: some(10.0),
            num_workers: some(1n),
            log_search_progress: none,
            seed: some(42n),
            relative_gap_limit: none,
            absolute_gap_limit: none,
            hints: none,
        }, CpSatColumnsConfigType);

        const result = $.let(GoogleOr.cpsatSolveColumns(model, config));

        $(Assert.equal(result.status, variant('optimal', null)));
        $(Assert.equal(result.objective_value, some(14.0)));
        $(Assert.equal(result.values, new BigInt64Array([1n, 2n, 3n])));
    });

    test("cpsat columns refuse a constraint over variables no names name", $ => {
        const model = $.let({
            var_lower: new BigInt64Array([1n, 1n]),
            var_upper: new BigInt64Array([3n, 3n]),
            row_lower: new BigInt64Array([]),
            row_upper: new BigInt64Array([]),
            row_ptr: new BigInt64Array([0n]),
            col_ix: new BigInt64Array([]),
            coeff: new BigInt64Array([]),
            objective: none,
            names: none,
            interval_vars: [],
            constraints: [variant('all_different', { vars: ["a", "b"] })],
        }, CpSatModelColumnsType);
        const config = $.let({
            max_time_seconds: none,
            num_workers: none,
            log_search_progress: none,
            seed: none,
            relative_gap_limit: none,
            absolute_gap_limit: none,
            hints: none,
        }, CpSatColumnsConfigType);

        $(Assert.throws(GoogleOr.cpsatSolveColumns(model, config), /google_or_cpsat_solve_columns: the interval variables and constraints name variables, but names is none/));
    });

    test("min cost flow answers a network's flows exactly", $ => {
        // 20 units from 0 to 3: 15 go 0→1→3 at 6 a unit, the other 5 0→2→3 at
        // 10 a unit, the one cheapest flow — 140 in all.
        const input = $.let({
            start_nodes: [0n, 0n, 1n, 2n],
            end_nodes:   [1n, 2n, 3n, 3n],
            capacities:  [15n, 8n, 20n, 8n],
            unit_costs:  [4n,  4n, 2n,  6n],
            supplies:    [20n, 0n, 0n, -20n],
        });

        const result = $.let(GoogleOr.minCostFlow(input));

        $(Assert.equal(result.status, variant('optimal', null)));
        $(Assert.equal(result.total_cost, 140n));
        $(Assert.equal(result.flows, [15n, 5n, 15n, 5n]));
    });

}, { exportOnly: true });
