/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Scikit-learn platform functions for East.
 *
 * Provides core machine learning utilities: preprocessing, model selection, and metrics.
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
    BooleanType,
    FloatType,
    BlobType,
    ArrayType,
    StringType,
    NullType,
} from "@elaraai/east";
import { VectorType, MatrixType } from "../types.js";
import { XGBoostConfigType } from "../xgboost/xgboost.js";
import { LightGBMConfigType } from "../lightgbm/lightgbm.js";
import { NGBoostConfigType } from "../ngboost/ngboost.js";
import { GPConfigType } from "../gp/gp.js";

// Re-export shared types for convenience
export { VectorType, MatrixType } from "../types.js";

// ============================================================================
// Class Weight Types
// ============================================================================

/**
 * Mode for computing class weights.
 */
export const ClassWeightModeType = VariantType({
    /** Weights are inversely proportional to class frequencies */
    balanced: NullType,
});

// ============================================================================
// Confusion Matrix Types
// ============================================================================

/**
 * Result type for confusion matrix.
 */
export const ConfusionMatrixResultType = StructType({
    /** Confusion matrix (n_classes x n_classes) */
    matrix: MatrixType(FloatType),
    /** Class labels in order */
    classes: VectorType(IntegerType),
});

// Re-export config types used in RegressorChain
export { XGBoostConfigType } from "../xgboost/xgboost.js";
export { LightGBMConfigType } from "../lightgbm/lightgbm.js";
export { NGBoostConfigType } from "../ngboost/ngboost.js";
export { GPConfigType } from "../gp/gp.js";

// ============================================================================
// Config Types
// ============================================================================

/**
 * Configuration for data splitting.
 *
 * Examples:
 * - 2-way: split_sizes: [0.8, 0.2] -> train/test
 * - 3-way: split_sizes: [0.7, 0.15, 0.15] -> train/val/test
 * - 4-way: split_sizes: [0.6, 0.1, 0.15, 0.15] -> train/val/calib/test
 */
export const SplitConfigType = StructType({
    /** Array of split proportions (must sum to 1.0). */
    split_sizes: ArrayType(FloatType),
    /** Random seed for reproducibility */
    random_state: OptionType(IntegerType),
    /** Whether to shuffle data before splitting (default true) */
    shuffle: OptionType(BooleanType),
    /**
     * Stratification columns - controls proportional distribution across splits.
     * Combined into compound strata. Each inner array is one column of labels.
     * Note: Stratify does NOT guarantee overlap - use the overlap parameter for that.
     */
    stratify: OptionType(MatrixType(IntegerType)),
    /**
     * Columns that must have overlapping representation in all splits.
     * Each column is checked independently - values that don't appear in all splits are rejected.
     * Each inner array is one column of labels (same length as X).
     */
    overlap: OptionType(MatrixType(IntegerType)),
    /**
     * Multi-value overlap columns - each sample can have MULTIPLE values (a set).
     * Structure: Array of columns, where each column is Array of samples, where each sample is Array of values.
     * Ensures each unique value (across all samples) appears in all splits.
     * Use this when a single sample can belong to multiple categories over time.
     */
    multi_overlap: OptionType(ArrayType(ArrayType(VectorType(IntegerType)))),
    /**
     * Minimum samples per overlap value. Values with fewer samples are rejected. (default = n_splits)
     * This ensures enough samples to distribute across all splits.
     */
    min_overlap: OptionType(IntegerType),
});

// ============================================================================
// Result Types
// ============================================================================

/**
 * Result of data splitting.
 */
export const SplitResultType = StructType({
    /** Array of feature matrices, one per split (in order of split_sizes) */
    X_splits: ArrayType(MatrixType(FloatType)),
    /** Array of target matrices, one per split (in order of split_sizes) */
    Y_splits: ArrayType(MatrixType(FloatType)),
    /** Indices of rows rejected due to rare stratify classes or missing overlap values */
    rejected_indices: ArrayType(IntegerType),
});

/**
 * Configuration for categorical overlap filtering.
 */
export const OverlapConfigType = StructType({
    /** Which column indices in the feature matrix are categorical */
    cat_indices: VectorType(IntegerType),
});

/**
 * Result of overlap filtering.
 */
export const OverlapResultType = StructType({
    /** Filtered feature matrices (one per target, rows with unseen categories removed) */
    X_filtered: ArrayType(MatrixType(FloatType)),
    /** Filtered target matrices (one per target, filtered in sync with X) */
    Y_filtered: ArrayType(MatrixType(FloatType)),
    /** Number of rejected rows per target */
    rejected_counts: VectorType(IntegerType),
    /** Per categorical column, the sorted list of known values from the reference */
    known_categories: ArrayType(VectorType(IntegerType)),
});

// ============================================================================
// Flexible Metrics Types
// ============================================================================

/**
 * Available regression metrics from sklearn.metrics.
 */
export const RegressionMetricType = VariantType({
    /** Mean Squared Error - sklearn.metrics.mean_squared_error */
    mse: NullType,
    /** Root Mean Squared Error - sqrt(MSE) */
    rmse: NullType,
    /** Mean Absolute Error - sklearn.metrics.mean_absolute_error */
    mae: NullType,
    /** R² (coefficient of determination) - sklearn.metrics.r2_score */
    r2: NullType,
    /** Mean Absolute Percentage Error - sklearn.metrics.mean_absolute_percentage_error */
    mape: NullType,
    /** Explained Variance Score - sklearn.metrics.explained_variance_score */
    explained_variance: NullType,
    /** Max Error - sklearn.metrics.max_error */
    max_error: NullType,
    /** Median Absolute Error - sklearn.metrics.median_absolute_error */
    median_ae: NullType,
    /** Mean Error (bias) - mean(pred - true), should be ~0 for unbiased predictions */
    mean_error: NullType,
    /** Pinball Loss - proper scoring rule for quantile regression (requires alpha parameter) */
    pinball_loss: FloatType,
    /** Huber Loss - robust to outliers (requires delta parameter, default 1.0) */
    huber: FloatType,
    /** Mean Tweedie Deviance - for skewed distributions (requires power parameter) */
    mean_tweedie_deviance: FloatType,
});

/**
 * Single metric result (scalar value).
 */
export const MetricResultType = StructType({
    /** Which metric was computed */
    metric: RegressionMetricType,
    /** Scalar metric value */
    value: FloatType,
});

/**
 * Result containing multiple computed metrics.
 */
export const MetricsResultType = ArrayType(MetricResultType);

/**
 * Aggregation strategy for multi-target metrics.
 */
export const MetricAggregationType = VariantType({
    /** Return metric for each target separately (default) */
    per_target: NullType,
    /** Average across all targets (uniform weights) */
    uniform_average: NullType,
});

/**
 * Configuration for multi-target metrics computation.
 */
export const MultiMetricsConfigType = StructType({
    /** How to aggregate metrics across targets (default: per_target) */
    aggregation: OptionType(MetricAggregationType),
});

/**
 * Multi-target metric result.
 */
export const MultiMetricResultType = StructType({
    /** Which metric was computed */
    metric: RegressionMetricType,
    /** Metric value(s) */
    value: VariantType({
        /** Aggregated scalar value */
        scalar: FloatType,
        /** Per-target values [target_0, target_1, ...] */
        per_target: VectorType(FloatType),
    }),
});

/**
 * Result containing multiple computed metrics (multi-target).
 */
export const MultiMetricsResultType = ArrayType(MultiMetricResultType);

/**
 * Weights type for Cohen's Kappa score.
 */
export const CohenKappaWeightsType = VariantType({
    /** No weighting (default) */
    none: NullType,
    /** Linear weighting - penalizes disagreements linearly */
    linear: NullType,
    /** Quadratic weighting - penalizes disagreements quadratically */
    quadratic: NullType,
});

/**
 * Available classification metrics from sklearn.metrics.
 */
export const ClassificationMetricType = VariantType({
    /** Accuracy - sklearn.metrics.accuracy_score */
    accuracy: NullType,
    /** Balanced Accuracy - sklearn.metrics.balanced_accuracy_score */
    balanced_accuracy: NullType,
    /** Precision - sklearn.metrics.precision_score */
    precision: NullType,
    /** Recall - sklearn.metrics.recall_score */
    recall: NullType,
    /** F1 Score - sklearn.metrics.f1_score */
    f1: NullType,
    /** Matthews Correlation Coefficient - sklearn.metrics.matthews_corrcoef */
    matthews_corrcoef: NullType,
    /** Cohen's Kappa - sklearn.metrics.cohen_kappa_score (with optional weights) */
    cohen_kappa: CohenKappaWeightsType,
    /** Jaccard Score - sklearn.metrics.jaccard_score */
    jaccard: NullType,
});

/**
 * Averaging strategy for multi-class classification metrics.
 */
export const ClassificationAverageType = VariantType({
    /** Calculate metrics for each label, return unweighted mean */
    macro: NullType,
    /** Calculate metrics globally by counting total TP, FP, FN */
    micro: NullType,
    /** Calculate metrics for each label, return weighted mean by support */
    weighted: NullType,
    /** Only for binary classification */
    binary: NullType,
});

/**
 * Multi-class strategy for ROC AUC.
 */
export const RocAucMultiClassType = VariantType({
    /** One-vs-rest (OvR) - computes AUC of each class against all others */
    ovr: NullType,
    /** One-vs-one (OvO) - computes pairwise AUC and averages */
    ovo: NullType,
});

/**
 * Configuration for ROC AUC score.
 */
export const RocAucConfigType = StructType({
    /** Multi-class strategy (default: ovr) */
    multi_class: OptionType(RocAucMultiClassType),
    /** Averaging strategy for multi-class: 'macro' or 'weighted' (default: macro) */
    average: OptionType(ClassificationAverageType),
});

/**
 * Configuration for classification metrics.
 */
export const ClassificationMetricsConfigType = StructType({
    /** Averaging strategy for multi-class (default: macro) */
    average: OptionType(ClassificationAverageType),
});

/**
 * Single classification metric result.
 */
export const ClassificationMetricResultType = StructType({
    /** Which metric was computed */
    metric: ClassificationMetricType,
    /** Scalar metric value */
    value: FloatType,
});

/**
 * Result containing multiple computed classification metrics.
 */
export const ClassificationMetricResultsType = ArrayType(ClassificationMetricResultType);

/**
 * Configuration for multi-target classification metrics.
 */
export const MultiClassificationConfigType = StructType({
    /** Averaging strategy for multi-class (default: macro) */
    average: OptionType(ClassificationAverageType),
    /** How to aggregate across targets (default: per_target) */
    aggregation: OptionType(MetricAggregationType),
});

/**
 * Multi-target classification metric result.
 */
export const MultiClassificationMetricResultType = StructType({
    /** Which metric was computed */
    metric: ClassificationMetricType,
    /** Metric value(s) */
    value: VariantType({
        /** Aggregated scalar value */
        scalar: FloatType,
        /** Per-target values */
        per_target: VectorType(FloatType),
    }),
});

/**
 * Result containing multiple computed classification metrics (multi-target).
 */
export const MultiClassificationMetricResultsType = ArrayType(MultiClassificationMetricResultType);

// ============================================================================
// GMM Types
// ============================================================================

/**
 * Covariance type for Gaussian Mixture Models.
 */
export const GMMCovarianceType = VariantType({
    /** Each component has its own general covariance matrix */
    full: NullType,
    /** All components share the same general covariance matrix */
    tied: NullType,
    /** Each component has its own diagonal covariance matrix */
    diag: NullType,
    /** Each component has its own single variance */
    spherical: NullType,
});

/**
 * Configuration for Gaussian Mixture Model fitting.
 */
export const GMMConfigType = StructType({
    /** Number of mixture components (default 1) */
    n_components: OptionType(IntegerType),
    /** Covariance type (default full) */
    covariance_type: OptionType(GMMCovarianceType),
    /** Maximum number of EM iterations (default 100) */
    max_iter: OptionType(IntegerType),
    /** Number of initializations (default 1) */
    n_init: OptionType(IntegerType),
    /** Convergence tolerance (default 1e-3) */
    tol: OptionType(FloatType),
    /** Regularization added to diagonal of covariance (default 1e-6) */
    reg_covar: OptionType(FloatType),
    /** Random seed for reproducibility */
    random_state: OptionType(IntegerType),
});

// ============================================================================
// Model Blob Types
// ============================================================================

/**
 * Model blob type for serialized sklearn models.
 *
 * Each model type has its own variant case containing ONNX bytes and metadata.
 */
export const SklearnModelBlobType = VariantType({
    /** StandardScaler model */
    standard_scaler: StructType({
        /** ONNX model bytes */
        onnx: BlobType,
        /** Number of input features */
        n_features: IntegerType,
    }),
    /** MinMaxScaler model */
    min_max_scaler: StructType({
        /** ONNX model bytes */
        onnx: BlobType,
        /** Number of input features */
        n_features: IntegerType,
    }),
    /** RobustScaler model */
    robust_scaler: StructType({
        /** ONNX model bytes */
        onnx: BlobType,
        /** Number of input features */
        n_features: IntegerType,
    }),
    /** LabelEncoder model */
    label_encoder: StructType({
        /** Cloudpickle serialized encoder */
        data: BlobType,
        /** Number of unique classes */
        n_classes: IntegerType,
    }),
    /** OrdinalEncoder model */
    ordinal_encoder: StructType({
        /** Cloudpickle serialized encoder */
        data: BlobType,
        /** Number of features */
        n_features: IntegerType,
    }),
    /** RegressorChain model */
    regressor_chain: StructType({
        /** Cloudpickle serialized chain */
        data: BlobType,
        /** Number of input features */
        n_features: IntegerType,
        /** Number of target outputs */
        n_targets: IntegerType,
        /** Base estimator type name */
        base_estimator_type: StringType,
    }),
    /** Gaussian Mixture Model */
    gaussian_mixture: StructType({
        /** Cloudpickle serialized GMM */
        data: BlobType,
        /** Number of input features */
        n_features: IntegerType,
        /** Number of mixture components */
        n_components: IntegerType,
    }),
});

// ============================================================================
// RegressorChain Types
// ============================================================================

/**
 * Base estimator configuration for RegressorChain.
 * Variant carries both the estimator type AND its configuration.
 */
export const RegressorChainBaseConfigType = VariantType({
    /** XGBoost regressor */
    xgboost: XGBoostConfigType,
    /** LightGBM regressor */
    lightgbm: LightGBMConfigType,
    /** NGBoost regressor */
    ngboost: NGBoostConfigType,
    /** Gaussian Process regressor */
    gp: GPConfigType,
});

/**
 * Configuration for RegressorChain.
 */
export const RegressorChainConfigType = StructType({
    /** Base estimator with its configuration */
    base_estimator: RegressorChainBaseConfigType,
    /** Chain order (indices of targets). None = natural order [0,1,2,...] */
    order: OptionType(ArrayType(IntegerType)),
    /** Random seed for reproducibility */
    random_state: OptionType(IntegerType),
});

// ============================================================================
// Platform Functions
// ============================================================================

/**
 * Split arrays into N subsets (train/test, train/val/test, etc.).
 *
 * @param X - Feature matrix
 * @param Y - Target matrix
 * @param config - Split configuration with split_sizes, stratify, overlap
 * @returns Split result with X_splits, Y_splits arrays
 *
 * @example
 * ```ts
 * // 2-way split (train/test)
 * const result = Sklearn.split(X, Y, { split_sizes: [0.8, 0.2], ... });
 * const [X_train, X_test] = [result.X_splits.get(0n), result.X_splits.get(1n)];
 *
 * // 3-way split (train/val/test)
 * const result = Sklearn.split(X, Y, { split_sizes: [0.7, 0.15, 0.15], ... });
 *
 * // With multi-column stratification
 * const result = Sklearn.split(X, Y, {
 *     split_sizes: [0.7, 0.15, 0.15],
 *     stratify: variant('some', [origin_labels, category_labels]),
 *     overlap: variant('some', [class_labels]),
 * });
 * ```
 */
export const sklearn_split = East.platform(
    "sklearn_split",
    [MatrixType(FloatType), MatrixType(FloatType), SplitConfigType],
    SplitResultType
);

/**
 * Filter target matrices to only contain rows whose categorical values exist in the reference.
 *
 * Given a reference feature matrix (e.g. training data) and one or more target matrices
 * (e.g. validation, calibration), removes rows from each target where any categorical
 * column has a value not seen in the reference.
 *
 * @param X_reference - Reference feature matrix (defines known categories)
 * @param X_targets - Array of target feature matrices to filter
 * @param Y_targets - Array of target label matrices to filter in sync
 * @param config - OverlapConfigType with cat_indices
 * @returns OverlapResultType with X_filtered, Y_filtered, rejected_counts, known_categories
 *
 * @example
 * ```ts
 * // After per-head filtering, ensure val/calib only have categories seen in train
 * const result = Sklearn.overlap(X_train, [X_val, X_calib], [Y_val, Y_calib], { cat_indices: cat_features });
 * const X_val_clean = result.X_filtered.get(0n);
 * const X_calib_clean = result.X_filtered.get(1n);
 * ```
 */
export const sklearn_overlap = East.platform(
    "sklearn_overlap",
    [MatrixType(FloatType), ArrayType(MatrixType(FloatType)), ArrayType(MatrixType(FloatType)), OverlapConfigType],
    OverlapResultType
);

/**
 * Fit a StandardScaler to training data.
 *
 * Standardizes features by removing the mean and scaling to unit variance.
 *
 * @param X - Training feature matrix
 * @returns Model blob containing fitted scaler
 */
export const sklearn_standard_scaler_fit = East.platform(
    "sklearn_standard_scaler_fit",
    [MatrixType(FloatType)],
    SklearnModelBlobType
);

/**
 * Transform data using a fitted StandardScaler.
 *
 * @param model - Fitted scaler model blob
 * @param X - Feature matrix to transform
 * @returns Transformed feature matrix
 */
export const sklearn_standard_scaler_transform = East.platform(
    "sklearn_standard_scaler_transform",
    [SklearnModelBlobType, MatrixType(FloatType)],
    MatrixType(FloatType)
);

/**
 * Fit a MinMaxScaler to training data.
 *
 * Scales features to a given range (default [0, 1]).
 *
 * @param X - Training feature matrix
 * @returns Model blob containing fitted scaler
 */
export const sklearn_min_max_scaler_fit = East.platform(
    "sklearn_min_max_scaler_fit",
    [MatrixType(FloatType)],
    SklearnModelBlobType
);

/**
 * Transform data using a fitted MinMaxScaler.
 *
 * @param model - Fitted scaler model blob
 * @param X - Feature matrix to transform
 * @returns Transformed feature matrix
 */
export const sklearn_min_max_scaler_transform = East.platform(
    "sklearn_min_max_scaler_transform",
    [SklearnModelBlobType, MatrixType(FloatType)],
    MatrixType(FloatType)
);

/**
 * Fit a RobustScaler to training data.
 *
 * Scales features using statistics that are robust to outliers.
 * Centers data using the median and scales using the interquartile range (IQR).
 *
 * @param X - Training feature matrix
 * @returns Model blob containing fitted scaler
 */
export const sklearn_robust_scaler_fit = East.platform(
    "sklearn_robust_scaler_fit",
    [MatrixType(FloatType)],
    SklearnModelBlobType
);

/**
 * Transform data using a fitted RobustScaler.
 *
 * @param model - Fitted scaler model blob
 * @param X - Feature matrix to transform
 * @returns Transformed feature matrix
 */
export const sklearn_robust_scaler_transform = East.platform(
    "sklearn_robust_scaler_transform",
    [SklearnModelBlobType, MatrixType(FloatType)],
    MatrixType(FloatType)
);

/**
 * Fit a LabelEncoder to encode target labels.
 *
 * Encodes labels with values between 0 and n_classes-1.
 *
 * @param y - Target labels (1D integer array)
 * @returns Model blob containing fitted encoder
 */
export const sklearn_label_encoder_fit = East.platform(
    "sklearn_label_encoder_fit",
    [VectorType(IntegerType)],
    SklearnModelBlobType
);

/**
 * Transform labels using a fitted LabelEncoder.
 *
 * @param model - Fitted encoder model blob
 * @param y - Labels to transform
 * @returns Encoded labels (0 to n_classes-1)
 */
export const sklearn_label_encoder_transform = East.platform(
    "sklearn_label_encoder_transform",
    [SklearnModelBlobType, VectorType(IntegerType)],
    VectorType(IntegerType)
);

/**
 * Inverse transform encoded labels back to original values.
 *
 * @param model - Fitted encoder model blob
 * @param y - Encoded labels to inverse transform
 * @returns Original label values
 */
export const sklearn_label_encoder_inverse_transform = East.platform(
    "sklearn_label_encoder_inverse_transform",
    [SklearnModelBlobType, VectorType(IntegerType)],
    VectorType(IntegerType)
);

/**
 * Fit an OrdinalEncoder to encode categorical features.
 *
 * Encodes categorical features as ordinal integers.
 *
 * @param X - Feature matrix with categorical values
 * @returns Model blob containing fitted encoder
 */
export const sklearn_ordinal_encoder_fit = East.platform(
    "sklearn_ordinal_encoder_fit",
    [MatrixType(FloatType)],
    SklearnModelBlobType
);

/**
 * Transform features using a fitted OrdinalEncoder.
 *
 * @param model - Fitted encoder model blob
 * @param X - Feature matrix to transform
 * @returns Encoded feature matrix
 */
export const sklearn_ordinal_encoder_transform = East.platform(
    "sklearn_ordinal_encoder_transform",
    [SklearnModelBlobType, MatrixType(FloatType)],
    MatrixType(FloatType)
);

/**
 * Compute class weights for balanced training.
 *
 * Calculates weights inversely proportional to class frequencies,
 * useful for handling class imbalance in classification tasks.
 *
 * @param mode - How to compute weights (balanced)
 * @param y - Class labels (1D integer array)
 * @returns Weights for each class (ordered by class index)
 */
export const sklearn_compute_class_weight = East.platform(
    "sklearn_compute_class_weight",
    [ClassWeightModeType, VectorType(IntegerType)],
    VectorType(FloatType)
);

/**
 * Compute confusion matrix for classification results.
 *
 * Returns a matrix where entry [i,j] is the number of samples
 * with true label i that were predicted as label j.
 *
 * @param y_true - True class labels (1D integer array)
 * @param y_pred - Predicted class labels (1D integer array)
 * @returns Confusion matrix result with matrix and class labels
 */
export const sklearn_confusion_matrix = East.platform(
    "sklearn_confusion_matrix",
    [VectorType(IntegerType), VectorType(IntegerType)],
    ConfusionMatrixResultType
);

/**
 * Compute ROC AUC score for classification results.
 *
 * For binary classification, pass probabilities for the positive class.
 * For multi-class, pass probability matrix (n_samples x n_classes).
 *
 * @param y_true - True class labels (1D integer array)
 * @param y_proba - Predicted probabilities (matrix: n_samples x n_classes)
 * @param config - Configuration for multi-class handling
 * @returns ROC AUC score
 */
export const sklearn_roc_auc_score = East.platform(
    "sklearn_roc_auc_score",
    [VectorType(IntegerType), MatrixType(FloatType), RocAucConfigType],
    FloatType
);

/**
 * Compute log loss (cross-entropy loss) for classification results.
 *
 * @param y_true - True class labels (1D integer array)
 * @param y_proba - Predicted probabilities (matrix: n_samples x n_classes)
 * @returns Log loss value
 */
export const sklearn_log_loss = East.platform(
    "sklearn_log_loss",
    [VectorType(IntegerType), MatrixType(FloatType)],
    FloatType
);

/**
 * Compute the silhouette score for clustering quality evaluation.
 *
 * The silhouette score measures how similar each sample is to its own cluster
 * compared to other clusters. Values range from -1 to 1, where higher values
 * indicate better-defined clusters.
 *
 * @param X - Feature matrix (n_samples x n_features)
 * @param labels - Cluster labels for each sample (1D integer array)
 * @returns Silhouette score (float, -1 to 1)
 */
export const sklearn_silhouette_score = East.platform(
    "sklearn_silhouette_score",
    [MatrixType(FloatType), VectorType(IntegerType)],
    FloatType
);

/**
 * Train a RegressorChain for multi-target regression.
 *
 * Each model in the chain uses previous targets as additional features,
 * enabling modeling of dependencies between targets.
 *
 * @param X - Feature matrix
 * @param Y - Target matrix (rows=samples, cols=targets)
 * @param config - Chain configuration
 * @returns Model blob containing fitted chain
 */
export const sklearn_regressor_chain_train = East.platform(
    "sklearn_regressor_chain_train",
    [MatrixType(FloatType), MatrixType(FloatType), RegressorChainConfigType],
    SklearnModelBlobType
);

/**
 * Predict using a fitted RegressorChain.
 *
 * @param model - Fitted chain model blob
 * @param X - Feature matrix to predict
 * @returns Predicted target matrix
 */
export const sklearn_regressor_chain_predict = East.platform(
    "sklearn_regressor_chain_predict",
    [SklearnModelBlobType, MatrixType(FloatType)],
    MatrixType(FloatType)
);


// ============================================================================
// GMM Platform Functions
// ============================================================================

/**
 * Fit a Gaussian Mixture Model to data.
 *
 * @param X - Feature matrix (n_samples x n_features)
 * @param config - GMM configuration
 * @returns Model blob containing fitted GMM
 */
export const sklearn_gmm_fit = East.platform(
    "sklearn_gmm_fit",
    [MatrixType(FloatType), GMMConfigType],
    SklearnModelBlobType
);

/**
 * Predict cluster labels for data using a fitted GMM.
 *
 * @param model - Fitted GMM model blob
 * @param X - Feature matrix to predict
 * @returns Predicted cluster labels (0 to n_components-1)
 */
export const sklearn_gmm_predict = East.platform(
    "sklearn_gmm_predict",
    [SklearnModelBlobType, MatrixType(FloatType)],
    VectorType(IntegerType)
);

/**
 * Predict posterior probabilities for each component.
 *
 * @param model - Fitted GMM model blob
 * @param X - Feature matrix
 * @returns Probability matrix (n_samples x n_components)
 */
export const sklearn_gmm_predict_proba = East.platform(
    "sklearn_gmm_predict_proba",
    [SklearnModelBlobType, MatrixType(FloatType)],
    MatrixType(FloatType)
);

/**
 * Compute per-sample log-likelihood under the model.
 *
 * @param model - Fitted GMM model blob
 * @param X - Feature matrix
 * @returns Log-likelihood for each sample
 */
export const sklearn_gmm_score_samples = East.platform(
    "sklearn_gmm_score_samples",
    [SklearnModelBlobType, MatrixType(FloatType)],
    VectorType(FloatType)
);

/**
 * Generate random samples from the fitted GMM.
 *
 * @param model - Fitted GMM model blob
 * @param n_samples - Number of samples to generate
 * @returns Generated samples matrix (n_samples x n_features)
 */
export const sklearn_gmm_sample = East.platform(
    "sklearn_gmm_sample",
    [SklearnModelBlobType, IntegerType],
    MatrixType(FloatType)
);

/**
 * Compute Bayesian Information Criterion for the model on data.
 *
 * Lower BIC indicates a better model. Useful for selecting n_components.
 *
 * @param model - Fitted GMM model blob
 * @param X - Feature matrix
 * @returns BIC score
 */
export const sklearn_gmm_bic = East.platform(
    "sklearn_gmm_bic",
    [SklearnModelBlobType, MatrixType(FloatType)],
    FloatType
);

/**
 * Compute Akaike Information Criterion for the model on data.
 *
 * Lower AIC indicates a better model. Useful for selecting n_components.
 *
 * @param model - Fitted GMM model blob
 * @param X - Feature matrix
 * @returns AIC score
 */
export const sklearn_gmm_aic = East.platform(
    "sklearn_gmm_aic",
    [SklearnModelBlobType, MatrixType(FloatType)],
    FloatType
);

/**
 * Compute regression metrics for single-target predictions.
 *
 * @param y_true - True target values (1D vector)
 * @param y_pred - Predicted target values (1D vector)
 * @param metrics - Array of metrics to compute
 * @returns Array of metric results with scalar values
 */
export const sklearn_compute_metrics = East.platform(
    "sklearn_compute_metrics",
    [VectorType(FloatType), VectorType(FloatType), ArrayType(RegressionMetricType)],
    MetricsResultType
);

/**
 * Compute regression metrics for multi-target predictions.
 *
 * @param Y_true - True target matrix [n_samples, n_targets]
 * @param Y_pred - Predicted target matrix [n_samples, n_targets]
 * @param metrics - Array of metrics to compute
 * @param config - Aggregation configuration
 * @returns Array of metric results with per-target or aggregated values
 */
export const sklearn_compute_metrics_multi = East.platform(
    "sklearn_compute_metrics_multi",
    [MatrixType(FloatType), MatrixType(FloatType), ArrayType(RegressionMetricType), MultiMetricsConfigType],
    MultiMetricsResultType
);

/**
 * Compute classification metrics for single-target predictions.
 *
 * @param y_true - True class labels (1D integer array)
 * @param y_pred - Predicted class labels (1D integer array)
 * @param metrics - Array of metrics to compute
 * @param config - Configuration (averaging strategy)
 * @returns Array of metric results with scalar values
 */
export const sklearn_compute_classification_metrics = East.platform(
    "sklearn_compute_classification_metrics",
    [VectorType(IntegerType), VectorType(IntegerType), ArrayType(ClassificationMetricType), ClassificationMetricsConfigType],
    ClassificationMetricResultsType
);

/**
 * Compute classification metrics for multi-target predictions.
 *
 * @param Y_true - True class labels matrix [n_samples, n_targets]
 * @param Y_pred - Predicted class labels matrix [n_samples, n_targets]
 * @param metrics - Array of metrics to compute
 * @param config - Configuration (averaging, aggregation)
 * @returns Array of metric results with per-target or aggregated values
 */
export const sklearn_compute_classification_metrics_multi = East.platform(
    "sklearn_compute_classification_metrics_multi",
    [MatrixType(FloatType), MatrixType(FloatType), ArrayType(ClassificationMetricType), MultiClassificationConfigType],
    MultiClassificationMetricResultsType
);

// ============================================================================
// Grouped Export
// ============================================================================

/**
 * Type definitions for sklearn functions.
 */
export const SklearnTypes = {
    /** Class weight mode type */
    ClassWeightModeType,
    /** Confusion matrix result type */
    ConfusionMatrixResultType,
    /** ROC AUC multi-class strategy type */
    RocAucMultiClassType,
    /** ROC AUC configuration type */
    RocAucConfigType,
    /** Split configuration type */
    SplitConfigType,
    /** Split result type */
    SplitResultType,
    /** Overlap configuration type */
    OverlapConfigType,
    /** Overlap result type */
    OverlapResultType,
    /** Model blob type for sklearn models */
    ModelBlobType: SklearnModelBlobType,
    /** RegressorChain base estimator config type */
    RegressorChainBaseConfigType,
    /** RegressorChain config type */
    RegressorChainConfigType,
    /** GMM covariance type */
    GMMCovarianceType,
    /** GMM configuration type */
    GMMConfigType,
    // Flexible metrics types
    /** Regression metric variant */
    RegressionMetricType,
    /** Single metric result */
    MetricResultType,
    /** Multiple metrics result */
    MetricsResultType,
    /** Metric aggregation type */
    MetricAggregationType,
    /** Multi-target metrics config */
    MultiMetricsConfigType,
    /** Multi-target metric result */
    MultiMetricResultType,
    /** Multi-target metrics result */
    MultiMetricsResultType,
    /** Cohen's Kappa weights type */
    CohenKappaWeightsType,
    /** Classification metric variant */
    ClassificationMetricType,
    /** Classification averaging type */
    ClassificationAverageType,
    /** Classification metrics config */
    ClassificationMetricsConfigType,
    /** Classification metric result */
    ClassificationMetricResultType,
    /** Classification metrics result */
    ClassificationMetricResultsType,
    /** Multi-target classification config */
    MultiClassificationConfigType,
    /** Multi-target classification metric result */
    MultiClassificationMetricResultType,
    /** Multi-target classification metrics result */
    MultiClassificationMetricResultsType,
} as const;

/**
 * Scikit-learn machine learning utilities.
 *
 * Provides preprocessing, model selection, and metrics for ML workflows.
 *
 * @example
 * ```ts
 * import { East, variant } from "@elaraai/east";
 * import { Sklearn } from "@elaraai/east-py-datascience";
 *
 * const pipeline = East.function([], Sklearn.Types.SplitResultType, $ => {
 *     const X = $.let([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [7.0, 8.0]]);
 *     const y = $.let([1.0, 2.0, 3.0, 4.0]);
 *     const config = $.let({
 *         test_size: variant('some', 0.25),
 *         random_state: variant('some', 42n),
 *         shuffle: variant('some', true),
 *     });
 *     return $.return(Sklearn.trainTestSplit(X, y, config));
 * });
 * ```
 */
export const Sklearn = {
    /**
     * Split arrays into N subsets (train/test, train/val/test, etc.).
     *
     * @example
     * ```ts
     * import { East, FloatType, variant } from "@elaraai/east";
     * import { Sklearn, SplitConfigType, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const splitData = East.function(
     *     [MatrixType(FloatType), MatrixType(FloatType)],
     *     Sklearn.Types.SplitResultType,
     *     ($, X, Y) => {
     *         const config = $.let({
     *             split_sizes: [0.7, 0.15, 0.15],
     *             random_state: variant("some", 42n),
     *             shuffle: variant("some", true),
     *             stratify: variant("none", null),
     *             overlap: variant("none", null),
     *             multi_overlap: variant("none", null),
     *             min_overlap: variant("none", null),
     *         }, SplitConfigType);
     *         return $.return(Sklearn.split(X, Y, config));
     *     }
     * );
     * ```
     */
    split: sklearn_split,
    /**
     * Filter targets to only contain rows with categorical values seen in reference.
     *
     * @example
     * ```ts
     * import { East, FloatType, IntegerType, ArrayType } from "@elaraai/east";
     * import { Sklearn, OverlapConfigType, MatrixType, VectorType } from "@elaraai/east-py-datascience";
     *
     * const filterOverlap = East.function(
     *     [MatrixType(FloatType), ArrayType(MatrixType(FloatType)), ArrayType(MatrixType(FloatType))],
     *     Sklearn.Types.OverlapResultType,
     *     ($, X_ref, X_targets, Y_targets) => {
     *         const config = $.let({
     *             cat_indices: new BigInt64Array([0n, 2n]),
     *         }, OverlapConfigType);
     *         return $.return(Sklearn.overlap(X_ref, X_targets, Y_targets, config));
     *     }
     * );
     * ```
     */
    overlap: sklearn_overlap,
    /**
     * Fit a StandardScaler to training data.
     *
     * Standardizes features by removing the mean and scaling to unit variance.
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Sklearn, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const fitScaler = East.function(
     *     [MatrixType(FloatType)],
     *     Sklearn.Types.ModelBlobType,
     *     ($, X) => {
     *         return $.return(Sklearn.standardScalerFit(X));
     *     }
     * );
     * ```
     */
    standardScalerFit: sklearn_standard_scaler_fit,
    /**
     * Transform data using a fitted StandardScaler.
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Sklearn, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const transform = East.function(
     *     [Sklearn.Types.ModelBlobType, MatrixType(FloatType)],
     *     MatrixType(FloatType),
     *     ($, model, X) => {
     *         return $.return(Sklearn.standardScalerTransform(model, X));
     *     }
     * );
     * ```
     */
    standardScalerTransform: sklearn_standard_scaler_transform,
    /**
     * Fit a MinMaxScaler to training data.
     *
     * Scales features to a given range (default [0, 1]).
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Sklearn, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const fitScaler = East.function(
     *     [MatrixType(FloatType)],
     *     Sklearn.Types.ModelBlobType,
     *     ($, X) => {
     *         return $.return(Sklearn.minMaxScalerFit(X));
     *     }
     * );
     * ```
     */
    minMaxScalerFit: sklearn_min_max_scaler_fit,
    /**
     * Transform data using a fitted MinMaxScaler.
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Sklearn, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const transform = East.function(
     *     [Sklearn.Types.ModelBlobType, MatrixType(FloatType)],
     *     MatrixType(FloatType),
     *     ($, model, X) => {
     *         return $.return(Sklearn.minMaxScalerTransform(model, X));
     *     }
     * );
     * ```
     */
    minMaxScalerTransform: sklearn_min_max_scaler_transform,
    /**
     * Fit a RobustScaler to training data.
     *
     * Scales features using statistics robust to outliers (median and IQR).
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Sklearn, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const fitScaler = East.function(
     *     [MatrixType(FloatType)],
     *     Sklearn.Types.ModelBlobType,
     *     ($, X) => {
     *         return $.return(Sklearn.robustScalerFit(X));
     *     }
     * );
     * ```
     */
    robustScalerFit: sklearn_robust_scaler_fit,
    /**
     * Transform data using a fitted RobustScaler.
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Sklearn, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const transform = East.function(
     *     [Sklearn.Types.ModelBlobType, MatrixType(FloatType)],
     *     MatrixType(FloatType),
     *     ($, model, X) => {
     *         return $.return(Sklearn.robustScalerTransform(model, X));
     *     }
     * );
     * ```
     */
    robustScalerTransform: sklearn_robust_scaler_transform,
    /**
     * Fit a LabelEncoder to encode target labels.
     *
     * Encodes labels with values between 0 and n_classes-1.
     *
     * @example
     * ```ts
     * import { East, IntegerType } from "@elaraai/east";
     * import { Sklearn, VectorType } from "@elaraai/east-py-datascience";
     *
     * const fitEncoder = East.function(
     *     [VectorType(IntegerType)],
     *     Sklearn.Types.ModelBlobType,
     *     ($, y) => {
     *         return $.return(Sklearn.labelEncoderFit(y));
     *     }
     * );
     * ```
     */
    labelEncoderFit: sklearn_label_encoder_fit,
    /**
     * Transform labels using a fitted LabelEncoder.
     *
     * @example
     * ```ts
     * import { East, IntegerType } from "@elaraai/east";
     * import { Sklearn, VectorType } from "@elaraai/east-py-datascience";
     *
     * const transform = East.function(
     *     [Sklearn.Types.ModelBlobType, VectorType(IntegerType)],
     *     VectorType(IntegerType),
     *     ($, model, y) => {
     *         return $.return(Sklearn.labelEncoderTransform(model, y));
     *     }
     * );
     * ```
     */
    labelEncoderTransform: sklearn_label_encoder_transform,
    /**
     * Inverse transform encoded labels back to original values.
     *
     * @example
     * ```ts
     * import { East, IntegerType } from "@elaraai/east";
     * import { Sklearn, VectorType } from "@elaraai/east-py-datascience";
     *
     * const inverse = East.function(
     *     [Sklearn.Types.ModelBlobType, VectorType(IntegerType)],
     *     VectorType(IntegerType),
     *     ($, model, y) => {
     *         return $.return(Sklearn.labelEncoderInverseTransform(model, y));
     *     }
     * );
     * ```
     */
    labelEncoderInverseTransform: sklearn_label_encoder_inverse_transform,
    /**
     * Fit an OrdinalEncoder to encode categorical features.
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Sklearn, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const fitEncoder = East.function(
     *     [MatrixType(FloatType)],
     *     Sklearn.Types.ModelBlobType,
     *     ($, X) => {
     *         return $.return(Sklearn.ordinalEncoderFit(X));
     *     }
     * );
     * ```
     */
    ordinalEncoderFit: sklearn_ordinal_encoder_fit,
    /**
     * Transform features using a fitted OrdinalEncoder.
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Sklearn, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const transform = East.function(
     *     [Sklearn.Types.ModelBlobType, MatrixType(FloatType)],
     *     MatrixType(FloatType),
     *     ($, model, X) => {
     *         return $.return(Sklearn.ordinalEncoderTransform(model, X));
     *     }
     * );
     * ```
     */
    ordinalEncoderTransform: sklearn_ordinal_encoder_transform,
    /**
     * Compute regression metrics for single-target predictions.
     *
     * @example
     * ```ts
     * import { East, FloatType, ArrayType, variant } from "@elaraai/east";
     * import { Sklearn, VectorType, RegressionMetricType } from "@elaraai/east-py-datascience";
     *
     * const evaluate = East.function(
     *     [VectorType(FloatType), VectorType(FloatType)],
     *     Sklearn.Types.MetricsResultType,
     *     ($, y_true, y_pred) => {
     *         const metrics = $.let([
     *             variant("mse", null),
     *             variant("mae", null),
     *             variant("r2", null),
     *         ], ArrayType(RegressionMetricType));
     *         return $.return(Sklearn.computeMetrics(y_true, y_pred, metrics));
     *     }
     * );
     * ```
     */
    computeMetrics: sklearn_compute_metrics,
    /**
     * Compute regression metrics for multi-target predictions.
     *
     * @example
     * ```ts
     * import { East, FloatType, ArrayType, variant } from "@elaraai/east";
     * import { Sklearn, MatrixType, RegressionMetricType, MultiMetricsConfigType } from "@elaraai/east-py-datascience";
     *
     * const evaluate = East.function(
     *     [MatrixType(FloatType), MatrixType(FloatType)],
     *     Sklearn.Types.MultiMetricsResultType,
     *     ($, Y_true, Y_pred) => {
     *         const metrics = $.let([
     *             variant("mse", null),
     *             variant("r2", null),
     *         ], ArrayType(RegressionMetricType));
     *         const config = $.let({
     *             aggregation: variant("some", variant("per_target", null)),
     *         }, MultiMetricsConfigType);
     *         return $.return(Sklearn.computeMetricsMulti(Y_true, Y_pred, metrics, config));
     *     }
     * );
     * ```
     */
    computeMetricsMulti: sklearn_compute_metrics_multi,
    /**
     * Compute classification metrics for single-target predictions.
     *
     * @example
     * ```ts
     * import { East, IntegerType, ArrayType, variant } from "@elaraai/east";
     * import { Sklearn, VectorType, ClassificationMetricType, ClassificationMetricsConfigType } from "@elaraai/east-py-datascience";
     *
     * const evaluate = East.function(
     *     [VectorType(IntegerType), VectorType(IntegerType)],
     *     Sklearn.Types.ClassificationMetricResultsType,
     *     ($, y_true, y_pred) => {
     *         const metrics = $.let([
     *             variant("accuracy", null),
     *             variant("f1", null),
     *             variant("precision", null),
     *         ], ArrayType(ClassificationMetricType));
     *         const config = $.let({
     *             average: variant("some", variant("macro", null)),
     *         }, ClassificationMetricsConfigType);
     *         return $.return(Sklearn.computeClassificationMetrics(y_true, y_pred, metrics, config));
     *     }
     * );
     * ```
     */
    computeClassificationMetrics: sklearn_compute_classification_metrics,
    /**
     * Compute classification metrics for multi-target predictions.
     *
     * @example
     * ```ts
     * import { East, FloatType, ArrayType, variant } from "@elaraai/east";
     * import { Sklearn, MatrixType, ClassificationMetricType, MultiClassificationConfigType } from "@elaraai/east-py-datascience";
     *
     * const evaluate = East.function(
     *     [MatrixType(FloatType), MatrixType(FloatType)],
     *     Sklearn.Types.MultiClassificationMetricResultsType,
     *     ($, Y_true, Y_pred) => {
     *         const metrics = $.let([
     *             variant("accuracy", null),
     *             variant("f1", null),
     *         ], ArrayType(ClassificationMetricType));
     *         const config = $.let({
     *             average: variant("some", variant("macro", null)),
     *             aggregation: variant("some", variant("per_target", null)),
     *         }, MultiClassificationConfigType);
     *         return $.return(Sklearn.computeClassificationMetricsMulti(Y_true, Y_pred, metrics, config));
     *     }
     * );
     * ```
     */
    computeClassificationMetricsMulti: sklearn_compute_classification_metrics_multi,
    /**
     * Compute class weights for balanced training.
     *
     * Calculates weights inversely proportional to class frequencies.
     *
     * @example
     * ```ts
     * import { East, FloatType, IntegerType, variant } from "@elaraai/east";
     * import { Sklearn, VectorType, ClassWeightModeType } from "@elaraai/east-py-datascience";
     *
     * const getWeights = East.function(
     *     [VectorType(IntegerType)],
     *     VectorType(FloatType),
     *     ($, y) => {
     *         const mode = $.let(variant("balanced", null), ClassWeightModeType);
     *         return $.return(Sklearn.computeClassWeight(mode, y));
     *     }
     * );
     * ```
     */
    computeClassWeight: sklearn_compute_class_weight,
    /**
     * Compute confusion matrix for classification results.
     *
     * @example
     * ```ts
     * import { East, IntegerType } from "@elaraai/east";
     * import { Sklearn, VectorType } from "@elaraai/east-py-datascience";
     *
     * const getMatrix = East.function(
     *     [VectorType(IntegerType), VectorType(IntegerType)],
     *     Sklearn.Types.ConfusionMatrixResultType,
     *     ($, y_true, y_pred) => {
     *         return $.return(Sklearn.confusionMatrix(y_true, y_pred));
     *     }
     * );
     * ```
     */
    confusionMatrix: sklearn_confusion_matrix,
    /**
     * Compute ROC AUC score for classification results.
     *
     * @example
     * ```ts
     * import { East, FloatType, IntegerType, variant } from "@elaraai/east";
     * import { Sklearn, VectorType, MatrixType, RocAucConfigType } from "@elaraai/east-py-datascience";
     *
     * const getAuc = East.function(
     *     [VectorType(IntegerType), MatrixType(FloatType)],
     *     FloatType,
     *     ($, y_true, y_proba) => {
     *         const config = $.let({
     *             multi_class: variant("some", variant("ovr", null)),
     *             average: variant("some", variant("macro", null)),
     *         }, RocAucConfigType);
     *         return $.return(Sklearn.rocAucScore(y_true, y_proba, config));
     *     }
     * );
     * ```
     */
    rocAucScore: sklearn_roc_auc_score,
    /**
     * Compute log loss (cross-entropy loss) for classification results.
     *
     * @example
     * ```ts
     * import { East, FloatType, IntegerType } from "@elaraai/east";
     * import { Sklearn, VectorType, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const getLoss = East.function(
     *     [VectorType(IntegerType), MatrixType(FloatType)],
     *     FloatType,
     *     ($, y_true, y_proba) => {
     *         return $.return(Sklearn.logLoss(y_true, y_proba));
     *     }
     * );
     * ```
     */
    logLoss: sklearn_log_loss,
    /**
     * Train a RegressorChain for multi-target regression.
     *
     * Each model in the chain uses previous targets as additional features.
     *
     * @example
     * ```ts
     * import { East, FloatType, variant } from "@elaraai/east";
     * import { Sklearn, MatrixType, RegressorChainConfigType } from "@elaraai/east-py-datascience";
     *
     * const trainChain = East.function(
     *     [MatrixType(FloatType), MatrixType(FloatType)],
     *     Sklearn.Types.ModelBlobType,
     *     ($, X, Y) => {
     *         const config = $.let({
     *             base_estimator: variant("xgboost", {
     *                 n_estimators: variant("some", 100n),
     *                 max_depth: variant("some", 3n),
     *                 learning_rate: variant("some", 0.1),
     *                 min_child_weight: variant("none", null),
     *                 subsample: variant("none", null),
     *                 colsample_bytree: variant("none", null),
     *                 reg_alpha: variant("none", null),
     *                 reg_lambda: variant("none", null),
     *                 gamma: variant("none", null),
     *                 random_state: variant("some", 42n),
     *                 n_jobs: variant("none", null),
     *                 sample_weight: variant("none", null),
     *                 categorical_features: variant("none", null),
     *                 categorical_n: variant("none", null),
     *                 max_cat_to_onehot: variant("none", null),
     *                 max_cat_threshold: variant("none", null),
     *             }),
     *             order: variant("none", null),
     *             random_state: variant("some", 42n),
     *         }, RegressorChainConfigType);
     *         return $.return(Sklearn.regressorChainTrain(X, Y, config));
     *     }
     * );
     * ```
     */
    regressorChainTrain: sklearn_regressor_chain_train,
    /**
     * Predict using a fitted RegressorChain.
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Sklearn, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const predict = East.function(
     *     [Sklearn.Types.ModelBlobType, MatrixType(FloatType)],
     *     MatrixType(FloatType),
     *     ($, model, X) => {
     *         return $.return(Sklearn.regressorChainPredict(model, X));
     *     }
     * );
     * ```
     */
    regressorChainPredict: sklearn_regressor_chain_predict,
    /**
     * Fit a Gaussian Mixture Model to data.
     *
     * @example
     * ```ts
     * import { East, FloatType, variant } from "@elaraai/east";
     * import { Sklearn, MatrixType, GMMConfigType } from "@elaraai/east-py-datascience";
     *
     * const fitGmm = East.function(
     *     [MatrixType(FloatType)],
     *     Sklearn.Types.ModelBlobType,
     *     ($, X) => {
     *         const config = $.let({
     *             n_components: variant("some", 3n),
     *             covariance_type: variant("some", variant("full", null)),
     *             max_iter: variant("none", null),
     *             n_init: variant("none", null),
     *             tol: variant("none", null),
     *             reg_covar: variant("none", null),
     *             random_state: variant("some", 42n),
     *         }, GMMConfigType);
     *         return $.return(Sklearn.gmmFit(X, config));
     *     }
     * );
     * ```
     */
    gmmFit: sklearn_gmm_fit,
    /**
     * Predict cluster labels for data using a fitted GMM.
     *
     * @example
     * ```ts
     * import { East, FloatType, IntegerType } from "@elaraai/east";
     * import { Sklearn, MatrixType, VectorType } from "@elaraai/east-py-datascience";
     *
     * const predict = East.function(
     *     [Sklearn.Types.ModelBlobType, MatrixType(FloatType)],
     *     VectorType(IntegerType),
     *     ($, model, X) => {
     *         return $.return(Sklearn.gmmPredict(model, X));
     *     }
     * );
     * ```
     */
    gmmPredict: sklearn_gmm_predict,
    /**
     * Predict posterior probabilities for each GMM component.
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Sklearn, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const predictProba = East.function(
     *     [Sklearn.Types.ModelBlobType, MatrixType(FloatType)],
     *     MatrixType(FloatType),
     *     ($, model, X) => {
     *         return $.return(Sklearn.gmmPredictProba(model, X));
     *     }
     * );
     * ```
     */
    gmmPredictProba: sklearn_gmm_predict_proba,
    /**
     * Compute per-sample log-likelihood under the fitted GMM.
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Sklearn, MatrixType, VectorType } from "@elaraai/east-py-datascience";
     *
     * const score = East.function(
     *     [Sklearn.Types.ModelBlobType, MatrixType(FloatType)],
     *     VectorType(FloatType),
     *     ($, model, X) => {
     *         return $.return(Sklearn.gmmScoreSamples(model, X));
     *     }
     * );
     * ```
     */
    gmmScoreSamples: sklearn_gmm_score_samples,
    /**
     * Generate random samples from the fitted GMM.
     *
     * @example
     * ```ts
     * import { East, FloatType, IntegerType } from "@elaraai/east";
     * import { Sklearn, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const generate = East.function(
     *     [Sklearn.Types.ModelBlobType, IntegerType],
     *     MatrixType(FloatType),
     *     ($, model, n) => {
     *         return $.return(Sklearn.gmmSample(model, n));
     *     }
     * );
     * ```
     */
    gmmSample: sklearn_gmm_sample,
    /**
     * Compute Bayesian Information Criterion for a fitted GMM.
     *
     * Lower BIC indicates a better model. Useful for selecting n_components.
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Sklearn, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const getBic = East.function(
     *     [Sklearn.Types.ModelBlobType, MatrixType(FloatType)],
     *     FloatType,
     *     ($, model, X) => {
     *         return $.return(Sklearn.gmmBic(model, X));
     *     }
     * );
     * ```
     */
    gmmBic: sklearn_gmm_bic,
    /**
     * Compute Akaike Information Criterion for a fitted GMM.
     *
     * Lower AIC indicates a better model. Useful for selecting n_components.
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Sklearn, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const getAic = East.function(
     *     [Sklearn.Types.ModelBlobType, MatrixType(FloatType)],
     *     FloatType,
     *     ($, model, X) => {
     *         return $.return(Sklearn.gmmAic(model, X));
     *     }
     * );
     * ```
     */
    gmmAic: sklearn_gmm_aic,
    /**
     * Compute the silhouette score for clustering quality evaluation.
     *
     * Values range from -1 to 1: higher means better-separated clusters.
     *
     * @example
     * ```ts
     * import { East, FloatType, IntegerType } from "@elaraai/east";
     * import { Sklearn, MatrixType, VectorType } from "@elaraai/east-py-datascience";
     *
     * const score = East.function(
     *     [MatrixType(FloatType), VectorType(IntegerType)],
     *     FloatType,
     *     ($, X, labels) => {
     *         return $.return(Sklearn.silhouetteScore(X, labels));
     *     }
     * );
     * ```
     */
    silhouetteScore: sklearn_silhouette_score,
    /** Type definitions */
    Types: SklearnTypes,
} as const;
