#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""SciPy platform functions for East - statistics, optimization, interpolation, curve fitting.

The ``*_impl`` functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip. The East type definitions
(config, blob, and result types) are re-exported here for building inputs with
``coerce_to`` and validating outputs.
"""

from east_py_datascience.scipy.scipy_impl import (
    scipy_curve_fit_impl,
    scipy_histogram_impl,
    scipy_impl,
    scipy_interpolate_1d_fit_impl,
    scipy_interpolate_1d_predict_impl,
    scipy_kde_evaluate_impl,
    scipy_kde_fit_impl,
    scipy_optimize_dual_annealing_impl,
    scipy_optimize_minimize_impl,
    scipy_optimize_minimize_quadratic_impl,
    scipy_stats_describe_impl,
    scipy_stats_iqr_impl,
    scipy_stats_mad_impl,
    scipy_stats_median_impl,
    scipy_stats_pearsonr_impl,
    scipy_stats_percentile_impl,
    scipy_stats_percentileofscore_impl,
    scipy_stats_robust_impl,
    scipy_stats_spearmanr_impl,
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
    "scipy_curve_fit_impl",
    "scipy_stats_describe_impl",
    "scipy_stats_pearsonr_impl",
    "scipy_stats_spearmanr_impl",
    "scipy_stats_percentile_impl",
    "scipy_stats_percentileofscore_impl",
    "scipy_stats_iqr_impl",
    "scipy_stats_median_impl",
    "scipy_stats_mad_impl",
    "scipy_stats_robust_impl",
    "scipy_interpolate_1d_fit_impl",
    "scipy_interpolate_1d_predict_impl",
    "scipy_optimize_minimize_impl",
    "scipy_optimize_minimize_quadratic_impl",
    "scipy_optimize_dual_annealing_impl",
    "scipy_histogram_impl",
    "scipy_kde_fit_impl",
    "scipy_kde_evaluate_impl",
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
