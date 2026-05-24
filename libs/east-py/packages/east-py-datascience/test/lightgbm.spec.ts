/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * LightGBM platform function tests
 */
import { East, variant } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { LightGBM } from "@elaraai/east-py-datascience";
import * as ex from "./lightgbm.examples.js";

describeEast("LightGBM platform functions", (test) => {

    Assert.examples(test, { lightgbmTrainPredict: ex.lightgbmTrainPredict, lightgbmClassifier: ex.lightgbmClassifier });

    test("train_regressor and predict works", $ => {
        // Simple linear data: y = x1 + x2
        const X = $.let(East.Matrix.fromArray([
            [1.0, 1.0],
            [2.0, 2.0],
            [3.0, 3.0],
            [4.0, 4.0],
            [5.0, 5.0],
        ]));
        const y = $.let(new Float64Array([2.0, 4.0, 6.0, 8.0, 10.0]));

        const config = $.let({
            n_estimators: variant('some', 100n),
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

        // Train model
        const model = $.let(LightGBM.trainRegressor(X, y, config));

        // Predict on training data
        const y_pred = $.let(LightGBM.predict(model, X));

        // Check dimensions
        $(Assert.equal(y_pred.length(), 5n));

        // Check predictions are close to actual values (within 2.5)
        $(Assert.less(y_pred.get(0n).subtract(y.get(0n)).abs(), East.value(2.5)));
        $(Assert.less(y_pred.get(2n).subtract(y.get(2n)).abs(), East.value(2.5)));
        $(Assert.less(y_pred.get(4n).subtract(y.get(4n)).abs(), East.value(2.5)));
    });

    test("train_classifier and predict_class works", $ => {
        // Binary classification data - well-separated clusters (need enough data)
        const X = $.let(East.Matrix.fromArray([
            [0.0, 0.0],
            [0.5, 0.5],
            [1.0, 1.0],
            [1.5, 1.5],
            [2.0, 2.0],
            [10.0, 10.0],
            [10.5, 10.5],
            [11.0, 11.0],
            [11.5, 11.5],
            [12.0, 12.0],
        ]));
        const y = $.let(new BigInt64Array([0n, 0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 1n]));

        const config = $.let({
            n_estimators: variant('some', 100n),
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

        // Train model
        const model = $.let(LightGBM.trainClassifier(X, y, config));

        // Predict on training data
        const y_pred = $.let(LightGBM.predictClass(model, X));

        // Check dimensions
        $(Assert.equal(y_pred.length(), 10n));

        // Check predictions are correct (data is well-separated)
        $(Assert.equal(y_pred.get(0n), 0n));  // First cluster should be class 0
        $(Assert.equal(y_pred.get(2n), 0n));
        $(Assert.equal(y_pred.get(5n), 1n));  // Second cluster should be class 1
        $(Assert.equal(y_pred.get(9n), 1n));
    });

    test("predict_proba returns probability matrix", $ => {
        // Binary classification data - well separated (need enough data)
        const X = $.let(East.Matrix.fromArray([
            [0.0, 0.0],
            [0.5, 0.5],
            [1.0, 1.0],
            [1.5, 1.5],
            [2.0, 2.0],
            [10.0, 10.0],
            [10.5, 10.5],
            [11.0, 11.0],
            [11.5, 11.5],
            [12.0, 12.0],
        ]));
        const y = $.let(new BigInt64Array([0n, 0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 1n]));

        const config = $.let({
            n_estimators: variant('some', 100n),
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

        // Train model
        const model = $.let(LightGBM.trainClassifier(X, y, config));

        // Get probabilities
        const proba = $.let(LightGBM.predictProba(model, X));

        // Check dimensions: 10 samples x 2 classes
        $(Assert.equal(proba.rows(), 10n));
        $(Assert.equal(proba.getRow(0n).length(), 2n));

        // First sample (class 0) should have high prob for class 0
        $(Assert.greater(proba.get(0n, 0n), East.value(0.6)));
        // Sixth sample (class 1) should have high prob for class 1
        $(Assert.greater(proba.get(5n, 1n), East.value(0.6)));

        // Probabilities should sum to 1 (within tolerance)
        const sum0 = $.let(proba.get(0n, 0n).add(proba.get(0n, 1n)));
        $(Assert.greater(sum0, East.value(0.99)));
        $(Assert.less(sum0, East.value(1.01)));
    });

    test("respects random_state for reproducibility", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
        ]));
        const y = $.let(new Float64Array([1.0, 2.0, 3.0, 4.0]));

        const config = $.let({
            n_estimators: variant('some', 10n),
            max_depth: variant('some', 2n),
            learning_rate: variant('some', 0.1),
            num_leaves: variant('some', 31n),
            min_child_samples: variant('some', 1n),
            subsample: variant('none', null),
            colsample_bytree: variant('none', null),
            reg_alpha: variant('none', null),
            reg_lambda: variant('none', null),
            random_state: variant('some', 123n),
            n_jobs: variant('none', null),
        });

        // Train two models with same seed
        const model1 = $.let(LightGBM.trainRegressor(X, y, config));
        const model2 = $.let(LightGBM.trainRegressor(X, y, config));

        // Predictions should be identical
        const pred1 = $.let(LightGBM.predict(model1, X));
        const pred2 = $.let(LightGBM.predict(model2, X));

        $(Assert.equal(pred1.get(0n), pred2.get(0n)));
        $(Assert.equal(pred1.get(1n), pred2.get(1n)));
    });

    test("error: train_regressor shape mismatch", $ => {
        const X = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]]));  // 3 samples
        const y = $.let(new Float64Array([1.0, 2.0]));  // 2 samples

        const config = $.let({
            n_estimators: variant('none', null),
            max_depth: variant('none', null),
            learning_rate: variant('none', null),
            num_leaves: variant('none', null),
            min_child_samples: variant('none', null),
            subsample: variant('none', null),
            colsample_bytree: variant('none', null),
            reg_alpha: variant('none', null),
            reg_lambda: variant('none', null),
            random_state: variant('none', null),
            n_jobs: variant('none', null),
        });

        $(Assert.throws(LightGBM.trainRegressor(X, y, config), /lightgbm_train_regressor.*X has 3 samples.*y has 2 samples/));
    });

    test("error: train_classifier shape mismatch", $ => {
        const X = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]]));  // 3 samples
        const y = $.let(new BigInt64Array([0n, 1n]));  // 2 samples

        const config = $.let({
            n_estimators: variant('none', null),
            max_depth: variant('none', null),
            learning_rate: variant('none', null),
            num_leaves: variant('none', null),
            min_child_samples: variant('none', null),
            subsample: variant('none', null),
            colsample_bytree: variant('none', null),
            reg_alpha: variant('none', null),
            reg_lambda: variant('none', null),
            random_state: variant('none', null),
            n_jobs: variant('none', null),
        });

        $(Assert.throws(LightGBM.trainClassifier(X, y, config), /lightgbm_train_classifier.*X has 3 samples.*y has 2 samples/));
    });

    test("error: predict with wrong model type", $ => {
        const X = $.let(East.Matrix.fromArray([[0.0, 0.0], [1.0, 1.0], [10.0, 10.0], [11.0, 11.0]]));
        const y = $.let(new BigInt64Array([0n, 0n, 1n, 1n]));

        const config = $.let({
            n_estimators: variant('some', 10n),
            max_depth: variant('some', 2n),
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

        const classifierModel = $.let(LightGBM.trainClassifier(X, y, config));
        $(Assert.throws(LightGBM.predict(classifierModel, X), /lightgbm_predict.*Expected lightgbm_regressor.*got lightgbm_classifier/));
    });

    test("error: predict_class with wrong model type", $ => {
        const X = $.let(East.Matrix.fromArray([[1.0, 1.0], [2.0, 2.0], [3.0, 3.0], [4.0, 4.0]]));
        const y = $.let(new Float64Array([2.0, 4.0, 6.0, 8.0]));

        const config = $.let({
            n_estimators: variant('some', 10n),
            max_depth: variant('some', 2n),
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

        const regressorModel = $.let(LightGBM.trainRegressor(X, y, config));
        $(Assert.throws(LightGBM.predictClass(regressorModel, X), /lightgbm_predict_class.*Expected lightgbm_classifier.*got lightgbm_regressor/));
    });

    test("error: predict_proba with wrong model type", $ => {
        const X = $.let(East.Matrix.fromArray([[1.0, 1.0], [2.0, 2.0], [3.0, 3.0], [4.0, 4.0]]));
        const y = $.let(new Float64Array([2.0, 4.0, 6.0, 8.0]));

        const config = $.let({
            n_estimators: variant('some', 10n),
            max_depth: variant('some', 2n),
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

        const regressorModel = $.let(LightGBM.trainRegressor(X, y, config));
        $(Assert.throws(LightGBM.predictProba(regressorModel, X), /lightgbm_predict_proba.*Expected lightgbm_classifier.*got lightgbm_regressor/));
    });
}, { exportOnly: true });
