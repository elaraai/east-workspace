/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Simulated Annealing platform function tests
 *
 * Tests use describeEast following east-node conventions.
 * Tests export IR for Python to run (exportOnly: true).
 */
import { East, FloatType, IntegerType, BooleanType, variant, VectorType, some, none } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { SimAnneal, AnnealConfigType, DiscreteStateType } from "@elaraai/east-py-datascience";
import * as ex from "./simanneal.examples.js";

describeEast("SimAnneal platform functions", (test) => {

    Assert.examples(test, { simannealOptimizeAssignment: ex.simannealOptimizeAssignment, simannealOptimizePermutation: ex.simannealOptimizePermutation, simannealOptimizeSubset: ex.simannealOptimizeSubset });

    test("optimizePermutation finds good TSP route", $ => {
        // Simple 4-city TSP with known optimal route
        // Cities arranged in a square: (0,0), (1,0), (1,1), (0,1)
        // Distance matrix (symmetric)
        // Optimal route: 0->1->2->3->0 or reverse, distance = 4.0

        // Energy function: total route distance
        const energy = East.function(
            [VectorType(IntegerType)],
            FloatType,
            ($, route) => {
                // Hardcoded distances for 4-city square
                // d[0][1] = d[1][2] = d[2][3] = d[3][0] = 1.0 (sides)
                // d[0][2] = d[1][3] = 1.414 (diagonals)
                const n = $.let(route.length());
                const total = $.let(0.0);

                // Sum distances for each leg of route
                $.for(East.Array.range(0n, n), ($, i) => {
                    const from = $.let(route.get(i));
                    const next_i = $.let(i.add(1n).remainder(n));
                    const to = $.let(route.get(next_i));

                    // Distance lookup (hardcoded for 4-city square)
                    const dist = $.let(0.0);
                    // Adjacent cities (0-1, 1-2, 2-3, 3-0) have distance 1.0
                    // Diagonal cities (0-2, 1-3) have distance ~1.414
                    const diff = $.let(from.subtract(to).abs());
                    $.if(East.equal(diff, 1n).or(() => East.equal(diff, 3n)), $ => {
                        $.assign(dist, 1.0);
                    }).else($ => {
                        $.assign(dist, 1.414);
                    });

                    $.assign(total, total.add(dist));
                });

                return $.return(total);
            }
        );

        // Initial route: 0, 1, 2, 3
        const initial = $.let(new BigInt64Array([0n, 1n, 2n, 3n]));

        const config = $.let({
            t_max: some(1000.0),
            t_min: some(0.1),
            steps: some(5000n),
            updates: none,
            auto_schedule: none,
            random_state: some(42n),
        }, AnnealConfigType);

        const result = $.let(SimAnneal.optimizePermutation(initial, energy, config));

        // Should find optimal or near-optimal route (distance <= 4.0)
        $(Assert.equal(result.success, true));
        $(Assert.less(result.best_energy, East.value(4.5)));
    });

    test("optimizeSubset finds good subset", $ => {
        // Subset sum problem: find subset that sums closest to target
        // Items: [3, 7, 1, 8, 4]
        // Target: 12
        // Optimal: [3, 1, 8] = 12 or [3, 1, 4] + something = 8, etc.

        const items = $.let(new Float64Array([3.0, 7.0, 1.0, 8.0, 4.0]));
        const target = $.let(12.0);

        // Energy: absolute difference from target
        const energy = East.function(
            [VectorType(BooleanType)],
            FloatType,
            ($, selection) => {
                const sum = $.let(0.0);
                $.for(East.Array.range(0n, selection.length()), ($, i) => {
                    $.if(selection.get(i), $ => {
                        $.assign(sum, sum.add(items.get(i)));
                    });
                });
                const diff = $.let(sum.subtract(target));
                return $.return(diff.abs());
            }
        );

        // Initial: all selected
        const initial = $.let(East.Vector.fromArray([true, true, true, true, true]));

        const config = $.let({
            t_max: some(500.0),
            t_min: some(0.1),
            steps: some(2000n),
            updates: none,
            auto_schedule: none,
            random_state: some(123n),
        }, AnnealConfigType);

        const result = $.let(SimAnneal.optimizeSubset(initial, energy, config));

        // Should find subset with sum close to 12 (energy close to 0)
        $(Assert.equal(result.success, true));
        $(Assert.less(result.best_energy, East.value(2.0)));
    });

    test("optimize with custom move function", $ => {
        // Assignment problem: assign 3 tasks to minimize cost
        // Each position i holds the assignment for task i
        // Costs: task 0 prefers assignment 2, task 1 prefers 0, task 2 prefers 1

        // Energy: sum of costs based on assignment
        const energy = East.function(
            [DiscreteStateType],
            FloatType,
            ($, state) => {
                const cost = $.let(0.0);
                $.match(state, {
                    int_array: ($, arr) => {
                        // Cost for task 0: 0 if assigned 2, else 1
                        const a0 = $.let(arr.get(0n));
                        $.if(East.equal(a0, 2n), _$ => {
                            // best assignment
                        }).else($ => {
                            $.assign(cost, cost.add(1.0));
                        });

                        // Cost for task 1: 0 if assigned 0, else 1
                        const a1 = $.let(arr.get(1n));
                        $.if(East.equal(a1, 0n), _$ => {
                            // best assignment
                        }).else($ => {
                            $.assign(cost, cost.add(1.0));
                        });

                        // Cost for task 2: 0 if assigned 1, else 1
                        const a2 = $.let(arr.get(2n));
                        $.if(East.equal(a2, 1n), _$ => {
                            // best assignment
                        }).else($ => {
                            $.assign(cost, cost.add(1.0));
                        });
                    },
                    bool_array: $ => {
                        $.assign(cost, 999.0);
                    },
                });
                return $.return(cost);
            }
        );

        // Move: change one random assignment
        const move = East.function(
            [DiscreteStateType],
            DiscreteStateType,
            ($, state) => {
                const result = $.let(state);
                $.match(state, {
                    int_array: ($, arr) => {
                        // Simple move: cycle the first element
                        const a0 = $.let(arr.get(0n));
                        const new_a0 = $.let(a0.add(1n).remainder(3n));
                        const new_arr = $.let(East.Vector.fromArray([new_a0, arr.get(1n), arr.get(2n)]));
                        $.assign(result, variant("int_array", new_arr));
                    },
                    bool_array: ($, arr) => {
                        $.assign(result, variant("bool_array", arr));
                    },
                });
                return $.return(result);
            }
        );

        // Initial: all assigned to 0
        const initial = $.let(variant("int_array", new BigInt64Array([0n, 0n, 0n])), DiscreteStateType);

        const config = $.let({
            t_max: some(100.0),
            t_min: some(0.01),
            steps: some(1000n),
            updates: none,
            auto_schedule: none,
            random_state: some(42n),
        }, AnnealConfigType);

        const result = $.let(SimAnneal.optimize(initial, energy, move, config));

        // Should find low-cost assignment
        $(Assert.equal(result.success, true));
        $(Assert.less(result.best_energy, East.value(2.0)));
    });

    test("respects random seed for reproducibility", $ => {
        // Same problem run twice with same seed should give same result
        const energy = East.function(
            [VectorType(IntegerType)],
            FloatType,
            ($, route) => {
                const sum = $.let(0.0);
                $.for(East.Array.range(0n, route.length()), ($, i) => {
                    const v = $.let(route.get(i));
                    $.assign(sum, sum.add(v.toFloat().multiply(v.toFloat())));
                });
                return $.return(sum);
            }
        );

        const initial = $.let(new BigInt64Array([3n, 1n, 4n, 1n, 5n]));

        const config = $.let({
            t_max: some(100.0),
            t_min: some(0.1),
            steps: some(500n),
            updates: none,
            auto_schedule: none,
            random_state: some(12345n),
        }, AnnealConfigType);

        const result1 = $.let(SimAnneal.optimizePermutation(initial, energy, config));
        const result2 = $.let(SimAnneal.optimizePermutation(initial, energy, config));

        // Both runs should give same energy (deterministic with same seed)
        $(Assert.equal(result1.best_energy, result2.best_energy));
    });
}, { exportOnly: true });
