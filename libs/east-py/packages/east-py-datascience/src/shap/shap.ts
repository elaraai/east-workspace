/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * SHAP platform functions for East.
 *
 * Provides model-agnostic feature importance and explainability using SHAP values.
 * Uses cloudpickle for explainer serialization.
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
    StringType,
    ArrayType,
    BlobType,
    NullType,
} from "@elaraai/east";
import { VectorType, MatrixType } from "../types.js";
import { MAPIEBaseModelDataType } from "../mapie/mapie.js";

// Re-export shared types for convenience
export { VectorType, MatrixType } from "../types.js";

// ============================================================================
// Data Types
// ============================================================================

/** String vector type for feature names */
export const StringVectorType = ArrayType(StringType);

// ============================================================================
// Result Types
// ============================================================================

/**
 * SHAP values type - variant for 2D (regression/binary) or 3D (multi-class).
 */
export const ShapValuesType = VariantType({
    /** 2D matrix for regression or binary classification (n_samples x n_features) */
    matrix_2d: MatrixType(FloatType),
    /** 3D tensor for multi-class classification (n_samples x n_features x n_classes) */
    tensor_3d: ArrayType(MatrixType(FloatType)),
});

/**
 * Base value type - variant for single (regression/binary) or per-class (multi-class).
 */
export const ShapBaseValueType = VariantType({
    /** Single base value for regression or binary classification */
    single: FloatType,
    /** Per-class base values for multi-class classification */
    per_class: VectorType(FloatType),
});

/**
 * Result type for SHAP value computation.
 */
export const ShapResultType = StructType({
    /** SHAP values - 2D matrix or 3D tensor depending on model type */
    shap_values: ShapValuesType,
    /** Base value(s) - single float or per-class array */
    base_value: ShapBaseValueType,
    /** Feature names */
    feature_names: StringVectorType,
});

/**
 * Result type for feature importance.
 */
export const FeatureImportanceType = StructType({
    /** Feature names */
    feature_names: StringVectorType,
    /** Mean absolute SHAP value for each feature */
    importances: VectorType(FloatType),
    /** Standard deviation of absolute SHAP values */
    std: OptionType(VectorType(FloatType)),
});

// ============================================================================
// Model Blob Types
// ============================================================================

/**
 * Model blob type for serialized SHAP explainers.
 */
export const ShapModelBlobType = VariantType({
    /** SHAP TreeExplainer for tree-based models */
    shap_tree_explainer: StructType({
        /** Cloudpickle serialized explainer */
        data: BlobType,
        /** Number of input features */
        n_features: IntegerType,
    }),
    /** SHAP KernelExplainer for any model */
    shap_kernel_explainer: StructType({
        /** Cloudpickle serialized explainer */
        data: BlobType,
        /** Number of input features */
        n_features: IntegerType,
    }),
});

/**
 * Tree-based model blob type - accepts XGBoost models and MAPIE wrappers with XGBoost.
 * Note: LightGBM is not supported for TreeExplainer due to SHAP compatibility issues.
 * Use KernelExplainer for LightGBM models.
 */
export const TreeModelBlobType = VariantType({
    /** XGBoost regressor */
    xgboost_regressor: StructType({
        data: BlobType,
        n_features: IntegerType,
        categorical_features: OptionType(VectorType(IntegerType)),
        categorical_n: OptionType(VectorType(IntegerType)),
    }),
    /** XGBoost classifier */
    xgboost_classifier: StructType({
        data: BlobType,
        n_features: IntegerType,
        n_classes: IntegerType,
        categorical_features: OptionType(VectorType(IntegerType)),
        categorical_n: OptionType(VectorType(IntegerType)),
    }),
    /** XGBoost quantile regressor (uses median quantile for explanations) */
    xgboost_quantile: StructType({
        data: BlobType,
        quantiles: VectorType(FloatType),
        n_features: IntegerType,
        categorical_features: OptionType(VectorType(IntegerType)),
        categorical_n: OptionType(VectorType(IntegerType)),
    }),
    /** MAPIE split conformal regressor with XGBoost base */
    mapie_split: StructType({
        data: MAPIEBaseModelDataType,
        n_features: IntegerType,
        confidence_level: FloatType,
    }),
    /** MAPIE cross conformal regressor with XGBoost base */
    mapie_cross: StructType({
        data: MAPIEBaseModelDataType,
        n_features: IntegerType,
        confidence_level: FloatType,
    }),
    /** MAPIE CQR conformal regressor with XGBoost base */
    mapie_cqr: StructType({
        data: MAPIEBaseModelDataType,
        n_features: IntegerType,
        confidence_level: FloatType,
    }),
    /** MAPIE conformal classifier with XGBoost base */
    mapie_classifier: StructType({
        data: MAPIEBaseModelDataType,
        n_features: IntegerType,
        n_classes: IntegerType,
        classes: VectorType(IntegerType),
        confidence_level: FloatType,
    }),
});

/**
 * Any model blob type - accepts any model for kernel explainer.
 * Includes all tree-based models plus NGBoost, GP, Torch, and sklearn models.
 */
export const AnyModelBlobType = VariantType({
    // Tree-based
    xgboost_regressor: StructType({
        data: BlobType,
        n_features: IntegerType,
        categorical_features: OptionType(VectorType(IntegerType)),
        categorical_n: OptionType(VectorType(IntegerType)),
    }),
    xgboost_classifier: StructType({
        data: BlobType,
        n_features: IntegerType,
        n_classes: IntegerType,
        categorical_features: OptionType(VectorType(IntegerType)),
        categorical_n: OptionType(VectorType(IntegerType)),
    }),
    xgboost_quantile: StructType({
        data: BlobType,
        quantiles: VectorType(FloatType),
        n_features: IntegerType,
        categorical_features: OptionType(VectorType(IntegerType)),
        categorical_n: OptionType(VectorType(IntegerType)),
    }),
    lightgbm_regressor: StructType({
        data: BlobType,
        n_features: IntegerType,
    }),
    lightgbm_classifier: StructType({
        data: BlobType,
        n_features: IntegerType,
        n_classes: IntegerType,
    }),
    // NGBoost
    ngboost_regressor: StructType({
        data: BlobType,
        distribution: VariantType({
            normal: NullType,
            lognormal: NullType,
        }),
        n_features: IntegerType,
    }),
    // GP
    gp_regressor: StructType({
        data: BlobType,
        n_features: IntegerType,
        kernel_type: StringType,
    }),
    // Torch
    torch_mlp: StructType({
        data: BlobType,
        n_features: IntegerType,
        hidden_layers: ArrayType(IntegerType),
        output_dim: IntegerType,
    }),
    // Sklearn scalers (for compatibility with SklearnModelBlobType)
    standard_scaler: StructType({
        onnx: BlobType,
        n_features: IntegerType,
    }),
    min_max_scaler: StructType({
        onnx: BlobType,
        n_features: IntegerType,
    }),
    robust_scaler: StructType({
        onnx: BlobType,
        n_features: IntegerType,
    }),
    label_encoder: StructType({
        data: BlobType,
        n_classes: IntegerType,
    }),
    ordinal_encoder: StructType({
        data: BlobType,
        n_features: IntegerType,
    }),
    gaussian_mixture: StructType({
        data: BlobType,
        n_features: IntegerType,
        n_components: IntegerType,
    }),
    // Sklearn RegressorChain
    regressor_chain: StructType({
        data: BlobType,
        n_features: IntegerType,
        n_targets: IntegerType,
        base_estimator_type: StringType,
    }),
    // MAPIE conformal regressors (uses nested variant pattern)
    mapie_split: StructType({
        data: MAPIEBaseModelDataType,
        n_features: IntegerType,
        confidence_level: FloatType,
    }),
    mapie_cross: StructType({
        data: MAPIEBaseModelDataType,
        n_features: IntegerType,
        confidence_level: FloatType,
    }),
    mapie_cqr: StructType({
        data: MAPIEBaseModelDataType,
        n_features: IntegerType,
        confidence_level: FloatType,
    }),
    // MAPIE conformal classifier (uses nested variant pattern)
    mapie_classifier: StructType({
        data: MAPIEBaseModelDataType,
        n_features: IntegerType,
        n_classes: IntegerType,
        classes: VectorType(IntegerType),
        confidence_level: FloatType,
    }),
    // MAPIE uncertainty predictors (for explaining interval width / set size)
    mapie_interval_width: StructType({
        data: BlobType,
        n_features: IntegerType,
    }),
    mapie_set_size: StructType({
        data: BlobType,
        n_features: IntegerType,
    }),
});

// ============================================================================
// MAPIE Model Types for SHAP
// ============================================================================

// Re-export MAPIE model types from mapie.ts for convenience
export { MAPIEBaseModelDataType } from "../mapie/mapie.js";

/**
 * MAPIE regressor model blob type for SHAP.
 * Accepts split, cross, or CQR conformal regressors.
 * Must match MAPIERegressorBlobType from mapie.ts.
 */
export const MAPIERegressorBlobType = VariantType({
    mapie_split: StructType({
        data: MAPIEBaseModelDataType,
        n_features: IntegerType,
        confidence_level: FloatType,
    }),
    mapie_cross: StructType({
        data: MAPIEBaseModelDataType,
        n_features: IntegerType,
        confidence_level: FloatType,
    }),
    mapie_cqr: StructType({
        data: MAPIEBaseModelDataType,
        n_features: IntegerType,
        confidence_level: FloatType,
    }),
});

/**
 * MAPIE classifier model blob type for SHAP.
 * Must match MAPIEClassifierBlobType from mapie.ts.
 */
export const MAPIEClassifierBlobType = StructType({
    data: MAPIEBaseModelDataType,
    n_features: IntegerType,
    n_classes: IntegerType,
    classes: VectorType(IntegerType),
    confidence_level: FloatType,
});

// ============================================================================
// MAPIE SHAP Result Types
// ============================================================================

/**
 * SHAP result for MAPIE regressors.
 * Contains explanations for both point prediction and uncertainty (interval width).
 */
export const MapieRegressorShapResultType = StructType({
    /** SHAP values for point prediction (what drives the predicted value) */
    point_prediction: ShapResultType,
    /** SHAP values for interval width (what drives uncertainty) */
    interval_width: ShapResultType,
});

/**
 * SHAP result for MAPIE classifiers.
 * Contains explanations for both class probabilities and prediction set size.
 */
export const MapieClassifierShapResultType = StructType({
    /** SHAP values for class probabilities (what drives each class probability) */
    class_probabilities: ShapResultType,
    /** SHAP values for prediction set size (what drives uncertainty) */
    prediction_set_size: ShapResultType,
});

// ============================================================================
// TreeExplainer Config Type
// ============================================================================

/**
 * Configuration for TreeExplainer creation.
 *
 * - `path_dependent`: Uses tree structure to compute SHAP values. Fast, but may
 *   conflate correlated features because it follows the tree's split paths.
 * - `interventional`: Uses background data to break feature correlations, giving
 *   causal "what if I changed this feature" explanations. Requires background samples.
 */
export const TreeExplainerConfigType = VariantType({
    /** Path-dependent mode: uses tree structure only (default SHAP behavior) */
    path_dependent: StructType({
        /** Tree-based model blob */
        model: TreeModelBlobType,
    }),
    /** Interventional mode: uses background data to break feature correlations */
    interventional: StructType({
        /** Tree-based model blob */
        model: TreeModelBlobType,
        /** Background data for computing interventional expectations */
        background: MatrixType(FloatType),
    }),
});

// ============================================================================
// Platform Functions
// ============================================================================

/**
 * Create a SHAP TreeExplainer for tree-based models.
 *
 * Works with XGBoost and LightGBM models (regressor and classifier).
 *
 * Two modes:
 * - `path_dependent`: Uses tree split paths (fast, default SHAP behavior).
 *   Tells you how the tree *used* features.
 * - `interventional`: Uses background data to break feature correlations.
 *   Tells you how *changing* a feature would change the prediction.
 *
 * @param config - Variant with mode selection and model/background data
 * @returns SHAP TreeExplainer blob
 */
export const shap_tree_explainer_create = East.platform(
    "shap_tree_explainer_create",
    [TreeExplainerConfigType],
    ShapModelBlobType
);

/**
 * Create a SHAP KernelExplainer for any model.
 *
 * Works with any model that has a predict method (NGBoost, GP, Torch, etc.).
 * Requires background data for computing expected values.
 *
 * @param model - Any model blob
 * @param X_background - Background data for computing expected values
 * @returns SHAP KernelExplainer blob
 */
export const shap_kernel_explainer_create = East.platform(
    "shap_kernel_explainer_create",
    [AnyModelBlobType, MatrixType(FloatType)],
    ShapModelBlobType
);

/**
 * Compute SHAP values for samples.
 *
 * @param explainer - SHAP explainer blob
 * @param X - Feature matrix to explain
 * @param feature_names - Names of features
 * @returns SHAP values, base value, and feature names
 */
export const shap_compute_values = East.platform(
    "shap_compute_values",
    [ShapModelBlobType, MatrixType(FloatType), StringVectorType],
    ShapResultType
);

/**
 * Compute global feature importance from SHAP values.
 *
 * @param shap_values - SHAP values (2D matrix or 3D tensor)
 * @param feature_names - Names of features
 * @returns Feature importance with mean |SHAP| values
 */
export const shap_feature_importance = East.platform(
    "shap_feature_importance",
    [ShapValuesType, StringVectorType],
    FeatureImportanceType
);

// ============================================================================
// Grouped Export
// ============================================================================

/**
 * Type definitions for SHAP functions.
 */
export const ShapTypes = {
    /** String vector type */
    StringVectorType,
    /** SHAP values variant type (2D or 3D) */
    ShapValuesType,
    /** SHAP base value variant type (single or per-class) */
    ShapBaseValueType,
    /** SHAP result type */
    ShapResultType,
    /** Feature importance type */
    FeatureImportanceType,
    /** SHAP explainer model blob type */
    ShapModelBlobType,
    /** Tree model blob type for input */
    TreeModelBlobType,
    /** TreeExplainer configuration type (path_dependent | interventional) */
    TreeExplainerConfigType,
    /** Any model blob type for kernel explainer */
    AnyModelBlobType,
} as const;

/**
 * SHAP explainability functions.
 *
 * Provides model-agnostic feature importance and SHAP value computation.
 *
 * @example
 * ```ts
 * import { East, variant } from "@elaraai/east";
 * import { Shap, LightGBM } from "@elaraai/east-py-datascience";
 *
 * const explain = East.function([LightGBM.Types.ModelBlobType, Shap.Types.MatrixType(FloatType)], Shap.Types.ShapResultType, ($, model, X) => {
 *     // Create explainer
 *     const explainer = $.let(Shap.treeExplainerCreate(model));
 *
 *     // Compute SHAP values
 *     const feature_names = $.let(["feature1", "feature2"]);
 *     const result = $.let(Shap.computeValues(explainer, X, feature_names));
 *
 *     return $.return(result);
 * });
 * ```
 */
export const Shap = {
    /**
     * Create a SHAP TreeExplainer for tree-based models (XGBoost, LightGBM).
     *
     * Two modes:
     * - `path_dependent`: Uses tree split paths. Tells you how the tree used features.
     * - `interventional`: Uses background data to break correlations. Tells you how
     *   changing a feature would change the prediction.
     *
     * @example
     * ```ts
     * import { East, FloatType, variant } from "@elaraai/east";
     * import { Shap, XGBoost } from "@elaraai/east-py-datascience";
     *
     * // Path-dependent mode (default SHAP behavior)
     * const explainPD = East.function(
     *     [XGBoost.Types.ModelBlobType],
     *     Shap.Types.ShapModelBlobType,
     *     ($, model) => {
     *         return $.return(Shap.treeExplainerCreate(
     *             variant('path_dependent', { model })
     *         ));
     *     }
     * );
     *
     * // Interventional mode (causal, uses background data)
     * const explainIV = East.function(
     *     [XGBoost.Types.ModelBlobType, Shap.Types.MatrixType(FloatType)],
     *     Shap.Types.ShapModelBlobType,
     *     ($, model, background) => {
     *         return $.return(Shap.treeExplainerCreate(
     *             variant('interventional', { model, background })
     *         ));
     *     }
     * );
     * ```
     */
    treeExplainerCreate: shap_tree_explainer_create,

    /**
     * Create a SHAP KernelExplainer for any model.
     *
     * Works with any model (NGBoost, GP, Torch, etc.). Requires background
     * data for computing expected values.
     *
     * @example
     * ```ts
     * import { East, FloatType, MatrixType } from "@elaraai/east";
     * import { Shap, NGBoost } from "@elaraai/east-py-datascience";
     *
     * const explain = East.function(
     *     [NGBoost.Types.ModelBlobType, MatrixType(FloatType)],
     *     Shap.Types.ShapModelBlobType,
     *     ($, model, X_background) => {
     *         return $.return(Shap.kernelExplainerCreate(model, X_background));
     *     }
     * );
     * ```
     */
    kernelExplainerCreate: shap_kernel_explainer_create,

    /**
     * Compute SHAP values for samples.
     *
     * @example
     * ```ts
     * import { East, FloatType, MatrixType, StringType, VectorType } from "@elaraai/east";
     * import { Shap } from "@elaraai/east-py-datascience";
     *
     * const compute = East.function(
     *     [Shap.Types.ShapModelBlobType, MatrixType(FloatType)],
     *     Shap.Types.ShapResultType,
     *     ($, explainer, X) => {
     *         const feature_names = $.let(["feature_a", "feature_b"]);
     *         const result = $.let(Shap.computeValues(explainer, X, feature_names));
     *         // result.values => SHAP values matrix
     *         // result.base_value => expected value
     *         return $.return(result);
     *     }
     * );
     * ```
     */
    computeValues: shap_compute_values,

    /**
     * Compute global feature importance from SHAP values.
     *
     * @example
     * ```ts
     * import { East, FloatType, MatrixType, StringType, VectorType } from "@elaraai/east";
     * import { Shap } from "@elaraai/east-py-datascience";
     *
     * const importance = East.function(
     *     [Shap.Types.ShapModelBlobType, MatrixType(FloatType)],
     *     Shap.Types.FeatureImportanceType,
     *     ($, explainer, X) => {
     *         const feature_names = $.let(["feature_a", "feature_b"]);
     *         const shap_result = $.let(Shap.computeValues(explainer, X, feature_names));
     *         return $.return(Shap.featureImportance(shap_result.values, feature_names));
     *     }
     * );
     * ```
     */
    featureImportance: shap_feature_importance,
    /** Type definitions */
    Types: ShapTypes,
} as const;
