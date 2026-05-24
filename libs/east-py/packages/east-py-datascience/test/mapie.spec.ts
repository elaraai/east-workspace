/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * MAPIE conformal prediction platform function tests (MAPIE 1.2.0 API)
 */
import {variant, East} from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { MAPIE } from "@elaraai/east-py-datascience";
import * as ex from "./mapie.examples.js";

describeEast("MAPIE platform functions", (test) => {

    Assert.examples(test, { mapieConformalRegressor: ex.mapieConformalRegressor, mapieCqr: ex.mapieCqr, mapieConformalClassifier: ex.mapieConformalClassifier });

    // ==========================================================================
    // Regression Tests
    // ==========================================================================

    test("trainConformalRegressor with XGBoost base model (split conformal)", $ => {
        // Training data
        const X_train = $.let(East.Matrix.fromArray([
            [1.0], [2.0], [3.0], [4.0], [5.0],
            [6.0], [7.0], [8.0], [9.0], [10.0],
        ]));
        const y_train = $.let(new Float64Array([1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5]));

        // Calibration data - need enough samples for conformal prediction
        const X_calib = $.let(East.Matrix.fromArray([[1.5], [2.5], [3.5], [4.5], [5.5], [6.5], [7.5], [8.5], [9.5], [10.5], [11.5]]));
        const y_calib = $.let(new Float64Array([2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0]));

        const config = $.let({
            base_model: variant('xgboost', {
                n_estimators: variant('some', 50n),
                max_depth: variant('some', 3n),
                learning_rate: variant('some', 0.1),
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
            }),
            method: variant('some', variant('split', null)),
            confidence_level: variant('some', 0.9),  // 90% coverage
            cv_folds: variant('none', null),
            random_state: variant('some', 42n),
            conformity_eps: variant('none', null),
        });

        const model = $.let(MAPIE.trainConformalRegressor(X_train, y_train, X_calib, y_calib, config));

        // Test prediction
        const X_test = $.let(East.Matrix.fromArray([[3.0], [5.0], [7.0]]));
        const result = $.let(MAPIE.predictInterval(model, X_test));

        // Check shapes
        $(Assert.equal(result.lower.length(), 3n));
        $(Assert.equal(result.pred.length(), 3n));
        $(Assert.equal(result.upper.length(), 3n));
    });

    test("trainConformalRegressor with LightGBM base model", $ => {
        const X_train = $.let(East.Matrix.fromArray([
            [1.0], [2.0], [3.0], [4.0], [5.0],
            [6.0], [7.0], [8.0], [9.0], [10.0],
        ]));
        const y_train = $.let(new Float64Array([1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5]));
        const X_calib = $.let(East.Matrix.fromArray([[1.5], [2.5], [3.5], [4.5], [5.5], [6.5], [7.5], [8.5], [9.5], [10.5], [11.5]]));
        const y_calib = $.let(new Float64Array([2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0]));

        const config = $.let({
            base_model: variant('lightgbm', {
                n_estimators: variant('some', 50n),
                max_depth: variant('some', 3n),
                learning_rate: variant('some', 0.1),
                num_leaves: variant('none', null),
                min_child_samples: variant('none', null),
                subsample: variant('none', null),
                colsample_bytree: variant('none', null),
                reg_alpha: variant('none', null),
                reg_lambda: variant('none', null),
                random_state: variant('some', 42n),
                n_jobs: variant('none', null),
            }),
            method: variant('some', variant('split', null)),
            confidence_level: variant('some', 0.9),
            cv_folds: variant('none', null),
            random_state: variant('some', 42n),
            conformity_eps: variant('none', null),
        });

        const model = $.let(MAPIE.trainConformalRegressor(X_train, y_train, X_calib, y_calib, config));
        const X_test = $.let(East.Matrix.fromArray([[3.0], [5.0], [7.0]]));
        const result = $.let(MAPIE.predictInterval(model, X_test));

        $(Assert.equal(result.lower.length(), 3n));
        $(Assert.equal(result.pred.length(), 3n));
        $(Assert.equal(result.upper.length(), 3n));
    });

    test("trainConformalRegressor with cross method", $ => {
        const X_train = $.let(East.Matrix.fromArray([
            [1.0], [2.0], [3.0], [4.0], [5.0],
            [6.0], [7.0], [8.0], [9.0], [10.0],
        ]));
        const y_train = $.let(new Float64Array([1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5]));
        const X_calib = $.let(East.Matrix.fromArray([[2.5], [4.5], [6.5], [8.5]]));
        const y_calib = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0]));

        const config = $.let({
            base_model: variant('xgboost', {
                n_estimators: variant('some', 20n),
                max_depth: variant('some', 3n),
                learning_rate: variant('some', 0.1),
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
            }),
            method: variant('some', variant('cross', null)),
            confidence_level: variant('some', 0.9),
            cv_folds: variant('some', 3n),
            random_state: variant('some', 42n),
            conformity_eps: variant('none', null),
        });

        const model = $.let(MAPIE.trainConformalRegressor(X_train, y_train, X_calib, y_calib, config));
        const result = $.let(MAPIE.predictInterval(model, X_calib));

        $(Assert.equal(result.pred.length(), 4n));
        $(Assert.equal(result.lower.length(), 4n));
        $(Assert.equal(result.upper.length(), 4n));
    });

    test("trainCQR trains conformalized quantile regression (uses LightGBM internally)", $ => {
        // Note: MAPIE 1.2.0 CQR requires LightGBM, not XGBoost
        const X_train = $.let(East.Matrix.fromArray([
            [1.0], [2.0], [3.0], [4.0], [5.0],
            [6.0], [7.0], [8.0], [9.0], [10.0],
            [11.0], [12.0], [13.0], [14.0], [15.0],
        ]));
        const y_train = $.let(new Float64Array([1.2, 2.1, 3.3, 4.0, 5.5, 6.2, 7.8, 8.1, 9.9, 10.2, 11.3, 12.1, 13.4, 14.0, 15.5]));
        const X_calib = $.let(East.Matrix.fromArray([[2.5], [4.5], [6.5], [8.5], [10.5], [12.5]]));
        const y_calib = $.let(new Float64Array([2.8, 4.6, 6.9, 8.7, 10.8, 12.6]));

        const config = $.let({
            xgboost_config: {
                n_estimators: variant('some', 50n),
                max_depth: variant('some', 3n),
                learning_rate: variant('some', 0.1),
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
            },
            confidence_level: variant('some', 0.9),
            random_state: variant('some', 42n),
        });

        const model = $.let(MAPIE.trainCQR(X_train, y_train, X_calib, y_calib, config));
        const X_test = $.let(East.Matrix.fromArray([[3.0], [5.0], [7.0]]));
        const result = $.let(MAPIE.predictInterval(model, X_test));

        $(Assert.equal(result.lower.length(), 3n));
        $(Assert.equal(result.pred.length(), 3n));
        $(Assert.equal(result.upper.length(), 3n));
    });

    test("error: X_train and y_train shape mismatch", $ => {
        const X_train = $.let(East.Matrix.fromArray([[1.0], [2.0], [3.0]]));
        const y_train = $.let(new Float64Array([1.0, 2.0]));  // Mismatch!
        const X_calib = $.let(East.Matrix.fromArray([[1.5]]));
        const y_calib = $.let(new Float64Array([1.5]));

        const config = $.let({
            base_model: variant('xgboost', {
                n_estimators: variant('some', 10n),
                max_depth: variant('none', null),
                learning_rate: variant('none', null),
                min_child_weight: variant('none', null),
                subsample: variant('none', null),
                colsample_bytree: variant('none', null),
                reg_alpha: variant('none', null),
                reg_lambda: variant('none', null),
                gamma: variant('none', null),
                random_state: variant('none', null),
                n_jobs: variant('none', null),
                sample_weight: variant('none', null),
                categorical_features: variant('none', null),
                categorical_n: variant('none', null),
                max_cat_to_onehot: variant('none', null),
                max_cat_threshold: variant('none', null),
            }),
            method: variant('none', null),
            confidence_level: variant('none', null),
            cv_folds: variant('none', null),
            random_state: variant('none', null),
            conformity_eps: variant('none', null),
        });

        $(Assert.throws(
            MAPIE.trainConformalRegressor(X_train, y_train, X_calib, y_calib, config),
            /X_train has 3 samples but y_train has 2 samples/
        ));
    });

    test("error: feature dimension mismatch between train and calib", $ => {
        const X_train = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0]]));
        const y_train = $.let(new Float64Array([1.0, 2.0]));
        const X_calib = $.let(East.Matrix.fromArray([[1.0]]));  // Different number of features!
        const y_calib = $.let(new Float64Array([1.0]));

        const config = $.let({
            base_model: variant('xgboost', {
                n_estimators: variant('some', 10n),
                max_depth: variant('none', null),
                learning_rate: variant('none', null),
                min_child_weight: variant('none', null),
                subsample: variant('none', null),
                colsample_bytree: variant('none', null),
                reg_alpha: variant('none', null),
                reg_lambda: variant('none', null),
                gamma: variant('none', null),
                random_state: variant('none', null),
                n_jobs: variant('none', null),
                sample_weight: variant('none', null),
                categorical_features: variant('none', null),
                categorical_n: variant('none', null),
                max_cat_to_onehot: variant('none', null),
                max_cat_threshold: variant('none', null),
            }),
            method: variant('none', null),
            confidence_level: variant('none', null),
            cv_folds: variant('none', null),
            random_state: variant('none', null),
            conformity_eps: variant('none', null),
        });

        $(Assert.throws(
            MAPIE.trainConformalRegressor(X_train, y_train, X_calib, y_calib, config),
            /X_train has 2 features but X_calib has 1 features/
        ));
    });

    // ==========================================================================
    // Classification Tests
    // ==========================================================================

    test("trainConformalClassifier with XGBoost base model (LAC method)", $ => {
        // Binary classification data - need more training data
        const X_train = $.let(East.Matrix.fromArray([
            [1.0, 0.0], [1.2, 0.2], [1.4, 0.4], [1.6, 0.6], [1.8, 0.8], [2.0, 1.0],  // Class 0
            [3.0, 3.0], [3.2, 3.2], [3.4, 3.4], [3.6, 3.6], [3.8, 3.8], [4.0, 4.0],  // Class 1
        ]));
        const y_train = $.let(new BigInt64Array([0n, 0n, 0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 1n, 1n]));

        // Calibration data - need at least 11 samples for 90% confidence level
        const X_calib = $.let(East.Matrix.fromArray([
            [1.1, 0.1], [1.3, 0.3], [1.5, 0.5], [1.7, 0.7], [1.9, 0.9],
            [3.1, 3.1], [3.3, 3.3], [3.5, 3.5], [3.7, 3.7], [3.9, 3.9], [4.1, 4.1],
        ]));
        const y_calib = $.let(new BigInt64Array([0n, 0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 1n, 1n]));

        const config = $.let({
            base_model: variant('xgboost', {
                n_estimators: variant('some', 50n),
                max_depth: variant('some', 3n),
                learning_rate: variant('some', 0.1),
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
            }),
            method: variant('some', variant('lac', null)),
            confidence_level: variant('some', 0.9),  // 90% coverage
            random_state: variant('some', 42n),
        });

        const model = $.let(MAPIE.trainConformalClassifier(X_train, y_train, X_calib, y_calib, config));

        // Test prediction
        const X_test = $.let(East.Matrix.fromArray([[1.0, 0.0], [4.0, 4.0]]));
        const result = $.let(MAPIE.predictSet(model, X_test));

        // Check shapes
        $(Assert.equal(result.pred.length(), 2n));
        $(Assert.equal(result.sets.length(), 2n));
        $(Assert.equal(result.probabilities.rows(), 2n));
        $(Assert.equal(result.set_sizes.length(), 2n));

        // Each set should have at least one class
        $(Assert.greaterEqual(result.set_sizes.get(0n), 1n));
        $(Assert.greaterEqual(result.set_sizes.get(1n), 1n));
    });

    test("trainConformalClassifier with LightGBM base model", $ => {
        const X_train = $.let(East.Matrix.fromArray([
            [1.0, 0.0], [1.2, 0.2], [1.4, 0.4], [1.6, 0.6], [1.8, 0.8], [2.0, 1.0],
            [3.0, 3.0], [3.2, 3.2], [3.4, 3.4], [3.6, 3.6], [3.8, 3.8], [4.0, 4.0],
        ]));
        const y_train = $.let(new BigInt64Array([0n, 0n, 0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 1n, 1n]));
        const X_calib = $.let(East.Matrix.fromArray([
            [1.1, 0.1], [1.3, 0.3], [1.5, 0.5], [1.7, 0.7], [1.9, 0.9],
            [3.1, 3.1], [3.3, 3.3], [3.5, 3.5], [3.7, 3.7], [3.9, 3.9], [4.1, 4.1],
        ]));
        const y_calib = $.let(new BigInt64Array([0n, 0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 1n, 1n]));

        const config = $.let({
            base_model: variant('lightgbm', {
                n_estimators: variant('some', 50n),
                max_depth: variant('some', 3n),
                learning_rate: variant('some', 0.1),
                num_leaves: variant('none', null),
                min_child_samples: variant('none', null),
                subsample: variant('none', null),
                colsample_bytree: variant('none', null),
                reg_alpha: variant('none', null),
                reg_lambda: variant('none', null),
                random_state: variant('some', 42n),
                n_jobs: variant('none', null),
            }),
            method: variant('some', variant('lac', null)),
            confidence_level: variant('some', 0.9),
            random_state: variant('some', 42n),
        });

        const model = $.let(MAPIE.trainConformalClassifier(X_train, y_train, X_calib, y_calib, config));
        const X_test = $.let(East.Matrix.fromArray([[1.0, 0.0], [4.0, 4.0]]));
        const result = $.let(MAPIE.predictSet(model, X_test));

        $(Assert.equal(result.pred.length(), 2n));
        $(Assert.equal(result.set_sizes.length(), 2n));
    });

    test("trainConformalClassifier multiclass with APS method", $ => {
        // 3-class classification - APS is only valid for multiclass, not binary
        const X_train = $.let(East.Matrix.fromArray([
            [0.0, 0.0], [0.2, 0.2], [0.4, 0.4], [0.6, 0.6],  // Class 0
            [2.0, 0.0], [2.2, 0.2], [2.4, 0.4], [2.6, 0.6],  // Class 1
            [1.0, 2.0], [1.2, 2.2], [1.4, 2.4], [1.6, 2.6],  // Class 2
        ]));
        const y_train = $.let(new BigInt64Array([0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 2n, 2n, 2n, 2n]));
        const X_calib = $.let(East.Matrix.fromArray([
            [0.1, 0.1], [0.3, 0.3], [0.5, 0.5], [0.7, 0.7],
            [2.1, 0.1], [2.3, 0.3], [2.5, 0.5], [2.7, 0.7],
            [1.1, 2.1], [1.3, 2.3], [1.5, 2.5],
        ]));
        const y_calib = $.let(new BigInt64Array([0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 2n, 2n, 2n]));

        const config = $.let({
            base_model: variant('xgboost', {
                n_estimators: variant('some', 30n),
                max_depth: variant('some', 3n),
                learning_rate: variant('some', 0.1),
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
            }),
            method: variant('some', variant('aps', null)),  // APS only works for multiclass
            confidence_level: variant('some', 0.9),
            random_state: variant('some', 42n),
        });

        const model = $.let(MAPIE.trainConformalClassifier(X_train, y_train, X_calib, y_calib, config));
        const result = $.let(MAPIE.predictSet(model, X_calib));

        // Should have 3 probabilities per sample (3 classes)
        $(Assert.equal(result.probabilities.getRow(0n).length(), 3n));
    });

    test("trainConformalClassifier multiclass with LAC method", $ => {
        // 3-class classification
        const X_train = $.let(East.Matrix.fromArray([
            [0.0, 0.0], [0.2, 0.2], [0.4, 0.4], [0.6, 0.6],  // Class 0
            [2.0, 0.0], [2.2, 0.2], [2.4, 0.4], [2.6, 0.6],  // Class 1
            [1.0, 2.0], [1.2, 2.2], [1.4, 2.4], [1.6, 2.6],  // Class 2
        ]));
        const y_train = $.let(new BigInt64Array([0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 2n, 2n, 2n, 2n]));
        const X_calib = $.let(East.Matrix.fromArray([
            [0.1, 0.1], [0.3, 0.3], [0.5, 0.5], [0.7, 0.7],
            [2.1, 0.1], [2.3, 0.3], [2.5, 0.5], [2.7, 0.7],
            [1.1, 2.1], [1.3, 2.3], [1.5, 2.5],
        ]));
        const y_calib = $.let(new BigInt64Array([0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 2n, 2n, 2n]));

        const config = $.let({
            base_model: variant('xgboost', {
                n_estimators: variant('some', 30n),
                max_depth: variant('some', 3n),
                learning_rate: variant('some', 0.1),
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
            }),
            method: variant('none', null),  // Default LAC
            confidence_level: variant('some', 0.9),
            random_state: variant('some', 42n),
        });

        const model = $.let(MAPIE.trainConformalClassifier(X_train, y_train, X_calib, y_calib, config));
        const result = $.let(MAPIE.predictSet(model, X_calib));

        // Should have 3 probabilities per sample (3 classes)
        $(Assert.equal(result.probabilities.getRow(0n).length(), 3n));
    });

    test("conformal regressor with categorical_n handles different category subsets at train vs predict", $ => {
        // 1 categorical feature (col 0) with 8 possible categories [0..7]
        // Training sees {0,1,2,3}, prediction sees {0,2,5,7}
        const X_train = $.let(East.Matrix.fromArray([
            [0.0, 10.0], [1.0, 20.0], [2.0, 30.0], [3.0, 40.0],
            [0.0, 15.0], [1.0, 25.0], [2.0, 35.0], [3.0, 45.0],
            [0.0, 12.0], [1.0, 22.0],
        ]));
        const y_train = $.let(new Float64Array([1.0, 2.0, 3.0, 4.0, 1.5, 2.5, 3.5, 4.5, 1.2, 2.2]));

        const X_calib = $.let(East.Matrix.fromArray([
            [0.0, 11.0], [1.0, 21.0], [2.0, 31.0], [3.0, 41.0],
            [0.0, 13.0], [1.0, 23.0], [2.0, 33.0], [3.0, 43.0],
            [0.0, 14.0], [1.0, 24.0], [2.0, 34.0],
        ]));
        const y_calib = $.let(new Float64Array([1.1, 2.1, 3.1, 4.1, 1.3, 2.3, 3.3, 4.3, 1.4, 2.4, 3.4]));

        const config = $.let({
            base_model: variant('xgboost', {
                n_estimators: variant('some', 50n),
                max_depth: variant('some', 3n),
                learning_rate: variant('some', 0.1),
                min_child_weight: variant('none', null),
                subsample: variant('none', null),
                colsample_bytree: variant('none', null),
                reg_alpha: variant('none', null),
                reg_lambda: variant('none', null),
                gamma: variant('none', null),
                random_state: variant('some', 42n),
                n_jobs: variant('none', null),
                sample_weight: variant('none', null),
                categorical_features: variant('some', BigInt64Array.of(0n)),
                categorical_n: variant('some', BigInt64Array.of(8n)),
                max_cat_to_onehot: variant('none', null),
                max_cat_threshold: variant('none', null),
            }),
            method: variant('some', variant('split', null)),
            confidence_level: variant('some', 0.9),
            cv_folds: variant('none', null),
            random_state: variant('some', 42n),
            conformity_eps: variant('none', null),
        });

        const model = $.let(MAPIE.trainConformalRegressor(X_train, y_train, X_calib, y_calib, config));

        // Predict with different category subset: 0 (seen), 2 (seen), 5 (unseen), 7 (unseen)
        const X_test = $.let(East.Matrix.fromArray([
            [0.0, 20.0], [2.0, 20.0], [5.0, 20.0], [7.0, 20.0],
        ]));
        const result = $.let(MAPIE.predictInterval(model, X_test));

        // Must not crash and must return 4 predictions with intervals
        $(Assert.equal(result.pred.length(), 4n));
        $(Assert.equal(result.lower.length(), 4n));
        $(Assert.equal(result.upper.length(), 4n));
    });

    test("conformal classifier with categorical_n handles different category subsets at train vs predict", $ => {
        // 1 categorical feature (col 0) with 6 possible categories [0..5]
        // Training sees {0,1,2}, prediction sees {0,3,4}
        const X_train = $.let(East.Matrix.fromArray([
            [0.0, 0.0], [0.0, 0.2], [0.0, 0.4], [1.0, 0.6], [1.0, 0.8], [1.0, 1.0],
            [2.0, 3.0], [2.0, 3.2], [2.0, 3.4], [0.0, 3.6], [1.0, 3.8], [2.0, 4.0],
        ]));
        const y_train = $.let(new BigInt64Array([0n, 0n, 0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 1n, 1n]));

        const X_calib = $.let(East.Matrix.fromArray([
            [0.0, 0.1], [1.0, 0.3], [0.0, 0.5], [1.0, 0.7], [2.0, 0.9],
            [2.0, 3.1], [0.0, 3.3], [1.0, 3.5], [2.0, 3.7], [0.0, 3.9], [1.0, 4.1],
        ]));
        const y_calib = $.let(new BigInt64Array([0n, 0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 1n, 1n]));

        const config = $.let({
            base_model: variant('xgboost', {
                n_estimators: variant('some', 50n),
                max_depth: variant('some', 3n),
                learning_rate: variant('some', 0.1),
                min_child_weight: variant('none', null),
                subsample: variant('none', null),
                colsample_bytree: variant('none', null),
                reg_alpha: variant('none', null),
                reg_lambda: variant('none', null),
                gamma: variant('none', null),
                random_state: variant('some', 42n),
                n_jobs: variant('none', null),
                sample_weight: variant('none', null),
                categorical_features: variant('some', BigInt64Array.of(0n)),
                categorical_n: variant('some', BigInt64Array.of(6n)),
                max_cat_to_onehot: variant('none', null),
                max_cat_threshold: variant('none', null),
            }),
            method: variant('some', variant('lac', null)),
            confidence_level: variant('some', 0.9),
            random_state: variant('some', 42n),
        });

        const model = $.let(MAPIE.trainConformalClassifier(X_train, y_train, X_calib, y_calib, config));

        // Predict with different category subset: 0 (seen), 3 (unseen), 4 (unseen)
        const X_test = $.let(East.Matrix.fromArray([
            [0.0, 0.5], [3.0, 0.5], [4.0, 3.5],
        ]));
        const result = $.let(MAPIE.predictSet(model, X_test));

        // Must not crash and must return 3 predictions
        $(Assert.equal(result.pred.length(), 3n));
        $(Assert.equal(result.set_sizes.length(), 3n));
    });

    test("error: classifier X_train and y_train shape mismatch", $ => {
        const X_train = $.let(East.Matrix.fromArray([[1.0, 0.0], [2.0, 1.0], [3.0, 2.0]]));
        const y_train = $.let(new BigInt64Array([0n, 1n]));  // Mismatch!
        const X_calib = $.let(East.Matrix.fromArray([[1.5, 0.5]]));
        const y_calib = $.let(new BigInt64Array([0n]));

        const config = $.let({
            base_model: variant('xgboost', {
                n_estimators: variant('some', 10n),
                max_depth: variant('none', null),
                learning_rate: variant('none', null),
                min_child_weight: variant('none', null),
                subsample: variant('none', null),
                colsample_bytree: variant('none', null),
                reg_alpha: variant('none', null),
                reg_lambda: variant('none', null),
                gamma: variant('none', null),
                random_state: variant('none', null),
                n_jobs: variant('none', null),
                sample_weight: variant('none', null),
                categorical_features: variant('none', null),
                categorical_n: variant('none', null),
                max_cat_to_onehot: variant('none', null),
                max_cat_threshold: variant('none', null),
            }),
            method: variant('none', null),
            confidence_level: variant('none', null),
            random_state: variant('none', null),
        });

        $(Assert.throws(
            MAPIE.trainConformalClassifier(X_train, y_train, X_calib, y_calib, config),
            /X_train has 3 samples but y_train has 2 samples/
        ));
    });

}, { exportOnly: true });
