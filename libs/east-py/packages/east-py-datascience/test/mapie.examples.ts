/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, variant, example } from "@elaraai/east";
import { MAPIE } from "@elaraai/east-py-datascience";

export const mapieConformalRegressor = example({
    keywords: ["mapie", "trainConformalRegressor", "predictInterval", "conformal", "prediction interval", "coverage", "delivery time"],
    description: "Predict delivery time with guaranteed 90% coverage prediction interval",
    fn: East.function([], BooleanType, ($) => {
        // Historical delivery data: distance (km)
        const X_train = $.let(East.Matrix.fromArray([
            [10.0], [20.0], [30.0], [40.0], [50.0],
            [60.0], [70.0], [80.0], [90.0], [100.0],
        ]));
        const y_train = $.let(East.Vector.fromArray([15.0, 25.0, 35.0, 45.0, 55.0, 65.0, 75.0, 85.0, 95.0, 105.0]));

        // Calibration data for conformal coverage
        const X_calib = $.let(East.Matrix.fromArray([
            [15.0], [25.0], [35.0], [45.0], [55.0],
            [65.0], [75.0], [85.0], [95.0], [105.0], [110.0],
        ]));
        const y_calib = $.let(East.Vector.fromArray([20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0, 100.0, 110.0, 115.0]));

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
                scale_pos_weight: variant('none', null),
            }),
            method: variant('some', variant('split', null)),
            confidence_level: variant('some', 0.9),
            cv_folds: variant('none', null),
            random_state: variant('some', 42n),
            conformity_eps: variant('none', null),
        }, MAPIE.Types.MAPIEConfigType);

        const model = $.let(MAPIE.trainConformalRegressor(X_train, y_train, X_calib, y_calib, config));

        // Predict intervals for new deliveries
        const X_new = $.let(East.Matrix.fromArray([[25.0], [75.0]]));
        const result = $.let(MAPIE.predictInterval(model, X_new));

        // 2 predictions with lower ≤ pred ≤ upper
        return result.pred.length().equal(2n)
            .and(() => result.lower.get(0n).lessEqual(result.pred.get(0n)))
            .and(() => result.pred.get(0n).lessEqual(result.upper.get(0n)));
    }),
    inputs: [],
    returns: true,
});

export const mapieCqr = example({
    keywords: ["mapie", "trainCQR", "predictInterval", "CQR", "conformalized quantile regression", "asymmetric", "processing duration"],
    description: "Predict processing duration with conformalized quantile regression for asymmetric intervals",
    fn: East.function([], BooleanType, ($) => {
        // Processing time data: batch size
        const X_train = $.let(East.Matrix.fromArray([
            [10.0], [20.0], [30.0], [40.0], [50.0],
            [60.0], [70.0], [80.0], [90.0], [100.0],
            [110.0], [120.0], [130.0], [140.0], [150.0],
        ]));
        const y_train = $.let(East.Vector.fromArray([12.0, 21.0, 33.0, 40.0, 55.0, 62.0, 78.0, 81.0, 99.0, 102.0, 113.0, 121.0, 134.0, 140.0, 155.0]));

        const X_calib = $.let(East.Matrix.fromArray([
            [25.0], [45.0], [65.0], [85.0], [105.0], [125.0],
        ]));
        const y_calib = $.let(East.Vector.fromArray([28.0, 46.0, 69.0, 87.0, 108.0, 126.0]));

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
                scale_pos_weight: variant('none', null),
            },
            confidence_level: variant('some', 0.9),
            random_state: variant('some', 42n),
        }, MAPIE.Types.MAPIECQRConfigType);

        const model = $.let(MAPIE.trainCQR(X_train, y_train, X_calib, y_calib, config));

        const X_new = $.let(East.Matrix.fromArray([[35.0], [95.0]]));
        const result = $.let(MAPIE.predictInterval(model, X_new));

        // 2 predictions with valid intervals
        return result.pred.length().equal(2n)
            .and(() => result.lower.get(0n).lessEqual(result.upper.get(0n)));
    }),
    inputs: [],
    returns: true,
});

export const mapieConformalClassifier = example({
    keywords: ["mapie", "trainConformalClassifier", "predictSet", "conformal", "classification", "prediction set", "defect", "coverage"],
    description: "Classify defect type with prediction sets that have guaranteed coverage",
    fn: East.function([], BooleanType, ($) => {
        // Defect classification: 2 sensor features, binary class (0=ok, 1=defect)
        const X_train = $.let(East.Matrix.fromArray([
            [1.0, 0.0], [1.2, 0.2], [1.4, 0.4], [1.6, 0.6], [1.8, 0.8], [2.0, 1.0],
            [3.0, 3.0], [3.2, 3.2], [3.4, 3.4], [3.6, 3.6], [3.8, 3.8], [4.0, 4.0],
        ]));
        const y_train = $.let(East.Vector.fromArray([0n, 0n, 0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 1n, 1n]));

        // Calibration data (≥11 samples for 90% confidence)
        const X_calib = $.let(East.Matrix.fromArray([
            [1.1, 0.1], [1.3, 0.3], [1.5, 0.5], [1.7, 0.7], [1.9, 0.9],
            [3.1, 3.1], [3.3, 3.3], [3.5, 3.5], [3.7, 3.7], [3.9, 3.9], [4.1, 4.1],
        ]));
        const y_calib = $.let(East.Vector.fromArray([0n, 0n, 0n, 0n, 0n, 1n, 1n, 1n, 1n, 1n, 1n]));

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
                scale_pos_weight: variant('none', null),
            }),
            method: variant('some', variant('lac', null)),
            confidence_level: variant('some', 0.9),
            random_state: variant('some', 42n),
        }, MAPIE.Types.MAPIEClassifierConfigType);

        const model = $.let(MAPIE.trainConformalClassifier(X_train, y_train, X_calib, y_calib, config));

        const X_new = $.let(East.Matrix.fromArray([[1.0, 0.0], [4.0, 4.0]]));
        const result = $.let(MAPIE.predictSet(model, X_new));

        // 2 predictions, each set has ≥1 class
        return result.pred.length().equal(2n)
            .and(() => result.set_sizes.get(0n).greaterEqual(1n))
            .and(() => result.set_sizes.get(1n).greaterEqual(1n));
    }),
    inputs: [],
    returns: true,
});
