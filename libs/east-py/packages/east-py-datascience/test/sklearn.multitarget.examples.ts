/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, variant, example } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

export const sklearnRegressorChain = example({
    keywords: ["sklearn", "regressorChainTrain", "regressorChainPredict", "multi-target", "chained", "hardness", "tensile", "elongation"],
    description: "Train chained regressor to predict multiple correlated quality metrics from process params",
    fn: East.function([], IntegerType, ($) => {
        // Process parameters: temperature, pressure
        const X = $.let(East.Matrix.fromArray([
            [200.0, 5.0],
            [220.0, 6.0],
            [240.0, 7.0],
            [260.0, 8.0],
            [280.0, 9.0],
        ]));
        // Quality metrics: hardness, tensile strength, elongation
        const Y = $.let(East.Matrix.fromArray([
            [45.0, 350.0, 12.0],
            [50.0, 380.0, 10.0],
            [55.0, 410.0, 8.0],
            [60.0, 440.0, 6.0],
            [65.0, 470.0, 4.0],
        ]));

        const config = $.let({
            base_estimator: variant('xgboost', {
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
            order: variant('none', null),
            random_state: variant('some', 42n),
        }, Sklearn.Types.RegressorChainConfigType);

        const model = $.let(Sklearn.regressorChainTrain(X, Y, config));
        const predictions = $.let(Sklearn.regressorChainPredict(model, X));

        // 5 samples × 3 targets
        return predictions.rows();
    }),
    inputs: [],
    returns: 5n,
});
