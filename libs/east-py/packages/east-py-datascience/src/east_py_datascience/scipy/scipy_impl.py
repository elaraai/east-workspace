#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""SciPy platform functions for East.

Provides scientific computing utilities: statistics, optimization,
interpolation, and curve fitting.
"""

import importlib.util
import warnings
from collections.abc import Callable

import numpy as np
from east.runtime.platform import platform_function, platform_functions

# Lazy import guard for optional dependency
_HAS_SCIPY_SUPPORT = importlib.util.find_spec("scipy") is not None


def _check_scipy_support() -> None:
    """Check if SciPy support is available."""
    if not _HAS_SCIPY_SUPPORT:
        raise NotImplementedError(
            "Scipy support requires the 'scipy' extra. "
            "Add east-py-datascience[scipy] to your pyproject.toml dependencies."
        )

from east.types.types import FloatType, OptionType, VectorType
from east.types.values import EastBlob, EastStruct, EastVariant, EastVector

from east_py_datascience.types import (
    CorrelationResultType,
    CurveFitConfigType,
    CurveFitResultType,
    CurveFunctionType,
    DualAnnealBoundsType,
    DualAnnealConfigType,
    DualAnnealResultType,
    HistogramConfigType,
    HistogramResultType,
    InterpolateConfigType,
    KdeConfigType,
    ModelBlobType,
    OptimizeConfigType,
    OptimizeResultType,
    QuadraticConfigType,
    RobustStatsResultType,
    ScalarObjectiveType,
    StatsDescribeResultType,
    _get_enum_tag,
    _get_option,
)

# ============================================================================
# Native Serialization Helpers
# ============================================================================


def _serialize_native(model) -> EastBlob:
    """Serialize a model using cloudpickle."""
    import cloudpickle

    return EastBlob(cloudpickle.dumps(model))


def _deserialize_native(data: EastBlob):
    """Deserialize a model using cloudpickle."""
    import cloudpickle

    return cloudpickle.loads(bytes(data))


def _make_enum(tag: str) -> EastVariant:
    """Create an enum-like variant (tag with null value)."""
    return EastVariant(tag, None)


# ============================================================================
# Platform Function Implementations
# ============================================================================


@platform_function(
    name="scipy_curve_fit",
    inputs=[CurveFunctionType, VectorType(FloatType), VectorType(FloatType), CurveFitConfigType],
    output=CurveFitResultType,
)
def scipy_curve_fit_impl(
    curve_type: EastVariant,
    x: EastVector,
    y: EastVector,
    config: EastStruct,
) -> EastStruct:
    """Fit curve to data using scipy.optimize.curve_fit."""
    _check_scipy_support()
    from scipy.optimize import OptimizeWarning, curve_fit

    x_np = x.to_numpy()
    y_np = y.to_numpy()
    max_iter = _get_option(config.get("max_iter"), 5000)

    tag = curve_type.type

    # Built-in curves with smart defaults
    if tag == "exponential_decay":

        def model_func(x, a, b):
            return a * np.exp(-b * x)

        p0 = [float(y_np[0]), 0.1]
        bounds = ([0, 0], [np.inf, np.inf])

    elif tag == "exponential_with_offset":

        def model_func(x, a, b, c):
            return a + b * np.exp(-c * x)

        p0 = [float(y_np[-1]), float(y_np[0] - y_np[-1]), 0.1]
        bounds = ([-np.inf, -np.inf, 0], [np.inf, np.inf, np.inf])

    elif tag == "exponential_growth":

        def model_func(x, a, b):
            return a * np.exp(b * x)

        p0 = [float(y_np[0]), 0.1]
        bounds = ([0, 0], [np.inf, np.inf])

    elif tag == "logistic":

        def model_func(x, L, k, x0):
            return L / (1 + np.exp(-k * (x - x0)))

        p0 = [float(y_np.max()), 1.0, float(x_np.mean())]
        bounds = ([0, 0, -np.inf], [np.inf, np.inf, np.inf])

    elif tag == "gompertz":

        def model_func(x, a, b, c):
            return a * np.exp(-b * np.exp(-c * x))

        p0 = [float(y_np.max()), 1.0, 0.1]
        bounds = ([0, 0, 0], [np.inf, np.inf, np.inf])

    elif tag == "power_law":

        def model_func(x, a, b):
            return a * np.power(np.maximum(x, 1e-10), b)

        p0 = [1.0, 1.0]
        bounds = ([-np.inf, -np.inf], [np.inf, np.inf])

    elif tag == "linear":

        def model_func(x, a, b):
            return a + b * x

        slope = (y_np[-1] - y_np[0]) / (x_np[-1] - x_np[0] + 1e-10)
        p0 = [float(y_np[0]), float(slope)]
        bounds = ([-np.inf, -np.inf], [np.inf, np.inf])

    elif tag == "quadratic":

        def model_func(x, a, b, c):
            return a + b * x + c * x**2

        p0 = [float(y_np[0]), 0.0, 0.0]
        bounds = ([-np.inf, -np.inf, -np.inf], [np.inf, np.inf, np.inf])

    elif tag == "cubic":

        def model_func(x, a, b, c, d):
            return a + b * x + c * x**2 + d * x**3

        p0 = [float(y_np[0]), 0.0, 0.0, 0.0]
        bounds = ([-np.inf] * 4, [np.inf] * 4)

    elif tag == "custom":
        custom_config = curve_type.value
        east_fn = custom_config["fn"]  # Compiled East function
        n_params = int(custom_config["n_params"])

        # Get fixed params (empty vector if not provided)
        fixed_params_opt = _get_option(custom_config.get("fixed_params"), None)
        fixed_params_arr = (
            fixed_params_opt
            if fixed_params_opt is not None
            else EastVector(FloatType, np.array([], dtype=np.float64))
        )

        # Wrap East function for scipy - now passes fixed_params as third arg
        def scalar_model(x_val, *params):
            params_arr = EastVector(FloatType, np.array(params, dtype=np.float64))
            return east_fn(float(x_val), params_arr, fixed_params_arr)

        # Vectorize for array inputs
        model_func = np.vectorize(scalar_model, excluded=list(range(1, n_params + 1)))

        # Initial guess
        initial_guess = _get_option(config.get("initial_guess"), None)
        p0 = (
            list(initial_guess.to_numpy())
            if initial_guess
            else [1.0] * n_params
        )

        # Bounds
        bounds_opt = _get_option(custom_config.get("param_bounds"), None)
        if bounds_opt:
            bounds = (
                list(bounds_opt["lower"].to_numpy()),
                list(bounds_opt["upper"].to_numpy()),
            )
        else:
            bounds = ([-np.inf] * n_params, [np.inf] * n_params)

    else:
        raise RuntimeError(f"scipy_curve_fit: Unknown curve type: {tag}")

    # Override initial guess if provided in config
    config_guess = _get_option(config.get("initial_guess"), None)
    if config_guess is not None and tag != "custom":
        p0 = list(config_guess.to_numpy())

    try:
        # Suppress OptimizeWarning about covariance estimation
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", OptimizeWarning)
            params, _ = curve_fit(
                model_func, x_np, y_np, p0=p0, bounds=bounds, maxfev=int(max_iter)
            )

        # Compute R²
        y_pred = model_func(x_np, *params)
        ss_res = np.sum((y_np - y_pred) ** 2)
        ss_tot = np.sum((y_np - y_np.mean()) ** 2)
        r2 = 1 - ss_res / ss_tot if ss_tot > 1e-10 else 0.0

        return EastStruct(
            {
                "params": EastVector(FloatType, np.array(params, dtype=np.float64)),
                "success": True,
                "r_squared": float(np.clip(r2, -10, 1)),
            }
        )

    except Exception:
        return EastStruct(
            {
                "params": EastVector(FloatType, np.array([], dtype=np.float64)),
                "success": False,
                "r_squared": 0.0,
            }
        )


@platform_function(
    name="scipy_stats_describe",
    inputs=[VectorType(FloatType)],
    output=StatsDescribeResultType,
)
def scipy_stats_describe_impl(data: EastVector) -> EastStruct:
    """Compute descriptive statistics for data."""
    _check_scipy_support()
    from scipy import stats

    data_np = data.to_numpy()
    result = stats.describe(data_np)

    return EastStruct(
        {
            "count": int(result.nobs),
            "mean": float(result.mean),
            "variance": float(result.variance),
            "skewness": float(result.skewness),
            "kurtosis": float(result.kurtosis),
            "min": float(result.minmax[0]),
            "max": float(result.minmax[1]),
        }
    )


@platform_function(
    name="scipy_stats_pearsonr",
    inputs=[VectorType(FloatType), VectorType(FloatType)],
    output=CorrelationResultType,
)
def scipy_stats_pearsonr_impl(x: EastVector, y: EastVector) -> EastStruct:
    """Compute Pearson correlation coefficient."""
    _check_scipy_support()
    from scipy import stats

    x_np = x.to_numpy()
    y_np = y.to_numpy()

    r, p = stats.pearsonr(x_np, y_np)

    return EastStruct(
        {
            "correlation": float(r),
            "pvalue": float(p),
        }
    )


@platform_function(
    name="scipy_stats_spearmanr",
    inputs=[VectorType(FloatType), VectorType(FloatType)],
    output=CorrelationResultType,
)
def scipy_stats_spearmanr_impl(x: EastVector, y: EastVector) -> EastStruct:
    """Compute Spearman rank correlation."""
    _check_scipy_support()
    from scipy import stats

    x_np = x.to_numpy()
    y_np = y.to_numpy()

    r, p = stats.spearmanr(x_np, y_np)

    return EastStruct(
        {
            "correlation": float(r),
            "pvalue": float(p),
        }
    )


@platform_function(
    name="scipy_stats_percentile",
    inputs=[VectorType(FloatType), VectorType(FloatType)],
    output=VectorType(FloatType),
)
def scipy_stats_percentile_impl(data: EastVector, percentiles: EastVector) -> EastVector:
    """Compute percentiles of data."""
    import numpy as np

    data_np = data.to_numpy()
    q_np = percentiles.to_numpy()
    result = np.percentile(data_np, q_np)
    return EastVector(FloatType, result.ravel().astype(np.float64))


@platform_function(
    name="scipy_stats_percentileofscore",
    inputs=[VectorType(FloatType), FloatType],
    output=FloatType,
)
def scipy_stats_percentileofscore_impl(data: EastVector, score: float) -> float:
    """Compute the percentile rank of a score relative to a dataset."""
    _check_scipy_support()
    from scipy.stats import percentileofscore

    return float(percentileofscore(data.to_numpy(), score))


@platform_function(
    name="scipy_stats_iqr",
    inputs=[VectorType(FloatType)],
    output=FloatType,
)
def scipy_stats_iqr_impl(data: EastVector) -> float:
    """Compute interquartile range (Q3 - Q1)."""
    _check_scipy_support()
    from scipy import stats

    return float(stats.iqr(data.to_numpy()))


@platform_function(
    name="scipy_stats_median",
    inputs=[VectorType(FloatType)],
    output=FloatType,
)
def scipy_stats_median_impl(data: EastVector) -> float:
    """Compute median."""
    import numpy as np

    return float(np.median(data.to_numpy()))


@platform_function(
    name="scipy_stats_mad",
    inputs=[VectorType(FloatType)],
    output=FloatType,
)
def scipy_stats_mad_impl(data: EastVector) -> float:
    """Compute median absolute deviation."""
    _check_scipy_support()
    from scipy import stats

    return float(stats.median_abs_deviation(data.to_numpy()))


@platform_function(
    name="scipy_stats_robust",
    inputs=[VectorType(FloatType)],
    output=RobustStatsResultType,
)
def scipy_stats_robust_impl(data: EastVector) -> EastStruct:
    """Compute robust statistics: median, iqr, mad, q1, q3."""
    _check_scipy_support()
    import numpy as np
    from scipy import stats

    data_np = data.to_numpy()
    q1, q3 = np.percentile(data_np, [25, 75])

    return EastStruct(
        {
            "median": float(np.median(data_np)),
            "iqr": float(stats.iqr(data_np)),
            "mad": float(stats.median_abs_deviation(data_np)),
            "q1": float(q1),
            "q3": float(q3),
        }
    )


@platform_function(
    name="scipy_interpolate_1d_fit",
    inputs=[VectorType(FloatType), VectorType(FloatType), InterpolateConfigType],
    output=ModelBlobType,
)
def scipy_interpolate_1d_fit_impl(
    x: EastVector,
    y: EastVector,
    config: EastStruct,
) -> EastVariant:
    """Fit 1D interpolator."""
    _check_scipy_support()
    from scipy import interpolate

    x_np = x.to_numpy()
    y_np = y.to_numpy()

    kind_variant = _get_option(config.get("kind"), None)
    kind = _get_enum_tag(kind_variant) if kind_variant else "linear"

    interp = interpolate.interp1d(x_np, y_np, kind=kind, fill_value="extrapolate")

    return EastVariant(
        "scipy_interp_1d",
        EastStruct(
            {
                "data": _serialize_native(interp),
                "kind": _make_enum(kind),
            }
        ),
    )


@platform_function(
    name="scipy_interpolate_1d_predict",
    inputs=[ModelBlobType, VectorType(FloatType)],
    output=VectorType(FloatType),
)
def scipy_interpolate_1d_predict_impl(
    model_blob: EastVariant,
    x: EastVector,
) -> EastVector:
    """Evaluate 1D interpolator at given points."""
    if model_blob.type != "scipy_interp_1d":
        raise RuntimeError(
            f"scipy_interpolate_1d_predict: Expected scipy_interp_1d, got {model_blob.type}"
        )

    interp = _deserialize_native(model_blob.value["data"])
    x_np = x.to_numpy()

    y_np = interp(x_np)

    return EastVector(FloatType, y_np.ravel().astype(np.float64))


@platform_function(
    name="scipy_optimize_minimize",
    inputs=[ScalarObjectiveType, VectorType(FloatType), OptimizeConfigType],
    output=OptimizeResultType,
)
def scipy_optimize_minimize_impl(
    objective_fn: Callable[[EastVector], float],
    x0: EastVector,
    config: EastStruct,
) -> EastStruct:
    """Minimize a scalar function using scipy.optimize.minimize."""
    _check_scipy_support()
    from scipy import optimize

    x0_np = x0.to_numpy()

    # Wrap East function for scipy
    def wrapped_objective(x):
        x_east = EastVector(FloatType, np.asarray(x, dtype=np.float64))
        return objective_fn(x_east)

    method_variant = _get_option(config.get("method"), None)
    method = _get_enum_tag(method_variant) if method_variant else "l_bfgs_b"
    method_map = {
        "bfgs": "BFGS",
        "l_bfgs_b": "L-BFGS-B",
        "nelder_mead": "Nelder-Mead",
        "powell": "Powell",
        "cg": "CG",
    }

    result = optimize.minimize(
        wrapped_objective,
        x0_np,
        method=method_map.get(method, "L-BFGS-B"),
        options={
            "maxiter": _get_option(config.get("max_iter"), 1000),
        },
        tol=_get_option(config.get("tol"), 1e-6),
    )

    return EastStruct(
        {
            "x": EastVector(FloatType, result.x.ravel().astype(np.float64)),
            "fun": float(result.fun),
            "success": bool(result.success),
            "nit": int(result.nit),
        }
    )


@platform_function(
    name="scipy_optimize_minimize_quadratic",
    inputs=[VectorType(FloatType), QuadraticConfigType, OptimizeConfigType],
    output=OptimizeResultType,
)
def scipy_optimize_minimize_quadratic_impl(
    x0: EastVector,
    quadratic: EastStruct,
    config: EastStruct,
) -> EastStruct:
    """Minimize quadratic function: f(x) = 0.5 * x'Ax + b'x + c"""
    _check_scipy_support()
    from scipy import optimize

    x0_np = x0.to_numpy()
    A_np = quadratic["A"].to_numpy()
    b_np = quadratic["b"].to_numpy()
    c = float(quadratic["c"])

    def objective(x):
        return 0.5 * x @ A_np @ x + b_np @ x + c

    def gradient(x):
        return A_np @ x + b_np

    method_variant = _get_option(config.get("method"), None)
    method = _get_enum_tag(method_variant) if method_variant else "l_bfgs_b"
    method_map = {
        "bfgs": "BFGS",
        "l_bfgs_b": "L-BFGS-B",
        "nelder_mead": "Nelder-Mead",
        "powell": "Powell",
        "cg": "CG",
    }

    result = optimize.minimize(
        objective,
        x0_np,
        method=method_map.get(method, "L-BFGS-B"),
        jac=gradient,
        options={
            "maxiter": _get_option(config.get("max_iter"), 1000),
        },
        tol=_get_option(config.get("tol"), 1e-6),
    )

    return EastStruct(
        {
            "x": EastVector(FloatType, result.x.ravel().astype(np.float64)),
            "fun": float(result.fun),
            "success": bool(result.success),
            "nit": int(result.nit),
        }
    )


@platform_function(
    name="scipy_optimize_dual_annealing",
    inputs=[
        ScalarObjectiveType,
        OptionType(VectorType(FloatType)),
        DualAnnealBoundsType,
        DualAnnealConfigType,
    ],
    output=DualAnnealResultType,
)
def scipy_optimize_dual_annealing_impl(
    objective_fn: Callable[[EastVector], float],
    x0_opt: EastVariant | None,
    bounds: EastStruct,
    config: EastStruct,
) -> EastStruct:
    """Global optimization using scipy.optimize.dual_annealing.

    Combines generalized simulated annealing with local search.
    Much faster than pure Python simanneal for continuous optimization.
    """
    _check_scipy_support()
    from scipy.optimize import dual_annealing

    # Convert bounds to list of tuples
    lower = bounds["lower"].to_numpy()
    upper = bounds["upper"].to_numpy()
    bounds_list = list(zip(lower, upper, strict=False))

    # Optional initial guess
    x0 = None
    if x0_opt is not None and hasattr(x0_opt, "type") and x0_opt.type == "some":
        x0 = x0_opt.value.to_numpy()

    # Wrapper: numpy -> EastVector -> objective_fn -> float
    def objective_wrapper(x: np.ndarray) -> float:
        east_x = EastVector(FloatType, np.asarray(x, dtype=np.float64))
        return float(objective_fn(east_x))

    # Build kwargs from config
    kwargs: dict = {}

    maxfun = _get_option(config.get("maxfun"), None)
    if maxfun is not None:
        kwargs["maxfun"] = int(maxfun)

    maxiter = _get_option(config.get("maxiter"), None)
    if maxiter is not None:
        kwargs["maxiter"] = int(maxiter)

    initial_temp = _get_option(config.get("initial_temp"), None)
    if initial_temp is not None:
        kwargs["initial_temp"] = float(initial_temp)

    restart_temp_ratio = _get_option(config.get("restart_temp_ratio"), None)
    if restart_temp_ratio is not None:
        kwargs["restart_temp_ratio"] = float(restart_temp_ratio)

    visit = _get_option(config.get("visit"), None)
    if visit is not None:
        kwargs["visit"] = float(visit)

    accept = _get_option(config.get("accept"), None)
    if accept is not None:
        kwargs["accept"] = float(accept)

    seed = _get_option(config.get("seed"), None)
    if seed is not None:
        kwargs["seed"] = int(seed)

    no_local_search = _get_option(config.get("no_local_search"), None)
    if no_local_search:
        kwargs["no_local_search"] = True

    # Run optimization
    result = dual_annealing(
        objective_wrapper,
        bounds=bounds_list,
        x0=x0,
        **kwargs,
    )

    return EastStruct(
        {
            "x": EastVector(FloatType, result.x.ravel().astype(np.float64)),
            "fun": float(result.fun),
            "nfev": int(result.nfev),
            "nit": int(result.nit),
            "success": bool(result.success),
            "message": str(result.message),
        }
    )


@platform_function(
    name="scipy_histogram",
    inputs=[VectorType(FloatType), HistogramConfigType],
    output=HistogramResultType,
)
def scipy_histogram_impl(
    data: EastVector,
    config: EastStruct,
) -> EastStruct:
    """Compute histogram using numpy.histogram."""
    _check_scipy_support()

    data_np = data.to_numpy()

    # Extract config
    bins_val = _get_option(config.get("bins"), 10)
    bin_method = _get_option(config.get("bin_method"), None)
    range_min = _get_option(config.get("range_min"), None)
    range_max = _get_option(config.get("range_max"), None)
    density = _get_option(config.get("density"), False)
    weights = _get_option(config.get("weights"), None)

    # Determine bins argument
    bins_arg = _get_enum_tag(bin_method) if bin_method is not None else int(bins_val)

    # Determine range
    hist_range = None
    if range_min is not None and range_max is not None:
        hist_range = (float(range_min), float(range_max))

    # Weights
    weights_np = weights.to_numpy() if weights is not None else None

    counts, bin_edges = np.histogram(
        data_np,
        bins=bins_arg,
        range=hist_range,
        density=bool(density),
        weights=weights_np,
    )

    return EastStruct(
        {
            "counts": EastVector(FloatType, counts.astype(np.float64)),
            "bin_edges": EastVector(FloatType, bin_edges.astype(np.float64)),
        }
    )


@platform_function(
    name="scipy_kde_fit",
    inputs=[VectorType(FloatType), KdeConfigType],
    output=ModelBlobType,
)
def scipy_kde_fit_impl(
    data: EastVector,
    config: EastStruct,
) -> EastVariant:
    """Fit Kernel Density Estimator using scipy.stats.gaussian_kde."""
    _check_scipy_support()
    from scipy import stats

    data_np = data.to_numpy()

    # Extract config
    bandwidth_method = _get_option(config.get("bandwidth"), None)
    bandwidth_scalar = _get_option(config.get("bandwidth_scalar"), None)
    weights = _get_option(config.get("weights"), None)

    # Determine bw_method
    if bandwidth_scalar is not None:
        bw_method = float(bandwidth_scalar)
    elif bandwidth_method is not None:
        bw_method = _get_enum_tag(bandwidth_method)
    else:
        bw_method = "scott"

    # Weights
    weights_np = weights.to_numpy() if weights is not None else None

    kde = stats.gaussian_kde(data_np, bw_method=bw_method, weights=weights_np)

    return EastVariant(
        "scipy_kde",
        EastStruct(
            {
                "data": _serialize_native(kde),
                "metadata": EastStruct(
                    {
                        "bandwidth": float(kde.factor),
                        "data_min": float(data_np.min()),
                        "data_max": float(data_np.max()),
                    }
                ),
            }
        ),
    )


@platform_function(
    name="scipy_kde_evaluate",
    inputs=[ModelBlobType, VectorType(FloatType)],
    output=VectorType(FloatType),
)
def scipy_kde_evaluate_impl(
    model_blob: EastVariant,
    points: EastVector,
) -> EastVector:
    """Evaluate fitted KDE at given points."""
    if model_blob.type != "scipy_kde":
        raise RuntimeError(
            f"scipy_kde_evaluate: Expected scipy_kde, got {model_blob.type}"
        )

    kde = _deserialize_native(model_blob.value["data"])
    points_np = points.to_numpy()

    densities = kde.evaluate(points_np)

    return EastVector(FloatType, densities.ravel().astype(np.float64))


# ============================================================================
# Platform Function Registration
# ============================================================================

scipy_impl = platform_functions(__name__)

__all__ = [
    "scipy_impl",
]
