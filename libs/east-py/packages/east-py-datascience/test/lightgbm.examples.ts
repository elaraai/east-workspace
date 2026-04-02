/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, BooleanType, variant, example } from "@elaraai/east";
import { LightGBM } from "@elaraai/east-py-datascience";

export const lightgbmTrainPredict = example({
    keywords: ["lightgbm", "trainRegressor", "predict", "regression", "cycle time", "processing duration", "manufacturing"],
    description: "Train regressor on historical cycle times to predict processing duration for new jobs",
    fn: East.function([], IntegerType, ($) => {
        // Features: material_thickness, batch_size, machine_speed
        // Target: cycle time in minutes
        const X_train = $.let(East.Matrix.fromArray([
            [2.0, 50.0, 100.0],
            [3.0, 30.0, 80.0],
            [1.5, 80.0, 120.0],
            [4.0, 20.0, 60.0],
            [2.5, 60.0, 90.0],
            [3.5, 40.0, 70.0],
            [1.0, 100.0, 110.0],
            [5.0, 10.0, 50.0],
        ]));
        const y_train = $.let(East.Vector.fromArray([15.0, 22.0, 12.0, 30.0, 18.0, 25.0, 10.0, 35.0]));

        const config = $.let({
            n_estimators: variant('some', 50n),
            max_depth: variant('some', 4n),
            learning_rate: variant('some', 0.1),
            num_leaves: variant('some', 31n),
            min_child_samples: variant('some', 1n),
            subsample: variant('none', null),
            colsample_bytree: variant('none', null),
            reg_alpha: variant('none', null),
            reg_lambda: variant('none', null),
            random_state: variant('some', 42n),
            n_jobs: variant('none', null),
        });

        const model = $.let(LightGBM.trainRegressor(X_train, y_train, config));

        const X_new = $.let(East.Matrix.fromArray([
            [2.0, 55.0, 95.0],
            [4.5, 15.0, 55.0],
        ]));
        const predictions = $.let(LightGBM.predict(model, X_new));

        return predictions.length();
    }),
    inputs: [],
    returns: 2n,
});

export const lightgbmClassifier = example({
    keywords: ["lightgbm", "trainClassifier", "predictClass", "predictProba", "classification", "equipment alert", "critical"],
    description: "Classify equipment alerts as critical vs non-critical from sensor readings",
    fn: East.function([], BooleanType, ($) => {
        // Sensor readings: vibration_level, temperature_delta
        // Class 0 = non-critical, Class 1 = critical
        const X_train = $.let(East.Matrix.fromArray([
            [1.0, 2.0], [1.5, 3.0], [2.0, 2.5], [1.2, 1.8], [0.8, 2.2],
            [8.0, 15.0], [9.0, 14.0], [7.5, 16.0], [8.5, 13.0], [9.5, 15.5],
        ]));
        const y_train = $.let(East.Vector.fromArray([0n, 0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 1n]));

        const config = $.let({
            n_estimators: variant('some', 50n),
            max_depth: variant('some', 4n),
            learning_rate: variant('some', 0.1),
            num_leaves: variant('some', 31n),
            min_child_samples: variant('some', 1n),
            subsample: variant('none', null),
            colsample_bytree: variant('none', null),
            reg_alpha: variant('none', null),
            reg_lambda: variant('none', null),
            random_state: variant('some', 42n),
            n_jobs: variant('none', null),
        });

        const model = $.let(LightGBM.trainClassifier(X_train, y_train, config));

        const X_new = $.let(East.Matrix.fromArray([
            [1.0, 2.0],    // non-critical
            [8.5, 14.5],   // critical
        ]));
        const classes = $.let(LightGBM.predictClass(model, X_new));
        const probas = $.let(LightGBM.predictProba(model, X_new));

        // Non-critical alert classified as 0, critical as 1
        return East.equal(classes.get(0n), 0n)
            .and(() => East.equal(classes.get(1n), 1n))
            .and(() => East.equal(probas.rows(), 2n));
    }),
    inputs: [],
    returns: true,
});
