#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""East Data Science Platform Functions.

Python implementation of data science platform functions for the East programming language.
Provides ML and optimization capabilities for East programs running in Python.
"""

# Make core's single shared east-c reachable before any datascience _eastc
# extension is loaded, so the whole process shares one east-c value slab /
# IR-type singleton / error register. Core ships the lib in the `east` package
# dir (libeast-c.so / .dylib / east_c_shared.dll). On Unix `import east` maps it
# and the extensions' $ORIGIN/../../east RUNPATH resolves it. Windows has no
# RUNPATH: register core's `east/` dir on the DLL search path so the datascience
# .pyd's — two package levels away — find east_c_shared.dll.
import os
from importlib.metadata import PackageNotFoundError, version

import east  # noqa: F401

if hasattr(os, "add_dll_directory"):  # Windows (Python 3.8+); no-op elsewhere
    os.add_dll_directory(os.path.dirname(east.__file__))

from east_py_datascience.alns import alns_impl, alns_optimize
from east_py_datascience.causal import causal_design_validation, causal_experiment, causal_impl
from east_py_datascience.google_or import google_or_impl

# Every platform function under its own name (#667): callable from python and,
# the same object, inside an East body — the printer's provider spelling.
from east_py_datascience.google_or.cpsat import (
    cpsat_solve,
    cpsat_solve_all,
)
from east_py_datascience.google_or.graph import (
    assignment,
    max_flow,
    min_cost_assignment,
    min_cost_flow,
)
from east_py_datascience.google_or.linear import (
    linear_solve,
)
from east_py_datascience.google_or.routing import (
    routing_solve,
)
from east_py_datascience.gp import gp_impl
from east_py_datascience.gp.gp_impl import (
    gp_predict,
    gp_predict_std,
    gp_train,
)
from east_py_datascience.lightgbm import lightgbm_impl
from east_py_datascience.lightgbm.lightgbm_impl import (
    lightgbm_predict,
    lightgbm_predict_class,
    lightgbm_predict_proba,
    lightgbm_train_classifier,
    lightgbm_train_regressor,
)
from east_py_datascience.lightning import lightning_impl
from east_py_datascience.lightning.lightning_impl import (
    lightning_decode,
    lightning_decode_conditional,
    lightning_encode,
    lightning_generate_sequence,
    lightning_predict,
    lightning_train,
)
from east_py_datascience.mads import mads_impl
from east_py_datascience.mads.mads import (
    mads_optimize,
)
from east_py_datascience.mapie import mapie_impl
from east_py_datascience.mapie.mapie_impl import (
    mapie_predict_interval,
    mapie_predict_set,
    mapie_train_conformal_classifier,
    mapie_train_conformal_regressor,
    mapie_train_cqr,
    mapie_uncertainty_predictor_classifier,
    mapie_uncertainty_predictor_regressor,
)
from east_py_datascience.ngboost import ngboost_impl
from east_py_datascience.ngboost.ngboost_impl import (
    ngboost_predict,
    ngboost_predict_dist,
    ngboost_train_regressor,
)
from east_py_datascience.optimization import (
    optimization_impl,
    optimization_iterative,
    optimization_iterative_grouped,
    optimization_iterative_incremental,
)
from east_py_datascience.optuna import optuna_impl
from east_py_datascience.optuna.optuna import (
    optuna_optimize,
)
from east_py_datascience.pymc import pymc_impl
from east_py_datascience.pymc.pymc_impl import (
    pymc_diagnostics,
    pymc_posterior_predictive_check,
    pymc_posterior_samples,
    pymc_posterior_summary,
    pymc_predict,
    pymc_predict_distribution,
    pymc_train_hierarchical,
    pymc_train_multi_layer,
    pymc_train_regression,
)
from east_py_datascience.scipy import scipy_impl
from east_py_datascience.scipy.scipy_impl import (
    scipy_curve_fit,
    scipy_histogram,
    scipy_interpolate_1d_fit,
    scipy_interpolate_1d_predict,
    scipy_kde_evaluate,
    scipy_kde_fit,
    scipy_optimize_dual_annealing,
    scipy_optimize_minimize,
    scipy_optimize_minimize_quadratic,
    scipy_stats_describe,
    scipy_stats_iqr,
    scipy_stats_mad,
    scipy_stats_median,
    scipy_stats_pearsonr,
    scipy_stats_percentile,
    scipy_stats_percentileofscore,
    scipy_stats_robust,
    scipy_stats_spearmanr,
)
from east_py_datascience.shap import shap_impl
from east_py_datascience.shap.shap_impl import (
    shap_compute_values,
    shap_feature_importance,
    shap_kernel_explainer_create,
    shap_tree_explainer_create,
)
from east_py_datascience.simanneal import simanneal_impl
from east_py_datascience.simanneal.simanneal import (
    simanneal_optimize,
    simanneal_optimize_permutation,
    simanneal_optimize_subset,
)
from east_py_datascience.simulation import simulation_impl, simulation_run
from east_py_datascience.sklearn import sklearn_impl
from east_py_datascience.sklearn.sklearn import (
    sklearn_compute_class_weight,
    sklearn_compute_classification_metrics,
    sklearn_compute_classification_metrics_multi,
    sklearn_compute_metrics,
    sklearn_compute_metrics_multi,
    sklearn_confusion_matrix,
    sklearn_gmm_aic,
    sklearn_gmm_bic,
    sklearn_gmm_fit,
    sklearn_gmm_predict,
    sklearn_gmm_predict_proba,
    sklearn_gmm_sample,
    sklearn_gmm_score_samples,
    sklearn_label_encoder_fit,
    sklearn_label_encoder_inverse_transform,
    sklearn_label_encoder_transform,
    sklearn_log_loss,
    sklearn_min_max_scaler_fit,
    sklearn_min_max_scaler_transform,
    sklearn_ordinal_encoder_fit,
    sklearn_ordinal_encoder_transform,
    sklearn_overlap,
    sklearn_regressor_chain_predict,
    sklearn_regressor_chain_train,
    sklearn_robust_scaler_fit,
    sklearn_robust_scaler_transform,
    sklearn_roc_auc_score,
    sklearn_silhouette_score,
    sklearn_split,
    sklearn_standard_scaler_fit,
    sklearn_standard_scaler_transform,
)
from east_py_datascience.torch import torch_impl
from east_py_datascience.torch.torch_impl import (
    torch_mlp_decode,
    torch_mlp_encode,
    torch_mlp_predict,
    torch_mlp_predict_multi,
    torch_mlp_train,
    torch_mlp_train_multi,
)
from east_py_datascience.types import (
    ClassificationAverageType,
    ClassificationMetricResultsType,
    ClassificationMetricResultType,
    ClassificationMetricsConfigType,
    ClassificationMetricType,
    CorrelationResultType,
    CurveFitConfigType,
    CurveFitResultType,
    CurveFunctionType,
    DualAnnealBoundsType,
    DualAnnealConfigType,
    DualAnnealResultType,
    InterpolateConfigType,
    InterpolationKindType,
    MetricAggregationType,
    MetricResultType,
    MetricsResultType,
    ModelBlobType,
    MultiClassificationConfigType,
    MultiClassificationMetricResultsType,
    MultiClassificationMetricResultType,
    MultiMetricResultType,
    MultiMetricsConfigType,
    MultiMetricsResultType,
    OptimizeConfigType,
    # Scipy types
    OptimizeMethodType,
    OptimizeResultType,
    # Flexible metrics types
    RegressionMetricType,
    RobustStatsResultType,
    ScalarObjectiveType,
    SplitConfigType,
    SplitResultType,
    StatsDescribeResultType,
    VectorObjectiveType,
)
from east_py_datascience.xgboost import xgboost_impl
from east_py_datascience.xgboost.xgboost_impl import (
    xgboost_predict,
    xgboost_predict_class,
    xgboost_predict_proba,
    xgboost_predict_quantile,
    xgboost_train_classifier,
    xgboost_train_quantile,
    xgboost_train_regressor,
)

try:
    __version__ = version("elaraai-east-py-datascience")
except PackageNotFoundError:  # a source checkout that is not installed
    __version__ = "0.0.0"

# Complete data science platform implementation
# Pass this list to compile_async() to enable all platform functions
platform = [
    *mads_impl,
    *optuna_impl,
    *simanneal_impl,
    *sklearn_impl,
    *scipy_impl,
    *xgboost_impl,
    *lightgbm_impl,
    *ngboost_impl,
    *shap_impl,
    *torch_impl,
    *gp_impl,
    *lightning_impl,
    *mapie_impl,
    *alns_impl,
    *optimization_impl,
    *google_or_impl,
    *pymc_impl,
    *simulation_impl,
    *causal_impl,
]

__all__ = [
    # ---------- platform functions ----------
    "__version__",
    "alns_optimize",
    "assignment",
    "causal_design_validation",
    "causal_experiment",
    "cpsat_solve",
    "cpsat_solve_all",
    "gp_predict",
    "gp_predict_std",
    "gp_train",
    "lightgbm_predict",
    "lightgbm_predict_class",
    "lightgbm_predict_proba",
    "lightgbm_train_classifier",
    "lightgbm_train_regressor",
    "lightning_decode",
    "lightning_decode_conditional",
    "lightning_encode",
    "lightning_generate_sequence",
    "lightning_predict",
    "lightning_train",
    "linear_solve",
    "mads_optimize",
    "mapie_predict_interval",
    "mapie_predict_set",
    "mapie_train_conformal_classifier",
    "mapie_train_conformal_regressor",
    "mapie_train_cqr",
    "mapie_uncertainty_predictor_classifier",
    "mapie_uncertainty_predictor_regressor",
    "max_flow",
    "min_cost_assignment",
    "min_cost_flow",
    "ngboost_predict",
    "ngboost_predict_dist",
    "ngboost_train_regressor",
    "optimization_iterative",
    "optimization_iterative_grouped",
    "optimization_iterative_incremental",
    "optuna_optimize",
    "platform",
    "pymc_diagnostics",
    "pymc_posterior_predictive_check",
    "pymc_posterior_samples",
    "pymc_posterior_summary",
    "pymc_predict",
    "pymc_predict_distribution",
    "pymc_train_hierarchical",
    "pymc_train_multi_layer",
    "pymc_train_regression",
    "routing_solve",
    "scipy_curve_fit",
    "scipy_histogram",
    "scipy_interpolate_1d_fit",
    "scipy_interpolate_1d_predict",
    "scipy_kde_evaluate",
    "scipy_kde_fit",
    "scipy_optimize_dual_annealing",
    "scipy_optimize_minimize",
    "scipy_optimize_minimize_quadratic",
    "scipy_stats_describe",
    "scipy_stats_iqr",
    "scipy_stats_mad",
    "scipy_stats_median",
    "scipy_stats_pearsonr",
    "scipy_stats_percentile",
    "scipy_stats_percentileofscore",
    "scipy_stats_robust",
    "scipy_stats_spearmanr",
    "shap_compute_values",
    "shap_feature_importance",
    "shap_kernel_explainer_create",
    "shap_tree_explainer_create",
    "simanneal_optimize",
    "simanneal_optimize_permutation",
    "simanneal_optimize_subset",
    "simulation_run",
    "sklearn_compute_class_weight",
    "sklearn_compute_classification_metrics",
    "sklearn_compute_classification_metrics_multi",
    "sklearn_compute_metrics",
    "sklearn_compute_metrics_multi",
    "sklearn_confusion_matrix",
    "sklearn_gmm_aic",
    "sklearn_gmm_bic",
    "sklearn_gmm_fit",
    "sklearn_gmm_predict",
    "sklearn_gmm_predict_proba",
    "sklearn_gmm_sample",
    "sklearn_gmm_score_samples",
    "sklearn_label_encoder_fit",
    "sklearn_label_encoder_inverse_transform",
    "sklearn_label_encoder_transform",
    "sklearn_log_loss",
    "sklearn_min_max_scaler_fit",
    "sklearn_min_max_scaler_transform",
    "sklearn_ordinal_encoder_fit",
    "sklearn_ordinal_encoder_transform",
    "sklearn_overlap",
    "sklearn_regressor_chain_predict",
    "sklearn_regressor_chain_train",
    "sklearn_robust_scaler_fit",
    "sklearn_robust_scaler_transform",
    "sklearn_roc_auc_score",
    "sklearn_silhouette_score",
    "sklearn_split",
    "sklearn_standard_scaler_fit",
    "sklearn_standard_scaler_transform",
    "torch_mlp_decode",
    "torch_mlp_encode",
    "torch_mlp_predict",
    "torch_mlp_predict_multi",
    "torch_mlp_train",
    "torch_mlp_train_multi",
    "xgboost_predict",
    "xgboost_predict_class",
    "xgboost_predict_proba",
    "xgboost_predict_quantile",
    "xgboost_train_classifier",
    "xgboost_train_quantile",
    "xgboost_train_regressor",
    # Module exports
    "mads_impl",
    "optuna_impl",
    "simanneal_impl",
    "sklearn_impl",
    "scipy_impl",
    "xgboost_impl",
    "lightgbm_impl",
    "ngboost_impl",
    "shap_impl",
    "torch_impl",
    "gp_impl",
    "lightning_impl",
    "mapie_impl",
    "alns_impl",
    "optimization_impl",
    "google_or_impl",
    "pymc_impl",
    "simulation_impl",
    "causal_impl",
    # Type exports
    "ScalarObjectiveType",
    "VectorObjectiveType",
    "SplitConfigType",
    "SplitResultType",
    "ModelBlobType",
    # Flexible metrics types
    "RegressionMetricType",
    "MetricResultType",
    "MetricsResultType",
    "MetricAggregationType",
    "MultiMetricsConfigType",
    "MultiMetricResultType",
    "MultiMetricsResultType",
    "ClassificationMetricType",
    "ClassificationAverageType",
    "ClassificationMetricsConfigType",
    "ClassificationMetricResultType",
    "ClassificationMetricResultsType",
    "MultiClassificationConfigType",
    "MultiClassificationMetricResultType",
    "MultiClassificationMetricResultsType",
    # Scipy types
    "OptimizeMethodType",
    "InterpolationKindType",
    "OptimizeConfigType",
    "InterpolateConfigType",
    "CurveFunctionType",
    "CurveFitConfigType",
    "StatsDescribeResultType",
    "RobustStatsResultType",
    "CorrelationResultType",
    "CurveFitResultType",
    "OptimizeResultType",
    "DualAnnealBoundsType",
    "DualAnnealConfigType",
    "DualAnnealResultType",
]
