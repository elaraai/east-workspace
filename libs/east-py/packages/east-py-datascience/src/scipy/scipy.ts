/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * SciPy platform functions for East.
 *
 * Provides scientific computing utilities: statistics, optimization,
 * interpolation, and curve fitting.
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
    StringType,
    BlobType,
    NullType,
    FunctionType,
} from "@elaraai/east";
import { VectorType, MatrixType, ScalarObjectiveType } from "../types.js";

// Re-export shared types for convenience
export { VectorType, MatrixType, ScalarObjectiveType } from "../types.js";

// ============================================================================
// Enum Types
// ============================================================================

/**
 * Optimization method for scipy.optimize.minimize.
 */
export const OptimizeMethodType = VariantType({
    /** BFGS algorithm */
    bfgs: NullType,
    /** L-BFGS-B algorithm (default) */
    l_bfgs_b: NullType,
    /** Nelder-Mead simplex */
    nelder_mead: NullType,
    /** Powell's method */
    powell: NullType,
    /** Conjugate gradient */
    cg: NullType,
});

/**
 * Interpolation method for scipy.interpolate.interp1d.
 */
export const InterpolationKindType = VariantType({
    /** Linear interpolation (default) */
    linear: NullType,
    /** Cubic interpolation */
    cubic: NullType,
    /** Quadratic interpolation */
    quadratic: NullType,
});

/**
 * Histogram bin selection method for numpy.histogram.
 */
export const HistogramBinMethodType = VariantType({
    /** Maximum of Sturges and FD estimators */
    auto: NullType,
    /** Freedman-Diaconis estimator */
    fd: NullType,
    /** Sturges estimator */
    sturges: NullType,
    /** Scott's normal reference rule */
    scott: NullType,
    /** Rice estimator */
    rice: NullType,
    /** Square root estimator */
    sqrt: NullType,
    /** Doane's estimator */
    doane: NullType,
});

/**
 * Bandwidth selection method for KDE.
 */
export const KdeBandwidthMethodType = VariantType({
    /** Scott's rule of thumb (default) */
    scott: NullType,
    /** Silverman's rule of thumb */
    silverman: NullType,
});

// ============================================================================
// Config Types
// ============================================================================

/**
 * Configuration for scipy.optimize.minimize.
 */
export const OptimizeConfigType = StructType({
    /** Optimization method */
    method: OptionType(OptimizeMethodType),
    /** Maximum number of iterations */
    max_iter: OptionType(IntegerType),
    /** Tolerance for convergence */
    tol: OptionType(FloatType),
});

/**
 * Configuration for scipy.interpolate.interp1d.
 */
export const InterpolateConfigType = StructType({
    /** Interpolation method */
    kind: OptionType(InterpolationKindType),
});

/**
 * Parameter bounds for curve fitting.
 */
export const ParamBoundsType = StructType({
    /** Lower bounds for each parameter */
    lower: VectorType(FloatType),
    /** Upper bounds for each parameter */
    upper: VectorType(FloatType),
});

/**
 * Custom curve function type: (x: Float, params: Vector, fixed_params: Vector) -> Float
 * The params are optimized, fixed_params are passed through unchanged.
 * If no fixed_params provided in config, an empty vector is passed.
 */
export const CustomCurveFunctionType = FunctionType([FloatType, VectorType(FloatType), VectorType(FloatType)], FloatType);

/**
 * Curve function type for scipy_curve_fit.
 *
 * Includes built-in standard mathematical functions and a custom option
 * for user-defined functions.
 */
export const CurveFunctionType = VariantType({
    /** y = a * exp(-b * x), 2 params: [a, b] */
    exponential_decay: NullType,
    /** y = a + b * exp(-c * x), 3 params: [a, b, c] */
    exponential_with_offset: NullType,
    /** y = a * exp(b * x), 2 params: [a, b] */
    exponential_growth: NullType,
    /** y = L / (1 + exp(-k * (x - x0))), 3 params: [L, k, x0] */
    logistic: NullType,
    /** y = a * exp(-b * exp(-c * x)), 3 params: [a, b, c] */
    gompertz: NullType,
    /** y = a * x^b, 2 params: [a, b] */
    power_law: NullType,
    /** y = a + b * x, 2 params: [a, b] */
    linear: NullType,
    /** y = a + b*x + c*x^2, 3 params: [a, b, c] */
    quadratic: NullType,
    /** y = a + b*x + c*x^2 + d*x^3, 4 params: [a, b, c, d] */
    cubic: NullType,
    /** Custom function provided by user */
    custom: StructType({
        /** The curve function: (x, params, fixed_params) -> y */
        fn: CustomCurveFunctionType,
        /** Number of parameters to optimize */
        n_params: IntegerType,
        /** Optional parameter bounds */
        param_bounds: OptionType(ParamBoundsType),
        /** Optional fixed parameters passed to fn but not optimized */
        fixed_params: OptionType(VectorType(FloatType)),
    }),
});

/**
 * Configuration for curve fitting.
 */
export const CurveFitConfigType = StructType({
    /** Maximum number of function evaluations */
    max_iter: OptionType(IntegerType),
    /** Initial guess for parameters */
    initial_guess: OptionType(VectorType(FloatType)),
});

/**
 * Configuration for histogram computation.
 */
export const HistogramConfigType = StructType({
    /** Number of bins (default 10) */
    bins: OptionType(IntegerType),
    /** Auto bin method (overrides bins if set) */
    bin_method: OptionType(HistogramBinMethodType),
    /** Lower bound */
    range_min: OptionType(FloatType),
    /** Upper bound */
    range_max: OptionType(FloatType),
    /** Normalize to probability density */
    density: OptionType(BooleanType),
    /** Per-element weights */
    weights: OptionType(VectorType(FloatType)),
});

/**
 * Configuration for Kernel Density Estimation.
 */
export const KdeConfigType = StructType({
    /** Bandwidth selection method (default scott) */
    bandwidth: OptionType(KdeBandwidthMethodType),
    /** Custom scalar bandwidth (overrides method if set) */
    bandwidth_scalar: OptionType(FloatType),
    /** Per-datapoint weights */
    weights: OptionType(VectorType(FloatType)),
});

/**
 * Configuration for quadratic optimization: f(x) = 0.5 * x'Ax + b'x + c
 */
export const QuadraticConfigType = StructType({
    /** Quadratic term (symmetric positive definite) */
    A: MatrixType(FloatType),
    /** Linear term */
    b: VectorType(FloatType),
    /** Constant term */
    c: FloatType,
});

// ============================================================================
// Result Types
// ============================================================================

/**
 * Descriptive statistics result.
 */
export const StatsDescribeResultType = StructType({
    /** Number of observations */
    count: IntegerType,
    /** Mean value */
    mean: FloatType,
    /** Variance */
    variance: FloatType,
    /** Skewness */
    skewness: FloatType,
    /** Kurtosis */
    kurtosis: FloatType,
    /** Minimum value */
    min: FloatType,
    /** Maximum value */
    max: FloatType,
});

/**
 * Robust statistics result (median-based, outlier-resistant).
 */
export const RobustStatsResultType = StructType({
    /** Median value */
    median: FloatType,
    /** Interquartile range (Q3 - Q1) */
    iqr: FloatType,
    /** Median absolute deviation */
    mad: FloatType,
    /** 25th percentile */
    q1: FloatType,
    /** 75th percentile */
    q3: FloatType,
});

/**
 * Correlation result (Pearson or Spearman).
 */
export const CorrelationResultType = StructType({
    /** Correlation coefficient */
    correlation: FloatType,
    /** P-value for hypothesis test */
    pvalue: FloatType,
});

/**
 * Curve fitting result.
 */
export const CurveFitResultType = StructType({
    /** Fitted parameters */
    params: VectorType(FloatType),
    /** Whether fit converged */
    success: BooleanType,
    /** Coefficient of determination (R²) */
    r_squared: FloatType,
});

/**
 * Optimization result.
 */
export const OptimizeResultType = StructType({
    /** Optimal parameters */
    x: VectorType(FloatType),
    /** Function value at optimum */
    fun: FloatType,
    /** Whether optimization succeeded */
    success: BooleanType,
    /** Number of iterations */
    nit: IntegerType,
});

/**
 * Histogram computation result.
 */
export const HistogramResultType = StructType({
    /** Bin values (float to support density mode) */
    counts: VectorType(FloatType),
    /** Bin edges (length = len(counts) + 1) */
    bin_edges: VectorType(FloatType),
});

/**
 * KDE fitting result metadata.
 */
export const KdeResultType = StructType({
    /** Actual bandwidth factor used */
    bandwidth: FloatType,
    /** Minimum of training data */
    data_min: FloatType,
    /** Maximum of training data */
    data_max: FloatType,
});

/**
 * Model blob type for scipy models.
 */
export const ScipyModelBlobType = VariantType({
    /** 1D interpolator (cloudpickle serialized) */
    scipy_interp_1d: StructType({
        /** Serialized interpolator */
        data: BlobType,
        /** Interpolation method used */
        kind: InterpolationKindType,
    }),
    /** KDE model (cloudpickle serialized) */
    scipy_kde: StructType({
        /** Serialized KDE model */
        data: BlobType,
        /** KDE metadata */
        metadata: KdeResultType,
    }),
});

// ============================================================================
// Dual Annealing Types
// ============================================================================

/**
 * Bounds for dual annealing optimization (required).
 */
export const DualAnnealBoundsType = StructType({
    /** Lower bounds for each variable */
    lower: VectorType(FloatType),
    /** Upper bounds for each variable */
    upper: VectorType(FloatType),
});

/**
 * Configuration for scipy.optimize.dual_annealing.
 *
 * Combines generalized simulated annealing with local search.
 * Much faster than pure Python simanneal for continuous optimization.
 */
export const DualAnnealConfigType = StructType({
    /** Maximum function evaluations (default: 1000) */
    maxfun: OptionType(IntegerType),
    /** Maximum iterations (default: 1000) */
    maxiter: OptionType(IntegerType),
    /** Initial temperature (default: 5230) */
    initial_temp: OptionType(FloatType),
    /** Temperature restart threshold (default: 2e-5) */
    restart_temp_ratio: OptionType(FloatType),
    /** Visiting distribution parameter (default: 2.62) */
    visit: OptionType(FloatType),
    /** Acceptance distribution parameter (default: -5.0) */
    accept: OptionType(FloatType),
    /** Random seed for reproducibility */
    seed: OptionType(IntegerType),
    /** Disable local search for speed (default: false) */
    no_local_search: OptionType(BooleanType),
});

/**
 * Result from dual annealing optimization.
 */
export const DualAnnealResultType = StructType({
    /** Best solution found */
    x: VectorType(FloatType),
    /** Best objective value */
    fun: FloatType,
    /** Number of function evaluations */
    nfev: IntegerType,
    /** Number of iterations */
    nit: IntegerType,
    /** Whether optimization succeeded */
    success: BooleanType,
    /** Status message */
    message: StringType,
});

// ============================================================================
// Platform Functions
// ============================================================================

/**
 * Fit a parametric curve to data using nonlinear least squares.
 */
export const scipy_curve_fit = East.platform(
    "scipy_curve_fit",
    [CurveFunctionType, VectorType(FloatType), VectorType(FloatType), CurveFitConfigType],
    CurveFitResultType
);

/**
 * Compute descriptive statistics for data.
 */
export const scipy_stats_describe = East.platform(
    "scipy_stats_describe",
    [VectorType(FloatType)],
    StatsDescribeResultType
);

/**
 * Compute Pearson correlation coefficient.
 */
export const scipy_stats_pearsonr = East.platform(
    "scipy_stats_pearsonr",
    [VectorType(FloatType), VectorType(FloatType)],
    CorrelationResultType
);

/**
 * Compute Spearman rank correlation.
 */
export const scipy_stats_spearmanr = East.platform(
    "scipy_stats_spearmanr",
    [VectorType(FloatType), VectorType(FloatType)],
    CorrelationResultType
);

/**
 * Compute percentiles of data.
 * @param data - Input data vector
 * @param percentiles - Percentile values to compute (0-100)
 * @returns Values at the specified percentiles
 */
export const scipy_stats_percentile = East.platform(
    "scipy_stats_percentile",
    [VectorType(FloatType), VectorType(FloatType)],
    VectorType(FloatType)
);

/**
 * Compute the percentile rank of a score relative to a dataset.
 * @param data - Reference data vector
 * @param score - Value to compute the percentile rank for
 * @returns Percentile rank (0-100)
 */
export const scipy_stats_percentileofscore = East.platform(
    "scipy_stats_percentileofscore",
    [VectorType(FloatType), FloatType],
    FloatType
);

/**
 * Compute interquartile range (Q3 - Q1).
 */
export const scipy_stats_iqr = East.platform(
    "scipy_stats_iqr",
    [VectorType(FloatType)],
    FloatType
);

/**
 * Compute median value.
 */
export const scipy_stats_median = East.platform(
    "scipy_stats_median",
    [VectorType(FloatType)],
    FloatType
);

/**
 * Compute median absolute deviation (robust std estimate).
 */
export const scipy_stats_mad = East.platform(
    "scipy_stats_mad",
    [VectorType(FloatType)],
    FloatType
);

/**
 * Compute robust statistics in one call (median, iqr, mad, q1, q3).
 */
export const scipy_stats_robust = East.platform(
    "scipy_stats_robust",
    [VectorType(FloatType)],
    RobustStatsResultType
);

/**
 * Fit 1D interpolator to data.
 */
export const scipy_interpolate_1d_fit = East.platform(
    "scipy_interpolate_1d_fit",
    [VectorType(FloatType), VectorType(FloatType), InterpolateConfigType],
    ScipyModelBlobType
);

/**
 * Evaluate 1D interpolator at given points.
 */
export const scipy_interpolate_1d_predict = East.platform(
    "scipy_interpolate_1d_predict",
    [ScipyModelBlobType, VectorType(FloatType)],
    VectorType(FloatType)
);

/**
 * Minimize a scalar function using scipy.optimize.minimize.
 */
export const scipy_optimize_minimize = East.platform(
    "scipy_optimize_minimize",
    [ScalarObjectiveType, VectorType(FloatType), OptimizeConfigType],
    OptimizeResultType
);

/**
 * Minimize a quadratic function with analytical gradient.
 */
export const scipy_optimize_minimize_quadratic = East.platform(
    "scipy_optimize_minimize_quadratic",
    [VectorType(FloatType), QuadraticConfigType, OptimizeConfigType],
    OptimizeResultType
);

/**
 * Global optimization using dual annealing.
 *
 * Combines generalized simulated annealing with local search.
 * Much faster than simanneal for continuous optimization problems.
 * Effective for non-convex problems with many local minima.
 *
 * @param objective_fn - Function to minimize: Vector -> Float
 * @param x0 - Optional initial guess (if none, starts from bounds center)
 * @param bounds - Required bounds for all variables
 * @param config - Algorithm configuration
 * @returns Optimization result with best solution
 */
export const scipy_optimize_dual_annealing = East.platform(
    "scipy_optimize_dual_annealing",
    [
        ScalarObjectiveType,
        OptionType(VectorType(FloatType)),
        DualAnnealBoundsType,
        DualAnnealConfigType,
    ],
    DualAnnealResultType
);

/**
 * Compute histogram of data using numpy.histogram.
 */
export const scipy_histogram = East.platform(
    "scipy_histogram",
    [VectorType(FloatType), HistogramConfigType],
    HistogramResultType
);

/**
 * Fit a Kernel Density Estimator to data.
 */
export const scipy_kde_fit = East.platform(
    "scipy_kde_fit",
    [VectorType(FloatType), KdeConfigType],
    ScipyModelBlobType
);

/**
 * Evaluate a fitted KDE model at given points.
 */
export const scipy_kde_evaluate = East.platform(
    "scipy_kde_evaluate",
    [ScipyModelBlobType, VectorType(FloatType)],
    VectorType(FloatType)
);

// ============================================================================
// Grouped Export
// ============================================================================

/**
 * Type definitions for scipy functions.
 */
export const ScipyTypes = {
    ScalarObjectiveType,
    OptimizeMethodType,
    InterpolationKindType,
    HistogramBinMethodType,
    KdeBandwidthMethodType,
    OptimizeConfigType,
    InterpolateConfigType,
    HistogramConfigType,
    KdeConfigType,
    ParamBoundsType,
    CustomCurveFunctionType,
    CurveFunctionType,
    CurveFitConfigType,
    QuadraticConfigType,
    StatsDescribeResultType,
    RobustStatsResultType,
    CorrelationResultType,
    CurveFitResultType,
    OptimizeResultType,
    HistogramResultType,
    KdeResultType,
    ModelBlobType: ScipyModelBlobType,
    DualAnnealBoundsType,
    DualAnnealConfigType,
    DualAnnealResultType,
} as const;

/**
 * SciPy scientific computing utilities.
 *
 * Provides statistics, optimization, interpolation, and curve fitting.
 */
export const Scipy = {
    /**
     * Fit a parametric curve to data using nonlinear least squares.
     *
     * @example
     * ```ts
     * import { East, FloatType, variant } from "@elaraai/east";
     * import { Scipy, VectorType, CurveFitConfigType } from "@elaraai/east-py-datascience";
     *
     * const fit = East.function(
     *     [VectorType(FloatType), VectorType(FloatType)],
     *     Scipy.Types.CurveFitResultType,
     *     ($, x, y) => {
     *         const func = $.let(variant("exponential_decay", null), Scipy.Types.CurveFunctionType);
     *         const config = $.let({
     *             max_iter: variant("none", null),
     *             initial_guess: variant("none", null),
     *         }, CurveFitConfigType);
     *         return $.return(Scipy.curveFit(func, x, y, config));
     *     }
     * );
     * ```
     */
    curveFit: scipy_curve_fit,
    /**
     * Compute descriptive statistics for data.
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Scipy, VectorType } from "@elaraai/east-py-datascience";
     *
     * const describe = East.function(
     *     [VectorType(FloatType)],
     *     Scipy.Types.StatsDescribeResultType,
     *     ($, data) => {
     *         const result = $.let(Scipy.statsDescribe(data));
     *         // result.mean, result.variance, result.skewness, etc.
     *         return $.return(result);
     *     }
     * );
     * ```
     */
    statsDescribe: scipy_stats_describe,
    /**
     * Compute Pearson correlation coefficient.
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Scipy, VectorType } from "@elaraai/east-py-datascience";
     *
     * const correlate = East.function(
     *     [VectorType(FloatType), VectorType(FloatType)],
     *     Scipy.Types.CorrelationResultType,
     *     ($, x, y) => {
     *         const result = $.let(Scipy.statsPearsonr(x, y));
     *         // result.correlation, result.pvalue
     *         return $.return(result);
     *     }
     * );
     * ```
     */
    statsPearsonr: scipy_stats_pearsonr,
    /**
     * Compute Spearman rank correlation.
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Scipy, VectorType } from "@elaraai/east-py-datascience";
     *
     * const correlate = East.function(
     *     [VectorType(FloatType), VectorType(FloatType)],
     *     Scipy.Types.CorrelationResultType,
     *     ($, x, y) => {
     *         const result = $.let(Scipy.statsSpearmanr(x, y));
     *         // result.correlation, result.pvalue
     *         return $.return(result);
     *     }
     * );
     * ```
     */
    statsSpearmanr: scipy_stats_spearmanr,
    /**
     * Compute percentiles of data.
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Scipy, VectorType } from "@elaraai/east-py-datascience";
     *
     * const getPercentiles = East.function(
     *     [VectorType(FloatType)],
     *     VectorType(FloatType),
     *     ($, data) => {
     *         const percentiles = $.let(new Float64Array([25.0, 50.0, 75.0]));
     *         return $.return(Scipy.statsPercentile(data, percentiles));
     *     }
     * );
     * ```
     */
    statsPercentile: scipy_stats_percentile,
    /**
     * Compute the percentile rank of a score relative to a dataset.
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Scipy, VectorType } from "@elaraai/east-py-datascience";
     *
     * const getPctRank = East.function(
     *     [VectorType(FloatType), FloatType],
     *     FloatType,
     *     ($, data, score) => {
     *         return $.return(Scipy.statsPercentileOfScore(data, score));
     *     }
     * );
     * ```
     */
    statsPercentileOfScore: scipy_stats_percentileofscore,
    /**
     * Compute interquartile range (Q3 - Q1).
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Scipy, VectorType } from "@elaraai/east-py-datascience";
     *
     * const getIqr = East.function(
     *     [VectorType(FloatType)],
     *     FloatType,
     *     ($, data) => {
     *         return $.return(Scipy.statsIqr(data));
     *     }
     * );
     * ```
     */
    statsIqr: scipy_stats_iqr,
    /**
     * Compute median value.
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Scipy, VectorType } from "@elaraai/east-py-datascience";
     *
     * const getMedian = East.function(
     *     [VectorType(FloatType)],
     *     FloatType,
     *     ($, data) => {
     *         return $.return(Scipy.statsMedian(data));
     *     }
     * );
     * ```
     */
    statsMedian: scipy_stats_median,
    /**
     * Compute median absolute deviation (robust std estimate).
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Scipy, VectorType } from "@elaraai/east-py-datascience";
     *
     * const getMad = East.function(
     *     [VectorType(FloatType)],
     *     FloatType,
     *     ($, data) => {
     *         return $.return(Scipy.statsMad(data));
     *     }
     * );
     * ```
     */
    statsMad: scipy_stats_mad,
    /**
     * Compute robust statistics in one call (median, iqr, mad, q1, q3).
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Scipy, VectorType } from "@elaraai/east-py-datascience";
     *
     * const getRobust = East.function(
     *     [VectorType(FloatType)],
     *     Scipy.Types.RobustStatsResultType,
     *     ($, data) => {
     *         const result = $.let(Scipy.statsRobust(data));
     *         // result.median, result.iqr, result.mad, result.q1, result.q3
     *         return $.return(result);
     *     }
     * );
     * ```
     */
    statsRobust: scipy_stats_robust,
    /**
     * Fit a 1D interpolator to data.
     *
     * @example
     * ```ts
     * import { East, FloatType, variant } from "@elaraai/east";
     * import { Scipy, VectorType, InterpolateConfigType } from "@elaraai/east-py-datascience";
     *
     * const fitInterp = East.function(
     *     [VectorType(FloatType), VectorType(FloatType)],
     *     Scipy.Types.ModelBlobType,
     *     ($, x, y) => {
     *         const config = $.let({
     *             kind: variant("some", variant("cubic", null)),
     *         }, InterpolateConfigType);
     *         return $.return(Scipy.interpolate1dFit(x, y, config));
     *     }
     * );
     * ```
     */
    interpolate1dFit: scipy_interpolate_1d_fit,
    /**
     * Evaluate a fitted 1D interpolator at given points.
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Scipy, VectorType } from "@elaraai/east-py-datascience";
     *
     * const predict = East.function(
     *     [Scipy.Types.ModelBlobType, VectorType(FloatType)],
     *     VectorType(FloatType),
     *     ($, model, x_new) => {
     *         return $.return(Scipy.interpolate1dPredict(model, x_new));
     *     }
     * );
     * ```
     */
    interpolate1dPredict: scipy_interpolate_1d_predict,
    /**
     * Minimize a scalar function using scipy.optimize.minimize.
     *
     * @example
     * ```ts
     * import { East, FloatType, variant } from "@elaraai/east";
     * import { Scipy, VectorType, ScalarObjectiveType, OptimizeConfigType } from "@elaraai/east-py-datascience";
     *
     * const optimize = East.function(
     *     [ScalarObjectiveType, VectorType(FloatType)],
     *     Scipy.Types.OptimizeResultType,
     *     ($, objective, x0) => {
     *         const config = $.let({
     *             method: variant("some", variant("l_bfgs_b", null)),
     *             max_iter: variant("some", 100n),
     *             tol: variant("none", null),
     *         }, OptimizeConfigType);
     *         return $.return(Scipy.optimizeMinimize(objective, x0, config));
     *     }
     * );
     * ```
     */
    optimizeMinimize: scipy_optimize_minimize,
    /**
     * Minimize a quadratic function with analytical gradient.
     *
     * Minimizes f(x) = 0.5 * x'Ax + b'x + c.
     *
     * @example
     * ```ts
     * import { East, FloatType, variant } from "@elaraai/east";
     * import { Scipy, VectorType, MatrixType, QuadraticConfigType, OptimizeConfigType } from "@elaraai/east-py-datascience";
     *
     * const optimize = East.function(
     *     [VectorType(FloatType)],
     *     Scipy.Types.OptimizeResultType,
     *     ($, x0) => {
     *         const quadConfig = $.let({
     *             A: [[2.0, 0.0], [0.0, 2.0]],
     *             b: new Float64Array([-4.0, -6.0]),
     *             c: 0.0,
     *         }, QuadraticConfigType);
     *         const config = $.let({
     *             method: variant("some", variant("l_bfgs_b", null)),
     *             max_iter: variant("none", null),
     *             tol: variant("none", null),
     *         }, OptimizeConfigType);
     *         return $.return(Scipy.optimizeMinimizeQuadratic(x0, quadConfig, config));
     *     }
     * );
     * ```
     */
    optimizeMinimizeQuadratic: scipy_optimize_minimize_quadratic,
    /**
     * Global optimization using dual annealing.
     *
     * Combines generalized simulated annealing with local search.
     *
     * @example
     * ```ts
     * import { East, FloatType, variant } from "@elaraai/east";
     * import { Scipy, VectorType, ScalarObjectiveType, DualAnnealBoundsType, DualAnnealConfigType } from "@elaraai/east-py-datascience";
     *
     * const optimize = East.function(
     *     [ScalarObjectiveType],
     *     Scipy.Types.DualAnnealResultType,
     *     ($, objective) => {
     *         const bounds = $.let({
     *             lower: new Float64Array([-5.0, -5.0]),
     *             upper: new Float64Array([5.0, 5.0]),
     *         }, DualAnnealBoundsType);
     *         const config = $.let({
     *             maxfun: variant("some", 1000n),
     *             maxiter: variant("none", null),
     *             initial_temp: variant("none", null),
     *             restart_temp_ratio: variant("none", null),
     *             visit: variant("none", null),
     *             accept: variant("none", null),
     *             seed: variant("some", 42n),
     *             no_local_search: variant("none", null),
     *         }, DualAnnealConfigType);
     *         return $.return(Scipy.optimizeDualAnnealing(objective, variant("none", null), bounds, config));
     *     }
     * );
     * ```
     */
    optimizeDualAnnealing: scipy_optimize_dual_annealing,
    /**
     * Compute histogram of data.
     *
     * @example
     * ```ts
     * import { East, FloatType, variant } from "@elaraai/east";
     * import { Scipy, VectorType, HistogramConfigType } from "@elaraai/east-py-datascience";
     *
     * const computeHist = East.function(
     *     [VectorType(FloatType)],
     *     Scipy.Types.HistogramResultType,
     *     ($, data) => {
     *         const config = $.let({
     *             bins: variant("some", 20n),
     *             bin_method: variant("none", null),
     *             range_min: variant("none", null),
     *             range_max: variant("none", null),
     *             density: variant("some", true),
     *             weights: variant("none", null),
     *         }, HistogramConfigType);
     *         const result = $.let(Scipy.histogram(data, config));
     *         // result.counts, result.bin_edges
     *         return $.return(result);
     *     }
     * );
     * ```
     */
    histogram: scipy_histogram,
    /**
     * Fit a Kernel Density Estimator to data.
     *
     * @example
     * ```ts
     * import { East, FloatType, variant } from "@elaraai/east";
     * import { Scipy, VectorType, KdeConfigType } from "@elaraai/east-py-datascience";
     *
     * const fitKde = East.function(
     *     [VectorType(FloatType)],
     *     Scipy.Types.ModelBlobType,
     *     ($, data) => {
     *         const config = $.let({
     *             bandwidth: variant("some", variant("scott", null)),
     *             bandwidth_scalar: variant("none", null),
     *             weights: variant("none", null),
     *         }, KdeConfigType);
     *         return $.return(Scipy.kdeFit(data, config));
     *     }
     * );
     * ```
     */
    kdeFit: scipy_kde_fit,
    /**
     * Evaluate a fitted KDE model at given points.
     *
     * @example
     * ```ts
     * import { East, FloatType } from "@elaraai/east";
     * import { Scipy, VectorType } from "@elaraai/east-py-datascience";
     *
     * const evaluate = East.function(
     *     [Scipy.Types.ModelBlobType, VectorType(FloatType)],
     *     VectorType(FloatType),
     *     ($, model, points) => {
     *         return $.return(Scipy.kdeEvaluate(model, points));
     *     }
     * );
     * ```
     */
    kdeEvaluate: scipy_kde_evaluate,
    /** Type definitions */
    Types: ScipyTypes,
} as const;
