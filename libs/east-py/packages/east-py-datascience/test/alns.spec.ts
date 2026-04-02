/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * ALNS platform function tests
 *
 * These tests use describeEast following east-node conventions.
 * Tests compile East functions and run them to validate platform function behavior.
 *
 * Note: These tests require the alns library to be installed in the Python environment.
 * Install with: pip install alns
 */
import { ArrayType, East, FloatType, IntegerType, StructType, variant } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { ALNS } from "@elaraai/east-py-datascience";
import * as ex from "./alns.examples.js";

// Simple solution type for testing: array of floats representing assignments
const SimpleSolutionType = StructType({
    values: ArrayType(FloatType),
    cost: FloatType,
});

describeEast("ALNS platform functions", (test) => {
    Assert.examples(test, { alnsOptimizeBasic: ex.alnsOptimizeBasic, alnsOptimizeMultiOperator: ex.alnsOptimizeMultiOperator, alnsOptimizeWithAcceptance: ex.alnsOptimizeWithAcceptance });

    test("optimize runs with simple solution type", $ => {
        // Initial solution
        const initial = $.let({
            values: [1.0, 2.0, 3.0],
            cost: 10.0,
        });

        // Objective: return the cost field
        const objective = East.function([SimpleSolutionType], FloatType, ($, solution) => {
            $.return(solution.cost);
        });

        // Destroy operator: just return the solution unchanged
        const destroy = East.function([SimpleSolutionType], SimpleSolutionType, ($, solution) => {
            $.return(solution);
        });

        // Repair operator: reduce cost by 0.1 each iteration (simple improvement)
        const repair = East.function([SimpleSolutionType], SimpleSolutionType, ($, solution) => {
            const newCost = $.let(solution.cost.subtract(East.value(0.1)));
            $.return({
                values: solution.values,
                cost: newCost,
            });
        });

        // Config with small number of iterations
        const config = $.let({
            stop: variant('some', variant('max_iterations', 10n)),
            acceptance: variant('none', null),
            operator_selection: variant('none', null),
            seed: variant('some', 42n),
        }, ALNS.Types.ConfigType);

        // Run optimization
        const result = $.let(ALNS.optimize([SimpleSolutionType],
            initial,
            objective,
            [destroy],
            [repair],
            config
        ));

        // Verify result structure
        $(Assert.equal(result.success, true));
        $(Assert.greater(result.iterations, 0n));
        // Cost should have decreased from 10.0
        $(Assert.less(result.best_objective, East.value(10.0)));
    });

    test("optimize respects seed for reproducibility", $ => {
        const initial = $.let({
            values: [1.0, 2.0],
            cost: 5.0,
        });

        const objective = East.function([SimpleSolutionType], FloatType, ($, solution) => {
            $.return(solution.cost);
        });

        // Destroy that removes a random amount (uses internal state)
        const destroy = East.function([SimpleSolutionType], SimpleSolutionType, ($, solution) => {
            $.return(solution);
        });

        // Repair that improves by fixed amount
        const repair = East.function([SimpleSolutionType], SimpleSolutionType, ($, solution) => {
            $.return({
                values: solution.values,
                cost: solution.cost.subtract(East.value(0.05)),
            });
        });

        const config = $.let({
            stop: variant('some', variant('max_iterations', 20n)),
            acceptance: variant('none', null),
            operator_selection: variant('none', null),
            seed: variant('some', 123n),
        }, ALNS.Types.ConfigType);

        // Run twice with same seed
        const result1 = $.let(ALNS.optimize([SimpleSolutionType],
            initial, objective, [destroy], [repair], config
        ));
        const result2 = $.let(ALNS.optimize([SimpleSolutionType],
            initial, objective, [destroy], [repair], config
        ));

        // Results should be identical with same seed
        $(Assert.equal(result1.best_objective, result2.best_objective));
        $(Assert.equal(result1.iterations, result2.iterations));
    });

    test("optimize with hill climbing acceptance", $ => {
        const initial = $.let({
            values: [0.0],
            cost: 100.0,
        });

        const objective = East.function([SimpleSolutionType], FloatType, ($, solution) => {
            $.return(solution.cost);
        });

        const destroy = East.function([SimpleSolutionType], SimpleSolutionType, ($, solution) => {
            $.return(solution);
        });

        // Always improve
        const repair = East.function([SimpleSolutionType], SimpleSolutionType, ($, solution) => {
            $.return({
                values: solution.values,
                cost: solution.cost.subtract(East.value(1.0)),
            });
        });

        // Use hill climbing (only accept improvements)
        const config = $.let({
            stop: variant('some', variant('max_iterations', 50n)),
            acceptance: variant('some', variant('hill_climbing', null)),
            operator_selection: variant('none', null),
            seed: variant('some', 42n),
        }, ALNS.Types.ConfigType);

        const result = $.let(ALNS.optimize([SimpleSolutionType],
            initial, objective, [destroy], [repair], config
        ));

        $(Assert.equal(result.success, true));
        // Should have improved significantly
        $(Assert.less(result.best_objective, East.value(60.0)));
    });

    test("optimize with simulated annealing config", $ => {
        const initial = $.let({
            values: [1.0, 2.0, 3.0],
            cost: 50.0,
        });

        const objective = East.function([SimpleSolutionType], FloatType, ($, solution) => {
            $.return(solution.cost);
        });

        const destroy = East.function([SimpleSolutionType], SimpleSolutionType, ($, solution) => {
            $.return(solution);
        });

        const repair = East.function([SimpleSolutionType], SimpleSolutionType, ($, solution) => {
            $.return({
                values: solution.values,
                cost: solution.cost.subtract(East.value(0.5)),
            });
        });

        // Explicit simulated annealing config
        const config = $.let({
            stop: variant('some', variant('max_iterations', 30n)),
            acceptance: variant('some', variant('simulated_annealing', {
                start_temperature: variant('some', 50.0),
                end_temperature: variant('some', 0.1),
                step: variant('some', 0.95),
            })),
            operator_selection: variant('none', null),
            seed: variant('some', 42n),
        }, ALNS.Types.ConfigType);

        const result = $.let(ALNS.optimize([SimpleSolutionType],
            initial, objective, [destroy], [repair], config
        ));

        $(Assert.equal(result.success, true));
        $(Assert.less(result.best_objective, East.value(50.0)));
    });

    test("optimize with multiple operators", $ => {
        const initial = $.let({
            values: [10.0, 20.0],
            cost: 100.0,
        });

        const objective = East.function([SimpleSolutionType], FloatType, ($, solution) => {
            $.return(solution.cost);
        });

        // Two different destroy operators
        const destroy1 = East.function([SimpleSolutionType], SimpleSolutionType, ($, solution) => {
            $.return(solution);
        });

        const destroy2 = East.function([SimpleSolutionType], SimpleSolutionType, ($, solution) => {
            // Slightly different behavior
            $.return({
                values: solution.values,
                cost: solution.cost,
            });
        });

        // Two different repair operators
        const repair1 = East.function([SimpleSolutionType], SimpleSolutionType, ($, solution) => {
            $.return({
                values: solution.values,
                cost: solution.cost.subtract(East.value(0.3)),
            });
        });

        const repair2 = East.function([SimpleSolutionType], SimpleSolutionType, ($, solution) => {
            $.return({
                values: solution.values,
                cost: solution.cost.subtract(East.value(0.7)),
            });
        });

        const config = $.let({
            stop: variant('some', variant('max_iterations', 50n)),
            acceptance: variant('none', null),
            operator_selection: variant('some', variant('roulette_wheel', {
                scores: variant('some', [33n, 9n, 3n, 0n]),
                decay: variant('some', 0.8),
            })),
            seed: variant('some', 42n),
        }, ALNS.Types.ConfigType);

        const result = $.let(ALNS.optimize([SimpleSolutionType],
            initial,
            objective,
            [destroy1, destroy2],
            [repair1, repair2],
            config
        ));

        $(Assert.equal(result.success, true));
        $(Assert.less(result.best_objective, East.value(100.0)));
    });

    test("optimize with no_improvement stop criterion", $ => {
        const initial = $.let({
            values: [0.0],
            cost: 10.0,
        });

        const objective = East.function([SimpleSolutionType], FloatType, ($, solution) => {
            $.return(solution.cost);
        });

        const destroy = East.function([SimpleSolutionType], SimpleSolutionType, ($, solution) => {
            $.return(solution);
        });

        // This repair doesn't improve anything
        const repair = East.function([SimpleSolutionType], SimpleSolutionType, ($, solution) => {
            $.return(solution);
        });

        // Stop after 5 iterations without improvement
        const config = $.let({
            stop: variant('some', variant('no_improvement', 5n)),
            acceptance: variant('some', variant('hill_climbing', null)),
            operator_selection: variant('none', null),
            seed: variant('some', 42n),
        }, ALNS.Types.ConfigType);

        const result = $.let(ALNS.optimize([SimpleSolutionType],
            initial, objective, [destroy], [repair], config
        ));

        // Should stop early due to no improvement
        $(Assert.equal(result.success, true));
        // Cost should be unchanged
        $(Assert.equal(result.best_objective, East.value(10.0)));
    });

    // Test with a DIFFERENT solution type to verify generic platform function works
    test("optimize works with different solution type (generic test)", $ => {
        // Completely different structure from SimpleSolutionType
        const GraphSolutionType = StructType({
            nodes: IntegerType,
            edges: IntegerType,
            score: FloatType,
        });

        const initial = $.let({
            nodes: 5n,
            edges: 10n,
            score: 100.0,
        });

        const objective = East.function([GraphSolutionType], FloatType, ($, solution) => {
            $.return(solution.score);
        });

        const destroy = East.function([GraphSolutionType], GraphSolutionType, ($, solution) => {
            // Remove an edge
            $.return({
                nodes: solution.nodes,
                edges: solution.edges.subtract(1n),
                score: solution.score,
            });
        });

        const repair = East.function([GraphSolutionType], GraphSolutionType, ($, solution) => {
            // Add edge back and improve score
            $.return({
                nodes: solution.nodes,
                edges: solution.edges.add(1n),
                score: solution.score.subtract(5.0),
            });
        });

        const config = $.let({
            stop: variant('some', variant('max_iterations', 10n)),
            acceptance: variant('none', null),
            operator_selection: variant('none', null),
            seed: variant('some', 99n),
        }, ALNS.Types.ConfigType);

        const result = $.let(ALNS.optimize([GraphSolutionType],
            initial, objective, [destroy], [repair], config
        ));

        $(Assert.equal(result.success, true));
        $(Assert.less(result.best_objective, East.value(100.0)));
        // Verify we can access the solution with the correct type
        $(Assert.equal(result.best_solution.nodes, 5n));
    });

}, { exportOnly: true });
