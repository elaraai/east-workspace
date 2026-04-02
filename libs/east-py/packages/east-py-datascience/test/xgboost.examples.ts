/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, BooleanType, variant, example } from "@elaraai/east";
import { XGBoost } from "@elaraai/east-py-datascience";

export const xgboostTrainPredict = example({
    keywords: ["xgboost", "trainRegressor", "predict", "regression", "sensor", "remaining useful life", "equipment"],
    description: "Train regressor on equipment sensor features to predict remaining useful life",
    fn: East.function([], IntegerType, ($) => {
        // Sensor features: vibration, temperature, hours_running
        // Target: remaining useful life in hours
        const X_train = $.let(East.Matrix.fromArray([
            [0.5, 60.0, 100.0],
            [0.8, 65.0, 300.0],
            [1.2, 70.0, 500.0],
            [1.5, 72.0, 700.0],
            [2.0, 78.0, 900.0],
            [2.5, 82.0, 1100.0],
            [3.0, 88.0, 1300.0],
            [3.5, 92.0, 1500.0],
        ]));
        const y_train = $.let(East.Vector.fromArray([900.0, 700.0, 500.0, 350.0, 200.0, 100.0, 50.0, 10.0]));

        const config = $.let({
            n_estimators: variant('some', 50n),
            max_depth: variant('some', 3n),
            learning_rate: variant('some', 0.3),
            min_child_weight: variant('none', null),
            subsample: variant('none', null),
            colsample_bytree: variant('none', null),
            reg_alpha: variant('none', null),
            reg_lambda: variant('none', null),
            gamma: variant('none', null),
            random_state: variant('some', 42n),
            n_jobs: variant('none', null),
            sample_weight: variant('none', null),
            categorical_features: variant('none', null),
            categorical_n: variant('none', null),
            max_cat_to_onehot: variant('none', null),
            max_cat_threshold: variant('none', null),
        });

        const model = $.let(XGBoost.trainRegressor(X_train, y_train, config));

        // Predict on new sensor readings
        const X_new = $.let(East.Matrix.fromArray([
            [1.0, 68.0, 400.0],
            [2.2, 80.0, 1000.0],
        ]));
        const predictions = $.let(XGBoost.predict(model, X_new));

        // Should produce one prediction per input row
        return predictions.length();
    }),
    inputs: [],
    returns: 2n,
});

export const xgboostClassifier = example({
    keywords: ["xgboost", "trainClassifier", "predictClass", "predictProba", "classification", "pass fail", "quality"],
    description: "Classify incoming parts as pass/fail from measurement features",
    fn: East.function([], BooleanType, ($) => {
        // Part measurements: diameter, weight — well-separated pass (0) vs fail (1)
        const X_train = $.let(East.Matrix.fromArray([
            [10.0, 5.0], [10.1, 5.1], [9.9, 4.9], [10.2, 5.0], [9.8, 5.2],
            [15.0, 8.0], [14.8, 7.9], [15.2, 8.1], [14.9, 8.2], [15.1, 7.8],
        ]));
        const y_train = $.let(East.Vector.fromArray([0n, 0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 1n]));

        const config = $.let({
            n_estimators: variant('some', 50n),
            max_depth: variant('some', 3n),
            learning_rate: variant('some', 0.3),
            min_child_weight: variant('none', null),
            subsample: variant('none', null),
            colsample_bytree: variant('none', null),
            reg_alpha: variant('none', null),
            reg_lambda: variant('none', null),
            gamma: variant('none', null),
            random_state: variant('some', 42n),
            n_jobs: variant('none', null),
            sample_weight: variant('none', null),
            categorical_features: variant('none', null),
            categorical_n: variant('none', null),
            max_cat_to_onehot: variant('none', null),
            max_cat_threshold: variant('none', null),
        });

        const model = $.let(XGBoost.trainClassifier(X_train, y_train, config));

        // Classify new parts
        const X_new = $.let(East.Matrix.fromArray([
            [10.0, 5.0],   // should be pass (0)
            [15.0, 8.0],   // should be fail (1)
        ]));
        const classes = $.let(XGBoost.predictClass(model, X_new));
        const probas = $.let(XGBoost.predictProba(model, X_new));

        // First part should be class 0 (pass), second class 1 (fail)
        // Probabilities should have 2 rows × 2 columns
        return East.equal(classes.get(0n), 0n)
            .and(() => East.equal(classes.get(1n), 1n))
            .and(() => East.equal(probas.rows(), 2n));
    }),
    inputs: [],
    returns: true,
});

export const xgboostQuantile = example({
    keywords: ["xgboost", "trainQuantile", "predictQuantile", "quantile regression", "delivery", "lead time", "uncertainty"],
    description: "Predict pessimistic, median, and optimistic delivery lead times",
    fn: East.function([], IntegerType, ($) => {
        // Features: distance_km, package_weight_kg
        // Target: delivery lead time in hours
        const X_train = $.let(East.Matrix.fromArray([
            [10.0, 1.0], [20.0, 2.0], [30.0, 1.5], [50.0, 3.0],
            [15.0, 0.5], [40.0, 2.5], [25.0, 1.0], [60.0, 4.0],
        ]));
        const y_train = $.let(East.Vector.fromArray([2.0, 4.0, 5.0, 8.0, 3.0, 7.0, 4.5, 10.0]));

        const config = $.let({
            quantiles: East.Vector.fromArray([0.1, 0.5, 0.9]),
            n_estimators: variant('some', 50n),
            max_depth: variant('some', 3n),
            learning_rate: variant('some', 0.3),
            min_child_weight: variant('none', null),
            subsample: variant('none', null),
            colsample_bytree: variant('none', null),
            reg_alpha: variant('none', null),
            reg_lambda: variant('none', null),
            gamma: variant('none', null),
            random_state: variant('some', 42n),
            n_jobs: variant('none', null),
            sample_weight: variant('none', null),
            categorical_features: variant('none', null),
            categorical_n: variant('none', null),
            max_cat_to_onehot: variant('none', null),
            max_cat_threshold: variant('none', null),
        });

        const model = $.let(XGBoost.trainQuantile(X_train, y_train, config));

        // Predict quantiles for new deliveries
        const X_new = $.let(East.Matrix.fromArray([
            [35.0, 2.0],
            [55.0, 3.5],
        ]));
        const result = $.let(XGBoost.predictQuantile(model, X_new));

        // predictions: 2 rows (deliveries) × 3 columns (quantiles)
        return result.quantiles.length();
    }),
    inputs: [],
    returns: 3n,
});
