/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * MAPIE conformal prediction intervals for East.
 *
 * Provides prediction intervals with coverage guarantees using
 * conformal prediction methods (MAPIE 1.2.0 API).
 *
 * @packageDocumentation
 */

import {
    East,
    StructType,
    VariantType,
    OptionType,
    ArrayType,
    IntegerType,
    FloatType,
    BlobType,
    NullType,
} from "@elaraai/east";
import { VectorType, MatrixType } from "../types.js";
import { XGBoostConfigType, XGBoostModelBlobType } from "../xgboost/xgboost.js";
import { LightGBMConfigType, LightGBMModelBlobType } from "../lightgbm/lightgbm.js";

// Re-export shared types for convenience
export { VectorType, MatrixType } from "../types.js";
export { XGBoostConfigType, XGBoostModelBlobType } from "../xgboost/xgboost.js";
export { LightGBMConfigType, LightGBMModelBlobType } from "../lightgbm/lightgbm.js";

// ============================================================================
// Config Types
// ============================================================================

/**
 * Conformal prediction method for regression.
 */
export const ConformalMethodType = VariantType({
    /** Split conformal - requires separate calibration set */
    split: NullType,
    /** Cross conformal - uses CV for calibration (combines train + calib) */
    cross: NullType,
});

/**
 * Base model type for MAPIE regression.
 * Uses full XGBoost/LightGBM config types for complete parameter support.
 */
export const BaseModelType = VariantType({
    /** XGBoost regressor as base model */
    xgboost: XGBoostConfigType,
    /** LightGBM regressor as base model */
    lightgbm: LightGBMConfigType,
});

/**
 * Configuration for MAPIE conformal prediction.
 */
export const MAPIEConfigType = StructType({
    /** Base model configuration */
    base_model: BaseModelType,
    /** Conformal method (default: split) */
    method: OptionType(ConformalMethodType),
    /** Confidence level: coverage probability (default 0.9 = 90% intervals) */
    confidence_level: OptionType(FloatType),
    /** Number of CV folds for cross method (default 5) */
    cv_folds: OptionType(IntegerType),
    /** Random seed for reproducibility */
    random_state: OptionType(IntegerType),
    /** Conformity score consistency check tolerance (default 1e-04) */
    conformity_eps: OptionType(FloatType),
});

/**
 * Configuration for CQR (Conformalized Quantile Regression).
 * Requires a base model that supports quantile regression (XGBoost).
 */
export const MAPIECQRConfigType = StructType({
    /** XGBoost config for the base quantile model */
    xgboost_config: XGBoostConfigType,
    /** Confidence level: coverage probability (default 0.9 = 90% intervals) */
    confidence_level: OptionType(FloatType),
    /** Random seed for reproducibility */
    random_state: OptionType(IntegerType),
});

// ============================================================================
// Classification Config Types
// ============================================================================

/**
 * Classification conformal method (conformity score).
 */
export const ClassificationMethodType = VariantType({
    /** Least Ambiguous set-valued Classifier - smallest sets */
    lac: NullType,
    /** Adaptive Prediction Sets - adapts to probabilities */
    aps: NullType,
});

/**
 * Base classifier type for MAPIE classification.
 * Uses full XGBoost/LightGBM config types for complete parameter support.
 */
export const BaseClassifierType = VariantType({
    /** XGBoost classifier as base model */
    xgboost: XGBoostConfigType,
    /** LightGBM classifier as base model */
    lightgbm: LightGBMConfigType,
});

/**
 * Configuration for MAPIE conformal classification.
 */
export const MAPIEClassifierConfigType = StructType({
    /** Base classifier configuration */
    base_model: BaseClassifierType,
    /** Classification conformity score method (default: lac) */
    method: OptionType(ClassificationMethodType),
    /** Confidence level: coverage probability (default 0.9 = 90% coverage) */
    confidence_level: OptionType(FloatType),
    /** Random seed for reproducibility */
    random_state: OptionType(IntegerType),
});

// ============================================================================
// Model Blob Types
// ============================================================================

/**
 * Tagged model data - variant tag indicates base model type, value is the serialized blob.
 * This pattern encodes the model type in the variant tag rather than a separate field.
 */
export const MAPIEBaseModelDataType = VariantType({
    /** XGBoost-based model (structured blob with categorical metadata) */
    xgboost: XGBoostModelBlobType,
    /** LightGBM-based model (structured blob) */
    lightgbm: LightGBMModelBlobType,
    /** Histogram-based model (sklearn HistGradientBoosting, used by CQR) */
    histogram: BlobType,
});

/**
 * Model blob for MAPIE conformal regressor.
 */
export const MAPIERegressorBlobType = VariantType({
    /** MAPIE regressor with split conformal */
    mapie_split: StructType({
        /** Serialized model - variant tag indicates base model type (xgboost/lightgbm) */
        data: MAPIEBaseModelDataType,
        /** Number of input features */
        n_features: IntegerType,
        /** Confidence level used during calibration */
        confidence_level: FloatType,
    }),
    /** MAPIE regressor with cross conformal */
    mapie_cross: StructType({
        /** Serialized model - variant tag indicates base model type (xgboost/lightgbm) */
        data: MAPIEBaseModelDataType,
        /** Number of input features */
        n_features: IntegerType,
        /** Confidence level used during calibration */
        confidence_level: FloatType,
    }),
    /** MAPIE CQR regressor (uses HistGradientBoosting internally) */
    mapie_cqr: StructType({
        /** Serialized model - variant tag indicates base model type */
        data: MAPIEBaseModelDataType,
        /** Number of input features */
        n_features: IntegerType,
        /** Confidence level used during calibration */
        confidence_level: FloatType,
    }),
});

/**
 * Model blob for MAPIE conformal classifier.
 * Uses single-case variant for consistency with MAPIERegressorBlobType and AnyModelBlobType.
 */
export const MAPIEClassifierBlobType = VariantType({
    /** MAPIE classifier with split conformal */
    mapie_classifier: StructType({
        /** Serialized model - variant tag indicates base model type (xgboost/lightgbm) */
        data: MAPIEBaseModelDataType,
        /** Number of input features */
        n_features: IntegerType,
        /** Number of classes */
        n_classes: IntegerType,
        /** Class labels */
        classes: VectorType(IntegerType),
        /** Confidence level used during calibration */
        confidence_level: FloatType,
    }),
});

// ============================================================================
// Uncertainty Predictor Types (for SHAP integration)
// ============================================================================

/**
 * Uncertainty predictor blob type.
 * Wraps MAPIE model to predict uncertainty measure (interval width or set size).
 * Compatible with SHAP's KernelExplainer for explaining uncertainty.
 */
export const UncertaintyPredictorType = VariantType({
    /** Predicts interval width (upper - lower) from MAPIE regressor */
    mapie_interval_width: StructType({
        data: BlobType,
        n_features: IntegerType,
    }),
    /** Predicts prediction set size from MAPIE classifier */
    mapie_set_size: StructType({
        data: BlobType,
        n_features: IntegerType,
    }),
});

// ============================================================================
// Result Types
// ============================================================================

/**
 * Prediction interval result (regression).
 */
export const IntervalResultType = StructType({
    /** Lower bound of prediction interval */
    lower: VectorType(FloatType),
    /** Point prediction (median/mean) */
    pred: VectorType(FloatType),
    /** Upper bound of prediction interval */
    upper: VectorType(FloatType),
});

/**
 * Prediction set result (classification).
 * For each sample, contains the set of classes included in the prediction set.
 */
export const PredictionSetResultType = StructType({
    /** Predicted class (argmax of probabilities) */
    pred: VectorType(IntegerType),
    /** Prediction set membership matrix (n_samples x n_classes, 1 if class in set) */
    sets: ArrayType(ArrayType(IntegerType)),
    /** Class probabilities (n_samples x n_classes) */
    probabilities: MatrixType(FloatType),
    /** Size of each prediction set */
    set_sizes: VectorType(IntegerType),
});

// ============================================================================
// Platform Functions
// ============================================================================

// --------------------------------
// Regression Functions
// --------------------------------

/**
 * Train a MAPIE conformal regressor.
 *
 * For split conformal, uses X_calib/y_calib for calibration.
 * For cross conformal, combines train and calib data, uses CV for calibration.
 *
 * @param X_train - Training feature matrix
 * @param y_train - Training target vector
 * @param X_calib - Calibration feature matrix
 * @param y_calib - Calibration target vector
 * @param config - MAPIE configuration
 * @returns Model blob containing calibrated MAPIE regressor
 */
export const mapie_train_conformal_regressor = East.platform(
    "mapie_train_conformal_regressor",
    [MatrixType(FloatType), VectorType(FloatType), MatrixType(FloatType), VectorType(FloatType), MAPIEConfigType],
    MAPIERegressorBlobType
);

/**
 * Train a MAPIE CQR (Conformalized Quantile Regression) model.
 *
 * CQR combines quantile regression with conformal prediction for
 * adaptive intervals that are wider where uncertainty is higher.
 *
 * @param X_train - Training feature matrix
 * @param y_train - Training target vector
 * @param X_calib - Calibration feature matrix
 * @param y_calib - Calibration target vector
 * @param config - CQR configuration
 * @returns Model blob containing calibrated CQR model
 */
export const mapie_train_cqr = East.platform(
    "mapie_train_cqr",
    [MatrixType(FloatType), VectorType(FloatType), MatrixType(FloatType), VectorType(FloatType), MAPIECQRConfigType],
    MAPIERegressorBlobType
);

/**
 * Predict with intervals using a MAPIE regressor.
 *
 * Returns intervals at the confidence level specified during training.
 *
 * @param model - Trained MAPIE regressor blob
 * @param X - Feature matrix to predict
 * @returns Prediction intervals (lower, pred, upper)
 */
export const mapie_predict_interval = East.platform(
    "mapie_predict_interval",
    [MAPIERegressorBlobType, MatrixType(FloatType)],
    IntervalResultType
);

// --------------------------------
// Classification Functions
// --------------------------------

/**
 * Train a MAPIE conformal classifier.
 *
 * Uses split conformal prediction with calibration set for classification.
 *
 * @param X_train - Training feature matrix
 * @param y_train - Training labels (integers)
 * @param X_calib - Calibration feature matrix
 * @param y_calib - Calibration labels
 * @param config - Classifier configuration
 * @returns Model blob containing calibrated MAPIE classifier
 */
export const mapie_train_conformal_classifier = East.platform(
    "mapie_train_conformal_classifier",
    [MatrixType(FloatType), VectorType(IntegerType), MatrixType(FloatType), VectorType(IntegerType), MAPIEClassifierConfigType],
    MAPIEClassifierBlobType
);

/**
 * Predict with prediction sets using a MAPIE classifier.
 *
 * Returns prediction sets at the confidence level specified during training.
 *
 * @param model - Trained MAPIE classifier blob
 * @param X - Feature matrix to predict
 * @returns Prediction sets (pred, sets, probabilities, set_sizes)
 */
export const mapie_predict_set = East.platform(
    "mapie_predict_set",
    [MAPIEClassifierBlobType, MatrixType(FloatType)],
    PredictionSetResultType
);

// --------------------------------
// SHAP Integration Functions
// --------------------------------

/**
 * Create an uncertainty predictor from a MAPIE regressor.
 *
 * Returns a model that predicts interval width (upper - lower) instead of
 * point predictions. Use with SHAP KernelExplainer to explain what drives
 * prediction uncertainty.
 *
 * @param model - MAPIE regressor blob
 * @returns Uncertainty predictor blob for use with SHAP KernelExplainer
 */
export const mapie_uncertainty_predictor_regressor = East.platform(
    "mapie_uncertainty_predictor_regressor",
    [MAPIERegressorBlobType],
    UncertaintyPredictorType
);

/**
 * Create an uncertainty predictor from a MAPIE classifier.
 *
 * Returns a model that predicts prediction set size instead of class labels.
 * Use with SHAP KernelExplainer to explain what drives prediction uncertainty.
 *
 * @param model - MAPIE classifier blob
 * @returns Uncertainty predictor blob for use with SHAP KernelExplainer
 */
export const mapie_uncertainty_predictor_classifier = East.platform(
    "mapie_uncertainty_predictor_classifier",
    [MAPIEClassifierBlobType],
    UncertaintyPredictorType
);

// ============================================================================
// Grouped Export
// ============================================================================

/**
 * Type definitions for MAPIE functions.
 */
export const MAPIETypes = {
    // Config types
    ConformalMethodType,
    XGBoostConfigType,
    LightGBMConfigType,
    BaseModelType,
    MAPIEConfigType,
    MAPIECQRConfigType,
    ClassificationMethodType,
    BaseClassifierType,
    MAPIEClassifierConfigType,
    // Model blob types
    MAPIEBaseModelDataType,
    MAPIERegressorBlobType,
    MAPIEClassifierBlobType,
    // Uncertainty predictor type (for SHAP)
    UncertaintyPredictorType,
    // Result types
    IntervalResultType,
    PredictionSetResultType,
} as const;

/**
 * MAPIE conformal prediction.
 *
 * Provides prediction intervals with coverage guarantees using
 * conformal prediction methods (MAPIE 1.2.0 API).
 *
 * @example
 * ```ts
 * import { East, variant } from "@elaraai/east";
 * import { MAPIE } from "@elaraai/east-py-datascience";
 *
 * const train = East.function([], MAPIE.Types.MAPIERegressorBlobType, $ => {
 *     const X_train = $.let([[1.0], [2.0], [3.0], [4.0], [5.0]]);
 *     const y_train = $.let([1.5, 2.5, 3.5, 4.5, 5.5]);
 *     const X_calib = $.let([[2.5], [4.5]]);
 *     const y_calib = $.let([3.0, 5.0]);
 *     const config = $.let({
 *         base_model: variant('xgboost', {
 *             n_estimators: variant('some', 50n),
 *             max_depth: variant('some', 3n),
 *             learning_rate: variant('some', 0.1),
 *             min_child_weight: variant('none', null),
 *             subsample: variant('none', null),
 *             colsample_bytree: variant('none', null),
 *             reg_alpha: variant('none', null),
 *             reg_lambda: variant('none', null),
 *             gamma: variant('none', null),
 *             random_state: variant('some', 42n),
 *             n_jobs: variant('none', null),
 *             sample_weight: variant('none', null),
 *             categorical_features: variant('none', null),
 *             categorical_n: variant('none', null),
 *             max_cat_to_onehot: variant('none', null),
 *             max_cat_threshold: variant('none', null),
 *         }),
 *         method: variant('some', variant('split', null)),
 *         confidence_level: variant('some', 0.9),
 *         cv_folds: variant('none', null),
 *         random_state: variant('some', 42n),
 *         conformity_eps: variant('none', null),
 *     });
 *     return $.return(MAPIE.trainConformalRegressor(X_train, y_train, X_calib, y_calib, config));
 * });
 * ```
 */
export const MAPIE = {
    // Regression
    /**
     * Train a MAPIE conformal regressor.
     *
     * For split conformal, uses X_calib/y_calib for calibration.
     * For cross conformal, combines train and calib data, uses CV.
     *
     * @example
     * ```ts
     * import { East, FloatType, variant } from "@elaraai/east";
     * import { MAPIE, MAPIEConfigType, MatrixType, VectorType } from "@elaraai/east-py-datascience";
     *
     * const train = East.function(
     *     [MatrixType(FloatType), VectorType(FloatType), MatrixType(FloatType), VectorType(FloatType)],
     *     MAPIE.Types.MAPIERegressorBlobType,
     *     ($, X_train, y_train, X_calib, y_calib) => {
     *         const config = $.let({
     *             base_model: variant("xgboost", {
     *                 n_estimators: variant("some", 50n),
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
     *             method: variant("some", variant("split", null)),
     *             confidence_level: variant("some", 0.9),
     *             cv_folds: variant("none", null),
     *             random_state: variant("some", 42n),
     *             conformity_eps: variant("none", null),
     *         }, MAPIEConfigType);
     *         return $.return(MAPIE.trainConformalRegressor(X_train, y_train, X_calib, y_calib, config));
     *     }
     * );
     * ```
     */
    trainConformalRegressor: mapie_train_conformal_regressor,
    /**
     * Train a MAPIE CQR (Conformalized Quantile Regression) model.
     *
     * CQR combines quantile regression with conformal prediction for
     * adaptive intervals that are wider where uncertainty is higher.
     *
     * @example
     * ```ts
     * import { East, FloatType, variant } from "@elaraai/east";
     * import { MAPIE, MAPIECQRConfigType, MatrixType, VectorType } from "@elaraai/east-py-datascience";
     *
     * const train = East.function(
     *     [MatrixType(FloatType), VectorType(FloatType), MatrixType(FloatType), VectorType(FloatType)],
     *     MAPIE.Types.MAPIERegressorBlobType,
     *     ($, X_train, y_train, X_calib, y_calib) => {
     *         const config = $.let({
     *             xgboost_config: {
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
     *             },
     *             confidence_level: variant("some", 0.9),
     *             random_state: variant("some", 42n),
     *         }, MAPIECQRConfigType);
     *         return $.return(MAPIE.trainCQR(X_train, y_train, X_calib, y_calib, config));
     *     }
     * );
     * ```
     */
    trainCQR: mapie_train_cqr,
    /**
     * Predict with intervals using a trained MAPIE regressor.
     *
     * Returns intervals at the confidence level specified during training.
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { MAPIE, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const predict = East.function(
     *     [MAPIE.Types.MAPIERegressorBlobType, MatrixType(FloatType)],
     *     MAPIE.Types.IntervalResultType,
     *     ($, model, X) => {
     *         const result = $.let(MAPIE.predictInterval(model, X));
     *         // result.lower => lower bound of prediction interval
     *         // result.pred  => point prediction
     *         // result.upper => upper bound of prediction interval
     *         return $.return(result);
     *     }
     * );
     * ```
     */
    predictInterval: mapie_predict_interval,
    // Classification
    /**
     * Train a MAPIE conformal classifier.
     *
     * Uses split conformal prediction with calibration set for classification.
     *
     * @example
     * ```ts
     * import { East, FloatType, IntegerType, variant } from "@elaraai/east";
     * import { MAPIE, MAPIEClassifierConfigType, MatrixType, VectorType } from "@elaraai/east-py-datascience";
     *
     * const train = East.function(
     *     [MatrixType(FloatType), VectorType(IntegerType), MatrixType(FloatType), VectorType(IntegerType)],
     *     MAPIE.Types.MAPIEClassifierBlobType,
     *     ($, X_train, y_train, X_calib, y_calib) => {
     *         const config = $.let({
     *             base_model: variant("xgboost", {
     *                 n_estimators: variant("some", 50n),
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
     *             method: variant("some", variant("lac", null)),
     *             confidence_level: variant("some", 0.9),
     *             random_state: variant("some", 42n),
     *         }, MAPIEClassifierConfigType);
     *         return $.return(MAPIE.trainConformalClassifier(X_train, y_train, X_calib, y_calib, config));
     *     }
     * );
     * ```
     */
    trainConformalClassifier: mapie_train_conformal_classifier,
    /**
     * Predict with prediction sets using a MAPIE classifier.
     *
     * Returns prediction sets at the confidence level specified during training.
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { MAPIE, MatrixType } from "@elaraai/east-py-datascience";
     *
     * const predict = East.function(
     *     [MAPIE.Types.MAPIEClassifierBlobType, MatrixType(FloatType)],
     *     MAPIE.Types.PredictionSetResultType,
     *     ($, model, X) => {
     *         const result = $.let(MAPIE.predictSet(model, X));
     *         // result.pred       => predicted class labels
     *         // result.sets       => prediction set membership matrix
     *         // result.set_sizes  => size of each prediction set
     *         return $.return(result);
     *     }
     * );
     * ```
     */
    predictSet: mapie_predict_set,
    // SHAP integration (uncertainty explanation)
    /**
     * Create an uncertainty predictor from a MAPIE regressor.
     *
     * Returns a model that predicts interval width (upper - lower).
     * Use with SHAP KernelExplainer to explain what drives uncertainty.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { MAPIE } from "@elaraai/east-py-datascience";
     *
     * const makePredictor = East.function(
     *     [MAPIE.Types.MAPIERegressorBlobType],
     *     MAPIE.Types.UncertaintyPredictorType,
     *     ($, model) => {
     *         return $.return(MAPIE.uncertaintyPredictorRegressor(model));
     *     }
     * );
     * ```
     */
    uncertaintyPredictorRegressor: mapie_uncertainty_predictor_regressor,
    /**
     * Create an uncertainty predictor from a MAPIE classifier.
     *
     * Returns a model that predicts prediction set size.
     * Use with SHAP KernelExplainer to explain what drives uncertainty.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { MAPIE } from "@elaraai/east-py-datascience";
     *
     * const makePredictor = East.function(
     *     [MAPIE.Types.MAPIEClassifierBlobType],
     *     MAPIE.Types.UncertaintyPredictorType,
     *     ($, model) => {
     *         return $.return(MAPIE.uncertaintyPredictorClassifier(model));
     *     }
     * );
     * ```
     */
    uncertaintyPredictorClassifier: mapie_uncertainty_predictor_classifier,
    /** Type definitions */
    Types: MAPIETypes,
} as const;
