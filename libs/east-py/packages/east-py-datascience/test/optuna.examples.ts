/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, FloatType, BooleanType, ArrayType, variant, example, some, none } from "@elaraai/east";
import { Optuna, Sklearn, XGBoost } from "@elaraai/east-py-datascience";

export const optunaTuneXgboost = example({
    keywords: ["optuna", "optimize", "xgboost", "hyperparameter", "tuning", "cross-validation", "MAE", "train test"],
    description: "Tune XGBoost learning_rate and max_depth on a train/test split, return best validation MAE",
    fn: East.function([], BooleanType, ($) => {
        // Training data: sensor features → remaining useful life
        const X_train = $.let(East.Matrix.fromArray([
            [1.0, 10.0], [2.0, 20.0], [3.0, 30.0], [4.0, 40.0],
            [5.0, 50.0], [6.0, 60.0], [7.0, 70.0], [8.0, 80.0],
        ]));
        const y_train = $.let(East.Vector.fromArray([2.0, 4.0, 6.0, 8.0, 10.0, 12.0, 14.0, 16.0]));

        // Validation data
        const X_test = $.let(East.Matrix.fromArray([
            [1.5, 15.0], [4.5, 45.0], [7.5, 75.0],
        ]));
        const y_test = $.let(East.Vector.fromArray([3.0, 9.0, 15.0]));

        // Objective: train XGBoost with suggested params, return validation MAE
        const objective = $.const(East.function(
            [ArrayType(Optuna.Types.NamedParamType)], FloatType,
            ($, params) => {
                const lr = $.let(params.get(0n).value.unwrap('float'));
                const depth = $.let(params.get(1n).value.unwrap('int'));

                const config = $.let({
                    n_estimators: some(50n),
                    max_depth: some(depth),
                    learning_rate: some(lr),
                    min_child_weight: none,
                    subsample: none,
                    colsample_bytree: none,
                    reg_alpha: none,
                    reg_lambda: none,
                    gamma: none,
                    random_state: some(42n),
                    n_jobs: none,
                    sample_weight: none,
                    categorical_features: none,
                    categorical_n: none,
                    max_cat_to_onehot: none,
                    max_cat_threshold: none,
                });

                const model = $.let(XGBoost.trainRegressor(X_train, y_train, config));
                const y_pred = $.let(XGBoost.predict(model, X_test));

                // Compute MAE on validation set
                const metrics = $.let([variant('mae', null)], ArrayType(Sklearn.Types.RegressionMetricType));
                const results = $.let(Sklearn.computeMetrics(y_test, y_pred, metrics));
                $.return(results.get(0n).value);
            }
        ));

        const search_space = $.let([
            {
                name: "learning_rate",
                kind: variant("log_uniform", null),
                low: some(0.01),
                high: some(0.5),
                choices: none,
            },
            {
                name: "max_depth",
                kind: variant("int", null),
                low: some(2.0),
                high: some(6.0),
                choices: none,
            },
        ], ArrayType(Optuna.Types.ParamSpaceType));

        const config = $.let({
            direction: some(variant("minimize", null)),
            n_trials: 15n,
            random_state: some(42n),
            pruner: none,
            initial_params: none,
        });

        const result = $.let(Optuna.optimize(search_space, objective, config));

        // Best MAE should be reasonably small for this linear data
        return result.best_score.lessThan(5.0);
    }),
    inputs: [],
    returns: true,
});

export const optunaOptimizeMixed = example({
    keywords: ["optuna", "optimize", "mixed", "integer", "float", "chemical process", "yield", "batch size", "temperature"],
    description: "Tune batch size (int) and processing temperature (float) for a chemical process yield function",
    fn: East.function([FloatType], BooleanType, ($, _baseline_yield) => {
        // Yield model: peak at batch_size=50, temperature=175.0
        // yield = baseline - 0.01*(batch-50)^2 - 0.005*(temp-175)^2
        const objective = $.const(East.function(
            [ArrayType(Optuna.Types.NamedParamType)], FloatType,
            ($, params) => {
                const batch_size = $.let(params.get(0n).value.unwrap('int').toFloat());
                const temperature = $.let(params.get(1n).value.unwrap('float'));
                const batch_err = $.let(batch_size.subtract(50.0));
                const temp_err = $.let(temperature.subtract(175.0));
                // Negate because we maximize yield
                $.return(batch_err.multiply(batch_err).multiply(0.01)
                    .add(temp_err.multiply(temp_err).multiply(0.005)));
            }
        ));

        const search_space = $.let([
            {
                name: "batch_size",
                kind: variant("int", null),
                low: some(20.0),
                high: some(80.0),
                choices: none,
            },
            {
                name: "temperature",
                kind: variant("float", null),
                low: some(150.0),
                high: some(200.0),
                choices: none,
            },
        ], ArrayType(Optuna.Types.ParamSpaceType));

        const config = $.let({
            direction: some(variant("minimize", null)),
            n_trials: 30n,
            random_state: some(42n),
            pruner: none,
            initial_params: none,
        });

        const result = $.let(Optuna.optimize(search_space, objective, config));

        // Should find near-optimal with low error
        return result.best_score.lessThan(5.0);
    }),
    inputs: [95.0],
    returns: true,
});

export const optunaOptimizeCategorical = example({
    keywords: ["optuna", "optimize", "categorical", "shift pattern", "staffing", "warehouse", "throughput"],
    description: "Select best shift pattern and staffing level for warehouse throughput",
    fn: East.function([], BooleanType, ($) => {
        // Throughput model based on shift pattern and staffing:
        // "three_shift" is best (3 shifts × 8h = 24h coverage)
        // "two_shift" is medium (2 shifts × 8h = 16h)
        // "single_shift" is worst (1 shift × 8h = 8h)
        // More staff = more throughput, but diminishing returns
        const objective = $.const(East.function(
            [ArrayType(Optuna.Types.NamedParamType)], FloatType,
            ($, params) => {
                const shift_param = $.let(params.get(0n).value);
                const staffing = $.let(params.get(1n).value.unwrap('int').toFloat());

                // Base throughput from shift pattern
                const shift_multiplier = $.let(1.0);
                $.match(shift_param, {
                    string: ($, s) => {
                        $.if(East.equal(s, "three_shift"), $ => {
                            $.assign(shift_multiplier, 3.0);
                        }).elseIf(East.equal(s, "two_shift"), $ => {
                            $.assign(shift_multiplier, 2.0);
                        }).else($ => {
                            $.assign(shift_multiplier, 1.0);
                        });
                    },
                    int: ($) => { $.assign(shift_multiplier, 1.0); },
                    float: ($) => { $.assign(shift_multiplier, 1.0); },
                    bool: ($) => { $.assign(shift_multiplier, 1.0); },
                });

                // Throughput = shift_hours * sqrt(staffing) * 10
                // Negate for minimization (we want to maximize)
                $.return(shift_multiplier.multiply(staffing.sqrt()).multiply(10.0).negate());
            }
        ));

        const search_space = $.let([
            {
                name: "shift_pattern",
                kind: variant("categorical", null),
                low: none,
                high: none,
                choices: some([
                    variant("string", "single_shift"),
                    variant("string", "two_shift"),
                    variant("string", "three_shift"),
                ]),
            },
            {
                name: "staffing_level",
                kind: variant("int", null),
                low: some(5.0),
                high: some(20.0),
                choices: none,
            },
        ], ArrayType(Optuna.Types.ParamSpaceType));

        const config = $.let({
            direction: some(variant("minimize", null)),
            n_trials: 30n,
            random_state: some(42n),
            pruner: none,
            initial_params: none,
        });

        const result = $.let(Optuna.optimize(search_space, objective, config));

        // Best should be three_shift with high staffing → large negative value
        return result.best_score.lessThan(-50.0);
    }),
    inputs: [],
    returns: true,
});
