/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, IntegerType, variant, example } from "@elaraai/east";
import { Sklearn } from "@elaraai/east-py-datascience";

export const sklearnRegressionMetrics = example({
    keywords: ["sklearn", "computeMetrics", "regression", "MAE", "RMSE", "lead time", "prediction"],
    description: "Compute MAE and RMSE for a lead time prediction model",
    fn: East.function([], IntegerType, ($) => {
        // Actual vs predicted lead times (days)
        const y_true = $.let(East.Vector.fromArray([5.0, 8.0, 12.0, 3.0, 7.0]));
        const y_pred = $.let(East.Vector.fromArray([5.5, 7.5, 11.0, 3.5, 7.2]));

        const results = $.let(Sklearn.computeMetrics(
            y_true,
            y_pred,
            [variant('mae', null), variant('rmse', null)]
        ));

        // 2 metrics computed
        return results.length();
    }),
    inputs: [],
    returns: 2n,
});

export const sklearnMultiMetrics = example({
    keywords: ["sklearn", "computeMetricsMulti", "multi-target", "per_target", "train", "validation", "test"],
    description: "Evaluate model across train/validation/test splits in one call",
    fn: East.function([], IntegerType, ($) => {
        // Multi-target: actual vs predicted for 2 outputs
        const Y_true = $.let(East.Matrix.fromArray([
            [10.0, 100.0],
            [20.0, 200.0],
            [30.0, 300.0],
            [40.0, 400.0],
            [50.0, 500.0],
        ]));
        const Y_pred = $.let(East.Matrix.fromArray([
            [11.0, 105.0],
            [19.0, 195.0],
            [31.0, 310.0],
            [39.0, 390.0],
            [51.0, 505.0],
        ]));

        const config = $.let({
            aggregation: variant('some', variant('per_target', null)),
        }, Sklearn.Types.MultiMetricsConfigType);

        const results = $.let(Sklearn.computeMetricsMulti(
            Y_true,
            Y_pred,
            [variant('mse', null), variant('r2', null)],
            config
        ));

        // 2 metrics computed
        return results.length();
    }),
    inputs: [],
    returns: 2n,
});

export const sklearnClassificationMetrics = example({
    keywords: ["sklearn", "computeClassificationMetrics", "precision", "recall", "F1", "defect", "classifier"],
    description: "Compute precision, recall, F1 for a defect detection classifier",
    fn: East.function([], IntegerType, ($) => {
        // True labels and predictions for 3-class defect detection
        // 0 = no defect, 1 = minor, 2 = major
        const y_true = $.let(East.Vector.fromArray([0n, 0n, 1n, 1n, 2n, 2n]));
        const y_pred = $.let(East.Vector.fromArray([0n, 0n, 1n, 1n, 2n, 2n]));

        const config = $.let({
            average: variant('some', variant('macro', null)),
        }, Sklearn.Types.ClassificationMetricsConfigType);

        const results = $.let(Sklearn.computeClassificationMetrics(
            y_true,
            y_pred,
            [variant('accuracy', null), variant('f1', null)],
            config
        ));

        // 2 classification metrics computed
        return results.length();
    }),
    inputs: [],
    returns: 2n,
});

export const sklearnConfusionMatrix = example({
    keywords: ["sklearn", "confusionMatrix", "confusion", "matrix", "classification", "fault", "equipment"],
    description: "Build confusion matrix for equipment fault type classification",
    fn: East.function([], IntegerType, ($) => {
        // Fault type classification: 0 = normal, 1 = bearing, 2 = misalignment
        const y_true = $.let(East.Vector.fromArray([0n, 0n, 1n, 1n, 2n, 2n]));
        const y_pred = $.let(East.Vector.fromArray([0n, 0n, 1n, 1n, 2n, 2n]));

        const result = $.let(Sklearn.confusionMatrix(y_true, y_pred));

        // 3×3 confusion matrix for 3 fault types
        return result.matrix.rows();
    }),
    inputs: [],
    returns: 3n,
});

export const sklearnRocAuc = example({
    keywords: ["sklearn", "rocAucScore", "ROC", "AUC", "binary", "quality gate", "pass/fail"],
    description: "Compute ROC-AUC score for a binary quality gate pass/fail classifier",
    fn: East.function([], BooleanType, ($) => {
        // Binary quality gate: 0 = fail, 1 = pass
        const y_true = $.let(East.Vector.fromArray([0n, 0n, 1n, 1n]));
        // Predicted probabilities: [P(fail), P(pass)]
        const y_proba = $.let(East.Matrix.fromArray([
            [0.9, 0.1],
            [0.8, 0.2],
            [0.2, 0.8],
            [0.1, 0.9],
        ]));

        const config = $.let({
            multi_class: variant('none', null),
            average: variant('none', null),
        }, Sklearn.Types.RocAucConfigType);

        const score = $.let(Sklearn.rocAucScore(y_true, y_proba, config));

        // Perfect predictions should yield AUC > 0.9
        return score.greater(0.9);
    }),
    inputs: [],
    returns: true,
});
