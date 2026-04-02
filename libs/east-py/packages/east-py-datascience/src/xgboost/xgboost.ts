/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * XGBoost platform functions for East.
 *
 * Provides gradient boosting for regression and classification.
 * Uses ONNX for model serialization to enable portable inference.
 *
 * @packageDocumentation
 */

import {
    East,
    StructType,
    VariantType,
    OptionType,
    IntegerType,
    FloatType,
    BlobType,
} from "@elaraai/east";
import { VectorType, MatrixType } from "../types.js";

// Re-export shared types for convenience
export { VectorType, MatrixType } from "../types.js";

// ============================================================================
// Config Types
// ============================================================================

/**
 * Configuration for XGBoost models.
 */
export const XGBoostConfigType = StructType({
    /** Number of boosting rounds (default 100) */
    n_estimators: OptionType(IntegerType),
    /** Maximum tree depth (default 6) */
    max_depth: OptionType(IntegerType),
    /** Learning rate / step size shrinkage (default 0.3) */
    learning_rate: OptionType(FloatType),
    /** Minimum sum of instance weight needed in a child (default 1) */
    min_child_weight: OptionType(IntegerType),
    /** Subsample ratio of training instances (default 1.0) */
    subsample: OptionType(FloatType),
    /** Subsample ratio of columns when constructing trees (default 1.0) */
    colsample_bytree: OptionType(FloatType),
    /** L1 regularization term (default 0) */
    reg_alpha: OptionType(FloatType),
    /** L2 regularization term (default 1) */
    reg_lambda: OptionType(FloatType),
    /** Minimum loss reduction required to make a further partition (default 0) */
    gamma: OptionType(FloatType),
    /** Random seed for reproducibility */
    random_state: OptionType(IntegerType),
    /** Number of parallel threads (default -1 for all cores) */
    n_jobs: OptionType(IntegerType),
    /** Sample weights for training (one per sample, default uniform) */
    sample_weight: OptionType(VectorType(FloatType)),
    /** Column indices that contain categorical features (0-indexed) */
    categorical_features: OptionType(VectorType(IntegerType)),
    /** Number of categories per categorical feature (one per entry in categorical_features).
     *  Used to set explicit pandas Categorical range at both train and predict time,
     *  ensuring consistent category spaces. Values outside [0, n) become NaN at predict
     *  time, which XGBoost handles natively via learned default branch directions. */
    categorical_n: OptionType(VectorType(IntegerType)),
    /** Max categories for one-hot encoding (default 4). Features with more categories use partition-based splits. */
    max_cat_to_onehot: OptionType(IntegerType),
    /** Max categories considered per split for partition-based method (default 64). */
    max_cat_threshold: OptionType(IntegerType),
});

/**
 * Configuration for XGBoost quantile regression.
 * Trains separate models for each quantile.
 */
export const XGBoostQuantileConfigType = StructType({
    /** Quantiles to predict (e.g., [0.1, 0.5, 0.9] for 80% interval + median) */
    quantiles: VectorType(FloatType),
    /** Number of boosting rounds (default 100) */
    n_estimators: OptionType(IntegerType),
    /** Maximum tree depth (default 6) */
    max_depth: OptionType(IntegerType),
    /** Learning rate / step size shrinkage (default 0.3) */
    learning_rate: OptionType(FloatType),
    /** Minimum sum of instance weight needed in a child (default 1) */
    min_child_weight: OptionType(IntegerType),
    /** Subsample ratio of training instances (default 1.0) */
    subsample: OptionType(FloatType),
    /** Subsample ratio of columns when constructing trees (default 1.0) */
    colsample_bytree: OptionType(FloatType),
    /** L1 regularization term (default 0) */
    reg_alpha: OptionType(FloatType),
    /** L2 regularization term (default 1) */
    reg_lambda: OptionType(FloatType),
    /** Minimum loss reduction required to make a further partition (default 0) */
    gamma: OptionType(FloatType),
    /** Random seed for reproducibility */
    random_state: OptionType(IntegerType),
    /** Number of parallel threads (default -1 for all cores) */
    n_jobs: OptionType(IntegerType),
    /** Sample weights for training (one per sample, default uniform) */
    sample_weight: OptionType(VectorType(FloatType)),
    /** Column indices that contain categorical features (0-indexed) */
    categorical_features: OptionType(VectorType(IntegerType)),
    /** Number of categories per categorical feature (one per entry in categorical_features).
     *  Used to set explicit pandas Categorical range at both train and predict time,
     *  ensuring consistent category spaces. Values outside [0, n) become NaN at predict
     *  time, which XGBoost handles natively via learned default branch directions. */
    categorical_n: OptionType(VectorType(IntegerType)),
    /** Max categories for one-hot encoding (default 4). Features with more categories use partition-based splits. */
    max_cat_to_onehot: OptionType(IntegerType),
    /** Max categories considered per split for partition-based method (default 64). */
    max_cat_threshold: OptionType(IntegerType),
});

// ============================================================================
// Model Blob Types
// ============================================================================

/**
 * Model blob type for serialized XGBoost models.
 *
 * Each model type has its own variant case containing cloudpickle bytes and metadata.
 */
export const XGBoostModelBlobType = VariantType({
    /** XGBoost regressor model */
    xgboost_regressor: StructType({
        /** Cloudpickle serialized model */
        data: BlobType,
        /** Number of input features */
        n_features: IntegerType,
        /** Column indices of categorical features (for prediction) */
        categorical_features: OptionType(VectorType(IntegerType)),
        /** Number of categories per categorical feature (for consistent category space) */
        categorical_n: OptionType(VectorType(IntegerType)),
    }),
    /** XGBoost classifier model */
    xgboost_classifier: StructType({
        /** Cloudpickle serialized model */
        data: BlobType,
        /** Number of input features */
        n_features: IntegerType,
        /** Number of classes */
        n_classes: IntegerType,
        /** Column indices of categorical features (for prediction) */
        categorical_features: OptionType(VectorType(IntegerType)),
        /** Number of categories per categorical feature (for consistent category space) */
        categorical_n: OptionType(VectorType(IntegerType)),
    }),
    /** XGBoost quantile regressor (multiple models, one per quantile) */
    xgboost_quantile: StructType({
        /** Cloudpickle serialized dict of {quantile: model} */
        data: BlobType,
        /** Quantiles this model predicts */
        quantiles: VectorType(FloatType),
        /** Number of input features */
        n_features: IntegerType,
        /** Column indices of categorical features (for prediction) */
        categorical_features: OptionType(VectorType(IntegerType)),
        /** Number of categories per categorical feature (for consistent category space) */
        categorical_n: OptionType(VectorType(IntegerType)),
    }),
});

/**
 * Result from XGBoost quantile prediction.
 */
export const XGBoostQuantilePredictResultType = StructType({
    /** Quantile values that were predicted */
    quantiles: VectorType(FloatType),
    /** Predictions matrix: (n_samples x n_quantiles) */
    predictions: MatrixType(FloatType),
});

// ============================================================================
// Platform Functions
// ============================================================================

/**
 * Train an XGBoost regression model.
 *
 * @param X - Feature matrix
 * @param y - Target vector
 * @param config - XGBoost configuration
 * @returns Model blob containing trained regressor
 */
export const xgboost_train_regressor = East.platform(
    "xgboost_train_regressor",
    [MatrixType(FloatType), VectorType(FloatType), XGBoostConfigType],
    XGBoostModelBlobType
);

/**
 * Train an XGBoost classification model.
 *
 * @param X - Feature matrix
 * @param y - Label vector (integer class labels)
 * @param config - XGBoost configuration
 * @returns Model blob containing trained classifier
 */
export const xgboost_train_classifier = East.platform(
    "xgboost_train_classifier",
    [MatrixType(FloatType), VectorType(IntegerType), XGBoostConfigType],
    XGBoostModelBlobType
);

/**
 * Make predictions with a trained XGBoost regressor.
 *
 * @param model - Trained regressor model blob
 * @param X - Feature matrix
 * @returns Predicted values
 */
export const xgboost_predict = East.platform(
    "xgboost_predict",
    [XGBoostModelBlobType, MatrixType(FloatType)],
    VectorType(FloatType)
);

/**
 * Predict class labels with a trained XGBoost classifier.
 *
 * @param model - Trained classifier model blob
 * @param X - Feature matrix
 * @returns Predicted class labels
 */
export const xgboost_predict_class = East.platform(
    "xgboost_predict_class",
    [XGBoostModelBlobType, MatrixType(FloatType)],
    VectorType(IntegerType)
);

/**
 * Get class probabilities from a trained XGBoost classifier.
 *
 * @param model - Trained classifier model blob
 * @param X - Feature matrix
 * @returns Probability matrix (n_samples x n_classes)
 */
export const xgboost_predict_proba = East.platform(
    "xgboost_predict_proba",
    [XGBoostModelBlobType, MatrixType(FloatType)],
    MatrixType(FloatType)
);

/**
 * Train XGBoost quantile regression models.
 *
 * Trains one model per quantile using pinball loss (reg:quantileerror).
 * This provides prediction intervals and uncertainty quantification.
 *
 * @param X - Feature matrix
 * @param y - Target vector
 * @param config - Quantile regression configuration (includes quantiles array)
 * @returns Model blob containing trained quantile models
 */
export const xgboost_train_quantile = East.platform(
    "xgboost_train_quantile",
    [MatrixType(FloatType), VectorType(FloatType), XGBoostQuantileConfigType],
    XGBoostModelBlobType
);

/**
 * Predict quantiles with trained XGBoost quantile regressor.
 *
 * @param model - Trained quantile model blob
 * @param X - Feature matrix
 * @returns Quantiles and predictions matrix (n_samples x n_quantiles)
 */
export const xgboost_predict_quantile = East.platform(
    "xgboost_predict_quantile",
    [XGBoostModelBlobType, MatrixType(FloatType)],
    XGBoostQuantilePredictResultType
);

// ============================================================================
// Grouped Export
// ============================================================================

/**
 * Type definitions for XGBoost functions.
 */
export const XGBoostTypes = {
    /** XGBoost configuration type */
    XGBoostConfigType,
    /** XGBoost quantile configuration type */
    XGBoostQuantileConfigType,
    /** Quantile prediction result type */
    XGBoostQuantilePredictResultType,
    /** Model blob type for XGBoost models */
    ModelBlobType: XGBoostModelBlobType,
} as const;

/**
 * XGBoost gradient boosting.
 *
 * Provides regression and classification with gradient boosted decision trees.
 *
 * @example
 * ```ts
 * import { East, variant } from "@elaraai/east";
 * import { XGBoost } from "@elaraai/east-py-datascience";
 *
 * const train = East.function([], XGBoost.Types.ModelBlobType, $ => {
 *     const X = $.let([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0]]);
 *     const y = $.let([1.0, 2.0, 3.0, 4.0]);
 *     const config = $.let({
 *         n_estimators: variant('some', 100n),
 *         max_depth: variant('some', 3n),
 *         learning_rate: variant('some', 0.1),
 *         min_child_weight: variant('none', null),
 *         subsample: variant('none', null),
 *         colsample_bytree: variant('none', null),
 *         reg_alpha: variant('none', null),
 *         reg_lambda: variant('none', null),
 *         random_state: variant('some', 42n),
 *         n_jobs: variant('none', null),
 *         sample_weight: variant('none', null),
 *     });
 *     return $.return(XGBoost.trainRegressor(X, y, config));
 * });
 * ```
 */
export const XGBoost = {
    /**
     * Train an XGBoost regression model.
     *
     * @example
     * ```ts
     * import { East, FloatType, MatrixType, VectorType, variant } from "@elaraai/east";
     * import { XGBoost, XGBoostConfigType } from "@elaraai/east-py-datascience";
     *
     * const train = East.function([], XGBoost.Types.ModelBlobType, ($) => {
     *     const X = $.let([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0]]);
     *     const y = $.let(new Float64Array([1.0, 2.0, 3.0, 4.0]));
     *     const config = $.let({
     *         n_estimators: variant("some", 100n), max_depth: variant("some", 3n),
     *         learning_rate: variant("some", 0.1), min_child_weight: variant("none", null),
     *         subsample: variant("none", null), colsample_bytree: variant("none", null),
     *         reg_alpha: variant("none", null), reg_lambda: variant("none", null),
     *         gamma: variant("none", null), random_state: variant("some", 42n),
     *         n_jobs: variant("none", null), sample_weight: variant("none", null),
     *         categorical_features: variant("none", null), categorical_n: variant("none", null),
     *         max_cat_to_onehot: variant("none", null), max_cat_threshold: variant("none", null),
     *     }, XGBoostConfigType);
     *     return $.return(XGBoost.trainRegressor(X, y, config));
     * });
     * ```
     */
    trainRegressor: xgboost_train_regressor,

    /**
     * Train an XGBoost classification model.
     *
     * @example
     * ```ts
     * import { East, FloatType, IntegerType, MatrixType, VectorType, variant } from "@elaraai/east";
     * import { XGBoost, XGBoostConfigType } from "@elaraai/east-py-datascience";
     *
     * const train = East.function([], XGBoost.Types.ModelBlobType, ($) => {
     *     const X = $.let([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0]]);
     *     const y = $.let(new BigInt64Array([0n, 1n, 0n, 1n]));
     *     const config = $.let({
     *         n_estimators: variant("some", 50n), max_depth: variant("some", 3n),
     *         learning_rate: variant("some", 0.1), min_child_weight: variant("none", null),
     *         subsample: variant("none", null), colsample_bytree: variant("none", null),
     *         reg_alpha: variant("none", null), reg_lambda: variant("none", null),
     *         gamma: variant("none", null), random_state: variant("some", 42n),
     *         n_jobs: variant("none", null), sample_weight: variant("none", null),
     *         categorical_features: variant("none", null), categorical_n: variant("none", null),
     *         max_cat_to_onehot: variant("none", null), max_cat_threshold: variant("none", null),
     *     }, XGBoostConfigType);
     *     return $.return(XGBoost.trainClassifier(X, y, config));
     * });
     * ```
     */
    trainClassifier: xgboost_train_classifier,

    /**
     * Train XGBoost quantile regression models.
     *
     * Trains one model per quantile using pinball loss, providing
     * prediction intervals and uncertainty quantification.
     *
     * @example
     * ```ts
     * import { East, FloatType, MatrixType, VectorType, variant } from "@elaraai/east";
     * import { XGBoost, XGBoostQuantileConfigType } from "@elaraai/east-py-datascience";
     *
     * const train = East.function([], XGBoost.Types.ModelBlobType, ($) => {
     *     const X = $.let([[1.0], [2.0], [3.0], [4.0]]);
     *     const y = $.let(new Float64Array([1.0, 2.0, 3.0, 4.0]));
     *     const config = $.let({
     *         quantiles: new Float64Array([0.1, 0.5, 0.9]),
     *         n_estimators: variant("some", 100n), max_depth: variant("some", 3n),
     *         learning_rate: variant("some", 0.1), min_child_weight: variant("none", null),
     *         subsample: variant("none", null), colsample_bytree: variant("none", null),
     *         reg_alpha: variant("none", null), reg_lambda: variant("none", null),
     *         gamma: variant("none", null), random_state: variant("some", 42n),
     *         n_jobs: variant("none", null), sample_weight: variant("none", null),
     *         categorical_features: variant("none", null), categorical_n: variant("none", null),
     *         max_cat_to_onehot: variant("none", null), max_cat_threshold: variant("none", null),
     *     }, XGBoostQuantileConfigType);
     *     return $.return(XGBoost.trainQuantile(X, y, config));
     * });
     * ```
     */
    trainQuantile: xgboost_train_quantile,

    /**
     * Make predictions with a trained XGBoost regressor.
     *
     * @example
     * ```ts
     * import { East, FloatType, MatrixType, VectorType } from "@elaraai/east";
     * import { XGBoost } from "@elaraai/east-py-datascience";
     *
     * const predictFn = East.function(
     *     [XGBoost.Types.ModelBlobType, MatrixType(FloatType)],
     *     VectorType(FloatType),
     *     ($, model, X) => {
     *         return $.return(XGBoost.predict(model, X));
     *     }
     * );
     * ```
     */
    predict: xgboost_predict,

    /**
     * Predict class labels with a trained XGBoost classifier.
     *
     * @example
     * ```ts
     * import { East, FloatType, IntegerType, MatrixType, VectorType } from "@elaraai/east";
     * import { XGBoost } from "@elaraai/east-py-datascience";
     *
     * const predictFn = East.function(
     *     [XGBoost.Types.ModelBlobType, MatrixType(FloatType)],
     *     VectorType(IntegerType),
     *     ($, model, X) => {
     *         return $.return(XGBoost.predictClass(model, X));
     *     }
     * );
     * ```
     */
    predictClass: xgboost_predict_class,

    /**
     * Get class probabilities from a trained XGBoost classifier.
     *
     * @example
     * ```ts
     * import { East, FloatType, MatrixType } from "@elaraai/east";
     * import { XGBoost } from "@elaraai/east-py-datascience";
     *
     * const predictFn = East.function(
     *     [XGBoost.Types.ModelBlobType, MatrixType(FloatType)],
     *     MatrixType(FloatType),
     *     ($, model, X) => {
     *         // Returns (n_samples x n_classes) probability matrix
     *         return $.return(XGBoost.predictProba(model, X));
     *     }
     * );
     * ```
     */
    predictProba: xgboost_predict_proba,

    /**
     * Predict quantiles with a trained XGBoost quantile regressor.
     *
     * @example
     * ```ts
     * import { East, FloatType, MatrixType } from "@elaraai/east";
     * import { XGBoost } from "@elaraai/east-py-datascience";
     *
     * const predictFn = East.function(
     *     [XGBoost.Types.ModelBlobType, MatrixType(FloatType)],
     *     XGBoost.Types.XGBoostQuantilePredictResultType,
     *     ($, model, X) => {
     *         const result = $.let(XGBoost.predictQuantile(model, X));
     *         // result.quantiles => [0.1, 0.5, 0.9]
     *         // result.predictions => (n_samples x n_quantiles) matrix
     *         return $.return(result);
     *     }
     * );
     * ```
     */
    predictQuantile: xgboost_predict_quantile,
    /** Type definitions */
    Types: XGBoostTypes,
} as const;
