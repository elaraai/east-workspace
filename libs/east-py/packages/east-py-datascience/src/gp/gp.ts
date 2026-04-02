/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Gaussian Process platform functions for East.
 *
 * Provides Gaussian Process regression using scikit-learn.
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
    BooleanType,
    BlobType,
    StringType,
    NullType,
} from "@elaraai/east";
import { VectorType, MatrixType } from "../types.js";

// Re-export shared types for convenience
export { VectorType, MatrixType } from "../types.js";

// ============================================================================
// Enum Types
// ============================================================================

/**
 * Kernel type for Gaussian Process.
 */
export const GPKernelType = VariantType({
    /** Radial Basis Function (squared exponential) */
    rbf: NullType,
    /** Matern with nu=1/2 (exponential) */
    matern_1_2: NullType,
    /** Matern with nu=3/2 */
    matern_3_2: NullType,
    /** Matern with nu=5/2 */
    matern_5_2: NullType,
    /** Rational Quadratic */
    rational_quadratic: NullType,
    /** Dot Product (linear) */
    dot_product: NullType,
});

// ============================================================================
// Config Types
// ============================================================================

/**
 * Configuration for Gaussian Process Regressor.
 */
export const GPConfigType = StructType({
    /** Kernel type (default rbf) */
    kernel: OptionType(GPKernelType),
    /** Noise level added to diagonal (default 1e-10) */
    alpha: OptionType(FloatType),
    /** Number of restarts for optimizer (default 0) */
    n_restarts_optimizer: OptionType(IntegerType),
    /** Whether to normalize target values (default false) */
    normalize_y: OptionType(BooleanType),
    /** Random seed for reproducibility */
    random_state: OptionType(IntegerType),
});

// ============================================================================
// Result Types
// ============================================================================

/**
 * Result type for GP prediction with uncertainty.
 */
export const GPPredictResultType = StructType({
    /** Predicted mean values */
    mean: VectorType(FloatType),
    /** Predicted standard deviation (uncertainty) */
    std: VectorType(FloatType),
});

// ============================================================================
// Model Blob Types
// ============================================================================

/**
 * Model blob type for serialized GP models.
 */
export const GPModelBlobType = VariantType({
    /** Gaussian Process Regressor */
    gp_regressor: StructType({
        /** Cloudpickle serialized model */
        data: BlobType,
        /** Number of input features */
        n_features: IntegerType,
        /** Kernel type name for reference */
        kernel_type: StringType,
    }),
});

// ============================================================================
// Platform Functions
// ============================================================================

/**
 * Train a Gaussian Process Regressor.
 *
 * @param X - Feature matrix
 * @param y - Target vector
 * @param config - GP configuration
 * @returns Trained GP model blob
 */
export const gp_train = East.platform(
    "gp_train",
    [MatrixType(FloatType), VectorType(FloatType), GPConfigType],
    GPModelBlobType
);

/**
 * Make predictions with a trained Gaussian Process.
 *
 * Returns point predictions (mean only).
 *
 * @param model - Trained GP model blob
 * @param X - Feature matrix
 * @returns Predicted values
 */
export const gp_predict = East.platform(
    "gp_predict",
    [GPModelBlobType, MatrixType(FloatType)],
    VectorType(FloatType)
);

/**
 * Make predictions with uncertainty estimates.
 *
 * Returns both mean and standard deviation.
 *
 * @param model - Trained GP model blob
 * @param X - Feature matrix
 * @returns Prediction result with mean and std
 */
export const gp_predict_std = East.platform(
    "gp_predict_std",
    [GPModelBlobType, MatrixType(FloatType)],
    GPPredictResultType
);

// ============================================================================
// Grouped Export
// ============================================================================

/**
 * Type definitions for GP functions.
 */
export const GPTypes = {
    /** Kernel type */
    GPKernelType,
    /** Configuration type */
    GPConfigType,
    /** Prediction result type with uncertainty */
    GPPredictResultType,
    /** Model blob type for GP models */
    ModelBlobType: GPModelBlobType,
} as const;

/**
 * Gaussian Process regression.
 *
 * Provides probabilistic regression with uncertainty quantification.
 *
 * @example
 * ```ts
 * import { East, variant } from "@elaraai/east";
 * import { GP } from "@elaraai/east-py-datascience";
 *
 * const train = East.function([], GP.Types.ModelBlobType, $ => {
 *     const X = $.let([[1.0], [2.0], [3.0], [4.0]]);
 *     const y = $.let([1.0, 4.0, 9.0, 16.0]);
 *     const config = $.let({
 *         kernel: variant('some', variant('rbf', {})),
 *         alpha: variant('some', 1e-10),
 *         n_restarts_optimizer: variant('some', 5n),
 *         normalize_y: variant('some', true),
 *         random_state: variant('some', 42n),
 *     });
 *     return $.return(GP.train(X, y, config));
 * });
 * ```
 */
export const GP = {
    /**
     * Train a Gaussian Process regression model.
     *
     * @example
     * ```ts
     * import { East, FloatType, MatrixType, VectorType, variant } from "@elaraai/east";
     * import { GP, GPConfigType } from "@elaraai/east-py-datascience";
     *
     * const train = East.function([], GP.Types.ModelBlobType, ($) => {
     *     const X = $.let([[1.0], [2.0], [3.0], [4.0]]);
     *     const y = $.let(new Float64Array([1.0, 4.0, 9.0, 16.0]));
     *     const config = $.let({
     *         kernel: variant("some", variant("rbf", null)),
     *         alpha: variant("some", 1e-10),
     *         n_restarts_optimizer: variant("some", 5n),
     *         normalize_y: variant("some", true),
     *         random_state: variant("some", 42n),
     *     }, GPConfigType);
     *     return $.return(GP.train(X, y, config));
     * });
     * ```
     */
    train: gp_train,

    /**
     * Make predictions (mean only) with a trained GP model.
     *
     * @example
     * ```ts
     * import { East, FloatType, MatrixType, VectorType } from "@elaraai/east";
     * import { GP } from "@elaraai/east-py-datascience";
     *
     * const predictFn = East.function(
     *     [GP.Types.ModelBlobType, MatrixType(FloatType)],
     *     VectorType(FloatType),
     *     ($, model, X) => {
     *         return $.return(GP.predict(model, X));
     *     }
     * );
     * ```
     */
    predict: gp_predict,

    /**
     * Make predictions with uncertainty estimates (mean + std).
     *
     * @example
     * ```ts
     * import { East, FloatType, MatrixType } from "@elaraai/east";
     * import { GP } from "@elaraai/east-py-datascience";
     *
     * const predictFn = East.function(
     *     [GP.Types.ModelBlobType, MatrixType(FloatType)],
     *     GP.Types.GPPredictResultType,
     *     ($, model, X) => {
     *         const result = $.let(GP.predictStd(model, X));
     *         // result.mean => predicted values
     *         // result.std  => uncertainty (standard deviation)
     *         return $.return(result);
     *     }
     * );
     * ```
     */
    predictStd: gp_predict_std,
    /** Type definitions */
    Types: GPTypes,
} as const;
