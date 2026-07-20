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
    RoutingModelType,
    RoutingConfigType,
    LinearModelType,
    LinearConfigType,
} from "@elaraai/east-py-datascience";
import * as cpsatEx from "./google_or.cpsat.examples.js";
import * as routingEx from "./google_or.routing.examples.js";
import * as linearEx from "./google_or.linear.examples.js";
import * as graphEx from "./google_or.graph.examples.js";

describeEast("GoogleOr platform functions", (test) => {


    // ========================================================================
    // CP-SAT Tests
    // ========================================================================

    Assert.examples(test, { cpsatScheduleJobs: cpsatEx.cpsatScheduleJobs, cpsatAssignShifts: cpsatEx.cpsatAssignShifts, cpsatSolveAll: cpsatEx.cpsatSolveAll });

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
        }, CpSatConfigType);

        const result = $.let(GoogleOr.cpsatSolve(model, config));

        // Objective: maximize 2x + 3y with x+y<=10 -> x=0,y=10 -> 30
        $.match(result.objective_value, {
            some: ($, v) => $(Assert.equal(v, East.value(30.0))),
            none: $ => $(Assert.fail(East.value("Expected objective value"))),
        });

        $(Assert.greater(result.wall_time, East.value(0.0)));
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

    Assert.examples(test, { linearSolveResourceAllocation: linearEx.linearSolveResourceAllocation, linearSolveMipRelativeGapLimit: linearEx.linearSolveMipRelativeGapLimit });

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

}, { exportOnly: true });
