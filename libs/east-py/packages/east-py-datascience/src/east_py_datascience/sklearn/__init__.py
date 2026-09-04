#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Sklearn utilities for East - preprocessing, model selection, and metrics.

The platform functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip. The East type definitions
(config, blob, and result types) are re-exported here for building inputs with
``coerce_to`` and validating outputs.
"""

from east_py_datascience.sklearn.sklearn import (
    # Class weights
    sklearn_compute_class_weight,
    # Metrics - classification (single-target)
    sklearn_compute_classification_metrics,
    # Metrics - classification (multi-target)
    sklearn_compute_classification_metrics_multi,
    # Metrics - regression (single-target)
    sklearn_compute_metrics,
    # Metrics - regression (multi-target)
    sklearn_compute_metrics_multi,
    # Metrics - confusion / roc / log-loss / silhouette
    sklearn_confusion_matrix,
    sklearn_gmm_aic,
    sklearn_gmm_bic,
    # Gaussian Mixture Model
    sklearn_gmm_fit,
    sklearn_gmm_predict,
    sklearn_gmm_predict_proba,
    sklearn_gmm_sample,
    sklearn_gmm_score_samples,
    # Platform registration
    sklearn_impl,
    # Encoders
    sklearn_label_encoder_fit,
    sklearn_label_encoder_inverse_transform,
    sklearn_label_encoder_transform,
    sklearn_log_loss,
    sklearn_min_max_scaler_fit,
    sklearn_min_max_scaler_transform,
    sklearn_ordinal_encoder_fit,
    sklearn_ordinal_encoder_transform,
    # Overlap filtering
    sklearn_overlap,
    sklearn_regressor_chain_predict,
    # RegressorChain
    sklearn_regressor_chain_train,
    sklearn_robust_scaler_fit,
    sklearn_robust_scaler_transform,
    sklearn_roc_auc_score,
    sklearn_silhouette_score,
    # Splitting
    sklearn_split,
    # Scalers
    sklearn_standard_scaler_fit,
    sklearn_standard_scaler_transform,
)
from east_py_datascience.types import (
    ClassificationAverageType,
    ClassificationMetricResultsType,
    ClassificationMetricResultType,
    ClassificationMetricsConfigType,
    ClassificationMetricType,
    # Class weight type
    ClassWeightModeType,
    # Classification metric types
    CohenKappaWeightsType,
    # Confusion matrix type
    ConfusionMatrixResultType,
    GMMConfigType,
    # GMM types
    GMMCovarianceType,
    MetricAggregationType,
    MetricResultType,
    MetricsResultType,
    MultiClassificationConfigType,
    MultiClassificationMetricResultsType,
    MultiClassificationMetricResultType,
    MultiMetricResultType,
    MultiMetricsConfigType,
    MultiMetricsResultType,
    MultiMetricValueType,
    # Overlap types
    OverlapConfigType,
    OverlapResultType,
    # Regression metric types
    RegressionMetricType,
    # RegressorChain types
    RegressorChainBaseConfigType,
    RegressorChainConfigType,
    # ROC AUC types
    RocAucConfigType,
    RocAucMultiClassType,
    # Sklearn model blob type
    SklearnModelBlobType,
    # Split types
    SplitConfigType,
    SplitResultType,
)

__all__ = [
    # Platform registration
    "sklearn_impl",
    # Directly-callable implementations
    "sklearn_split",
    "sklearn_overlap",
    "sklearn_standard_scaler_fit",
    "sklearn_standard_scaler_transform",
    "sklearn_min_max_scaler_fit",
    "sklearn_min_max_scaler_transform",
    "sklearn_robust_scaler_fit",
    "sklearn_robust_scaler_transform",
    "sklearn_label_encoder_fit",
    "sklearn_label_encoder_transform",
    "sklearn_label_encoder_inverse_transform",
    "sklearn_ordinal_encoder_fit",
    "sklearn_ordinal_encoder_transform",
    "sklearn_compute_class_weight",
    "sklearn_compute_metrics",
    "sklearn_compute_metrics_multi",
    "sklearn_compute_classification_metrics",
    "sklearn_compute_classification_metrics_multi",
    "sklearn_confusion_matrix",
    "sklearn_roc_auc_score",
    "sklearn_log_loss",
    "sklearn_silhouette_score",
    "sklearn_regressor_chain_train",
    "sklearn_regressor_chain_predict",
    "sklearn_gmm_fit",
    "sklearn_gmm_predict",
    "sklearn_gmm_predict_proba",
    "sklearn_gmm_score_samples",
    "sklearn_gmm_sample",
    "sklearn_gmm_bic",
    "sklearn_gmm_aic",
    # East type definitions
    "SplitConfigType",
    "SplitResultType",
    "OverlapConfigType",
    "OverlapResultType",
    "ClassWeightModeType",
    "ConfusionMatrixResultType",
    "RocAucConfigType",
    "RocAucMultiClassType",
    "RegressionMetricType",
    "MetricResultType",
    "MetricsResultType",
    "MetricAggregationType",
    "MultiMetricsConfigType",
    "MultiMetricValueType",
    "MultiMetricResultType",
    "MultiMetricsResultType",
    "CohenKappaWeightsType",
    "ClassificationMetricType",
    "ClassificationAverageType",
    "ClassificationMetricsConfigType",
    "ClassificationMetricResultType",
    "ClassificationMetricResultsType",
    "MultiClassificationConfigType",
    "MultiClassificationMetricResultType",
    "MultiClassificationMetricResultsType",
    "RegressorChainBaseConfigType",
    "RegressorChainConfigType",
    "GMMCovarianceType",
    "GMMConfigType",
    "SklearnModelBlobType",
]
