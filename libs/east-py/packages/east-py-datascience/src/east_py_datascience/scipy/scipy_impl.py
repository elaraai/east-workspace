#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""SciPy platform functions for East.

Provides scientific computing utilities: statistics, optimization,
interpolation, and curve fitting.
"""

import warnings
from collections.abc import Callable
from typing import Any

import numpy as np
from east import variant
from east.runtime.platform import platform_function, platform_functions
from east.types.types import FloatType, OptionType, VectorType
from east.types.values import EastStruct, EastVariant, EastVector

from east_py_datascience._common import (
    deserialize,
    expect_case,
    extra_guard,
    option_tag,
    serialize,
)
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
    InterpolationKindType,
    KdeConfigType,
    OptimizeConfigType,
    OptimizeResultType,
    QuadraticConfigType,
    RobustStatsResultType,
    ScalarObjectiveType,
    ScipyModelBlobType,
    StatsDescribeResultType,
)

_check_scipy_support = extra_guard("scipy", "scipy", "SciPy")

# ``OptimizeMethodType`` case -> scipy.optimize.minimize method name
_MINIMIZE_METHODS = {
    "bfgs": "BFGS",
    "l_bfgs_b": "L-BFGS-B",
    "nelder_mead": "Nelder-Mead",
    "powell": "Powell",
    "cg": "CG",
}


_INF = float("inf")


def _exponential_decay(x: np.ndarray, a: float, b: float) -> np.ndarray:
    return a * np.exp(-b * x)


def _exponential_with_offset(x: np.ndarray, a: float, b: float, c: float) -> np.ndarray:
    return a + b * np.exp(-c * x)


def _exponential_growth(x: np.ndarray, a: float, b: float) -> np.ndarray:
    return a * np.exp(b * x)


def _logistic(x: np.ndarray, L: float, k: float, x0: float) -> np.ndarray:  # noqa: N803
    return L / (1 + np.exp(-k * (x - x0)))


def _gompertz(x: np.ndarray, a: float, b: float, c: float) -> np.ndarray:
    return a * np.exp(-b * np.exp(-c * x))


def _power_law(x: np.ndarray, a: float, b: float) -> np.ndarray:
    return a * np.power(np.maximum(x, 1e-10), b)


def _linear(x: np.ndarray, a: float, b: float) -> np.ndarray:
    return a + b * x


def _quadratic(x: np.ndarray, a: float, b: float, c: float) -> np.ndarray:
    return a + b * x + c * x**2


def _cubic(x: np.ndarray, a: float, b: float, c: float, d: float) -> np.ndarray:
    return a + b * x + c * x**2 + d * x**3


def _linear_guess(x: np.ndarray, y: np.ndarray) -> list[float]:
    return [float(y[0]), float((y[-1] - y[0]) / (x[-1] - x[0] + 1e-10))]


# ``CurveFunctionType`` built-in case -> (model, initial guess from (x, y), (lower, upper) bounds).
# The guesses come from the data's endpoints/extremes; the bounds keep rates and
# amplitudes non-negative where the shape requires it.
_BUILTIN_CURVES: dict[
    str,
    tuple[Callable[..., Any], Callable[[np.ndarray, np.ndarray], list[float]], tuple[list[float], list[float]]],
] = {
    "exponential_decay": (_exponential_decay, lambda x, y: [float(y[0]), 0.1], ([0.0, 0.0], [_INF, _INF])),
    "exponential_with_offset": (
        _exponential_with_offset,
        lambda x, y: [float(y[-1]), float(y[0] - y[-1]), 0.1],
        ([-_INF, -_INF, 0.0], [_INF, _INF, _INF]),
    ),
    "exponential_growth": (_exponential_growth, lambda x, y: [float(y[0]), 0.1], ([0.0, 0.0], [_INF, _INF])),
    "logistic": (
        _logistic,
        lambda x, y: [float(y.max()), 1.0, float(x.mean())],
        ([0.0, 0.0, -_INF], [_INF, _INF, _INF]),
    ),
    "gompertz": (_gompertz, lambda x, y: [float(y.max()), 1.0, 0.1], ([0.0, 0.0, 0.0], [_INF] * 3)),
    "power_law": (_power_law, lambda x, y: [1.0, 1.0], ([-_INF, -_INF], [_INF, _INF])),
    "linear": (_linear, _linear_guess, ([-_INF] * 2, [_INF] * 2)),
    "quadratic": (_quadratic, lambda x, y: [float(y[0]), 0.0, 0.0], ([-_INF] * 3, [_INF] * 3)),
    "cubic": (_cubic, lambda x, y: [float(y[0]), 0.0, 0.0, 0.0], ([-_INF] * 4, [_INF] * 4)),
}


# ============================================================================
# Platform Function Implementations
# ============================================================================


@platform_function(
    name="scipy_curve_fit",
    inputs=[CurveFunctionType, VectorType(FloatType), VectorType(FloatType), CurveFitConfigType],
    output=CurveFitResultType,
)
def scipy_curve_fit(
    curve_type: EastVariant,
    x: EastVector,
    y: EastVector,
    config: EastStruct,
) -> EastStruct:
    """Fit a parametric curve to (x, y) data using scipy.optimize.curve_fit.

    Supports nine built-in curve shapes and a ``custom`` variant that wraps a
    compiled East function.  Built-in shapes supply smart initial guesses and
    non-negativity bounds automatically; ``custom`` curves use the bounds and
    initial guess encoded in the variant payload.

    Args:
        curve_type: ``CurveFunctionType`` (``EastVariant``) - the curve shape.
            Cases with no payload: ``exponential_decay``,
            ``exponential_with_offset``, ``exponential_growth``, ``logistic``,
            ``gompertz``, ``power_law``, ``linear``, ``quadratic``, ``cubic``.
            Case ``custom`` carries a struct with fields:

            - ``fn`` (``CustomCurveFunctionType``): East function
              ``(x: Float, params: Vector<Float>, fixed_params: Vector<Float>)
              -> Float``; an ``EastFunction`` is expected.
            - ``n_params`` (``Integer``): number of free parameters to fit.
            - ``param_bounds`` (``Option<ParamBoundsType>``): ``{lower, upper}``
              ``Vector<Float>`` bounds per parameter (default unconstrained).
            - ``fixed_params`` (``Option<Vector<Float>>``): constants passed
              through to ``fn`` unchanged (default empty).
        x: ``Vector<Float>`` (``EastVector``) - independent variable values.
        y: ``Vector<Float>`` (``EastVector``) - observed dependent variable
            values corresponding to ``x``.
        config: ``CurveFitConfigType`` (``EastStruct``) with fields:

            - ``max_iter`` (``Option<Integer>``): maximum optimizer iterations
              (default 5000).
            - ``initial_guess`` (``Option<Vector<Float>>``): initial parameter
              guess; overrides the built-in auto-guess for non-custom curves.

    Returns:
        ``CurveFitResultType`` (``EastStruct``): ``params``
        (``Vector<Float>`` - fitted parameters, empty when the optimizer did
        not converge), ``success`` (``Boolean``), ``r_squared`` (``Float``,
        clipped to [-10, 1]).

    Raises:
        NotImplementedError: the ``scipy`` extra is not installed.
        RuntimeError: unknown curve type tag.
        Exception: whatever a ``custom`` curve function raised during the
            fit - only scipy's own convergence and input failures become a
            ``success = false`` result.
    """
    _check_scipy_support()
    from scipy.optimize import OptimizeWarning, curve_fit

    x_np = x.to_numpy()
    y_np = y.to_numpy()
    max_iter = config["max_iter"].unwrap_or(5000)

    tag = curve_type.type
    model_func: Callable[..., Any]
    p0: list[float]
    bounds: tuple[list[float], list[float]]

    if tag == "custom":
        custom_config = curve_type.value
        east_fn = custom_config["fn"]  # Compiled East function
        n_params = int(custom_config["n_params"])

        # Get fixed params (empty vector if not provided)
        fixed_params_opt = custom_config["fixed_params"].unwrap_or(None)
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
        initial_guess = config["initial_guess"].unwrap_or(None)
        p0 = [float(v) for v in initial_guess.to_numpy()] if initial_guess is not None else [1.0] * n_params

        # Bounds
        bounds_opt = custom_config["param_bounds"].unwrap_or(None)
        if bounds_opt is not None:
            bounds = (
                [float(v) for v in bounds_opt["lower"].to_numpy()],
                [float(v) for v in bounds_opt["upper"].to_numpy()],
            )
        else:
            bounds = ([-_INF] * n_params, [_INF] * n_params)

    elif tag in _BUILTIN_CURVES:
        model_func, guess, bounds = _BUILTIN_CURVES[tag]
        # The config's initial guess overrides the built-in one
        config_guess = config["initial_guess"].unwrap_or(None)
        p0 = guess(x_np, y_np) if config_guess is None else [float(v) for v in config_guess.to_numpy()]

    else:
        raise RuntimeError(f"scipy_curve_fit: Unknown curve type: {tag}")

    try:
        # Suppress OptimizeWarning about covariance estimation
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", OptimizeWarning)
            params, _ = curve_fit(
                model_func, x_np, y_np, p0=p0, bounds=bounds, maxfev=int(max_iter)
            )
    except (RuntimeError, ValueError):
        # scipy's "optimal parameters not found" / rejected input: a failed fit
        # is a result, not an error. Anything else (a custom curve function
        # raising, say) propagates.
        return EastStruct(
            {
                "params": EastVector(FloatType, np.array([], dtype=np.float64)),
                "success": False,
                "r_squared": 0.0,
            }
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


@platform_function(
    name="scipy_stats_describe",
    inputs=[VectorType(FloatType)],
    output=StatsDescribeResultType,
)
def scipy_stats_describe(data: EastVector) -> EastStruct:
    """Compute descriptive statistics for a numeric sample via scipy.stats.describe.

    Args:
        data: ``Vector<Float>`` (``EastVector``) - the sample to describe.

    Returns:
        ``StatsDescribeResultType`` (``EastStruct``): ``count`` (``Integer``),
        ``mean``, ``variance``, ``skewness``, ``kurtosis``, ``min``, ``max``
        (all ``Float``).

    Raises:
        NotImplementedError: the ``scipy`` extra is not installed.
    """
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
def scipy_stats_pearsonr(x: EastVector, y: EastVector) -> EastStruct:
    """Compute the Pearson product-moment correlation coefficient between two samples.

    Args:
        x: ``Vector<Float>`` (``EastVector``) - first sample.
        y: ``Vector<Float>`` (``EastVector``) - second sample; must have the
            same length as ``x``.

    Returns:
        ``CorrelationResultType`` (``EastStruct``): ``correlation`` (``Float``,
        in [-1, 1]) and ``pvalue`` (``Float``, two-tailed p-value).

    Raises:
        NotImplementedError: the ``scipy`` extra is not installed.
    """
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
def scipy_stats_spearmanr(x: EastVector, y: EastVector) -> EastStruct:
    """Compute the Spearman rank-order correlation coefficient between two samples.

    A non-parametric measure of monotonic association; robust to outliers and
    non-linear relationships.

    Args:
        x: ``Vector<Float>`` (``EastVector``) - first sample.
        y: ``Vector<Float>`` (``EastVector``) - second sample; must have the
            same length as ``x``.

    Returns:
        ``CorrelationResultType`` (``EastStruct``): ``correlation`` (``Float``,
        in [-1, 1]) and ``pvalue`` (``Float``, two-tailed p-value).

    Raises:
        NotImplementedError: the ``scipy`` extra is not installed.
    """
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
def scipy_stats_percentile(data: EastVector, percentiles: EastVector) -> EastVector:
    """Compute one or more percentiles of a dataset.

    Args:
        data: ``Vector<Float>`` (``EastVector``) - the sample.
        percentiles: ``Vector<Float>`` (``EastVector``) - percentile values to
            compute, each in [0, 100].

    Returns:
        ``Vector<Float>`` (``EastVector``) - one value per entry in
        ``percentiles``, in the same order.
    """
    data_np = data.to_numpy()
    q_np = percentiles.to_numpy()
    result = np.percentile(data_np, q_np)
    return EastVector(FloatType, result.ravel().astype(np.float64))


@platform_function(
    name="scipy_stats_percentileofscore",
    inputs=[VectorType(FloatType), FloatType],
    output=FloatType,
)
def scipy_stats_percentileofscore(data: EastVector, score: float) -> float:
    """Compute the percentile rank of a single score relative to a dataset.

    Args:
        data: ``Vector<Float>`` (``EastVector``) - the reference dataset.
        score: ``Float`` - the value whose rank is computed.

    Returns:
        ``Float`` - the percentile rank in [0, 100].

    Raises:
        NotImplementedError: the ``scipy`` extra is not installed.
    """
    _check_scipy_support()
    from scipy.stats import percentileofscore

    return float(percentileofscore(data.to_numpy(), score))


@platform_function(
    name="scipy_stats_iqr",
    inputs=[VectorType(FloatType)],
    output=FloatType,
)
def scipy_stats_iqr(data: EastVector) -> float:
    """Compute the interquartile range (Q3 - Q1) of a sample.

    Args:
        data: ``Vector<Float>`` (``EastVector``) - the sample.

    Returns:
        ``Float`` - the IQR (Q75 - Q25).

    Raises:
        NotImplementedError: the ``scipy`` extra is not installed.
    """
    _check_scipy_support()
    from scipy import stats

    return float(stats.iqr(data.to_numpy()))


@platform_function(
    name="scipy_stats_median",
    inputs=[VectorType(FloatType)],
    output=FloatType,
)
def scipy_stats_median(data: EastVector) -> float:
    """Compute the median of a sample.

    Args:
        data: ``Vector<Float>`` (``EastVector``) - the sample.

    Returns:
        ``Float`` - the median value.
    """
    return float(np.median(data.to_numpy()))


@platform_function(
    name="scipy_stats_mad",
    inputs=[VectorType(FloatType)],
    output=FloatType,
)
def scipy_stats_mad(data: EastVector) -> float:
    """Compute the median absolute deviation (MAD) of a sample.

    MAD is a robust dispersion measure: median(|x - median(x)|).

    Args:
        data: ``Vector<Float>`` (``EastVector``) - the sample.

    Returns:
        ``Float`` - the MAD value.

    Raises:
        NotImplementedError: the ``scipy`` extra is not installed.
    """
    _check_scipy_support()
    from scipy import stats

    return float(stats.median_abs_deviation(data.to_numpy()))


@platform_function(
    name="scipy_stats_robust",
    inputs=[VectorType(FloatType)],
    output=RobustStatsResultType,
)
def scipy_stats_robust(data: EastVector) -> EastStruct:
    """Compute a full set of outlier-resistant summary statistics in one pass.

    Combines median, interquartile range, median absolute deviation, and
    quartile values computed by numpy and scipy.

    Args:
        data: ``Vector<Float>`` (``EastVector``) - the sample.

    Returns:
        ``RobustStatsResultType`` (``EastStruct``): ``median``, ``iqr``,
        ``mad``, ``q1``, ``q3`` (all ``Float``).

    Raises:
        NotImplementedError: the ``scipy`` extra is not installed.
    """
    _check_scipy_support()
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
    output=ScipyModelBlobType,
)
def scipy_interpolate_1d_fit(
    x: EastVector,
    y: EastVector,
    config: EastStruct,
) -> EastVariant:
    """Fit a 1-D piecewise interpolator to (x, y) data.

    The fitted model is serialized with cloudpickle and returned as a
    ``ScipyModelBlobType`` variant for use with
    :func:`scipy_interpolate_1d_predict`.

    Args:
        x: ``Vector<Float>`` (``EastVector``) - knot positions; must be
            strictly increasing.
        y: ``Vector<Float>`` (``EastVector``) - knot values corresponding to
            ``x``; same length.
        config: ``InterpolateConfigType`` (``EastStruct``) with fields:

            - ``kind`` (``Option<InterpolationKindType>``): ``linear``
              (default), ``quadratic``, or ``cubic``.

    Returns:
        ``ScipyModelBlobType`` (``EastVariant`` tagged ``scipy_interp_1d``):
        ``{data: Blob, kind: InterpolationKindType}`` - the cloudpickle
        serialized ``scipy.interpolate.interp1d`` instance.

    Raises:
        NotImplementedError: the ``scipy`` extra is not installed.
    """
    _check_scipy_support()
    from scipy import interpolate

    x_np = x.to_numpy()
    y_np = y.to_numpy()

    kind = option_tag(config["kind"], "linear")

    interp = interpolate.interp1d(x_np, y_np, kind=kind, fill_value="extrapolate")

    return EastVariant(
        "scipy_interp_1d",
        EastStruct(
            {
                "data": serialize(interp),
                "kind": variant(kind, None, InterpolationKindType),
            }
        ),
    )


@platform_function(
    name="scipy_interpolate_1d_predict",
    inputs=[ScipyModelBlobType, VectorType(FloatType)],
    output=VectorType(FloatType),
)
def scipy_interpolate_1d_predict(
    model_blob: EastVariant,
    x: EastVector,
) -> EastVector:
    """Evaluate a fitted 1-D interpolator at new points.

    The interpolator extrapolates beyond the training range using
    ``fill_value="extrapolate"``.

    Args:
        model_blob: ``ScipyModelBlobType`` (``EastVariant`` tagged
            ``scipy_interp_1d``) from :func:`scipy_interpolate_1d_fit`.
        x: ``Vector<Float>`` (``EastVector``) - query points.

    Returns:
        ``Vector<Float>`` (``EastVector``) - interpolated values at each query
        point.

    Raises:
        RuntimeError: ``model_blob`` is not tagged ``scipy_interp_1d``.
    """
    payload = expect_case(model_blob, "scipy_interp_1d", "scipy_interpolate_1d_predict")

    interp = deserialize(payload["data"])
    x_np = x.to_numpy()

    y_np = interp(x_np)

    return EastVector(FloatType, y_np.ravel().astype(np.float64))


@platform_function(
    name="scipy_optimize_minimize",
    inputs=[ScalarObjectiveType, VectorType(FloatType), OptimizeConfigType],
    output=OptimizeResultType,
)
def scipy_optimize_minimize(
    objective_fn: Callable[[EastVector], float],
    x0: EastVector,
    config: EastStruct,
) -> EastStruct:
    """Minimize a scalar objective using scipy.optimize.minimize.

    The East objective function is wrapped so scipy receives a plain
    ``numpy.ndarray`` and returns a ``float``; the wrapper converts to/from
    ``EastVector`` on each call.

    Args:
        objective_fn: ``ScalarObjectiveType`` - East function
            ``(x: Vector<Float>) -> Float``; an ``EastFunction`` is expected.
        x0: ``Vector<Float>`` (``EastVector``) - starting point.
        config: ``OptimizeConfigType`` (``EastStruct``) with fields:

            - ``method`` (``Option<OptimizeMethodType>``): ``l_bfgs_b``
              (default), ``bfgs``, ``nelder_mead``, ``powell``, ``cg``.
            - ``max_iter`` (``Option<Integer>``): maximum iterations (default
              1000).
            - ``tol`` (``Option<Float>``): convergence tolerance (default
              1e-6).

    Returns:
        ``OptimizeResultType`` (``EastStruct``): ``x`` (``Vector<Float>``
        optimal parameters), ``fun`` (``Float`` objective at optimum),
        ``success`` (``Boolean``), ``nit`` (``Integer`` iterations used).

    Raises:
        NotImplementedError: the ``scipy`` extra is not installed.
    """
    _check_scipy_support()
    from scipy import optimize

    x0_np = x0.to_numpy()

    # Wrap East function for scipy
    def wrapped_objective(x):
        x_east = EastVector(FloatType, np.asarray(x, dtype=np.float64))
        return objective_fn(x_east)

    method = option_tag(config["method"], "l_bfgs_b")

    result = optimize.minimize(
        wrapped_objective,
        x0_np,
        method=_MINIMIZE_METHODS.get(method, "L-BFGS-B"),
        options={
            "maxiter": config["max_iter"].unwrap_or(1000),
        },
        tol=config["tol"].unwrap_or(1e-6),
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
def scipy_optimize_minimize_quadratic(
    x0: EastVector,
    quadratic: EastStruct,
    config: EastStruct,
) -> EastStruct:
    """Minimize the quadratic form f(x) = 0.5 * x'Ax + b'x + c.

    Supplies the exact analytic gradient (A @ x + b) to the solver,
    so gradient-based methods (``l_bfgs_b``, ``bfgs``, ``cg``) converge
    in far fewer iterations than with finite differences.

    Args:
        x0: ``Vector<Float>`` (``EastVector``) - starting point.
        quadratic: ``QuadraticConfigType`` (``EastStruct``) with fields:

            - ``A`` (``Matrix<Float>``): symmetric positive-definite quadratic
              coefficient matrix.
            - ``b`` (``Vector<Float>``): linear coefficient vector.
            - ``c`` (``Float``): scalar constant.
        config: ``OptimizeConfigType`` (``EastStruct``) - see
            :func:`scipy_optimize_minimize` for fields.

    Returns:
        ``OptimizeResultType`` (``EastStruct``): ``x`` (``Vector<Float>``),
        ``fun`` (``Float``), ``success`` (``Boolean``), ``nit``
        (``Integer``).

    Raises:
        NotImplementedError: the ``scipy`` extra is not installed.
    """
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

    method = option_tag(config["method"], "l_bfgs_b")

    result = optimize.minimize(
        objective,
        x0_np,
        method=_MINIMIZE_METHODS.get(method, "L-BFGS-B"),
        jac=gradient,
        options={
            "maxiter": config["max_iter"].unwrap_or(1000),
        },
        tol=config["tol"].unwrap_or(1e-6),
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
def scipy_optimize_dual_annealing(
    objective_fn: Callable[[EastVector], float],
    x0_opt: EastVariant,
    bounds: EastStruct,
    config: EastStruct,
) -> EastStruct:
    """Global optimization over a bounded continuous domain using dual annealing.

    Combines generalized simulated annealing with a local gradient-based search
    (L-BFGS-B by default).  Faster than pure Python simanneal for continuous
    problems.  The East objective is wrapped to convert between numpy arrays and
    ``EastVector`` on each call.

    Args:
        objective_fn: ``ScalarObjectiveType`` - East function
            ``(x: Vector<Float>) -> Float``; an ``EastFunction`` is expected.
        x0_opt: ``Option<Vector<Float>>`` (``EastVariant``) - optional initial
            point; ``none`` lets the algorithm choose.
        bounds: ``DualAnnealBoundsType`` (``EastStruct``) with fields:

            - ``lower`` (``Vector<Float>``): lower bound per dimension.
            - ``upper`` (``Vector<Float>``): upper bound per dimension.
        config: ``DualAnnealConfigType`` (``EastStruct``) with fields:

            - ``maxfun`` (``Option<Integer>``): max function evaluations
              (default 1000).
            - ``maxiter`` (``Option<Integer>``): max outer iterations (default
              1000).
            - ``initial_temp`` (``Option<Float>``): initial annealing
              temperature (default 5230).
            - ``restart_temp_ratio`` (``Option<Float>``): restart threshold
              (default 2e-5).
            - ``visit`` (``Option<Float>``): visiting distribution parameter
              (default 2.62).
            - ``accept`` (``Option<Float>``): acceptance parameter (default
              -5.0).
            - ``seed`` (``Option<Integer>``): random seed for reproducibility.
            - ``no_local_search`` (``Option<Boolean>``): disable the local
              search phase (default false).

    Returns:
        ``DualAnnealResultType`` (``EastStruct``): ``x``
        (``Vector<Float>`` best solution), ``fun`` (``Float`` best objective
        value), ``nfev`` (``Integer`` function evaluations), ``nit``
        (``Integer`` iterations), ``success`` (``Boolean``), ``message``
        (``String``).

    Raises:
        NotImplementedError: the ``scipy`` extra is not installed.
    """
    _check_scipy_support()
    from scipy.optimize import dual_annealing

    # Convert bounds to list of tuples
    lower = bounds["lower"].to_numpy()
    upper = bounds["upper"].to_numpy()
    bounds_list = list(zip(lower, upper, strict=False))

    # Optional initial guess
    x0_vec = x0_opt.unwrap_or(None)
    x0 = None if x0_vec is None else x0_vec.to_numpy()

    # Wrapper: numpy -> EastVector -> objective_fn -> float
    def objective_wrapper(x: np.ndarray) -> float:
        east_x = EastVector(FloatType, np.asarray(x, dtype=np.float64))
        return float(objective_fn(east_x))

    # Build kwargs from config
    kwargs: dict = {}

    maxfun = config["maxfun"].unwrap_or(None)
    if maxfun is not None:
        kwargs["maxfun"] = int(maxfun)

    maxiter = config["maxiter"].unwrap_or(None)
    if maxiter is not None:
        kwargs["maxiter"] = int(maxiter)

    initial_temp = config["initial_temp"].unwrap_or(None)
    if initial_temp is not None:
        kwargs["initial_temp"] = float(initial_temp)

    restart_temp_ratio = config["restart_temp_ratio"].unwrap_or(None)
    if restart_temp_ratio is not None:
        kwargs["restart_temp_ratio"] = float(restart_temp_ratio)

    visit = config["visit"].unwrap_or(None)
    if visit is not None:
        kwargs["visit"] = float(visit)

    accept = config["accept"].unwrap_or(None)
    if accept is not None:
        kwargs["accept"] = float(accept)

    seed = config["seed"].unwrap_or(None)
    if seed is not None:
        kwargs["seed"] = int(seed)

    if config["no_local_search"].unwrap_or(False):
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
def scipy_histogram(
    data: EastVector,
    config: EastStruct,
) -> EastStruct:
    """Compute a histogram of a numeric sample using numpy.histogram.

    Args:
        data: ``Vector<Float>`` (``EastVector``) - the sample to bin.
        config: ``HistogramConfigType`` (``EastStruct``) with fields:

            - ``bins`` (``Option<Integer>``): number of equal-width bins
              (default 10); ignored when ``bin_method`` is set.
            - ``bin_method`` (``Option<HistogramBinMethodType>``): automatic
              bin selection strategy - ``auto``, ``fd``, ``sturges``,
              ``scott``, ``rice``, ``sqrt``, ``doane``; overrides ``bins``
              when provided.
            - ``range_min`` / ``range_max`` (``Option<Float>``): clamp the
              histogram range; both must be provided together.
            - ``density`` (``Option<Boolean>``): normalize to a probability
              density (default false).
            - ``weights`` (``Option<Vector<Float>>``): per-element weights,
              same length as ``data`` (default uniform).

    Returns:
        ``HistogramResultType`` (``EastStruct``): ``counts``
        (``Vector<Float>`` - bin values, float even in count mode for
        consistency with density mode), ``bin_edges`` (``Vector<Float>`` -
        length ``len(counts) + 1``).

    Raises:
        NotImplementedError: the ``scipy`` extra is not installed.
    """
    _check_scipy_support()

    data_np = data.to_numpy()

    # Extract config
    bins_val = config["bins"].unwrap_or(10)
    bin_method = config["bin_method"].unwrap_or(None)
    range_min = config["range_min"].unwrap_or(None)
    range_max = config["range_max"].unwrap_or(None)
    density = config["density"].unwrap_or(False)
    weights = config["weights"].unwrap_or(None)

    # An automatic estimator overrides the numeric bin count
    bins_arg = bin_method.type if bin_method is not None else int(bins_val)

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
    output=ScipyModelBlobType,
)
def scipy_kde_fit(
    data: EastVector,
    config: EastStruct,
) -> EastVariant:
    """Fit a Gaussian kernel density estimator to a 1-D sample.

    The fitted KDE is serialized with cloudpickle and returned as a
    ``ScipyModelBlobType`` variant for use with :func:`scipy_kde_evaluate`.

    Args:
        data: ``Vector<Float>`` (``EastVector``) - the training sample.
        config: ``KdeConfigType`` (``EastStruct``) with fields:

            - ``bandwidth`` (``Option<KdeBandwidthMethodType>``): automatic
              bandwidth selector - ``scott`` (default) or ``silverman``;
              ignored when ``bandwidth_scalar`` is set.
            - ``bandwidth_scalar`` (``Option<Float>``): explicit bandwidth
              factor; takes precedence over ``bandwidth``.
            - ``weights`` (``Option<Vector<Float>>``): per-datapoint weights,
              same length as ``data`` (default uniform).

    Returns:
        ``ScipyModelBlobType`` (``EastVariant`` tagged ``scipy_kde``):
        ``{data: Blob, metadata: {bandwidth: Float, data_min: Float,
        data_max: Float}}`` - the cloudpickle serialized
        ``scipy.stats.gaussian_kde`` instance.

    Raises:
        NotImplementedError: the ``scipy`` extra is not installed.
    """
    _check_scipy_support()
    from scipy import stats

    data_np = data.to_numpy()

    # Extract config
    bandwidth_method = config["bandwidth"].unwrap_or(None)
    bandwidth_scalar = config["bandwidth_scalar"].unwrap_or(None)
    weights = config["weights"].unwrap_or(None)

    # An explicit bandwidth factor overrides the selection rule
    bw_method: float | str
    if bandwidth_scalar is not None:
        bw_method = float(bandwidth_scalar)
    elif bandwidth_method is not None:
        bw_method = bandwidth_method.type
    else:
        bw_method = "scott"

    # Weights
    weights_np = weights.to_numpy() if weights is not None else None

    kde = stats.gaussian_kde(data_np, bw_method=bw_method, weights=weights_np)

    return EastVariant(
        "scipy_kde",
        EastStruct(
            {
                "data": serialize(kde),
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
    inputs=[ScipyModelBlobType, VectorType(FloatType)],
    output=VectorType(FloatType),
)
def scipy_kde_evaluate(
    model_blob: EastVariant,
    points: EastVector,
) -> EastVector:
    """Evaluate a fitted KDE at given query points to obtain density values.

    Args:
        model_blob: ``ScipyModelBlobType`` (``EastVariant`` tagged ``scipy_kde``)
            from :func:`scipy_kde_fit`.
        points: ``Vector<Float>`` (``EastVector``) - points at which to
            evaluate the density.

    Returns:
        ``Vector<Float>`` (``EastVector``) - estimated probability density at
        each query point.

    Raises:
        RuntimeError: ``model_blob`` is not tagged ``scipy_kde``.
    """
    payload = expect_case(model_blob, "scipy_kde", "scipy_kde_evaluate")

    kde = deserialize(payload["data"])
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
