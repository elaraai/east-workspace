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

from east_py_datascience.alns import alns_impl
from east_py_datascience.causal import causal_impl
from east_py_datascience.google_or import google_or_impl
from east_py_datascience.gp import gp_impl
from east_py_datascience.lightgbm import lightgbm_impl
from east_py_datascience.lightning import lightning_impl
from east_py_datascience.mads import mads_impl
from east_py_datascience.mapie import mapie_impl
from east_py_datascience.ngboost import ngboost_impl
from east_py_datascience.optimization import optimization_impl
from east_py_datascience.optuna import optuna_impl
from east_py_datascience.pymc import pymc_impl
from east_py_datascience.scipy import scipy_impl
from east_py_datascience.shap import shap_impl
from east_py_datascience.simanneal import simanneal_impl
from east_py_datascience.simulation import simulation_impl
from east_py_datascience.sklearn import sklearn_impl
from east_py_datascience.torch import torch_impl
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
    "__version__",
    "platform",
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
