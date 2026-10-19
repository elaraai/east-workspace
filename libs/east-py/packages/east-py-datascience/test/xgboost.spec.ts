/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * XGBoost platform function tests
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { East, variant, some, none } from "@elaraai/east";
import { describeEast, Assert } from "@elaraai/east-node-std";
import { XGBoost, XGBoostModelBlobType, XGBoostConfigType } from "@elaraai/east-py-datascience";
import * as ex from "./xgboost.examples.js";

// The interchange fixture: model blobs east-py-datascience trained and wrote
// (tests/fixtures/make_xgboost_interchange.py), the inputs it asked them
// about and what they answered. Baked into the IR as constants, so every
// runner that implements the family — east-py-datascience, east-c's
// east-c-datascience — predicts from the very bytes the python runner wrote
// and must answer what it answered.
interface FixtureModel {
    case: string;
    fields: {
        data: string;
        n_features: number;
        n_classes?: number;
        quantiles?: number[];
        categorical_features: number[] | null;
        categorical_n: number[] | null;
    };
}
interface Fixture {
    regressor: {
        model: FixtureModel;
        train: {
            X: number[][]; y: number[]; n_estimators: number; max_depth: number;
            learning_rate: number; random_state: number;
            categorical_features: number[]; categorical_n: number[];
        };
        X: number[][];
        predictions: number[];
    };
    classifier: { model: FixtureModel; X: number[][]; classes: number[]; probabilities: number[][] };
    quantile: { model: FixtureModel; X: number[][]; quantiles: number[]; predictions: number[][] };
}
const fixturePath = (): string => {
    // Beside this file in the source tree; two levels up from dist/test/ when built.
    for (const candidate of ["./fixtures/xgboost_interchange.json", "../../test/fixtures/xgboost_interchange.json"]) {
        const path = fileURLToPath(new URL(candidate, import.meta.url));
        if (existsSync(path)) return path;
    }
    throw new Error("xgboost_interchange.json: the interchange fixture is missing");
};
const FIXTURE = JSON.parse(readFileSync(fixturePath(), "utf-8")) as Fixture;

const integerVector = (xs: number[] | null) => xs === null ? none : some(BigInt64Array.from(xs.map((x) => BigInt(x))));

/** The fixture's model blob as the East value `XGBoostModelBlobType` holds. */
const fixtureModel = (model: FixtureModel) => {
    const data = new Uint8Array(Buffer.from(model.fields.data, "base64"));
    const common = {
        data,
        n_features: BigInt(model.fields.n_features),
        categorical_features: integerVector(model.fields.categorical_features),
        categorical_n: integerVector(model.fields.categorical_n),
    };
    switch (model.case) {
        case "xgboost_regressor":
            return variant("xgboost_regressor", common);
        case "xgboost_classifier":
            return variant("xgboost_classifier", { ...common, n_classes: BigInt(model.fields.n_classes ?? 0) });
        case "xgboost_quantile":
            return variant("xgboost_quantile", { ...common, quantiles: Float64Array.from(model.fields.quantiles ?? []) });
        default:
            throw new Error(`unknown fixture model ${model.case}`);
    }
};

describeEast("XGBoost platform functions", (test) => {

    Assert.examples(test, { xgboostTrainPredict: ex.xgboostTrainPredict, xgboostClassifier: ex.xgboostClassifier, xgboostQuantile: ex.xgboostQuantile, xgboostClassifierScalePosWeight: ex.xgboostClassifierScalePosWeight });

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
            scale_pos_weight: variant('none', null),
        });

        // Train model
        const model = $.let(XGBoost.trainRegressor(X, y, config));

        // Predict on training data
        const y_pred = $.let(XGBoost.predict(model, X));

        // Check dimensions
        $(Assert.equal(y_pred.length(), 5n));

        // Check predictions are close to actual values (within 1.0)
        $(Assert.less(y_pred.get(0n).subtract(y.get(0n)).abs(), East.value(1.0)));
        $(Assert.less(y_pred.get(2n).subtract(y.get(2n)).abs(), East.value(1.0)));
        $(Assert.less(y_pred.get(4n).subtract(y.get(4n)).abs(), East.value(1.0)));
    });

    test("train_classifier and predict_class works", $ => {
        // Binary classification data - well-separated clusters (need enough data for XGBoost)
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
            scale_pos_weight: variant('none', null),
        });

        // Train model
        const model = $.let(XGBoost.trainClassifier(X, y, config));

        // Predict on training data
        const y_pred = $.let(XGBoost.predictClass(model, X));

        // Check dimensions
        $(Assert.equal(y_pred.length(), 10n));

        // Check predictions are correct (data is well-separated)
        $(Assert.equal(y_pred.get(0n), 0n));  // First cluster should be class 0
        $(Assert.equal(y_pred.get(2n), 0n));
        $(Assert.equal(y_pred.get(5n), 1n));  // Second cluster should be class 1
        $(Assert.equal(y_pred.get(9n), 1n));
    });

    test("predict_proba returns probability matrix", $ => {
        // Binary classification data - well separated (need enough data for XGBoost)
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
            scale_pos_weight: variant('none', null),
        });

        // Train model
        const model = $.let(XGBoost.trainClassifier(X, y, config));

        // Get probabilities
        const proba = $.let(XGBoost.predictProba(model, X));

        // Check dimensions: 10 samples x 2 classes
        $(Assert.equal(proba.rows(), 10n));
        $(Assert.equal(proba.getRow(0n).length(), 2n));

        // First sample (class 0) should have high prob for class 0
        $(Assert.greater(proba.get(0n, 0n), East.value(0.7)));
        // Sixth sample (class 1) should have high prob for class 1
        $(Assert.greater(proba.get(5n, 1n), East.value(0.7)));

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
            min_child_weight: variant('none', null),
            subsample: variant('none', null),
            colsample_bytree: variant('none', null),
            reg_alpha: variant('none', null),
            reg_lambda: variant('none', null),
            gamma: variant('none', null),
            random_state: variant('some', 123n),
            n_jobs: variant('none', null),
            sample_weight: variant('none', null),
            categorical_features: variant('none', null),
            categorical_n: variant('none', null),
            max_cat_to_onehot: variant('none', null),
            max_cat_threshold: variant('none', null),
            scale_pos_weight: variant('none', null),
        });

        // Train two models with same seed
        const model1 = $.let(XGBoost.trainRegressor(X, y, config));
        const model2 = $.let(XGBoost.trainRegressor(X, y, config));

        // Predictions should be identical
        const pred1 = $.let(XGBoost.predict(model1, X));
        const pred2 = $.let(XGBoost.predict(model2, X));

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
            scale_pos_weight: variant('none', null),
        });

        $(Assert.throws(XGBoost.trainRegressor(X, y, config), /xgboost_train_regressor.*X has 3 samples.*y has 2 samples/));
    });

    test("error: train_classifier shape mismatch", $ => {
        const X = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]]));  // 3 samples
        const y = $.let(new BigInt64Array([0n, 1n]));  // 2 samples

        const config = $.let({
            n_estimators: variant('none', null),
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
            scale_pos_weight: variant('none', null),
        });

        $(Assert.throws(XGBoost.trainClassifier(X, y, config), /xgboost_train_classifier.*X has 3 samples.*y has 2 samples/));
    });

    test("error: predict with wrong model type", $ => {
        // Train a classifier but try to use it with regressor predict
        const X = $.let(East.Matrix.fromArray([[0.0, 0.0], [1.0, 1.0], [10.0, 10.0], [11.0, 11.0]]));
        const y = $.let(new BigInt64Array([0n, 0n, 1n, 1n]));

        const config = $.let({
            n_estimators: variant('some', 10n),
            max_depth: variant('some', 2n),
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
            scale_pos_weight: variant('none', null),
        });

        const classifierModel = $.let(XGBoost.trainClassifier(X, y, config));
        $(Assert.throws(XGBoost.predict(classifierModel, X), /xgboost_predict.*Expected xgboost_regressor.*got xgboost_classifier/));
    });

    test("error: predict_class with wrong model type", $ => {
        // Train a regressor but try to use it with classifier predict
        const X = $.let(East.Matrix.fromArray([[1.0, 1.0], [2.0, 2.0], [3.0, 3.0], [4.0, 4.0]]));
        const y = $.let(new Float64Array([2.0, 4.0, 6.0, 8.0]));

        const config = $.let({
            n_estimators: variant('some', 10n),
            max_depth: variant('some', 2n),
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
            scale_pos_weight: variant('none', null),
        });

        const regressorModel = $.let(XGBoost.trainRegressor(X, y, config));
        $(Assert.throws(XGBoost.predictClass(regressorModel, X), /xgboost_predict_class.*Expected xgboost_classifier.*got xgboost_regressor/));
    });

    test("error: predict_proba with wrong model type", $ => {
        // Train a regressor but try to use it with predict_proba
        const X = $.let(East.Matrix.fromArray([[1.0, 1.0], [2.0, 2.0], [3.0, 3.0], [4.0, 4.0]]));
        const y = $.let(new Float64Array([2.0, 4.0, 6.0, 8.0]));

        const config = $.let({
            n_estimators: variant('some', 10n),
            max_depth: variant('some', 2n),
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
            scale_pos_weight: variant('none', null),
        });

        const regressorModel = $.let(XGBoost.trainRegressor(X, y, config));
        $(Assert.throws(XGBoost.predictProba(regressorModel, X), /xgboost_predict_proba.*Expected xgboost_classifier.*got xgboost_regressor/));
    });

    test("train_quantile and predict_quantile works", $ => {
        // Linear data with noise for quantile regression
        const X = $.let(East.Matrix.fromArray([
            [1.0, 1.0],
            [2.0, 2.0],
            [3.0, 3.0],
            [4.0, 4.0],
            [5.0, 5.0],
            [6.0, 6.0],
            [7.0, 7.0],
            [8.0, 8.0],
        ]));
        const y = $.let(new Float64Array([2.0, 4.0, 6.0, 8.0, 10.0, 12.0, 14.0, 16.0]));

        const config = $.let({
            quantiles: new Float64Array([0.1, 0.5, 0.9]),  // 80% prediction interval + median
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

        // Train quantile model
        const model = $.let(XGBoost.trainQuantile(X, y, config));

        // Predict quantiles
        const result = $.let(XGBoost.predictQuantile(model, X));

        // Check result structure
        $(Assert.equal(result.quantiles.length(), 3n));  // 3 quantiles
        $(Assert.equal(result.predictions.rows(), 8n));  // 8 samples
        $(Assert.equal(result.predictions.getRow(0n).length(), 3n));  // 3 quantiles per sample

        // Check quantile values are returned correctly
        $(Assert.less(result.quantiles.get(0n).subtract(East.value(0.1)).abs(), East.value(0.01)));
        $(Assert.less(result.quantiles.get(1n).subtract(East.value(0.5)).abs(), East.value(0.01)));
        $(Assert.less(result.quantiles.get(2n).subtract(East.value(0.9)).abs(), East.value(0.01)));
    });

    test("quantile predictions maintain ordering (lower <= median <= upper)", $ => {
        // Data for quantile regression
        const X = $.let(East.Matrix.fromArray([
            [1.0, 1.0],
            [2.0, 2.0],
            [3.0, 3.0],
            [4.0, 4.0],
            [5.0, 5.0],
            [6.0, 6.0],
        ]));
        const y = $.let(new Float64Array([2.0, 4.0, 6.0, 8.0, 10.0, 12.0]));

        const config = $.let({
            quantiles: new Float64Array([0.1, 0.5, 0.9]),
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

        const model = $.let(XGBoost.trainQuantile(X, y, config));
        const result = $.let(XGBoost.predictQuantile(model, X));

        // Check first sample: q0.1 <= q0.5 <= q0.9
        const q10_0 = $.let(result.predictions.get(0n, 0n));
        const q50_0 = $.let(result.predictions.get(0n, 1n));
        const q90_0 = $.let(result.predictions.get(0n, 2n));

        $(Assert.lessEqual(q10_0, q50_0));
        $(Assert.lessEqual(q50_0, q90_0));

        // Check last sample
        const q10_5 = $.let(result.predictions.get(5n, 0n));
        const q50_5 = $.let(result.predictions.get(5n, 1n));
        const q90_5 = $.let(result.predictions.get(5n, 2n));

        $(Assert.lessEqual(q10_5, q50_5));
        $(Assert.lessEqual(q50_5, q90_5));
    });

    test("error: predict_quantile with wrong model type", $ => {
        // Train a regressor but try to use it with quantile predict
        const X = $.let(East.Matrix.fromArray([[1.0, 1.0], [2.0, 2.0], [3.0, 3.0], [4.0, 4.0]]));
        const y = $.let(new Float64Array([2.0, 4.0, 6.0, 8.0]));

        const config = $.let({
            n_estimators: variant('some', 10n),
            max_depth: variant('some', 2n),
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
            scale_pos_weight: variant('none', null),
        });

        const regressorModel = $.let(XGBoost.trainRegressor(X, y, config));
        $(Assert.throws(XGBoost.predictQuantile(regressorModel, X), /xgboost_predict_quantile.*Expected xgboost_quantile.*got xgboost_regressor/));
    });

    test("error: train_quantile with invalid quantiles", $ => {
        const X = $.let(East.Matrix.fromArray([[1.0, 1.0], [2.0, 2.0], [3.0, 3.0], [4.0, 4.0]]));
        const y = $.let(new Float64Array([2.0, 4.0, 6.0, 8.0]));

        // Quantile outside valid range (must be in (0, 1))
        const config = $.let({
            quantiles: new Float64Array([0.0, 0.5, 1.0]),  // 0.0 and 1.0 are invalid
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
        });

        $(Assert.throws(XGBoost.trainQuantile(X, y, config), /xgboost_train_quantile.*Quantiles must be in \(0, 1\)/));
    });

    test("error: train_quantile shape mismatch", $ => {
        const X = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]]));  // 3 samples
        const y = $.let(new Float64Array([1.0, 2.0]));  // 2 samples

        const config = $.let({
            quantiles: new Float64Array([0.1, 0.5, 0.9]),
            n_estimators: variant('none', null),
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
        });

        $(Assert.throws(XGBoost.trainQuantile(X, y, config), /xgboost_train_quantile.*X has 3 samples.*y has 2 samples/));
    });

    test("train_regressor with sample_weight works", $ => {
        // Data where first samples are more important
        const X = $.let(East.Matrix.fromArray([
            [1.0, 1.0],
            [2.0, 2.0],
            [3.0, 3.0],
            [4.0, 4.0],
            [5.0, 5.0],
        ]));
        const y = $.let(new Float64Array([2.0, 4.0, 6.0, 8.0, 10.0]));
        // Give higher weight to first samples
        const weights = $.let(new Float64Array([10.0, 10.0, 1.0, 1.0, 1.0]));

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
            sample_weight: variant('some', weights),
            categorical_features: variant('none', null),
            categorical_n: variant('none', null),
            max_cat_to_onehot: variant('none', null),
            max_cat_threshold: variant('none', null),
            scale_pos_weight: variant('none', null),
        });

        // Train model with sample weights
        const model = $.let(XGBoost.trainRegressor(X, y, config));

        // Predict on training data - should work
        const y_pred = $.let(XGBoost.predict(model, X));

        // Check dimensions
        $(Assert.equal(y_pred.length(), 5n));
    });

    test("error: sample_weight length mismatch", $ => {
        const X = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0]]));  // 4 samples
        const y = $.let(new Float64Array([1.0, 2.0, 3.0, 4.0]));
        const weights = $.let(new Float64Array([1.0, 1.0]));  // Only 2 weights

        const config = $.let({
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
            sample_weight: variant('some', weights),
            categorical_features: variant('none', null),
            categorical_n: variant('none', null),
            max_cat_to_onehot: variant('none', null),
            max_cat_threshold: variant('none', null),
            scale_pos_weight: variant('none', null),
        });

        $(Assert.throws(XGBoost.trainRegressor(X, y, config), /xgboost_train_regressor.*sample_weight has 2 elements.*X has 4 samples/));
    });

    // ============================================================================
    // Categorical Feature Tests
    // ============================================================================

    test("train_regressor with categorical features", $ => {
        // Feature 0: numeric, Feature 1: categorical (encoded as 0.0, 1.0, 2.0)
        // Categories have distinct target distributions
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0],  // category A
            [2.0, 0.0],  // category A
            [3.0, 1.0],  // category B
            [4.0, 1.0],  // category B
            [5.0, 2.0],  // category C
            [6.0, 2.0],  // category C
        ]));
        const y = $.let(new Float64Array([10.0, 11.0, 20.0, 21.0, 30.0, 31.0]));

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
            categorical_features: variant('some', BigInt64Array.of(1n)),  // Column 1 is categorical
            categorical_n: variant('none', null),
            max_cat_to_onehot: variant('none', null),
            max_cat_threshold: variant('none', null),
            scale_pos_weight: variant('none', null),
        });

        const model = $.let(XGBoost.trainRegressor(X, y, config));
        const y_pred = $.let(XGBoost.predict(model, X));

        // Check dimensions
        $(Assert.equal(y_pred.length(), 6n));
    });

    test("train_classifier with categorical features", $ => {
        // Feature 0: numeric, Feature 1: categorical (encoded as 0.0, 1.0)
        const X = $.let(East.Matrix.fromArray([
            [0.0, 0.0],
            [0.5, 0.0],
            [1.0, 0.0],
            [1.5, 0.0],
            [10.0, 1.0],
            [10.5, 1.0],
            [11.0, 1.0],
            [11.5, 1.0],
        ]));
        const y = $.let(new BigInt64Array([0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n]));

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
            categorical_features: variant('some', BigInt64Array.of(1n)),  // Column 1 is categorical
            categorical_n: variant('none', null),
            max_cat_to_onehot: variant('none', null),
            max_cat_threshold: variant('none', null),
            scale_pos_weight: variant('none', null),
        });

        const model = $.let(XGBoost.trainClassifier(X, y, config));
        const y_pred = $.let(XGBoost.predictClass(model, X));

        // Check dimensions
        $(Assert.equal(y_pred.length(), 8n));

        // Check predictions - well separated data should classify correctly
        $(Assert.equal(y_pred.get(0n), 0n));
        $(Assert.equal(y_pred.get(7n), 1n));
    });

    test("train_quantile with categorical features", $ => {
        // Feature 0: numeric, Feature 1: categorical
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0],
            [2.0, 0.0],
            [3.0, 1.0],
            [4.0, 1.0],
            [5.0, 2.0],
            [6.0, 2.0],
        ]));
        const y = $.let(new Float64Array([10.0, 11.0, 20.0, 21.0, 30.0, 31.0]));

        const config = $.let({
            quantiles: new Float64Array([0.1, 0.5, 0.9]),
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
            categorical_features: variant('some', BigInt64Array.of(1n)),
            categorical_n: variant('none', null),
            max_cat_to_onehot: variant('none', null),
            max_cat_threshold: variant('none', null),
        });

        const model = $.let(XGBoost.trainQuantile(X, y, config));
        const result = $.let(XGBoost.predictQuantile(model, X));

        // Check dimensions
        $(Assert.equal(result.quantiles.length(), 3n));
        $(Assert.equal(result.predictions.rows(), 6n));
    });

    test("categorical with custom max_cat_to_onehot", $ => {
        // High-cardinality categorical (10 categories)
        const X = $.let(East.Matrix.fromArray([
            [1.0, 0.0], [2.0, 1.0], [3.0, 2.0], [4.0, 3.0], [5.0, 4.0],
            [6.0, 5.0], [7.0, 6.0], [8.0, 7.0], [9.0, 8.0], [10.0, 9.0],
        ]));
        const y = $.let(new Float64Array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]));

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
            categorical_features: variant('some', BigInt64Array.of(1n)),
            categorical_n: variant('none', null),
            max_cat_to_onehot: variant('some', 8n),  // Force one-hot for up to 8 categories
            max_cat_threshold: variant('some', 32n),
            scale_pos_weight: variant('none', null),
        });

        const model = $.let(XGBoost.trainRegressor(X, y, config));
        const y_pred = $.let(XGBoost.predict(model, X));
        $(Assert.equal(y_pred.length(), 10n));
    });

    test("error: categorical_features index out of bounds", $ => {
        const X = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0]]));  // 2 features
        const y = $.let(new Float64Array([1.0, 2.0, 3.0, 4.0]));

        const config = $.let({
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
            categorical_features: variant('some', BigInt64Array.of(5n)),  // Invalid: only 2 features
            categorical_n: variant('none', null),
            max_cat_to_onehot: variant('none', null),
            max_cat_threshold: variant('none', null),
            scale_pos_weight: variant('none', null),
        });

        $(Assert.throws(XGBoost.trainRegressor(X, y, config), /categorical_features index 5 out of bounds/));
    });

    test("error: categorical column contains non-integer value", $ => {
        // Categorical values must be whole numbers (0.0, 1.0, 2.0, ...)
        const X = $.let(East.Matrix.fromArray([
            [0.5, 10.0],  // 0.5 is not a valid category index
            [1.0, 20.0],
            [2.0, 30.0],
            [0.0, 40.0],
        ]));
        const y = $.let(new Float64Array([1.0, 2.0, 3.0, 4.0]));

        const config = $.let({
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
            categorical_features: variant('some', BigInt64Array.of(0n)),  // Column 0 has non-integer values
            categorical_n: variant('none', null),
            max_cat_to_onehot: variant('none', null),
            max_cat_threshold: variant('none', null),
            scale_pos_weight: variant('none', null),
        });

        $(Assert.throws(XGBoost.trainRegressor(X, y, config), /categorical column 0 contains non-integer value 0\.5/));
    });

    test("categorical_n handles different category subsets at train vs predict time", $ => {
        // 2 categorical features (columns 0 and 1), each with 8 possible categories [0..7]
        // Training sees subset: col0 in {0,1,2,3}, col1 in {0,1,2}
        // Prediction sees different subset: col0 in {0,2,5,7}, col1 in {1,3,6}
        // Without categorical_n, pandas creates different category codes -> crash
        const X_train = $.let(East.Matrix.fromArray([
            [0.0, 0.0, 10.0], [1.0, 1.0, 20.0], [2.0, 2.0, 30.0], [3.0, 0.0, 40.0],
            [0.0, 1.0, 15.0], [1.0, 2.0, 25.0], [2.0, 0.0, 35.0], [3.0, 1.0, 45.0],
            [0.0, 2.0, 12.0], [1.0, 0.0, 22.0], [2.0, 1.0, 32.0], [3.0, 2.0, 42.0],
        ]));
        const y_train = $.let(new Float64Array([1.0, 2.0, 3.0, 4.0, 1.5, 2.5, 3.5, 4.5, 1.2, 2.2, 3.2, 4.2]));

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
            categorical_features: variant('some', BigInt64Array.of(0n, 1n)),
            categorical_n: variant('some', BigInt64Array.of(8n, 8n)),  // 8 categories each [0..7]
            max_cat_to_onehot: variant('none', null),
            max_cat_threshold: variant('none', null),
            scale_pos_weight: variant('none', null),
        });

        const model = $.let(XGBoost.trainRegressor(X_train, y_train, config));

        // Predict with a different subset of categories — includes unseen values
        // col0: 0 (seen), 2 (seen), 5 (unseen), 7 (unseen)
        // col1: 1 (seen), 3 (unseen), 6 (unseen), 1 (seen)
        const X_test = $.let(East.Matrix.fromArray([
            [0.0, 1.0, 20.0],
            [2.0, 3.0, 20.0],
            [5.0, 6.0, 20.0],
            [7.0, 1.0, 20.0],
        ]));
        const y_pred = $.let(XGBoost.predict(model, X_test));

        // Must not crash and must return 4 predictions
        $(Assert.equal(y_pred.length(), 4n));
    });

    // ============================================================================
    // Interchange: a model trained on one runner predicts on the other
    // ============================================================================

    test("interchange: a regressor east-py-datascience trained predicts the same here", $ => {
        const model = $.const(fixtureModel(FIXTURE.regressor.model), XGBoostModelBlobType);
        const X = $.let(East.Matrix.fromArray(FIXTURE.regressor.X));
        const pred = $.let(XGBoost.predict(model, X));
        $(Assert.equal(pred.length(), BigInt(FIXTURE.regressor.predictions.length)));
        FIXTURE.regressor.predictions.forEach((expected, i) => {
            $(Assert.less(pred.get(BigInt(i)).subtract(East.value(expected)).abs(), East.value(1e-6)));
        });
    });

    test("interchange: a classifier east-py-datascience trained predicts the same here", $ => {
        const model = $.const(fixtureModel(FIXTURE.classifier.model), XGBoostModelBlobType);
        const X = $.let(East.Matrix.fromArray(FIXTURE.classifier.X));
        const classes = $.let(XGBoost.predictClass(model, X));
        const proba = $.let(XGBoost.predictProba(model, X));
        FIXTURE.classifier.classes.forEach((expected, i) => {
            $(Assert.equal(classes.get(BigInt(i)), BigInt(expected)));
        });
        $(Assert.equal(proba.rows(), BigInt(FIXTURE.classifier.probabilities.length)));
        FIXTURE.classifier.probabilities.forEach((row, r) => {
            row.forEach((expected, c) => {
                $(Assert.less(proba.get(BigInt(r), BigInt(c)).subtract(East.value(expected)).abs(), East.value(1e-6)));
            });
        });
    });

    test("interchange: a quantile model east-py-datascience trained predicts the same here", $ => {
        const model = $.const(fixtureModel(FIXTURE.quantile.model), XGBoostModelBlobType);
        const X = $.let(East.Matrix.fromArray(FIXTURE.quantile.X));
        const result = $.let(XGBoost.predictQuantile(model, X));
        // The quantiles come back ascending, whatever order they were trained in
        FIXTURE.quantile.quantiles.forEach((q, i) => {
            $(Assert.equal(result.quantiles.get(BigInt(i)), East.value(q)));
        });
        FIXTURE.quantile.predictions.forEach((row, r) => {
            row.forEach((expected, c) => {
                $(Assert.less(result.predictions.get(BigInt(r), BigInt(c)).subtract(East.value(expected)).abs(), East.value(1e-6)));
            });
        });
    });

    test("interchange: training the fixture's regressor here predicts within tolerance of the python runner's", $ => {
        // The same data, hyperparameters and seed on the same library version:
        // the two runners' models agree to floating point, where the sum order
        // of a histogram may differ.
        const train = FIXTURE.regressor.train;
        const X = $.let(East.Matrix.fromArray(train.X));
        const y = $.let(Float64Array.from(train.y));
        const config = $.let({
            n_estimators: some(BigInt(train.n_estimators)),
            max_depth: some(BigInt(train.max_depth)),
            learning_rate: some(train.learning_rate),
            min_child_weight: none,
            subsample: none,
            colsample_bytree: none,
            reg_alpha: none,
            reg_lambda: none,
            gamma: none,
            random_state: some(BigInt(train.random_state)),
            n_jobs: none,
            sample_weight: none,
            categorical_features: integerVector(train.categorical_features),
            categorical_n: integerVector(train.categorical_n),
            max_cat_to_onehot: none,
            max_cat_threshold: none,
            scale_pos_weight: none,
        }, XGBoostConfigType);
        const model = $.let(XGBoost.trainRegressor(X, y, config));
        const pred = $.let(XGBoost.predict(model, $.let(East.Matrix.fromArray(FIXTURE.regressor.X))));
        FIXTURE.regressor.predictions.forEach((expected, i) => {
            $(Assert.less(pred.get(BigInt(i)).subtract(East.value(expected)).abs(), East.value(1e-3)));
        });
    });
}, { exportOnly: true });
