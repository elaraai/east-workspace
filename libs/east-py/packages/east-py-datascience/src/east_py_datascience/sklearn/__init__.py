#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Sklearn utilities for East - preprocessing, model selection, and metrics.

The ``*_impl`` functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip. The East type definitions
(config, blob, and result types) are re-exported here for building inputs with
``coerce_to`` and validating outputs.
"""

from east_py_datascience.sklearn.sklearn import (
    # Class weights
    sklearn_compute_class_weight_impl,
    # Metrics - classification (single-target)
    sklearn_compute_classification_metrics_impl,
    # Metrics - classification (multi-target)
    sklearn_compute_classification_metrics_multi_impl,
    # Metrics - regression (single-target)
    sklearn_compute_metrics_impl,
    # Metrics - regression (multi-target)
    sklearn_compute_metrics_multi_impl,
    # Metrics - confusion / roc / log-loss / silhouette
    sklearn_confusion_matrix_impl,
    sklearn_gmm_aic_impl,
    sklearn_gmm_bic_impl,
    # Gaussian Mixture Model
    sklearn_gmm_fit_impl,
    sklearn_gmm_predict_impl,
    sklearn_gmm_predict_proba_impl,
    sklearn_gmm_sample_impl,
    sklearn_gmm_score_samples_impl,
    # Platform registration
    sklearn_impl,
    # Encoders
    sklearn_label_encoder_fit_impl,
    sklearn_label_encoder_inverse_transform_impl,
    sklearn_label_encoder_transform_impl,
    sklearn_log_loss_impl,
    sklearn_min_max_scaler_fit_impl,
    sklearn_min_max_scaler_transform_impl,
    sklearn_ordinal_encoder_fit_impl,
    sklearn_ordinal_encoder_transform_impl,
    # Overlap filtering
    sklearn_overlap_impl,
    sklearn_regressor_chain_predict_impl,
    # RegressorChain
    sklearn_regressor_chain_train_impl,
    sklearn_robust_scaler_fit_impl,
    sklearn_robust_scaler_transform_impl,
    sklearn_roc_auc_score_impl,
    sklearn_silhouette_score_impl,
    # Splitting
    sklearn_split_impl,
    # Scalers
    sklearn_standard_scaler_fit_impl,
    sklearn_standard_scaler_transform_impl,
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
    # Shared model blob type
    ModelBlobType,
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
    # Split types
    SplitConfigType,
    SplitResultType,
)

__all__ = [
    # Platform registration
    "sklearn_impl",
    # Directly-callable implementations
    "sklearn_split_impl",
    "sklearn_overlap_impl",
    "sklearn_standard_scaler_fit_impl",
    "sklearn_standard_scaler_transform_impl",
    "sklearn_min_max_scaler_fit_impl",
    "sklearn_min_max_scaler_transform_impl",
    "sklearn_robust_scaler_fit_impl",
    "sklearn_robust_scaler_transform_impl",
    "sklearn_label_encoder_fit_impl",
    "sklearn_label_encoder_transform_impl",
    "sklearn_label_encoder_inverse_transform_impl",
    "sklearn_ordinal_encoder_fit_impl",
    "sklearn_ordinal_encoder_transform_impl",
    "sklearn_compute_class_weight_impl",
    "sklearn_compute_metrics_impl",
    "sklearn_compute_metrics_multi_impl",
    "sklearn_compute_classification_metrics_impl",
    "sklearn_compute_classification_metrics_multi_impl",
    "sklearn_confusion_matrix_impl",
    "sklearn_roc_auc_score_impl",
    "sklearn_log_loss_impl",
    "sklearn_silhouette_score_impl",
    "sklearn_regressor_chain_train_impl",
    "sklearn_regressor_chain_predict_impl",
    "sklearn_gmm_fit_impl",
    "sklearn_gmm_predict_impl",
    "sklearn_gmm_predict_proba_impl",
    "sklearn_gmm_score_samples_impl",
    "sklearn_gmm_sample_impl",
    "sklearn_gmm_bic_impl",
    "sklearn_gmm_aic_impl",
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
    "ModelBlobType",
]
