/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * LightGBM platform functions for East.
 *
 * Provides fast gradient boosting for regression and classification.
 * Uses cloudpickle for model serialization.
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
 * Configuration for LightGBM models.
 */
export const LightGBMConfigType = StructType({
    /** Number of boosting rounds (default 100) */
    n_estimators: OptionType(IntegerType),
    /** Maximum tree depth, -1 for unlimited (default -1) */
    max_depth: OptionType(IntegerType),
    /** Learning rate / step size shrinkage (default 0.1) */
    learning_rate: OptionType(FloatType),
    /** Maximum number of leaves in one tree (default 31) */
    num_leaves: OptionType(IntegerType),
    /** Minimum number of samples required in a leaf (default 20) */
    min_child_samples: OptionType(IntegerType),
    /** Subsample ratio of training instances (default 1.0) */
    subsample: OptionType(FloatType),
    /** Subsample ratio of columns when constructing trees (default 1.0) */
    colsample_bytree: OptionType(FloatType),
    /** L1 regularization term (default 0) */
    reg_alpha: OptionType(FloatType),
    /** L2 regularization term (default 0) */
    reg_lambda: OptionType(FloatType),
    /** Random seed for reproducibility */
    random_state: OptionType(IntegerType),
    /** Number of parallel threads (default -1 for all cores) */
    n_jobs: OptionType(IntegerType),
});

// ============================================================================
// Model Blob Types
// ============================================================================

/**
 * Model blob type for serialized LightGBM models.
 *
 * Each model type has its own variant case containing cloudpickle bytes and metadata.
 */
export const LightGBMModelBlobType = VariantType({
    /** LightGBM regressor model */
    lightgbm_regressor: StructType({
        /** Cloudpickle serialized model */
        data: BlobType,
        /** Number of input features */
        n_features: IntegerType,
    }),
    /** LightGBM classifier model */
    lightgbm_classifier: StructType({
        /** Cloudpickle serialized model */
        data: BlobType,
        /** Number of input features */
        n_features: IntegerType,
        /** Number of classes */
        n_classes: IntegerType,
    }),
});

// ============================================================================
// Platform Functions
// ============================================================================

/**
 * Train a LightGBM regression model.
 *
 * @param X - Feature matrix
 * @param y - Target vector
 * @param config - LightGBM configuration
 * @returns Model blob containing trained regressor
 */
export const lightgbm_train_regressor = East.platform(
    "lightgbm_train_regressor",
    [MatrixType(FloatType), VectorType(FloatType), LightGBMConfigType],
    LightGBMModelBlobType
);

/**
 * Train a LightGBM classification model.
 *
 * @param X - Feature matrix
 * @param y - Label vector (integer class labels)
 * @param config - LightGBM configuration
 * @returns Model blob containing trained classifier
 */
export const lightgbm_train_classifier = East.platform(
    "lightgbm_train_classifier",
    [MatrixType(FloatType), VectorType(IntegerType), LightGBMConfigType],
    LightGBMModelBlobType
);

/**
 * Make predictions with a trained LightGBM regressor.
 *
 * @param model - Trained regressor model blob
 * @param X - Feature matrix
 * @returns Predicted values
 */
export const lightgbm_predict = East.platform(
    "lightgbm_predict",
    [LightGBMModelBlobType, MatrixType(FloatType)],
    VectorType(FloatType)
);

/**
 * Predict class labels with a trained LightGBM classifier.
 *
 * @param model - Trained classifier model blob
 * @param X - Feature matrix
 * @returns Predicted class labels
 */
export const lightgbm_predict_class = East.platform(
    "lightgbm_predict_class",
    [LightGBMModelBlobType, MatrixType(FloatType)],
    VectorType(IntegerType)
);

/**
 * Get class probabilities from a trained LightGBM classifier.
 *
 * @param model - Trained classifier model blob
 * @param X - Feature matrix
 * @returns Probability matrix (n_samples x n_classes)
 */
export const lightgbm_predict_proba = East.platform(
    "lightgbm_predict_proba",
    [LightGBMModelBlobType, MatrixType(FloatType)],
    MatrixType(FloatType)
);

// ============================================================================
// Grouped Export
// ============================================================================

/**
 * Type definitions for LightGBM functions.
 */
export const LightGBMTypes = {
    /** LightGBM configuration type */
    LightGBMConfigType,
    /** Model blob type for LightGBM models */
    ModelBlobType: LightGBMModelBlobType,
} as const;

/**
 * LightGBM gradient boosting.
 *
 * Provides fast regression and classification with gradient boosted decision trees.
 */
export const LightGBM = {
    /**
     * Train a LightGBM regression model.
     *
     * @example
     * ```ts
     * import { East, FloatType, MatrixType, VectorType, variant } from "@elaraai/east";
     * import { LightGBM, LightGBMConfigType } from "@elaraai/east-py-datascience";
     *
     * const train = East.function([], LightGBM.Types.ModelBlobType, ($) => {
     *     const X = $.let([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0]]);
     *     const y = $.let(new Float64Array([1.0, 2.0, 3.0, 4.0]));
     *     const config = $.let({
     *         n_estimators: variant("some", 100n), max_depth: variant("some", 3n),
     *         learning_rate: variant("some", 0.1), num_leaves: variant("none", null),
     *         min_child_samples: variant("none", null), subsample: variant("none", null),
     *         colsample_bytree: variant("none", null), reg_alpha: variant("none", null),
     *         reg_lambda: variant("none", null), random_state: variant("some", 42n),
     *         n_jobs: variant("none", null),
     *     }, LightGBMConfigType);
     *     return $.return(LightGBM.trainRegressor(X, y, config));
     * });
     * ```
     */
    trainRegressor: lightgbm_train_regressor,

    /**
     * Train a LightGBM classification model.
     *
     * @example
     * ```ts
     * import { East, FloatType, IntegerType, MatrixType, VectorType, variant } from "@elaraai/east";
     * import { LightGBM, LightGBMConfigType } from "@elaraai/east-py-datascience";
     *
     * const train = East.function([], LightGBM.Types.ModelBlobType, ($) => {
     *     const X = $.let([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0]]);
     *     const y = $.let(new BigInt64Array([0n, 1n, 0n, 1n]));
     *     const config = $.let({
     *         n_estimators: variant("some", 50n), max_depth: variant("some", 3n),
     *         learning_rate: variant("some", 0.1), num_leaves: variant("none", null),
     *         min_child_samples: variant("none", null), subsample: variant("none", null),
     *         colsample_bytree: variant("none", null), reg_alpha: variant("none", null),
     *         reg_lambda: variant("none", null), random_state: variant("some", 42n),
     *         n_jobs: variant("none", null),
     *     }, LightGBMConfigType);
     *     return $.return(LightGBM.trainClassifier(X, y, config));
     * });
     * ```
     */
    trainClassifier: lightgbm_train_classifier,

    /**
     * Make predictions with a trained LightGBM regressor.
     *
     * @example
     * ```ts
     * import { East, FloatType, MatrixType, VectorType } from "@elaraai/east";
     * import { LightGBM } from "@elaraai/east-py-datascience";
     *
     * const predictFn = East.function(
     *     [LightGBM.Types.ModelBlobType, MatrixType(FloatType)],
     *     VectorType(FloatType),
     *     ($, model, X) => {
     *         return $.return(LightGBM.predict(model, X));
     *     }
     * );
     * ```
     */
    predict: lightgbm_predict,

    /**
     * Predict class labels with a trained LightGBM classifier.
     *
     * @example
     * ```ts
     * import { East, FloatType, IntegerType, MatrixType, VectorType } from "@elaraai/east";
     * import { LightGBM } from "@elaraai/east-py-datascience";
     *
     * const predictFn = East.function(
     *     [LightGBM.Types.ModelBlobType, MatrixType(FloatType)],
     *     VectorType(IntegerType),
     *     ($, model, X) => {
     *         return $.return(LightGBM.predictClass(model, X));
     *     }
     * );
     * ```
     */
    predictClass: lightgbm_predict_class,

    /**
     * Get class probabilities from a trained LightGBM classifier.
     *
     * @example
     * ```ts
     * import { East, FloatType, MatrixType } from "@elaraai/east";
     * import { LightGBM } from "@elaraai/east-py-datascience";
     *
     * const predictFn = East.function(
     *     [LightGBM.Types.ModelBlobType, MatrixType(FloatType)],
     *     MatrixType(FloatType),
     *     ($, model, X) => {
     *         return $.return(LightGBM.predictProba(model, X));
     *     }
     * );
     * ```
     */
    predictProba: lightgbm_predict_proba,
    /** Type definitions */
    Types: LightGBMTypes,
} as const;
