#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""SciPy platform functions for East - statistics, optimization, interpolation, curve fitting.

The platform functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip. The East type definitions
(config, blob, and result types) are re-exported here for building inputs with
``coerce_to`` and validating outputs.
"""

from east_py_datascience.scipy.scipy_impl import (
    scipy_curve_fit,
    scipy_histogram,
    scipy_impl,
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
from east_py_datascience.types import (
    CorrelationResultType,
    CurveFitConfigType,
    CurveFitResultType,
    CurveFunctionType,
    CustomCurveFunctionType,
    DualAnnealBoundsType,
    DualAnnealConfigType,
    DualAnnealResultType,
    HistogramBinMethodType,
    HistogramConfigType,
    HistogramResultType,
    InterpolateConfigType,
    InterpolationKindType,
    KdeBandwidthMethodType,
    KdeConfigType,
    KdeResultType,
    ModelBlobType,
    OptimizeConfigType,
    OptimizeMethodType,
    OptimizeResultType,
    ParamBoundsType,
    QuadraticConfigType,
    RobustStatsResultType,
    ScalarObjectiveType,
    StatsDescribeResultType,
)

__all__ = [
    # Platform registration
    "scipy_impl",
    # Directly-callable implementations
    "scipy_curve_fit",
    "scipy_stats_describe",
    "scipy_stats_pearsonr",
    "scipy_stats_spearmanr",
    "scipy_stats_percentile",
    "scipy_stats_percentileofscore",
    "scipy_stats_iqr",
    "scipy_stats_median",
    "scipy_stats_mad",
    "scipy_stats_robust",
    "scipy_interpolate_1d_fit",
    "scipy_interpolate_1d_predict",
    "scipy_optimize_minimize",
    "scipy_optimize_minimize_quadratic",
    "scipy_optimize_dual_annealing",
    "scipy_histogram",
    "scipy_kde_fit",
    "scipy_kde_evaluate",
    # East type definitions - function inputs
    "ScalarObjectiveType",
    "CurveFunctionType",
    "CustomCurveFunctionType",
    # East type definitions - config
    "OptimizeMethodType",
    "InterpolationKindType",
    "HistogramBinMethodType",
    "KdeBandwidthMethodType",
    "OptimizeConfigType",
    "InterpolateConfigType",
    "HistogramConfigType",
    "KdeConfigType",
    "ParamBoundsType",
    "CurveFitConfigType",
    "QuadraticConfigType",
    "DualAnnealBoundsType",
    "DualAnnealConfigType",
    # East type definitions - results / blobs
    "StatsDescribeResultType",
    "RobustStatsResultType",
    "CorrelationResultType",
    "HistogramResultType",
    "KdeResultType",
    "CurveFitResultType",
    "OptimizeResultType",
    "DualAnnealResultType",
    "ModelBlobType",
]
