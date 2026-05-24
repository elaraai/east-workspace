/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * SHAP platform function tests
 */
import { East, variant } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { Shap, XGBoost, NGBoost, GP, Torch, Sklearn, MAPIE } from "@elaraai/east-py-datascience";
import * as ex from "./shap.examples.js";

describeEast("SHAP platform functions", (test) => {

    Assert.examples(test, { shapTreeExplainer: ex.shapTreeExplainer, shapTreeExplainerCategorical: ex.shapTreeExplainerCategorical, shapTreeExplainerInterventionalCategorical: ex.shapTreeExplainerInterventionalCategorical, shapMapieCategoricalInterventional: ex.shapMapieCategoricalInterventional, shapTreeExplainerInterventional: ex.shapTreeExplainerInterventional, shapKernelExplainer: ex.shapKernelExplainer });
    // Note: LightGBM TreeExplainer tests removed due to SHAP compatibility issues.
    // Use KernelExplainer for LightGBM models.

    test("tree_explainer works with XGBoost regressor", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
            [5.0, 6.0],
            [6.0, 7.0],
            [7.0, 8.0],
            [8.0, 9.0],
        ]));
        const y = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0, 11.0, 13.0, 15.0, 17.0]));

        const config = $.let({
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
        });

        const model = $.let(XGBoost.trainRegressor(X, y, config));
        const explainer = $.let(Shap.treeExplainerCreate(variant('path_dependent', { model })));
        const feature_names = $.let(["feature1", "feature2"]);
        const result = $.let(Shap.computeValues(explainer, X, feature_names));

        // Regression returns matrix_2d variant
        $.match(result.shap_values, {
            matrix_2d: ($, shap_matrix) => {
                $(Assert.equal(shap_matrix.rows(), 8n));
                $(Assert.equal(shap_matrix.getRow(0n).length(), 2n));
            },
            tensor_3d: ($) => $(Assert.fail("Expected matrix_2d for regression")),
        });
    });

    test("tree_explainer interventional mode with XGBoost regressor", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
            [5.0, 6.0],
            [6.0, 7.0],
            [7.0, 8.0],
            [8.0, 9.0],
        ]));
        const y = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0, 11.0, 13.0, 15.0, 17.0]));

        const config = $.let({
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
        });

        const model = $.let(XGBoost.trainRegressor(X, y, config));
        // Use subset as background data for interventional mode
        const background = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [4.0, 5.0],
            [8.0, 9.0],
        ]));
        const explainer = $.let(Shap.treeExplainerCreate(variant('interventional', { model, background })));
        const feature_names = $.let(["feature1", "feature2"]);
        const result = $.let(Shap.computeValues(explainer, X, feature_names));

        // Regression returns matrix_2d variant
        $.match(result.shap_values, {
            matrix_2d: ($, shap_matrix) => {
                $(Assert.equal(shap_matrix.rows(), 8n));
                $(Assert.equal(shap_matrix.getRow(0n).length(), 2n));
            },
            tensor_3d: ($) => $(Assert.fail("Expected matrix_2d for regression")),
        });
    });

    test("tree_explainer works with XGBoost classifier", $ => {
        const X = $.let(East.Matrix.fromArray([
            [0.0, 0.0],
            [0.5, 0.5],
            [1.0, 1.0],
            [1.5, 1.5],
            [10.0, 10.0],
            [10.5, 10.5],
            [11.0, 11.0],
            [11.5, 11.5],
        ]));
        const y = $.let(new BigInt64Array([0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n]));

        const config = $.let({
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
        });

        const model = $.let(XGBoost.trainClassifier(X, y, config));
        const explainer = $.let(Shap.treeExplainerCreate(variant('path_dependent', { model })));
        const feature_names = $.let(["feature1", "feature2"]);
        const result = $.let(Shap.computeValues(explainer, X, feature_names));

        // Binary classification returns matrix_2d variant
        $.match(result.shap_values, {
            matrix_2d: ($, shap_matrix) => {
                $(Assert.equal(shap_matrix.rows(), 8n));
                $(Assert.equal(shap_matrix.getRow(0n).length(), 2n));
            },
            tensor_3d: ($) => $(Assert.fail("Expected matrix_2d for binary classification")),
        });
    });

    test("tree_explainer works with XGBoost quantile regressor", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
            [5.0, 6.0],
            [6.0, 7.0],
            [7.0, 8.0],
            [8.0, 9.0],
        ]));
        const y = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0, 11.0, 13.0, 15.0, 17.0]));

        const config = $.let({
            quantiles: new Float64Array([0.1, 0.5, 0.9]),
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
        });

        // Train quantile model
        const model = $.let(XGBoost.trainQuantile(X, y, config));
        // TreeExplainer uses the median (0.5) quantile model
        const explainer = $.let(Shap.treeExplainerCreate(variant('path_dependent', { model })));
        const feature_names = $.let(["feature1", "feature2"]);
        const result = $.let(Shap.computeValues(explainer, X, feature_names));

        // Quantile regression returns matrix_2d variant
        $.match(result.shap_values, {
            matrix_2d: ($, shap_matrix) => {
                $(Assert.equal(shap_matrix.rows(), 8n));
                $(Assert.equal(shap_matrix.getRow(0n).length(), 2n));
            },
            tensor_3d: ($) => $(Assert.fail("Expected matrix_2d for quantile regression")),
        });
    });

    test("feature_importance computes mean absolute SHAP", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
            [5.0, 6.0],
            [6.0, 7.0],
            [7.0, 8.0],
            [8.0, 9.0],
        ]));
        const y = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0, 11.0, 13.0, 15.0, 17.0]));

        const config = $.let({
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
        });

        const model = $.let(XGBoost.trainRegressor(X, y, config));
        const explainer = $.let(Shap.treeExplainerCreate(variant('path_dependent', { model })));
        const feature_names = $.let(["feature1", "feature2"]);
        const shap_result = $.let(Shap.computeValues(explainer, X, feature_names));
        const importance = $.let(Shap.featureImportance(shap_result.shap_values, feature_names));

        $(Assert.equal(importance.feature_names.length(), 2n));
        $(Assert.equal(importance.importances.length(), 2n));
        $(Assert.greaterEqual(importance.importances.get(0n), East.value(0.0)));
        $(Assert.greaterEqual(importance.importances.get(1n), East.value(0.0)));
    });

    test("kernel_explainer works with NGBoost regressor", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
            [5.0, 6.0],
            [6.0, 7.0],
            [7.0, 8.0],
            [8.0, 9.0],
        ]));
        const y = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0, 11.0, 13.0, 15.0, 17.0]));

        const config = $.let({
            n_estimators: variant('some', 50n),
            learning_rate: variant('some', 0.1),
            minibatch_frac: variant('none', null),
            col_sample: variant('none', null),
            random_state: variant('some', 42n),
            distribution: variant('none', null),
        });

        const model = $.let(NGBoost.trainRegressor(X, y, config));
        // Use subset of data as background for KernelExplainer
        const X_background = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [4.0, 5.0],
            [8.0, 9.0],
        ]));
        const explainer = $.let(Shap.kernelExplainerCreate(model, X_background));
        const feature_names = $.let(["feature1", "feature2"]);
        // Explain just 2 samples to keep test fast
        const X_explain = $.let(East.Matrix.fromArray([
            [2.0, 3.0],
            [5.0, 6.0],
        ]));
        const result = $.let(Shap.computeValues(explainer, X_explain, feature_names));

        // Regression returns matrix_2d variant
        $.match(result.shap_values, {
            matrix_2d: ($, shap_matrix) => {
                $(Assert.equal(shap_matrix.rows(), 2n));
                $(Assert.equal(shap_matrix.getRow(0n).length(), 2n));
            },
            tensor_3d: ($) => $(Assert.fail("Expected matrix_2d for regression")),
        });
    });

    test("kernel_explainer works with GP regressor", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
            [5.0, 6.0],
        ]));
        const y = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0, 11.0]));

        const config = $.let({
            kernel: variant('some', variant('rbf', null)),
            alpha: variant('some', 1e-10),
            n_restarts_optimizer: variant('some', 0n),
            normalize_y: variant('some', true),
            random_state: variant('some', 42n),
        });

        const model = $.let(GP.train(X, y, config));
        const X_background = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [3.0, 4.0],
            [5.0, 6.0],
        ]));
        const explainer = $.let(Shap.kernelExplainerCreate(model, X_background));
        const feature_names = $.let(["feature1", "feature2"]);
        const X_explain = $.let(East.Matrix.fromArray([
            [2.0, 3.0],
            [4.0, 5.0],
        ]));
        const result = $.let(Shap.computeValues(explainer, X_explain, feature_names));

        // Regression returns matrix_2d variant
        $.match(result.shap_values, {
            matrix_2d: ($, shap_matrix) => {
                $(Assert.equal(shap_matrix.rows(), 2n));
                $(Assert.equal(shap_matrix.getRow(0n).length(), 2n));
            },
            tensor_3d: ($) => $(Assert.fail("Expected matrix_2d for regression")),
        });
    });

    test("kernel_explainer works with Torch MLP", $ => {
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
            [5.0, 6.0],
            [6.0, 7.0],
            [7.0, 8.0],
            [8.0, 9.0],
        ]));
        const y = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0, 11.0, 13.0, 15.0, 17.0]));

        const mlp_config = $.let({
            hidden_layers: [16n, 8n],
            activation: variant('some', variant('relu', null)),
            output_activation: variant('none', null),
            dropout: variant('none', null),
            output_dim: variant('some', 1n),
        });
        const train_config = $.let({
            epochs: variant('some', 50n),
            batch_size: variant('some', 4n),
            learning_rate: variant('some', 0.01),
            loss: variant('none', null),
            optimizer: variant('none', null),
            early_stopping: variant('none', null),
            validation_split: variant('none', null),
            random_state: variant('some', 42n),
        });

        const train_result = $.let(Torch.mlpTrain(X, y, mlp_config, train_config));
        const model = $.let(train_result.model);
        const X_background = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [4.0, 5.0],
            [8.0, 9.0],
        ]));
        const explainer = $.let(Shap.kernelExplainerCreate(model, X_background));
        const feature_names = $.let(["feature1", "feature2"]);
        const X_explain = $.let(East.Matrix.fromArray([
            [2.0, 3.0],
            [5.0, 6.0],
        ]));
        const result = $.let(Shap.computeValues(explainer, X_explain, feature_names));

        // Regression returns matrix_2d variant
        $.match(result.shap_values, {
            matrix_2d: ($, shap_matrix) => {
                $(Assert.equal(shap_matrix.rows(), 2n));
                $(Assert.equal(shap_matrix.getRow(0n).length(), 2n));
            },
            tensor_3d: ($) => $(Assert.fail("Expected matrix_2d for regression")),
        });
    });

    test("tree_explainer works with XGBoost multi-class classifier", $ => {
        // Multi-class classification with 3 classes
        const X = $.let(East.Matrix.fromArray([
            [0.0, 0.0],
            [0.5, 0.5],
            [1.0, 1.0],
            [5.0, 5.0],
            [5.5, 5.5],
            [6.0, 6.0],
            [10.0, 10.0],
            [10.5, 10.5],
            [11.0, 11.0],
        ]));
        const y = $.let(new BigInt64Array([0n, 0n, 0n, 1n, 1n, 1n, 2n, 2n, 2n]));

        const config = $.let({
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
        });

        const model = $.let(XGBoost.trainClassifier(X, y, config));
        const explainer = $.let(Shap.treeExplainerCreate(variant('path_dependent', { model })));
        const feature_names = $.let(["feature1", "feature2"]);
        const result = $.let(Shap.computeValues(explainer, X, feature_names));

        // Multi-class (>2 classes) returns tensor_3d variant
        $.match(result.shap_values, {
            matrix_2d: ($) => $(Assert.fail("Expected tensor_3d for multi-class classification")),
            tensor_3d: ($, shap_tensor) => {
                // tensor_3d is list of (n_features, n_classes) matrices, one per sample
                $(Assert.equal(shap_tensor.length(), 9n));  // 9 samples
                $(Assert.equal(shap_tensor.get(0n).rows(), 2n));  // 2 features
                $(Assert.equal(shap_tensor.get(0n).getRow(0n).length(), 3n));  // 3 classes
            },
        });

        // base_value should be per_class
        $.match(result.base_value, {
            single: ($) => $(Assert.fail("Expected per_class for multi-class classification")),
            per_class: ($, base_values) => {
                $(Assert.equal(base_values.length(), 3n));  // 3 classes
            },
        });
    });

    test("feature_importance works with multi-class tensor_3d", $ => {
        // Multi-class classification with 3 classes
        const X = $.let(East.Matrix.fromArray([
            [0.0, 0.0],
            [0.5, 0.5],
            [1.0, 1.0],
            [5.0, 5.0],
            [5.5, 5.5],
            [6.0, 6.0],
            [10.0, 10.0],
            [10.5, 10.5],
            [11.0, 11.0],
        ]));
        const y = $.let(new BigInt64Array([0n, 0n, 0n, 1n, 1n, 1n, 2n, 2n, 2n]));

        const config = $.let({
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
        });

        const model = $.let(XGBoost.trainClassifier(X, y, config));
        const explainer = $.let(Shap.treeExplainerCreate(variant('path_dependent', { model })));
        const feature_names = $.let(["feature1", "feature2"]);
        const shap_result = $.let(Shap.computeValues(explainer, X, feature_names));
        const importance = $.let(Shap.featureImportance(shap_result.shap_values, feature_names));

        // Feature importance aggregates across samples and classes
        $(Assert.equal(importance.feature_names.length(), 2n));
        $(Assert.equal(importance.importances.length(), 2n));
        $(Assert.greaterEqual(importance.importances.get(0n), East.value(0.0)));
        $(Assert.greaterEqual(importance.importances.get(1n), East.value(0.0)));
    });

    test("kernel_explainer works with RegressorChain", $ => {
        // Multi-target regression data
        const X = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
            [5.0, 6.0],
            [6.0, 7.0],
            [7.0, 8.0],
            [8.0, 9.0],
        ]));
        // Multi-target: Y has 2 targets (columns)
        const Y = $.let(East.Matrix.fromArray([
            [3.0, 6.0],
            [5.0, 10.0],
            [7.0, 14.0],
            [9.0, 18.0],
            [11.0, 22.0],
            [13.0, 26.0],
            [15.0, 30.0],
            [17.0, 34.0],
        ]));

        // Configure RegressorChain with XGBoost base estimator
        const xgboost_config = $.let({
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
        });

        const chain_config = $.let({
            base_estimator: variant('xgboost', xgboost_config),
            order: variant('none', null),
            random_state: variant('some', 42n),
        });

        const model = $.let(Sklearn.regressorChainTrain(X, Y, chain_config));

        // Use subset of data as background for KernelExplainer
        const X_background = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [4.0, 5.0],
            [8.0, 9.0],
        ]));
        const explainer = $.let(Shap.kernelExplainerCreate(model, X_background));
        const feature_names = $.let(["feature1", "feature2"]);

        // Explain just 2 samples to keep test fast
        const X_explain = $.let(East.Matrix.fromArray([
            [2.0, 3.0],
            [5.0, 6.0],
        ]));
        const result = $.let(Shap.computeValues(explainer, X_explain, feature_names));

        // RegressorChain returns first target's predictions, so SHAP gives matrix_2d
        $.match(result.shap_values, {
            matrix_2d: ($, shap_matrix) => {
                $(Assert.equal(shap_matrix.rows(), 2n));
                $(Assert.equal(shap_matrix.getRow(0n).length(), 2n));
            },
            tensor_3d: ($) => $(Assert.fail("Expected matrix_2d for RegressorChain")),
        });
    });

    // =========================================================================
    // MAPIE Integration Tests
    // =========================================================================

    test("kernel_explainer works with MAPIE split regressor", $ => {
        // Training data
        const X_train = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
            [5.0, 6.0],
            [6.0, 7.0],
            [7.0, 8.0],
            [8.0, 9.0],
            [9.0, 10.0],
            [10.0, 11.0],
        ]));
        const y_train = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0, 11.0, 13.0, 15.0, 17.0, 19.0, 21.0]));

        // Calibration data - need at least 11 samples for 90% confidence
        const X_calib = $.let(East.Matrix.fromArray([
            [1.5, 2.5], [2.5, 3.5], [3.5, 4.5], [4.5, 5.5], [5.5, 6.5],
            [6.5, 7.5], [7.5, 8.5], [8.5, 9.5], [9.5, 10.5], [10.5, 11.5], [11.5, 12.5],
        ]));
        const y_calib = $.let(new Float64Array([4.0, 6.0, 8.0, 10.0, 12.0, 14.0, 16.0, 18.0, 20.0, 22.0, 24.0]));

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
            confidence_level: variant('some', 0.9),
            cv_folds: variant('none', null),
            random_state: variant('some', 42n),
            conformity_eps: variant('none', null),
        });

        const model = $.let(MAPIE.trainConformalRegressor(X_train, y_train, X_calib, y_calib, config));

        // Background data for SHAP
        const X_background = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [4.0, 5.0],
        ]));

        const explainer = $.let(Shap.kernelExplainerCreate(model, X_background));
        const feature_names = $.let(["feature1", "feature2"]);
        const X_explain = $.let(East.Matrix.fromArray([
            [2.0, 3.0],
            [5.0, 6.0],
        ]));
        const result = $.let(Shap.computeValues(explainer, X_explain, feature_names));

        // Regression returns matrix_2d variant
        $.match(result.shap_values, {
            matrix_2d: ($, shap_matrix) => {
                $(Assert.equal(shap_matrix.rows(), 2n));
                $(Assert.equal(shap_matrix.getRow(0n).length(), 2n));
            },
            tensor_3d: ($) => $(Assert.fail("Expected matrix_2d for MAPIE regressor")),
        });
    });

    test("kernel_explainer works with MAPIE CQR regressor", $ => {
        const X_train = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
            [5.0, 6.0],
            [6.0, 7.0],
            [7.0, 8.0],
            [8.0, 9.0],
            [9.0, 10.0],
            [10.0, 11.0],
            [11.0, 12.0],
            [12.0, 13.0],
            [13.0, 14.0],
            [14.0, 15.0],
            [15.0, 16.0],
        ]));
        const y_train = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0, 11.0, 13.0, 15.0, 17.0, 19.0, 21.0, 23.0, 25.0, 27.0, 29.0, 31.0]));
        // Calibration data - need enough samples for CQR
        const X_calib = $.let(East.Matrix.fromArray([
            [1.5, 2.5], [2.5, 3.5], [3.5, 4.5], [4.5, 5.5], [5.5, 6.5],
            [6.5, 7.5],
        ]));
        const y_calib = $.let(new Float64Array([4.0, 6.0, 8.0, 10.0, 12.0, 14.0]));

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

        const X_background = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [4.0, 5.0],
        ]));

        const explainer = $.let(Shap.kernelExplainerCreate(model, X_background));
        const feature_names = $.let(["feature1", "feature2"]);
        const X_explain = $.let(East.Matrix.fromArray([
            [2.0, 3.0],
            [5.0, 6.0],
        ]));
        const result = $.let(Shap.computeValues(explainer, X_explain, feature_names));

        $.match(result.shap_values, {
            matrix_2d: ($, shap_matrix) => {
                $(Assert.equal(shap_matrix.rows(), 2n));
                $(Assert.equal(shap_matrix.getRow(0n).length(), 2n));
            },
            tensor_3d: ($) => $(Assert.fail("Expected matrix_2d for MAPIE CQR")),
        });
    });

    test("kernel_explainer works with MAPIE classifier", $ => {
        const X_train = $.let(East.Matrix.fromArray([
            [0.0, 0.0], [0.5, 0.5], [1.0, 1.0], [1.5, 1.5], [2.0, 2.0], [2.5, 2.5],
            [10.0, 10.0], [10.5, 10.5], [11.0, 11.0], [11.5, 11.5], [12.0, 12.0], [12.5, 12.5],
        ]));
        const y_train = $.let(new BigInt64Array([0n, 0n, 0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 1n, 1n]));
        // Calibration data - need at least 11 samples for 90% confidence
        const X_calib = $.let(East.Matrix.fromArray([
            [0.25, 0.25], [0.75, 0.75], [1.25, 1.25], [1.75, 1.75], [2.25, 2.25],
            [10.25, 10.25], [10.75, 10.75], [11.25, 11.25], [11.75, 11.75], [12.25, 12.25], [12.75, 12.75],
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
            confidence_level: variant('some', 0.9),
            random_state: variant('some', 42n),
        });

        const model = $.let(MAPIE.trainConformalClassifier(X_train, y_train, X_calib, y_calib, config));

        const X_background = $.let(East.Matrix.fromArray([
            [0.0, 0.0],
            [10.0, 10.0],
        ]));

        // model is already a variant (mapie_classifier) from trainConformalClassifier
        const explainer = $.let(Shap.kernelExplainerCreate(model, X_background));
        const feature_names = $.let(["feature1", "feature2"]);
        const X_explain = $.let(East.Matrix.fromArray([
            [0.5, 0.5],
            [10.5, 10.5],
        ]));
        const result = $.let(Shap.computeValues(explainer, X_explain, feature_names));

        // Binary classifier returns matrix_2d or tensor_3d depending on implementation
        $.match(result.shap_values, {
            matrix_2d: ($, shap_matrix) => {
                $(Assert.equal(shap_matrix.rows(), 2n));
                $(Assert.equal(shap_matrix.getRow(0n).length(), 2n));
            },
            tensor_3d: ($, shap_tensor) => {
                // If multi-class format
                $(Assert.equal(shap_tensor.length(), 2n));
            },
        });
    });

    test("uncertainty_predictor_regressor explains interval width", $ => {
        const X_train = $.let(East.Matrix.fromArray([
            [1.0, 2.0], [2.0, 3.0], [3.0, 4.0], [4.0, 5.0], [5.0, 6.0],
            [6.0, 7.0], [7.0, 8.0], [8.0, 9.0], [9.0, 10.0], [10.0, 11.0],
        ]));
        const y_train = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0, 11.0, 13.0, 15.0, 17.0, 19.0, 21.0]));
        // Need at least 11 calibration samples for 90% confidence
        const X_calib = $.let(East.Matrix.fromArray([
            [1.5, 2.5], [2.5, 3.5], [3.5, 4.5], [4.5, 5.5], [5.5, 6.5],
            [6.5, 7.5], [7.5, 8.5], [8.5, 9.5], [9.5, 10.5], [10.5, 11.5], [11.5, 12.5],
        ]));
        const y_calib = $.let(new Float64Array([4.0, 6.0, 8.0, 10.0, 12.0, 14.0, 16.0, 18.0, 20.0, 22.0, 24.0]));

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
            confidence_level: variant('some', 0.9),
            cv_folds: variant('none', null),
            random_state: variant('some', 42n),
            conformity_eps: variant('none', null),
        });

        const mapie_model = $.let(MAPIE.trainConformalRegressor(X_train, y_train, X_calib, y_calib, config));

        // Create uncertainty predictor that predicts interval width
        const uncertainty_model = $.let(MAPIE.uncertaintyPredictorRegressor(mapie_model));

        const X_background = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [4.0, 5.0],
        ]));

        const explainer = $.let(Shap.kernelExplainerCreate(uncertainty_model, X_background));
        const feature_names = $.let(["feature1", "feature2"]);
        const X_explain = $.let(East.Matrix.fromArray([
            [2.0, 3.0],
            [5.0, 6.0],
        ]));
        const result = $.let(Shap.computeValues(explainer, X_explain, feature_names));

        // Uncertainty SHAP returns matrix_2d (interval width is scalar per sample)
        $.match(result.shap_values, {
            matrix_2d: ($, shap_matrix) => {
                $(Assert.equal(shap_matrix.rows(), 2n));
                $(Assert.equal(shap_matrix.getRow(0n).length(), 2n));
            },
            tensor_3d: ($) => $(Assert.fail("Expected matrix_2d for uncertainty SHAP")),
        });
    });

    test("uncertainty_predictor_classifier explains set size", $ => {
        const X_train = $.let(East.Matrix.fromArray([
            [0.0, 0.0], [0.5, 0.5], [1.0, 1.0], [1.5, 1.5], [2.0, 2.0], [2.5, 2.5],
            [10.0, 10.0], [10.5, 10.5], [11.0, 11.0], [11.5, 11.5], [12.0, 12.0], [12.5, 12.5],
        ]));
        const y_train = $.let(new BigInt64Array([0n, 0n, 0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 1n, 1n]));
        // Need at least 11 calibration samples for 90% confidence
        const X_calib = $.let(East.Matrix.fromArray([
            [0.25, 0.25], [0.75, 0.75], [1.25, 1.25], [1.75, 1.75], [2.25, 2.25],
            [10.25, 10.25], [10.75, 10.75], [11.25, 11.25], [11.75, 11.75], [12.25, 12.25], [12.75, 12.75],
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
            confidence_level: variant('some', 0.9),
            random_state: variant('some', 42n),
        });

        const mapie_model = $.let(MAPIE.trainConformalClassifier(X_train, y_train, X_calib, y_calib, config));

        // Create uncertainty predictor that predicts set size
        const uncertainty_model = $.let(MAPIE.uncertaintyPredictorClassifier(mapie_model));

        const X_background = $.let(East.Matrix.fromArray([
            [0.0, 0.0],
            [10.0, 10.0],
        ]));

        const explainer = $.let(Shap.kernelExplainerCreate(uncertainty_model, X_background));
        const feature_names = $.let(["feature1", "feature2"]);
        const X_explain = $.let(East.Matrix.fromArray([
            [0.5, 0.5],
            [10.5, 10.5],
        ]));
        const result = $.let(Shap.computeValues(explainer, X_explain, feature_names));

        // Set size is scalar per sample, returns matrix_2d
        $.match(result.shap_values, {
            matrix_2d: ($, shap_matrix) => {
                $(Assert.equal(shap_matrix.rows(), 2n));
                $(Assert.equal(shap_matrix.getRow(0n).length(), 2n));
            },
            tensor_3d: ($) => $(Assert.fail("Expected matrix_2d for uncertainty SHAP")),
        });
    });

    // =========================================================================
    // MAPIE TreeExplainer Tests (direct XGBoost extraction)
    // =========================================================================

    test("tree_explainer works with MAPIE split regressor (XGBoost base)", $ => {
        const X_train = $.let(East.Matrix.fromArray([
            [1.0, 2.0], [2.0, 3.0], [3.0, 4.0], [4.0, 5.0], [5.0, 6.0],
            [6.0, 7.0], [7.0, 8.0], [8.0, 9.0], [9.0, 10.0], [10.0, 11.0],
        ]));
        const y_train = $.let(new Float64Array([3.0, 5.0, 7.0, 9.0, 11.0, 13.0, 15.0, 17.0, 19.0, 21.0]));
        // Need at least 11 calibration samples for 90% confidence
        const X_calib = $.let(East.Matrix.fromArray([
            [1.5, 2.5], [2.5, 3.5], [3.5, 4.5], [4.5, 5.5], [5.5, 6.5],
            [6.5, 7.5], [7.5, 8.5], [8.5, 9.5], [9.5, 10.5], [10.5, 11.5], [11.5, 12.5],
        ]));
        const y_calib = $.let(new Float64Array([4.0, 6.0, 8.0, 10.0, 12.0, 14.0, 16.0, 18.0, 20.0, 22.0, 24.0]));

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
            confidence_level: variant('some', 0.9),
            cv_folds: variant('none', null),
            random_state: variant('some', 42n),
            conformity_eps: variant('none', null),
        });

        const model = $.let(MAPIE.trainConformalRegressor(X_train, y_train, X_calib, y_calib, config));

        // TreeExplainer extracts underlying XGBoost from MAPIE
        const explainer = $.let(Shap.treeExplainerCreate(variant('path_dependent', { model })));
        const feature_names = $.let(["feature1", "feature2"]);
        const X_explain = $.let(East.Matrix.fromArray([
            [2.0, 3.0],
            [5.0, 6.0],
        ]));
        const result = $.let(Shap.computeValues(explainer, X_explain, feature_names));

        // Regression returns matrix_2d variant
        $.match(result.shap_values, {
            matrix_2d: ($, shap_matrix) => {
                $(Assert.equal(shap_matrix.rows(), 2n));
                $(Assert.equal(shap_matrix.getRow(0n).length(), 2n));
            },
            tensor_3d: ($) => $(Assert.fail("Expected matrix_2d for MAPIE regressor")),
        });
    });

    test("tree_explainer works with MAPIE classifier (XGBoost base)", $ => {
        const X_train = $.let(East.Matrix.fromArray([
            [0.0, 0.0], [0.5, 0.5], [1.0, 1.0], [1.5, 1.5], [2.0, 2.0], [2.5, 2.5],
            [10.0, 10.0], [10.5, 10.5], [11.0, 11.0], [11.5, 11.5], [12.0, 12.0], [12.5, 12.5],
        ]));
        const y_train = $.let(new BigInt64Array([0n, 0n, 0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 1n, 1n]));
        // Need at least 11 calibration samples for 90% confidence
        const X_calib = $.let(East.Matrix.fromArray([
            [0.25, 0.25], [0.75, 0.75], [1.25, 1.25], [1.75, 1.75], [2.25, 2.25],
            [10.25, 10.25], [10.75, 10.75], [11.25, 11.25], [11.75, 11.75], [12.25, 12.25], [12.75, 12.75],
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
            confidence_level: variant('some', 0.9),
            random_state: variant('some', 42n),
        });

        const model = $.let(MAPIE.trainConformalClassifier(X_train, y_train, X_calib, y_calib, config));

        // TreeExplainer extracts underlying XGBoost from MAPIE
        const explainer = $.let(Shap.treeExplainerCreate(variant('path_dependent', { model })));
        const feature_names = $.let(["feature1", "feature2"]);
        const X_explain = $.let(East.Matrix.fromArray([
            [0.5, 0.5],
            [10.5, 10.5],
        ]));
        const result = $.let(Shap.computeValues(explainer, X_explain, feature_names));

        // Binary classification returns matrix_2d variant
        $.match(result.shap_values, {
            matrix_2d: ($, shap_matrix) => {
                $(Assert.equal(shap_matrix.rows(), 2n));
                $(Assert.equal(shap_matrix.getRow(0n).length(), 2n));
            },
            tensor_3d: ($) => $(Assert.fail("Expected matrix_2d for binary MAPIE classifier")),
        });
    });

    test("tree_explainer works with MAPIE multi-class classifier (XGBoost base)", $ => {
        const X_train = $.let(East.Matrix.fromArray([
            [0.0, 0.0], [0.3, 0.3], [0.5, 0.5], [0.7, 0.7], [1.0, 1.0],
            [5.0, 5.0], [5.3, 5.3], [5.5, 5.5], [5.7, 5.7], [6.0, 6.0],
            [10.0, 10.0], [10.3, 10.3], [10.5, 10.5], [10.7, 10.7], [11.0, 11.0],
        ]));
        const y_train = $.let(new BigInt64Array([0n, 0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 1n, 2n, 2n, 2n, 2n, 2n]));
        // Need at least 11 calibration samples for 90% confidence
        const X_calib = $.let(East.Matrix.fromArray([
            [0.25, 0.25], [0.75, 0.75], [1.25, 1.25], [1.75, 1.75],
            [5.25, 5.25], [5.75, 5.75], [6.25, 6.25],
            [10.25, 10.25], [10.75, 10.75], [11.25, 11.25], [11.75, 11.75],
        ]));
        const y_calib = $.let(new BigInt64Array([0n, 0n, 0n, 0n, 1n, 1n, 1n, 2n, 2n, 2n, 2n]));

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
            confidence_level: variant('some', 0.9),
            random_state: variant('some', 42n),
        });

        const model = $.let(MAPIE.trainConformalClassifier(X_train, y_train, X_calib, y_calib, config));

        // TreeExplainer extracts underlying XGBoost from MAPIE
        const explainer = $.let(Shap.treeExplainerCreate(variant('path_dependent', { model })));
        const feature_names = $.let(["feature1", "feature2"]);
        const result = $.let(Shap.computeValues(explainer, X_train, feature_names));

        // Multi-class (>2 classes) returns tensor_3d variant
        $.match(result.shap_values, {
            matrix_2d: ($) => $(Assert.fail("Expected tensor_3d for multi-class MAPIE classifier")),
            tensor_3d: ($, shap_tensor) => {
                $(Assert.equal(shap_tensor.length(), 15n));  // 15 samples
                $(Assert.equal(shap_tensor.get(0n).rows(), 2n));  // 2 features
                $(Assert.equal(shap_tensor.get(0n).getRow(0n).length(), 3n));  // 3 classes
            },
        });

        // base_value should be per_class
        $.match(result.base_value, {
            single: ($) => $(Assert.fail("Expected per_class for multi-class MAPIE classifier")),
            per_class: ($, base_values) => {
                $(Assert.equal(base_values.length(), 3n));  // 3 classes
            },
        });
    });
}, { exportOnly: true });
