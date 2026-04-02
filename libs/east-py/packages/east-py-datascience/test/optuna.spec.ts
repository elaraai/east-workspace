/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Optuna platform function tests
 *
 * Tests use describeEast following east-node conventions.
 * Tests export IR for Python to run (exportOnly: true).
 */
import { ArrayType, East, FloatType, variant } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { Optuna, NamedParamType, ParamSpaceType } from "@elaraai/east-py-datascience";
import * as ex from "./optuna.examples.js";

describeEast("Optuna platform functions", (test) => {

    Assert.examples(test, { optunaTuneXgboost: ex.optunaTuneXgboost, optunaOptimizeMixed: ex.optunaOptimizeMixed, optunaOptimizeCategorical: ex.optunaOptimizeCategorical });

    test("optimize finds minimum of quadratic function", $ => {
        // Define objective: minimize (x - 2)^2
        // Minimum is at x = 2 with value 0
        const objective = East.function(
            [ArrayType(NamedParamType)],
            FloatType,
            ($, params) => {
                const x = $.let(params.get(0n).value.unwrap('float'));
                // (x - 2)^2
                const diff = $.let(x.subtract(2.0));
                return $.return(diff.multiply(diff));
            }
        );

        // Search space: x in [0, 5]
        const search_space = $.let([
            {
                name: "x",
                kind: variant("float", null),
                low: variant("some", 0.0),
                high: variant("some", 5.0),
                choices: variant("none", null),
            },
        ], ArrayType(ParamSpaceType));

        // Config
        const config = $.let({
            direction: variant("some", variant("minimize", null)),
            n_trials: 30n,
            random_state: variant("some", 42n),
            pruner: variant("none", null),
            initial_params: variant("none", null),
        });

        // Run optimization
        const result = $.let(Optuna.optimize(search_space, objective, config));

        // Verify we found a good solution
        // Best score should be close to 0 (minimum is 0 at x=2)
        $(Assert.less(result.best_score, East.value(0.5)));
        // Should have run all trials
        $(Assert.equal(result.trials.length(), 30n));
    });

    test("optimize with integer parameter", $ => {
        // Define objective: minimize (n - 5)^2
        // Minimum is at n = 5 with value 0
        const objective = East.function(
            [ArrayType(NamedParamType)],
            FloatType,
            ($, params) => {
                const n = $.let(params.get(0n).value.unwrap('int').toFloat());
                // (n - 5)^2
                const diff = $.let(n.subtract(5.0));
                return $.return(diff.multiply(diff));
            }
        );

        // Search space: n in [0, 10]
        const search_space = $.let([
            {
                name: "n",
                kind: variant("int", null),
                low: variant("some", 0.0),
                high: variant("some", 10.0),
                choices: variant("none", null),
            },
        ], ArrayType(ParamSpaceType));

        const config = $.let({
            direction: variant("some", variant("minimize", null)),
            n_trials: 20n,
            random_state: variant("some", 123n),
            pruner: variant("none", null),
            initial_params: variant("none", null),
        });

        const result = $.let(Optuna.optimize(search_space, objective, config));

        // Best score should be small (ideally 0 when n=5)
        $(Assert.less(result.best_score, East.value(2.0)));
    });

    test("optimize with categorical parameter", $ => {
        // Define objective: return score based on category
        // "best" -> 0, "good" -> 1, "bad" -> 2
        const objective = East.function(
            [ArrayType(NamedParamType)],
            FloatType,
            ($, params) => {
                const catParam = $.let(params.get(0n));
                const catValue = $.let(catParam.value);
                const score = $.let(10.0);
                $.match(catValue, {
                    int: $ => $.assign(score, 10.0),
                    float: $ => $.assign(score, 10.0),
                    string: ($, s) => {
                        $.if(East.equal(s, "best"), $ => {
                            $.assign(score, 0.0);
                        }).elseIf(East.equal(s, "good"), $ => {
                            $.assign(score, 1.0);
                        }).elseIf(East.equal(s, "bad"), $ => {
                            $.assign(score, 2.0);
                        });
                    },
                    bool: $ => $.assign(score, 10.0),
                });
                return $.return(score);
            }
        );

        // Search space: category in ["best", "good", "bad"]
        const search_space = $.let([
            {
                name: "category",
                kind: variant("categorical", null),
                low: variant("none", null),
                high: variant("none", null),
                choices: variant("some", [
                    variant("string", "best"),
                    variant("string", "good"),
                    variant("string", "bad"),
                ]),
            },
        ], ArrayType(ParamSpaceType));

        const config = $.let({
            direction: variant("some", variant("minimize", null)),
            n_trials: 15n,
            random_state: variant("some", 42n),
            pruner: variant("none", null),
            initial_params: variant("none", null),
        });

        const result = $.let(Optuna.optimize(search_space, objective, config));

        // Should find "best" category with score 0
        $(Assert.equal(result.best_score, 0.0));
    });

    test("optimize with maximize direction", $ => {
        // Define objective: maximize x (return x directly)
        // Maximum is at x = 10
        const objective = East.function(
            [ArrayType(NamedParamType)],
            FloatType,
            ($, params) => {
                const x = $.let(params.get(0n).value.unwrap('float'));
                return $.return(x);
            }
        );

        const search_space = $.let([
            {
                name: "x",
                kind: variant("float", null),
                low: variant("some", 0.0),
                high: variant("some", 10.0),
                choices: variant("none", null),
            },
        ], ArrayType(ParamSpaceType));

        const config = $.let({
            direction: variant("some", variant("maximize", null)),
            n_trials: 20n,
            random_state: variant("some", 42n),
            pruner: variant("none", null),
            initial_params: variant("none", null),
        });

        const result = $.let(Optuna.optimize(search_space, objective, config));

        // Best score should be close to 10 (the maximum)
        $(Assert.greater(result.best_score, East.value(9.0)));
    });

    test("optimize with initial params (warm-start)", $ => {
        // Define objective: minimize (x - 2)^2 + (y - 3)^2
        // Minimum is at (2, 3) with value 0
        const objective = East.function(
            [ArrayType(NamedParamType)],
            FloatType,
            ($, params) => {
                const x = $.let(params.get(0n).value.unwrap('float'));
                const y = $.let(params.get(1n).value.unwrap('float'));
                // (x - 2)^2 + (y - 3)^2
                const dx = $.let(x.subtract(2.0));
                const dy = $.let(y.subtract(3.0));
                return $.return(dx.multiply(dx).add(dy.multiply(dy)));
            }
        );

        // Search space: x in [0, 5], y in [0, 5]
        const search_space = $.let([
            {
                name: "x",
                kind: variant("float", null),
                low: variant("some", 0.0),
                high: variant("some", 5.0),
                choices: variant("none", null),
            },
            {
                name: "y",
                kind: variant("float", null),
                low: variant("some", 0.0),
                high: variant("some", 5.0),
                choices: variant("none", null),
            },
        ], ArrayType(ParamSpaceType));

        // Initial params close to optimal
        const init_params = $.let([
            { name: "x", value: variant("float", 1.9) },
            { name: "y", value: variant("float", 3.1) },
        ], ArrayType(NamedParamType));

        // Config with initial params
        const config = $.let({
            direction: variant("some", variant("minimize", null)),
            n_trials: 10n,
            random_state: variant("some", 42n),
            pruner: variant("none", null),
            initial_params: variant("some", init_params),
        });

        const result = $.let(Optuna.optimize(search_space, objective, config));

        // Should find a good solution quickly due to warm-start
        // The initial point (1.9, 3.1) has score 0.01 + 0.01 = 0.02
        $(Assert.less(result.best_score, East.value(0.5)));
        // First trial should use the initial params
        $(Assert.equal(result.trials.length(), 10n));
    });
}, { exportOnly: true });
