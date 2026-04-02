/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, variant, example } from "@elaraai/east";
import { Shap, XGBoost, GP } from "@elaraai/east-py-datascience";

export const shapTreeExplainer = example({
    keywords: ["shap", "treeExplainerCreate", "computeValues", "featureImportance", "XGBoost", "tree", "sensor", "failure"],
    description: "Explain which sensor features drive failure predictions from a trained XGBoost model",
    fn: East.function([], BooleanType, ($) => {
        // Sensor data: vibration, temperature → failure score
        const X_train = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
            [5.0, 6.0],
            [6.0, 7.0],
            [7.0, 8.0],
            [8.0, 9.0],
        ]));
        const y_train = $.let(East.Vector.fromArray([3.0, 5.0, 7.0, 9.0, 11.0, 13.0, 15.0, 17.0]));

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
        }, XGBoost.Types.XGBoostConfigType);

        const model = $.let(XGBoost.trainRegressor(X_train, y_train, config));
        const explainer = $.let(Shap.treeExplainerCreate(model));

        const feature_names = $.let(["vibration", "temperature"]);
        const shap_result = $.let(Shap.computeValues(explainer, X_train, feature_names));

        // Get feature importance ranking
        const importance = $.let(Shap.featureImportance(shap_result.shap_values, feature_names));

        // 2 features explained with non-negative importances
        return importance.importances.length().equal(2n)
            .and(() => importance.importances.get(0n).greaterEqual(0.0))
            .and(() => importance.feature_names.length().equal(2n));
    }),
    inputs: [],
    returns: true,
});

export const shapKernelExplainer = example({
    keywords: ["shap", "kernelExplainerCreate", "computeValues", "GP", "kernel", "model-agnostic", "anomaly", "process"],
    description: "Explain a GP model's anomalous process reading predictions using model-agnostic SHAP",
    fn: East.function([], BooleanType, ($) => {
        // Process readings: pressure, flow_rate → anomaly score
        const X_train = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [2.0, 3.0],
            [3.0, 4.0],
            [4.0, 5.0],
            [5.0, 6.0],
        ]));
        const y_train = $.let(East.Vector.fromArray([3.0, 5.0, 7.0, 9.0, 11.0]));

        const gp_config = $.let({
            kernel: variant('some', variant('rbf', null)),
            alpha: variant('some', 1e-10),
            n_restarts_optimizer: variant('some', 0n),
            normalize_y: variant('some', true),
            random_state: variant('some', 42n),
        }, GP.Types.GPConfigType);

        const model = $.let(GP.train(X_train, y_train, gp_config));

        // Background data for KernelExplainer
        const X_background = $.let(East.Matrix.fromArray([
            [1.0, 2.0],
            [3.0, 4.0],
            [5.0, 6.0],
        ]));
        const explainer = $.let(Shap.kernelExplainerCreate(model, X_background));

        // Explain 2 new process readings
        const feature_names = $.let(["pressure", "flow_rate"]);
        const X_explain = $.let(East.Matrix.fromArray([
            [2.0, 3.0],
            [4.0, 5.0],
        ]));
        const result = $.let(Shap.computeValues(explainer, X_explain, feature_names));

        // 2 features explained for 2 samples
        return result.feature_names.length().equal(2n);
    }),
    inputs: [],
    returns: true,
});
