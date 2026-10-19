#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Shared type definitions for East Data Science.

Provides common East type definitions used across data science modules
including vectors, matrices, and scalar function types.
"""


from east.types.types import (
    ArrayType,
    BlobType,
    BooleanType,
    FloatType,
    FunctionType,
    IntegerType,
    MatrixType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    VectorType,
)

# ============================================================================
# Core Data Types
# ============================================================================

# String vector type (for feature names - strings can't go in vectors)
StringVectorType = ArrayType(StringType)
"""Array of ``String`` used for feature name lists."""

# ============================================================================
# Function Types
# ============================================================================

# Scalar objective function type: Vector -> Float
ScalarObjectiveType = FunctionType([VectorType(FloatType)], FloatType)
"""East function type ``(Vector<Float>) -> Float`` for scalar objective functions."""

# Vector objective function type: Vector -> Vector
VectorObjectiveType = FunctionType([VectorType(FloatType)], VectorType(FloatType))
"""East function type ``(Vector<Float>) -> Vector<Float>`` for vector objective functions."""

# ============================================================================
# Enum Types (Variant with NullType values)
# ============================================================================

# SciPy optimization method
OptimizeMethodType = VariantType(
    [
        ("bfgs", NullType),
        ("l_bfgs_b", NullType),
        ("nelder_mead", NullType),
        ("powell", NullType),
        ("cg", NullType),
    ]
)
"""SciPy gradient-based minimization algorithm.

Cases: ``bfgs``, ``l_bfgs_b`` (default, memory-efficient quasi-Newton with box
bounds), ``nelder_mead`` (derivative-free simplex), ``powell``
(derivative-free direction-set), ``cg`` (conjugate gradient).
"""

# Interpolation kind
InterpolationKindType = VariantType(
    [
        ("linear", NullType),
        ("cubic", NullType),
        ("quadratic", NullType),
    ]
)
"""Interpolation spline order for ``scipy_interp_1d``.

Cases: ``linear`` (default), ``cubic``, ``quadratic``.
"""

# Histogram bin selection method
HistogramBinMethodType = VariantType(
    [
        ("auto", NullType),
        ("fd", NullType),
        ("sturges", NullType),
        ("scott", NullType),
        ("rice", NullType),
        ("sqrt", NullType),
        ("doane", NullType),
    ]
)
"""Automatic bin-count estimator for ``scipy_histogram``, passed to ``numpy.histogram_bin_edges``.

Cases: ``auto`` (best of ``fd``/``sturges``), ``fd`` (Freedman-Diaconis),
``sturges``, ``scott``, ``rice``, ``sqrt``, ``doane``.
Overrides the numeric ``bins`` field when set.
"""

# KDE bandwidth selection method
KdeBandwidthMethodType = VariantType(
    [
        ("scott", NullType),
        ("silverman", NullType),
    ]
)
"""Bandwidth selection rule for ``scipy_kde``.

Cases: ``scott`` (default), ``silverman``.
Overridden by a numeric ``bandwidth_scalar`` when both are supplied.
"""

# NGBoost distribution type
NGBoostDistributionType = VariantType(
    [
        ("normal", NullType),
        ("lognormal", NullType),
    ]
)
"""Parametric output distribution for NGBoost probabilistic regression.

Cases: ``normal`` (default), ``lognormal`` (strictly positive targets).
"""



# GMM covariance type
GMMCovarianceType = VariantType(
    [
        ("full", NullType),
        ("tied", NullType),
        ("diag", NullType),
        ("spherical", NullType),
    ]
)
"""Covariance matrix structure for the Gaussian Mixture Model.

Cases: ``full`` (default - each component has its own full covariance),
``tied`` (all components share one covariance), ``diag`` (diagonal
per-component), ``spherical`` (single variance per component).
"""

# GP kernel type
GPKernelType = VariantType(
    [
        ("rbf", NullType),  # Radial Basis Function (squared exponential)
        ("matern_1_2", NullType),  # Matern with nu=1/2 (exponential)
        ("matern_3_2", NullType),  # Matern with nu=3/2
        ("matern_5_2", NullType),  # Matern with nu=5/2
        ("rational_quadratic", NullType),
        ("dot_product", NullType),
    ]
)
"""Covariance kernel for the Gaussian Process regressor.

Cases: ``rbf`` (default - squared exponential, infinitely differentiable),
``matern_1_2`` (exponential, non-differentiable), ``matern_3_2``
(once differentiable), ``matern_5_2`` (twice differentiable),
``rational_quadratic`` (scale mixture of RBFs), ``dot_product``
(inner product, non-stationary).
"""


# ============================================================================
# Config Types
# ============================================================================

# Class weight mode type
ClassWeightModeType = VariantType(
    [
        ("balanced", NullType),
    ]
)
"""Automatic class-weight mode for sklearn classifiers.

Cases: ``balanced`` (weights inversely proportional to class frequencies).
"""

# Confusion matrix result type
ConfusionMatrixResultType = StructType(
    [
        ("matrix", MatrixType(FloatType)),  # n_classes x n_classes
        ("classes", VectorType(IntegerType)),  # class labels
    ]
)
"""Confusion matrix with class labels.

Fields: ``matrix`` (``Matrix<Float>`` of shape ``n_classes x n_classes``),
``classes`` (``Vector<Integer>`` - sorted class labels in row/column order).
"""

# N-way split configuration (unified for 2-way, 3-way, 4-way, etc.)
SplitConfigType = StructType(
    [
        # Split proportions (must sum to 1.0), e.g., [0.7, 0.15, 0.15] for train/val/test
        ("split_sizes", ArrayType(FloatType)),
        ("random_state", OptionType(IntegerType)),  # default None
        ("shuffle", OptionType(BooleanType)),  # default True
        # Multi-column stratification: matrix where each row is one column of labels
        # E.g., matrix([[origin1, origin2, ...], [mpf1, mpf2, ...]]) stratifies on origin × mpf
        ("stratify", OptionType(MatrixType(IntegerType))),
        # Columns that must have overlapping values in all splits (but not used for stratification)
        # Matrix where each row is one column of overlap labels
        ("overlap", OptionType(MatrixType(IntegerType))),
        # Multi-value overlap columns: Array of columns, each column is Array of samples,
        # each sample is a Vector of values (a sample can belong to multiple categories)
        ("multi_overlap", OptionType(ArrayType(ArrayType(VectorType(IntegerType))))),
        # Minimum samples per overlap value (default = n_splits)
        ("min_overlap", OptionType(IntegerType)),
    ]
)
"""N-way train/validation/test split configuration.

Fields: ``split_sizes`` (``Array<Float>`` proportions summing to 1.0, e.g.
``[0.7, 0.15, 0.15]``), ``random_state`` (default ``None``), ``shuffle``
(default ``True``), ``stratify`` (``Option<Matrix<Integer>>`` - each row is
one integer-label column; stratifies jointly on all provided columns),
``overlap`` (``Option<Matrix<Integer>>`` - categories that must appear in
every split, not used for stratification), ``multi_overlap``
(``Option<Array<Array<Vector<Integer>>>>`` - multi-valued overlap: each
sample may belong to several categories), ``min_overlap`` (minimum samples
per overlap value, default ``n_splits``).
"""

# SciPy optimization configuration
OptimizeConfigType = StructType(
    [
        ("method", OptionType(OptimizeMethodType)),  # default l_bfgs_b
        ("max_iter", OptionType(IntegerType)),  # default 1000
        ("tol", OptionType(FloatType)),  # default 1e-6
    ]
)
"""Configuration for ``scipy_optimize`` (scalar minimization).

Fields: ``method`` (default ``l_bfgs_b``), ``max_iter`` (default 1000),
``tol`` (convergence tolerance, default 1e-6).
"""

# SciPy interpolation configuration
InterpolateConfigType = StructType(
    [
        ("kind", OptionType(InterpolationKindType)),  # default linear
    ]
)
"""Configuration for ``scipy_interp_1d`` (1-D spline fitting).

Fields: ``kind`` (default ``linear``).
"""

# Histogram configuration
HistogramConfigType = StructType(
    [
        ("bins", OptionType(IntegerType)),  # default 10
        ("bin_method", OptionType(HistogramBinMethodType)),  # overrides bins if set
        ("range_min", OptionType(FloatType)),  # lower bound
        ("range_max", OptionType(FloatType)),  # upper bound
        ("density", OptionType(BooleanType)),  # normalize to probability density
        ("weights", OptionType(VectorType(FloatType))),  # per-element weights
    ]
)
"""Configuration for ``scipy_histogram``.

Fields: ``bins`` (default 10), ``bin_method`` (automatic estimator -
overrides ``bins`` when set), ``range_min`` / ``range_max`` (clip range),
``density`` (normalize to probability density, default ``False``),
``weights`` (``Option<Vector<Float>>`` per-element weights).
"""

# KDE configuration
KdeConfigType = StructType(
    [
        ("bandwidth", OptionType(KdeBandwidthMethodType)),  # default scott
        ("bandwidth_scalar", OptionType(FloatType)),  # custom scalar (overrides method)
        ("weights", OptionType(VectorType(FloatType))),  # per-datapoint weights
    ]
)
"""Configuration for ``scipy_kde`` (kernel density estimation).

Fields: ``bandwidth`` (selection rule, default ``scott``),
``bandwidth_scalar`` (explicit numeric bandwidth - overrides ``bandwidth``
when set), ``weights`` (``Option<Vector<Float>>`` per-datapoint weights).
"""

# Parameter bounds for curve fitting
ParamBoundsType = StructType(
    [
        ("lower", VectorType(FloatType)),
        ("upper", VectorType(FloatType)),
    ]
)
"""Box bounds on curve-fit parameters for ``scipy_curve_fit``.

Fields: ``lower`` / ``upper`` (``Vector<Float>`` - one bound per optimized
parameter in the custom curve function).
"""

# Custom curve function: (x: Float, params: Vector, fixed_params: Vector) -> Float
# The params are optimized, fixed_params are passed through unchanged.
CustomCurveFunctionType = FunctionType([FloatType, VectorType(FloatType), VectorType(FloatType)], FloatType)
"""East function type ``(Float, Vector<Float>, Vector<Float>) -> Float`` for user-defined curve shapes.

Signature: ``(x, params, fixed_params) -> Float`` where ``params`` are
optimized by ``scipy_curve_fit`` and ``fixed_params`` are passed through
unchanged.
"""

# Curve function type (built-in + custom)
CurveFunctionType = VariantType(
    [
        # Standard mathematical functions
        ("exponential_decay", NullType),  # y = a * exp(-b * x)
        ("exponential_with_offset", NullType),  # y = a + b * exp(-c * x)
        ("exponential_growth", NullType),  # y = a * exp(b * x)
        ("logistic", NullType),  # y = L / (1 + exp(-k * (x - x0)))
        ("gompertz", NullType),  # y = a * exp(-b * exp(-c * x))
        ("power_law", NullType),  # y = a * x^b
        ("linear", NullType),  # y = a + b * x
        ("quadratic", NullType),  # y = a + b*x + c*x^2
        ("cubic", NullType),  # y = a + b*x + c*x^2 + d*x^3
        # Custom function
        (
            "custom",
            StructType(
                [
                    ("fn", CustomCurveFunctionType),
                    ("n_params", IntegerType),
                    ("param_bounds", OptionType(ParamBoundsType)),
                    ("fixed_params", OptionType(VectorType(FloatType))),  # Passed to fn but not optimized
                ]
            ),
        ),
    ]
)
"""Curve shape for ``scipy_curve_fit`` - built-in or user-defined.

Cases: ``exponential_decay`` (``a * exp(-b*x)``), ``exponential_with_offset``
(``a + b*exp(-c*x)``), ``exponential_growth`` (``a * exp(b*x)``),
``logistic`` (``L / (1 + exp(-k*(x-x0)))``), ``gompertz``
(``a * exp(-b*exp(-c*x))``), ``power_law`` (``a * x^b``), ``linear``
(``a + b*x``), ``quadratic`` (``a + b*x + c*x^2``), ``cubic``
(``a + b*x + c*x^2 + d*x^3``), ``custom`` ``{fn, n_params, param_bounds,
fixed_params}`` (arbitrary East function - ``n_params`` parameters are
optimized; ``fixed_params`` passed through unchanged).
"""

# Curve fit configuration
CurveFitConfigType = StructType(
    [
        ("max_iter", OptionType(IntegerType)),  # default 5000
        ("initial_guess", OptionType(VectorType(FloatType))),  # default: auto
    ]
)
"""Configuration for ``scipy_curve_fit`` iterations and starting point.

Fields: ``max_iter`` (default 5000), ``initial_guess``
(``Option<Vector<Float>>`` - one value per parameter; derived automatically
when absent).
"""

# Quadratic function configuration: f(x) = 0.5 * x'Ax + b'x + c
QuadraticConfigType = StructType(
    [
        ("A", MatrixType(FloatType)),  # Quadratic term (symmetric positive definite)
        ("b", VectorType(FloatType)),  # Linear term
        ("c", FloatType),  # Constant term
    ]
)
"""Quadratic objective ``f(x) = 0.5 * x'Ax + b'x + c`` used by ``scipy_optimize_quadratic``.

Fields: ``A`` (``Matrix<Float>`` - symmetric positive-definite quadratic
term), ``b`` (``Vector<Float>`` - linear term), ``c`` (``Float`` - constant
offset).
"""

# XGBoost configuration
XGBoostConfigType = StructType(
    [
        ("n_estimators", OptionType(IntegerType)),  # default 100
        ("max_depth", OptionType(IntegerType)),  # default 6
        ("learning_rate", OptionType(FloatType)),  # default 0.3
        ("min_child_weight", OptionType(IntegerType)),  # default 1
        ("subsample", OptionType(FloatType)),  # default 1.0
        ("colsample_bytree", OptionType(FloatType)),  # default 1.0
        ("reg_alpha", OptionType(FloatType)),  # default 0 (L1)
        ("reg_lambda", OptionType(FloatType)),  # default 1 (L2)
        ("gamma", OptionType(FloatType)),  # default 0 (min split loss)
        ("random_state", OptionType(IntegerType)),  # default None
        ("n_jobs", OptionType(IntegerType)),  # default -1
        ("sample_weight", OptionType(VectorType(FloatType))),  # sample weights (default uniform)
        ("categorical_features", OptionType(VectorType(IntegerType))),  # categorical column indices
        ("categorical_n", OptionType(VectorType(IntegerType))),  # n categories per categorical feature
        ("max_cat_to_onehot", OptionType(IntegerType)),  # default 4
        ("max_cat_threshold", OptionType(IntegerType)),  # default 64
        ("scale_pos_weight", OptionType(FloatType)),  # default None (XGBoost default 1.0)
    ]
)
"""Configuration for XGBoost regression and classification.

Fields: ``n_estimators`` (default 100), ``max_depth`` (default 6),
``learning_rate`` (default 0.3), ``min_child_weight`` (default 1),
``subsample`` (default 1.0), ``colsample_bytree`` (default 1.0),
``reg_alpha`` (L1, default 0), ``reg_lambda`` (L2, default 1),
``gamma`` (min split loss, default 0), ``random_state`` (default
``None``), ``n_jobs`` (default -1), ``sample_weight``
(``Option<Vector<Float>>`` per-row weights, default uniform),
``categorical_features`` (``Option<Vector<Integer>>`` zero-based column
indices), ``categorical_n`` (``Option<Vector<Integer>>`` category count per
categorical feature), ``max_cat_to_onehot`` (default 4),
``max_cat_threshold`` (default 64), ``scale_pos_weight``
(``Option<Float>`` binary class-imbalance weight, default ``None`` =
XGBoost default 1.0; consumed by classifier training only).
"""

# XGBoost quantile configuration
XGBoostQuantileConfigType = StructType(
    [
        ("quantiles", VectorType(FloatType)),  # quantiles to predict, e.g., [0.1, 0.5, 0.9]
        ("n_estimators", OptionType(IntegerType)),  # default 100
        ("max_depth", OptionType(IntegerType)),  # default 6
        ("learning_rate", OptionType(FloatType)),  # default 0.3
        ("min_child_weight", OptionType(IntegerType)),  # default 1
        ("subsample", OptionType(FloatType)),  # default 1.0
        ("colsample_bytree", OptionType(FloatType)),  # default 1.0
        ("reg_alpha", OptionType(FloatType)),  # default 0 (L1)
        ("reg_lambda", OptionType(FloatType)),  # default 1 (L2)
        ("gamma", OptionType(FloatType)),  # default 0 (min split loss)
        ("random_state", OptionType(IntegerType)),  # default None
        ("n_jobs", OptionType(IntegerType)),  # default -1
        ("sample_weight", OptionType(VectorType(FloatType))),  # sample weights (default uniform)
        ("categorical_features", OptionType(VectorType(IntegerType))),  # categorical column indices
        ("categorical_n", OptionType(VectorType(IntegerType))),  # n categories per categorical feature
        ("max_cat_to_onehot", OptionType(IntegerType)),  # default 4
        ("max_cat_threshold", OptionType(IntegerType)),  # default 64
    ]
)
"""Configuration for XGBoost quantile regression (one model per quantile).

Fields: ``quantiles`` (``Vector<Float>`` e.g. ``[0.1, 0.5, 0.9]``), plus
the same hyperparameters as ``XGBoostConfigType`` - ``n_estimators``
(default 100), ``max_depth`` (default 6), ``learning_rate`` (default 0.3),
``min_child_weight`` (default 1), ``subsample`` (default 1.0),
``colsample_bytree`` (default 1.0), ``reg_alpha`` (L1, default 0),
``reg_lambda`` (L2, default 1), ``gamma`` (default 0),
``random_state`` (default ``None``), ``n_jobs`` (default -1),
``sample_weight``, ``categorical_features``, ``categorical_n``,
``max_cat_to_onehot`` (default 4), ``max_cat_threshold`` (default 64).
"""

# LightGBM configuration
LightGBMConfigType = StructType(
    [
        ("n_estimators", OptionType(IntegerType)),  # default 100
        ("max_depth", OptionType(IntegerType)),  # default -1 (unlimited)
        ("learning_rate", OptionType(FloatType)),  # default 0.1
        ("num_leaves", OptionType(IntegerType)),  # default 31
        ("min_child_samples", OptionType(IntegerType)),  # default 20
        ("subsample", OptionType(FloatType)),  # default 1.0
        ("colsample_bytree", OptionType(FloatType)),  # default 1.0
        ("reg_alpha", OptionType(FloatType)),  # default 0
        ("reg_lambda", OptionType(FloatType)),  # default 0
        ("random_state", OptionType(IntegerType)),  # default None
        ("n_jobs", OptionType(IntegerType)),  # default -1
    ]
)
"""Configuration for LightGBM regression and classification.

Fields: ``n_estimators`` (default 100), ``max_depth`` (default -1 -
unlimited depth), ``learning_rate`` (default 0.1), ``num_leaves`` (default
31), ``min_child_samples`` (default 20), ``subsample`` (default 1.0),
``colsample_bytree`` (default 1.0), ``reg_alpha`` (L1, default 0),
``reg_lambda`` (L2, default 0), ``random_state`` (default ``None``),
``n_jobs`` (default -1).
"""

# NGBoost configuration
NGBoostConfigType = StructType(
    [
        ("n_estimators", OptionType(IntegerType)),  # default 500
        ("learning_rate", OptionType(FloatType)),  # default 0.01
        ("minibatch_frac", OptionType(FloatType)),  # default 1.0
        ("col_sample", OptionType(FloatType)),  # default 1.0
        ("random_state", OptionType(IntegerType)),  # default None
        ("distribution", OptionType(NGBoostDistributionType)),  # default normal
    ]
)
"""Configuration for NGBoost probabilistic regression.

Fields: ``n_estimators`` (default 500), ``learning_rate`` (default 0.01),
``minibatch_frac`` (default 1.0), ``col_sample`` (default 1.0),
``random_state`` (default ``None``), ``distribution`` (default ``normal``).
"""

# NGBoost prediction configuration
NGBoostPredictConfigType = StructType(
    [
        ("confidence_level", OptionType(FloatType)),  # default 0.95
    ]
)
"""Configuration for NGBoost prediction intervals.

Fields: ``confidence_level`` (default 0.95 - symmetric interval width
around the point prediction).
"""


# GP configuration
GPConfigType = StructType(
    [
        ("kernel", OptionType(GPKernelType)),  # default rbf
        ("alpha", OptionType(FloatType)),  # noise level, default 1e-10
        ("n_restarts_optimizer", OptionType(IntegerType)),  # default 0
        ("normalize_y", OptionType(BooleanType)),  # default False
        ("random_state", OptionType(IntegerType)),  # for reproducibility
    ]
)
"""Configuration for Gaussian Process regression.

Fields: ``kernel`` (default ``rbf``), ``alpha`` (observation noise
variance added to the diagonal, default 1e-10), ``n_restarts_optimizer``
(random restarts for marginal likelihood maximization, default 0),
``normalize_y`` (default ``False``), ``random_state``.
"""

# GMM configuration
GMMConfigType = StructType(
    [
        ("n_components", OptionType(IntegerType)),  # default 1
        ("covariance_type", OptionType(GMMCovarianceType)),  # default full
        ("max_iter", OptionType(IntegerType)),  # default 100
        ("n_init", OptionType(IntegerType)),  # default 1
        ("tol", OptionType(FloatType)),  # default 1e-3
        ("reg_covar", OptionType(FloatType)),  # default 1e-6
        ("random_state", OptionType(IntegerType)),  # default None
    ]
)
"""Configuration for Gaussian Mixture Model fitting.

Fields: ``n_components`` (default 1), ``covariance_type`` (default
``full``), ``max_iter`` (EM iterations, default 100), ``n_init``
(independent initializations, default 1), ``tol`` (default 1e-3),
``reg_covar`` (covariance regularization, default 1e-6),
``random_state`` (default ``None``).
"""

# RegressorChain base estimator config (variant carries type + config)
RegressorChainBaseConfigType = VariantType(
    [
        ("xgboost", XGBoostConfigType),
        ("lightgbm", LightGBMConfigType),
        ("ngboost", NGBoostConfigType),
        ("gp", GPConfigType),
    ]
)
"""Base estimator selector for sklearn ``RegressorChain``.

Cases: ``xgboost`` (``XGBoostConfigType``), ``lightgbm``
(``LightGBMConfigType``), ``ngboost`` (``NGBoostConfigType``), ``gp``
(``GPConfigType``). The chosen estimator is fitted independently for
each output in the chain.
"""

# RegressorChain configuration
RegressorChainConfigType = StructType(
    [
        ("base_estimator", RegressorChainBaseConfigType),  # Base estimator with config
        (
            "order",
            OptionType(ArrayType(IntegerType)),
        ),  # Chain order (default: None = 0,1,2,...)
        ("random_state", OptionType(IntegerType)),  # Random seed
    ]
)
"""Configuration for sklearn ``RegressorChain`` (chained multi-output regression).

Fields: ``base_estimator`` (which model and its config to replicate per
target), ``order`` (``Option<Array<Integer>>`` target indices defining the
chain order; default ``None`` = natural 0, 1, 2, … order),
``random_state``.
"""

# ============================================================================
# Result Types
# ============================================================================

# N-way split result (unified)
SplitResultType = StructType(
    [
        # Array of feature matrices, one per split (in order of split_sizes)
        ("X_splits", ArrayType(MatrixType(FloatType))),
        # Array of target matrices, one per split (in order of split_sizes)
        ("Y_splits", ArrayType(MatrixType(FloatType))),
        # Indices of rows rejected due to rare stratify classes or missing overlap values
        ("rejected_indices", ArrayType(IntegerType)),
    ]
)
"""Result of ``sklearn_split`` - N feature/target matrix pairs plus rejection info.

Fields: ``X_splits`` (``Array<Matrix<Float>>`` - one feature matrix per
split in ``split_sizes`` order), ``Y_splits`` (``Array<Matrix<Float>>`` -
matching target matrices), ``rejected_indices`` (``Array<Integer>`` rows
dropped due to rare stratify classes or missing overlap values).
"""

# Overlap configuration (for filtering targets to match reference categories)
OverlapConfigType = StructType(
    [
        # Which column indices in X are categorical
        ("cat_indices", VectorType(IntegerType)),
    ]
)
"""Configuration for ``sklearn_overlap`` - specifies which X columns are categorical.

Fields: ``cat_indices`` (``Vector<Integer>`` - zero-based column indices
treated as categorical when computing overlap filtering).
"""

# Overlap result
OverlapResultType = StructType(
    [
        # Filtered feature matrices (one per target)
        ("X_filtered", ArrayType(MatrixType(FloatType))),
        # Filtered target matrices (one per target, filtered in sync with X)
        ("Y_filtered", ArrayType(MatrixType(FloatType))),
        # Number of rejected rows per target
        ("rejected_counts", VectorType(IntegerType)),
        # Per categorical column, the sorted list of known values from the reference
        ("known_categories", ArrayType(VectorType(IntegerType))),
    ]
)
"""Result of ``sklearn_overlap`` - feature/target pairs filtered to reference categories.

Fields: ``X_filtered`` (``Array<Matrix<Float>>`` - one feature matrix per
target dataset), ``Y_filtered`` (``Array<Matrix<Float>>`` - matching target
matrices), ``rejected_counts`` (``Vector<Integer>`` rows dropped per
target), ``known_categories`` (``Array<Vector<Integer>>`` - sorted known
values per categorical column derived from the reference dataset).
"""

# ============================================================================
# Flexible Metrics Types
# ============================================================================

# Regression metric variant (flexible)
RegressionMetricType = VariantType(
    [
        ("mse", NullType),
        ("rmse", NullType),
        ("mae", NullType),
        ("r2", NullType),
        ("mape", NullType),
        ("explained_variance", NullType),
        ("max_error", NullType),
        ("median_ae", NullType),
        ("mean_error", NullType),  # Bias: mean(pred - true)
        ("pinball_loss", FloatType),  # Quantile loss (param = alpha)
        ("huber", FloatType),  # Robust loss (param = delta)
        ("mean_tweedie_deviance", FloatType),  # Skewed distributions (param = power)
    ]
)
"""Regression metric selector used in ``sklearn_metrics`` and multi-target variants.

Cases: ``mse``, ``rmse``, ``mae``, ``r2``, ``mape``, ``explained_variance``,
``max_error``, ``median_ae``, ``mean_error`` (bias: mean(pred - true)),
``pinball_loss`` (``Float`` quantile alpha), ``huber`` (``Float`` delta for
robust loss), ``mean_tweedie_deviance`` (``Float`` power for skewed
distributions).
"""

# Single metric result
MetricResultType = StructType(
    [
        ("metric", RegressionMetricType),
        ("value", FloatType),
    ]
)
"""Single regression metric result from ``sklearn_metrics``.

Fields: ``metric`` (which metric was computed), ``value`` (``Float``
computed value).
"""

# Multiple metrics result
MetricsResultType = ArrayType(MetricResultType)
"""Array of ``MetricResultType`` - one entry per requested metric from ``sklearn_metrics``."""

# Metric aggregation type
MetricAggregationType = VariantType(
    [
        ("per_target", NullType),
        ("uniform_average", NullType),
    ]
)
"""Aggregation strategy for multi-target regression metrics.

Cases: ``per_target`` (return one value per output column),
``uniform_average`` (scalar average across all outputs).
"""

# Multi-target metrics config
MultiMetricsConfigType = StructType(
    [
        ("aggregation", OptionType(MetricAggregationType)),
    ]
)
"""Configuration for ``sklearn_multi_metrics`` aggregation strategy.

Fields: ``aggregation`` (default ``uniform_average``).
"""

# Multi-target metric value (scalar or per-target)
MultiMetricValueType = VariantType(
    [
        ("scalar", FloatType),
        ("per_target", VectorType(FloatType)),
    ]
)
"""Metric value for multi-target regression - aggregated or per-output.

Cases: ``scalar`` (``Float`` - uniform average across targets),
``per_target`` (``Vector<Float>`` - one value per output column).
"""

# Multi-target metric result
MultiMetricResultType = StructType(
    [
        ("metric", RegressionMetricType),
        ("value", MultiMetricValueType),
    ]
)
"""Single metric result for multi-target regression from ``sklearn_multi_metrics``.

Fields: ``metric`` (which metric), ``value`` (``MultiMetricValueType`` -
scalar or per-target).
"""

# Multi-target metrics result
MultiMetricsResultType = ArrayType(MultiMetricResultType)
"""Array of ``MultiMetricResultType`` - one entry per requested metric."""

# Cohen's Kappa weights type
CohenKappaWeightsType = VariantType(
    [
        ("none", NullType),
        ("linear", NullType),
        ("quadratic", NullType),
    ]
)
"""Disagreement weighting scheme for Cohen's Kappa.

Cases: ``none`` (unweighted - all disagreements equal), ``linear``
(penalty proportional to distance), ``quadratic`` (penalty proportional
to squared distance).
"""

# Classification metric variant
ClassificationMetricType = VariantType(
    [
        ("accuracy", NullType),
        ("balanced_accuracy", NullType),
        ("precision", NullType),
        ("recall", NullType),
        ("f1", NullType),
        ("matthews_corrcoef", NullType),
        ("cohen_kappa", CohenKappaWeightsType),
        ("jaccard", NullType),
    ]
)
"""Classification metric selector used in ``sklearn_classification_metrics``.

Cases: ``accuracy``, ``balanced_accuracy``, ``precision``, ``recall``,
``f1``, ``matthews_corrcoef``, ``cohen_kappa`` (``CohenKappaWeightsType``
weighting scheme), ``jaccard``.
"""

# Classification averaging type
ClassificationAverageType = VariantType(
    [
        ("macro", NullType),
        ("micro", NullType),
        ("weighted", NullType),
        ("binary", NullType),
    ]
)
"""Averaging strategy for multi-class/multi-label classification metrics.

Cases: ``macro`` (unweighted mean per class), ``micro`` (globally pooled
counts), ``weighted`` (support-weighted mean), ``binary`` (positive class
only - for binary problems).
"""

# ROC AUC multi-class strategy type
RocAucMultiClassType = VariantType(
    [
        ("ovr", NullType),  # One-vs-rest
        ("ovo", NullType),  # One-vs-one
    ]
)
"""Multi-class extension strategy for ROC AUC.

Cases: ``ovr`` (default - one-vs-rest), ``ovo`` (one-vs-one).
"""

# ROC AUC configuration type
RocAucConfigType = StructType(
    [
        ("multi_class", OptionType(RocAucMultiClassType)),  # default ovr
        ("average", OptionType(ClassificationAverageType)),  # default macro
    ]
)
"""Configuration for ``sklearn_roc_auc``.

Fields: ``multi_class`` (default ``ovr``), ``average`` (default ``macro``).
"""

# Classification metrics config
ClassificationMetricsConfigType = StructType(
    [
        ("average", OptionType(ClassificationAverageType)),
    ]
)
"""Configuration for ``sklearn_classification_metrics`` averaging strategy.

Fields: ``average`` (default ``macro``).
"""

# Single classification metric result
ClassificationMetricResultType = StructType(
    [
        ("metric", ClassificationMetricType),
        ("value", FloatType),
    ]
)
"""Single classification metric result from ``sklearn_classification_metrics``.

Fields: ``metric`` (which metric was computed), ``value`` (``Float``
computed value).
"""

# Multiple classification metrics result
ClassificationMetricResultsType = ArrayType(ClassificationMetricResultType)
"""Array of ``ClassificationMetricResultType`` - one entry per requested metric."""

# Multi-target classification config
MultiClassificationConfigType = StructType(
    [
        ("average", OptionType(ClassificationAverageType)),
        ("aggregation", OptionType(MetricAggregationType)),
    ]
)
"""Configuration for multi-target classification metrics.

Fields: ``average`` (per-class averaging, default ``macro``),
``aggregation`` (cross-target aggregation, default ``uniform_average``).
"""

# Multi-target classification metric result
MultiClassificationMetricResultType = StructType(
    [
        ("metric", ClassificationMetricType),
        ("value", MultiMetricValueType),
    ]
)
"""Single metric result for multi-target classification.

Fields: ``metric`` (which metric), ``value`` (``MultiMetricValueType`` -
scalar or per-target).
"""

# Multi-target classification metrics result
MultiClassificationMetricResultsType = ArrayType(MultiClassificationMetricResultType)
"""Array of ``MultiClassificationMetricResultType`` - one entry per requested metric."""

# SciPy stats describe result
StatsDescribeResultType = StructType(
    [
        ("count", IntegerType),
        ("mean", FloatType),
        ("variance", FloatType),
        ("skewness", FloatType),
        ("kurtosis", FloatType),
        ("min", FloatType),
        ("max", FloatType),
    ]
)
"""Descriptive statistics result from ``scipy_stats_describe``.

Fields: ``count`` (sample size), ``mean``, ``variance``, ``skewness``
(Fisher's definition), ``kurtosis`` (excess kurtosis), ``min``, ``max``.
"""

# Robust statistics result (median-based, outlier-resistant)
RobustStatsResultType = StructType(
    [
        ("median", FloatType),
        ("iqr", FloatType),
        ("mad", FloatType),
        ("q1", FloatType),
        ("q3", FloatType),
    ]
)
"""Robust (median-based) statistics result from ``scipy_robust_stats``.

Fields: ``median``, ``iqr`` (interquartile range), ``mad``
(median absolute deviation), ``q1`` (25th percentile), ``q3``
(75th percentile).
"""

# Correlation result
CorrelationResultType = StructType(
    [
        ("correlation", FloatType),
        ("pvalue", FloatType),
    ]
)
"""Pairwise correlation result from ``scipy_pearsonr`` / ``scipy_spearmanr``.

Fields: ``correlation`` (coefficient in [-1, 1]), ``pvalue``
(two-tailed significance).
"""

# Histogram result
HistogramResultType = StructType(
    [
        ("counts", VectorType(FloatType)),  # bin values (float for density mode)
        ("bin_edges", VectorType(FloatType)),  # length = len(counts) + 1
    ]
)
"""Histogram result from ``scipy_histogram``.

Fields: ``counts`` (``Vector<Float>`` - bin values; float to support
density mode), ``bin_edges`` (``Vector<Float>`` - length ``len(counts)+1``).
"""

# KDE result metadata
KdeResultType = StructType(
    [
        ("bandwidth", FloatType),  # actual bandwidth factor used
        ("data_min", FloatType),  # min of training data
        ("data_max", FloatType),  # max of training data
    ]
)
"""Kernel density estimator metadata from ``scipy_kde_fit``.

Fields: ``bandwidth`` (actual bandwidth factor applied), ``data_min`` /
``data_max`` (range of the training data, used to bound evaluation grids).
"""

# Curve fitting result
CurveFitResultType = StructType(
    [
        ("params", VectorType(FloatType)),
        ("success", BooleanType),
        ("r_squared", FloatType),
    ]
)
"""Result of ``scipy_curve_fit``.

Fields: ``params`` (``Vector<Float>`` - fitted parameter values),
``success`` (whether the optimizer converged), ``r_squared``
(coefficient of determination on the training data).
"""

# SciPy optimization result
OptimizeResultType = StructType(
    [
        ("x", VectorType(FloatType)),  # Optimal parameters
        ("fun", FloatType),  # Function value at optimum
        ("success", BooleanType),  # Whether optimization succeeded
        ("nit", IntegerType),  # Number of iterations
    ]
)
"""Result of ``scipy_optimize``.

Fields: ``x`` (``Vector<Float>`` - optimal parameter values), ``fun``
(objective value at ``x``), ``success`` (optimizer convergence flag),
``nit`` (iterations taken).
"""

# SciPy dual annealing bounds (required)
DualAnnealBoundsType = StructType(
    [
        ("lower", VectorType(FloatType)),  # Lower bounds for each variable
        ("upper", VectorType(FloatType)),  # Upper bounds for each variable
    ]
)
"""Required search-space bounds for ``scipy_dual_anneal``.

Fields: ``lower`` / ``upper`` (``Vector<Float>`` - one bound per decision
variable; must match the objective's input dimension).
"""

# SciPy dual annealing configuration
DualAnnealConfigType = StructType(
    [
        ("maxfun", OptionType(IntegerType)),  # Max function evals (default 1000)
        ("maxiter", OptionType(IntegerType)),  # Max iterations (default 1000)
        ("initial_temp", OptionType(FloatType)),  # Initial temperature (default 5230)
        (
            "restart_temp_ratio",
            OptionType(FloatType),
        ),  # Restart threshold (default 2e-5)
        ("visit", OptionType(FloatType)),  # Visiting distribution param (default 2.62)
        ("accept", OptionType(FloatType)),  # Acceptance param (default -5.0)
        ("seed", OptionType(IntegerType)),  # Random seed
        ("no_local_search", OptionType(BooleanType)),  # Disable local search
    ]
)
"""Configuration for ``scipy_dual_anneal`` (dual annealing global optimizer).

Fields: ``maxfun`` (max function evaluations, SciPy default 1e7 - pass
explicitly to cap), ``maxiter`` (max annealing iterations, SciPy default
1000), ``initial_temp`` (SciPy default 5230), ``restart_temp_ratio``
(restart threshold, SciPy default 2e-5), ``visit`` (visiting distribution
parameter, SciPy default 2.62), ``accept`` (acceptance parameter, SciPy
default -5.0), ``seed`` (random seed), ``no_local_search`` (disable local
polishing, default ``False``).
"""

# SciPy dual annealing result
DualAnnealResultType = StructType(
    [
        ("x", VectorType(FloatType)),  # Best solution found
        ("fun", FloatType),  # Best objective value
        ("nfev", IntegerType),  # Number of function evaluations
        ("nit", IntegerType),  # Number of iterations
        ("success", BooleanType),  # Whether optimization succeeded
        ("message", StringType),  # Status message
    ]
)
"""Result of ``scipy_dual_anneal``.

Fields: ``x`` (``Vector<Float>`` - best solution found), ``fun`` (best
objective value), ``nfev`` (function evaluations), ``nit``
(iterations), ``success`` (convergence flag), ``message`` (status
string from SciPy).
"""

# NGBoost prediction result (with uncertainty)
NGBoostPredictResultType = StructType(
    [
        ("predictions", VectorType(FloatType)),  # Point predictions (mean)
        ("std", OptionType(VectorType(FloatType))),  # Standard deviation
        ("lower", OptionType(VectorType(FloatType))),  # Lower confidence interval
        ("upper", OptionType(VectorType(FloatType))),  # Upper confidence interval
    ]
)
"""NGBoost prediction result with uncertainty from ``ngboost_predict``.

Fields: ``predictions`` (``Vector<Float>`` - point predictions / mean),
``std`` (``Option<Vector<Float>>`` - predictive standard deviation),
``lower`` / ``upper`` (``Option<Vector<Float>>`` - confidence interval
bounds at the configured ``confidence_level``).
"""

# XGBoost quantile prediction result
XGBoostQuantilePredictResultType = StructType(
    [
        ("quantiles", VectorType(FloatType)),  # Quantile values that were predicted
        ("predictions", MatrixType(FloatType)),  # Predictions matrix (n_samples x n_quantiles)
    ]
)
"""XGBoost quantile regression prediction result from ``xgboost_quantile_predict``.

Fields: ``quantiles`` (``Vector<Float>`` - the quantile levels that were
predicted), ``predictions`` (``Matrix<Float>`` shape
``n_samples x n_quantiles``).
"""

# SHAP values variant type - 2D (regression/binary) or 3D (multi-class)
ShapValuesType = VariantType(
    [
        ("matrix_2d", MatrixType(FloatType)),  # 2D for regression/binary (n_samples x n_features)
        (
            "tensor_3d",
            ArrayType(MatrixType(FloatType)),
        ),  # 3D for multi-class (n_samples x n_features x n_classes)
    ]
)
"""SHAP attribution values - 2-D for single-output models, 3-D for multi-class.

Cases: ``matrix_2d`` (``Matrix<Float>`` shape ``n_samples x n_features`` -
regression or binary classification), ``tensor_3d``
(``Array<Matrix<Float>>`` shape ``n_classes x n_samples x n_features`` -
multi-class classification).
"""

# SHAP base value variant type - single (regression/binary) or per-class (multi-class)
ShapBaseValueType = VariantType(
    [
        ("single", FloatType),  # Single base value for regression/binary
        ("per_class", VectorType(FloatType)),  # Per-class base values for multi-class
    ]
)
"""SHAP expected-value baseline - scalar or per-class.

Cases: ``single`` (``Float`` - regression/binary), ``per_class``
(``Vector<Float>`` - one baseline value per class for multi-class models).
"""

# SHAP values result
ShapResultType = StructType(
    [
        ("shap_values", ShapValuesType),  # SHAP values (2D or 3D)
        ("base_value", ShapBaseValueType),  # Base value(s)
        ("feature_names", StringVectorType),  # Feature names
    ]
)
"""SHAP explanation result from ``shap_values``.

Fields: ``shap_values`` (2-D or 3-D attributions), ``base_value``
(model expected output - scalar or per-class), ``feature_names``
(``Array<String>`` feature labels in column order).
"""

# Feature importance result
FeatureImportanceType = StructType(
    [
        ("feature_names", StringVectorType),  # Feature names
        ("importances", VectorType(FloatType)),  # Mean |SHAP| for each feature
        ("std", OptionType(VectorType(FloatType))),  # Std of |SHAP| for each feature
    ]
)
"""SHAP-based feature importance from ``shap_feature_importance``.

Fields: ``feature_names`` (``Array<String>``), ``importances``
(``Vector<Float>`` - mean absolute SHAP value per feature),
``std`` (``Option<Vector<Float>>`` - standard deviation of |SHAP| per
feature, present when computed).
"""


# GP prediction result (with uncertainty)
GPPredictResultType = StructType(
    [
        ("mean", VectorType(FloatType)),  # Predicted mean
        ("std", VectorType(FloatType)),  # Predicted standard deviation
    ]
)
"""Gaussian Process prediction result from ``gp_predict``.

Fields: ``mean`` (``Vector<Float>`` - posterior mean per sample), ``std``
(``Vector<Float>`` - posterior standard deviation per sample).
"""

# ============================================================================
# Model Blob Type
# ============================================================================

# Standalone model blob types (reused by MAPIE)
XGBoostModelBlobType = VariantType(
    [
        (
            "xgboost_regressor",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                    ("categorical_features", OptionType(VectorType(IntegerType))),
                    ("categorical_n", OptionType(VectorType(IntegerType))),
                ]
            ),
        ),
        (
            "xgboost_classifier",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                    ("n_classes", IntegerType),
                    ("categorical_features", OptionType(VectorType(IntegerType))),
                    ("categorical_n", OptionType(VectorType(IntegerType))),
                ]
            ),
        ),
        (
            "xgboost_quantile",
            StructType(
                [
                    ("data", BlobType),
                    ("quantiles", VectorType(FloatType)),
                    ("n_features", IntegerType),
                    ("categorical_features", OptionType(VectorType(IntegerType))),
                    ("categorical_n", OptionType(VectorType(IntegerType))),
                ]
            ),
        ),
    ]
)
"""Serialized XGBoost model blob - reused by MAPIE conformal wrappers.

Cases: ``xgboost_regressor`` ``{data, n_features, categorical_features,
categorical_n}``, ``xgboost_classifier`` ``{data, n_features, n_classes,
categorical_features, categorical_n}``, ``xgboost_quantile`` ``{data,
quantiles, n_features, categorical_features, categorical_n}``.
All ``data`` fields are cloudpickle-serialized.
"""

LightGBMModelBlobType = VariantType(
    [
        (
            "lightgbm_regressor",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                ]
            ),
        ),
        (
            "lightgbm_classifier",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                    ("n_classes", IntegerType),
                ]
            ),
        ),
    ]
)
"""Serialized LightGBM model blob - reused by MAPIE conformal wrappers.

Cases: ``lightgbm_regressor`` ``{data, n_features}``,
``lightgbm_classifier`` ``{data, n_features, n_classes}``.
All ``data`` fields are cloudpickle-serialized.
"""

# Model blob type - each model type has its own variant case
ModelBlobType = VariantType(
    [
        # Sklearn Preprocessing
        (
            "standard_scaler",
            StructType(
                [
                    ("onnx", BlobType),
                    ("n_features", IntegerType),
                ]
            ),
        ),
        (
            "min_max_scaler",
            StructType(
                [
                    ("onnx", BlobType),
                    ("n_features", IntegerType),
                ]
            ),
        ),
        (
            "robust_scaler",
            StructType(
                [
                    ("onnx", BlobType),
                    ("n_features", IntegerType),
                ]
            ),
        ),
        # Sklearn Encoders (cloudpickle serialized)
        (
            "label_encoder",
            StructType(
                [
                    ("data", BlobType),
                    ("n_classes", IntegerType),
                ]
            ),
        ),
        (
            "ordinal_encoder",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                ]
            ),
        ),
        # SciPy Interpolation (native format)
        (
            "scipy_interp_1d",
            StructType(
                [
                    ("data", BlobType),  # cloudpickle serialized
                    ("kind", InterpolationKindType),
                ]
            ),
        ),
        # SciPy KDE (cloudpickle serialized)
        (
            "scipy_kde",
            StructType(
                [
                    ("data", BlobType),  # cloudpickle serialized
                    ("metadata", KdeResultType),
                ]
            ),
        ),
        # XGBoost models (cloudpickle serialized)
        (
            "xgboost_regressor",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                    ("categorical_features", OptionType(VectorType(IntegerType))),
                    ("categorical_n", OptionType(VectorType(IntegerType))),
                ]
            ),
        ),
        (
            "xgboost_classifier",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                    ("n_classes", IntegerType),
                    ("categorical_features", OptionType(VectorType(IntegerType))),
                    ("categorical_n", OptionType(VectorType(IntegerType))),
                ]
            ),
        ),
        # XGBoost quantile regressor (cloudpickle serialized, one model per quantile)
        (
            "xgboost_quantile",
            StructType(
                [
                    ("data", BlobType),
                    ("quantiles", VectorType(FloatType)),
                    ("n_features", IntegerType),
                    ("categorical_features", OptionType(VectorType(IntegerType))),
                    ("categorical_n", OptionType(VectorType(IntegerType))),
                ]
            ),
        ),
        # LightGBM models (cloudpickle serialized)
        (
            "lightgbm_regressor",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                ]
            ),
        ),
        (
            "lightgbm_classifier",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                    ("n_classes", IntegerType),
                ]
            ),
        ),
        # NGBoost models (cloudpickle serialized)
        (
            "ngboost_regressor",
            StructType(
                [
                    ("data", BlobType),
                    ("distribution", NGBoostDistributionType),
                    ("n_features", IntegerType),
                ]
            ),
        ),
        # SHAP explainers (cloudpickle serialized)
        (
            "shap_tree_explainer",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                ]
            ),
        ),
        (
            "shap_kernel_explainer",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                ]
            ),
        ),
        # RegressorChain (cloudpickle serialized)
        (
            "regressor_chain",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                    ("n_targets", IntegerType),
                    (
                        "base_estimator_type",
                        StringType,
                    ),  # "xgboost", "lightgbm", "ngboost", or "gp"
                ]
            ),
        ),
        # Gaussian Process (cloudpickle serialized)
        (
            "gp_regressor",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                    ("kernel_type", StringType),  # kernel name for reference
                ]
            ),
        ),
        # Gaussian Mixture Model (cloudpickle serialized)
        (
            "gaussian_mixture",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                    ("n_components", IntegerType),
                ]
            ),
        ),
    ]
)
"""Unified model blob covering all serializable model types across modules.

Cases: ``standard_scaler`` / ``min_max_scaler`` / ``robust_scaler``
(ONNX-serialized sklearn scalers, ``{onnx, n_features}``),
``label_encoder`` / ``ordinal_encoder`` (cloudpickle-serialized sklearn
encoders), ``scipy_interp_1d`` / ``scipy_kde`` (cloudpickle SciPy objects),
``xgboost_regressor`` / ``xgboost_classifier`` / ``xgboost_quantile``
(cloudpickle XGBoost, see ``XGBoostModelBlobType``), ``lightgbm_regressor``
/ ``lightgbm_classifier`` (cloudpickle LightGBM), ``ngboost_regressor``
(cloudpickle NGBoost ``{data, distribution, n_features}``),
``shap_tree_explainer`` / ``shap_kernel_explainer`` (cloudpickle SHAP
explainers), ``regressor_chain`` (cloudpickle
RegressorChain ``{data, n_features, n_targets, base_estimator_type}``),
``gp_regressor`` (cloudpickle GP ``{data, n_features, kernel_type}``),
``gaussian_mixture`` (cloudpickle GMM ``{data, n_features, n_components}``).
"""

# Per-module narrow model blob types. Each train/create function returns (and
# each predict function consumes) its own narrow union, matching the TS
# per-module `<Module>ModelBlobType`; the broad `ModelBlobType` above is the
# canonical union of all of them and is used only where TS declares it.
GPModelBlobType = VariantType(
    [
        (
            "gp_regressor",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                    ("kernel_type", StringType),
                ]
            ),
        ),
    ]
)
"""Serialized Gaussian Process model blob returned by ``gp_train``.

Single case ``gp_regressor``: ``data`` (cloudpickle), ``n_features``,
``kernel_type`` (kernel name for reference).
"""

ScipyModelBlobType = VariantType(
    [
        (
            "scipy_interp_1d",
            StructType(
                [
                    ("data", BlobType),
                    ("kind", InterpolationKindType),
                ]
            ),
        ),
        (
            "scipy_kde",
            StructType(
                [
                    ("data", BlobType),
                    ("metadata", KdeResultType),
                ]
            ),
        ),
    ]
)
"""Serialized SciPy model blob returned by ``scipy_interp_1d`` / ``scipy_kde``.

Cases: ``scipy_interp_1d`` ``{data, kind}``, ``scipy_kde``
``{data, metadata}`` (both cloudpickle-serialized).
"""


ShapModelBlobType = VariantType(
    [
        (
            "shap_tree_explainer",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                ]
            ),
        ),
        (
            "shap_kernel_explainer",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                ]
            ),
        ),
    ]
)
"""Serialized SHAP explainer blob returned by the SHAP explainer-create functions.

Cases: ``shap_tree_explainer`` ``{data, n_features}``,
``shap_kernel_explainer`` ``{data, n_features}`` (both cloudpickle-serialized).
"""

NGBoostModelBlobType = VariantType(
    [
        (
            "ngboost_regressor",
            StructType(
                [
                    ("data", BlobType),
                    ("distribution", NGBoostDistributionType),
                    ("n_features", IntegerType),
                ]
            ),
        ),
    ]
)
"""Serialized NGBoost model blob returned by ``ngboost_train_regressor``.

Single case ``ngboost_regressor``: ``data`` (cloudpickle), ``distribution``
(``NGBoostDistributionType``), ``n_features``.
"""

SklearnModelBlobType = VariantType(
    [
        (
            "standard_scaler",
            StructType([("onnx", BlobType), ("n_features", IntegerType)]),
        ),
        (
            "min_max_scaler",
            StructType([("onnx", BlobType), ("n_features", IntegerType)]),
        ),
        (
            "robust_scaler",
            StructType([("onnx", BlobType), ("n_features", IntegerType)]),
        ),
        (
            "label_encoder",
            StructType([("data", BlobType), ("n_classes", IntegerType)]),
        ),
        (
            "ordinal_encoder",
            StructType([("data", BlobType), ("n_features", IntegerType)]),
        ),
        (
            "regressor_chain",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                    ("n_targets", IntegerType),
                    ("base_estimator_type", StringType),
                ]
            ),
        ),
        (
            "gaussian_mixture",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                    ("n_components", IntegerType),
                ]
            ),
        ),
    ]
)
"""Serialized sklearn model blob returned by the sklearn preprocessing/encoder/
chain fits.

Cases: ``standard_scaler`` / ``min_max_scaler`` / ``robust_scaler``
``{onnx, n_features}``, ``label_encoder`` ``{data, n_classes}``,
``ordinal_encoder`` ``{data, n_features}``, ``regressor_chain``
``{data, n_features, n_targets, base_estimator_type}``, ``gaussian_mixture``
``{data, n_features, n_components}``.
"""

# Serialized base model data inside a MAPIE blob (mirrors mapie.ts
# MAPIEBaseModelDataType; also defined in mapie_impl for its own blobs).
MAPIEBaseModelDataType = VariantType(
    [
        ("xgboost", XGBoostModelBlobType),
        ("lightgbm", LightGBMModelBlobType),
        ("histogram", BlobType),
    ]
)
"""Serialized base-model data inside a MAPIE conformal blob.

Cases: ``xgboost`` (``XGBoostModelBlobType``), ``lightgbm``
(``LightGBMModelBlobType``), ``histogram`` (bare ``Blob`` for the
``HistGradientBoosting`` base used by CQR).
"""

# SHAP TreeExplainer input union - tree-based models plus MAPIE wrappers
# (mirrors shap.ts TreeModelBlobType). LightGBM is intentionally excluded.
TreeModelBlobType = VariantType(
    [
        (
            "xgboost_regressor",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                    ("categorical_features", OptionType(VectorType(IntegerType))),
                    ("categorical_n", OptionType(VectorType(IntegerType))),
                ]
            ),
        ),
        (
            "xgboost_classifier",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                    ("n_classes", IntegerType),
                    ("categorical_features", OptionType(VectorType(IntegerType))),
                    ("categorical_n", OptionType(VectorType(IntegerType))),
                ]
            ),
        ),
        (
            "xgboost_quantile",
            StructType(
                [
                    ("data", BlobType),
                    ("quantiles", VectorType(FloatType)),
                    ("n_features", IntegerType),
                    ("categorical_features", OptionType(VectorType(IntegerType))),
                    ("categorical_n", OptionType(VectorType(IntegerType))),
                ]
            ),
        ),
        (
            "mapie_split",
            StructType(
                [
                    ("data", MAPIEBaseModelDataType),
                    ("n_features", IntegerType),
                    ("confidence_level", FloatType),
                ]
            ),
        ),
        (
            "mapie_cross",
            StructType(
                [
                    ("data", MAPIEBaseModelDataType),
                    ("n_features", IntegerType),
                    ("confidence_level", FloatType),
                ]
            ),
        ),
        (
            "mapie_cqr",
            StructType(
                [
                    ("data", MAPIEBaseModelDataType),
                    ("n_features", IntegerType),
                    ("confidence_level", FloatType),
                ]
            ),
        ),
        (
            "mapie_classifier",
            StructType(
                [
                    ("data", MAPIEBaseModelDataType),
                    ("n_features", IntegerType),
                    ("n_classes", IntegerType),
                    ("classes", VectorType(IntegerType)),
                    ("confidence_level", FloatType),
                ]
            ),
        ),
    ]
)
"""SHAP TreeExplainer input union - XGBoost models and MAPIE wrappers with an
XGBoost base (mirrors shap.ts ``TreeModelBlobType``).

Cases: ``xgboost_regressor`` / ``xgboost_classifier`` / ``xgboost_quantile``
(cloudpickle XGBoost), ``mapie_split`` / ``mapie_cross`` / ``mapie_cqr`` /
``mapie_classifier`` (MAPIE conformal wrappers carrying a
``MAPIEBaseModelDataType``). LightGBM is excluded - use the kernel explainer.
"""

# SHAP KernelExplainer input union - any supported model (mirrors shap.ts
# AnyModelBlobType).
AnyModelBlobType = VariantType(
    [
        (
            "xgboost_regressor",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                    ("categorical_features", OptionType(VectorType(IntegerType))),
                    ("categorical_n", OptionType(VectorType(IntegerType))),
                ]
            ),
        ),
        (
            "xgboost_classifier",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                    ("n_classes", IntegerType),
                    ("categorical_features", OptionType(VectorType(IntegerType))),
                    ("categorical_n", OptionType(VectorType(IntegerType))),
                ]
            ),
        ),
        (
            "xgboost_quantile",
            StructType(
                [
                    ("data", BlobType),
                    ("quantiles", VectorType(FloatType)),
                    ("n_features", IntegerType),
                    ("categorical_features", OptionType(VectorType(IntegerType))),
                    ("categorical_n", OptionType(VectorType(IntegerType))),
                ]
            ),
        ),
        (
            "lightgbm_regressor",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                ]
            ),
        ),
        (
            "lightgbm_classifier",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                    ("n_classes", IntegerType),
                ]
            ),
        ),
        (
            "ngboost_regressor",
            StructType(
                [
                    ("data", BlobType),
                    ("distribution", NGBoostDistributionType),
                    ("n_features", IntegerType),
                ]
            ),
        ),
        (
            "gp_regressor",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                    ("kernel_type", StringType),
                ]
            ),
        ),
        (
            "standard_scaler",
            StructType([("onnx", BlobType), ("n_features", IntegerType)]),
        ),
        (
            "min_max_scaler",
            StructType([("onnx", BlobType), ("n_features", IntegerType)]),
        ),
        (
            "robust_scaler",
            StructType([("onnx", BlobType), ("n_features", IntegerType)]),
        ),
        (
            "label_encoder",
            StructType([("data", BlobType), ("n_classes", IntegerType)]),
        ),
        (
            "ordinal_encoder",
            StructType([("data", BlobType), ("n_features", IntegerType)]),
        ),
        (
            "gaussian_mixture",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                    ("n_components", IntegerType),
                ]
            ),
        ),
        (
            "regressor_chain",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                    ("n_targets", IntegerType),
                    ("base_estimator_type", StringType),
                ]
            ),
        ),
        (
            "mapie_split",
            StructType(
                [
                    ("data", MAPIEBaseModelDataType),
                    ("n_features", IntegerType),
                    ("confidence_level", FloatType),
                ]
            ),
        ),
        (
            "mapie_cross",
            StructType(
                [
                    ("data", MAPIEBaseModelDataType),
                    ("n_features", IntegerType),
                    ("confidence_level", FloatType),
                ]
            ),
        ),
        (
            "mapie_cqr",
            StructType(
                [
                    ("data", MAPIEBaseModelDataType),
                    ("n_features", IntegerType),
                    ("confidence_level", FloatType),
                ]
            ),
        ),
        (
            "mapie_classifier",
            StructType(
                [
                    ("data", MAPIEBaseModelDataType),
                    ("n_features", IntegerType),
                    ("n_classes", IntegerType),
                    ("classes", VectorType(IntegerType)),
                    ("confidence_level", FloatType),
                ]
            ),
        ),
        (
            "mapie_interval_width",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                ]
            ),
        ),
        (
            "mapie_set_size",
            StructType(
                [
                    ("data", BlobType),
                    ("n_features", IntegerType),
                ]
            ),
        ),
    ]
)
"""SHAP KernelExplainer input union - every supported model type (mirrors
shap.ts ``AnyModelBlobType``).

Adds NGBoost / GP / sklearn / MAPIE-uncertainty cases on top of the
tree-based and MAPIE conformal cases, so any trained model can be explained
model-agnostically via the kernel explainer.
"""

# TreeExplainer config type - path_dependent (tree structure) or interventional (background data)
TreeExplainerConfigType = VariantType(
    [
        (
            "path_dependent",
            StructType(
                [
                    ("model", TreeModelBlobType),
                ]
            ),
        ),
        (
            "interventional",
            StructType(
                [
                    ("model", TreeModelBlobType),
                    ("background", MatrixType(FloatType)),
                ]
            ),
        ),
    ]
)
"""SHAP TreeExplainer construction config - chooses attribution method.

Cases: ``path_dependent`` ``{model}`` (uses tree structure for exact
Shapley values - no background data required), ``interventional``
``{model, background}`` (uses a background dataset to condition on
feature absence - recommended when features are correlated).
"""

__all__ = [
    # Core Types
    "StringVectorType",
    "ScalarObjectiveType",
    "VectorObjectiveType",
    # Sklearn Types
    "ClassWeightModeType",
    "ConfusionMatrixResultType",
    "SplitConfigType",
    "SplitResultType",
    "OverlapConfigType",
    "OverlapResultType",
    # Flexible Metrics Types
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
    "RocAucMultiClassType",
    "RocAucConfigType",
    "ClassificationMetricsConfigType",
    "ClassificationMetricResultType",
    "ClassificationMetricResultsType",
    "MultiClassificationConfigType",
    "MultiClassificationMetricResultType",
    "MultiClassificationMetricResultsType",
    # Scipy Types
    "OptimizeMethodType",
    "InterpolationKindType",
    "HistogramBinMethodType",
    "KdeBandwidthMethodType",
    "OptimizeConfigType",
    "InterpolateConfigType",
    "HistogramConfigType",
    "KdeConfigType",
    "ParamBoundsType",
    "CustomCurveFunctionType",
    "CurveFunctionType",
    "CurveFitConfigType",
    "QuadraticConfigType",
    # XGBoost Types
    "XGBoostConfigType",
    "XGBoostQuantileConfigType",
    "XGBoostQuantilePredictResultType",
    # LightGBM Types
    "LightGBMConfigType",
    # NGBoost Types
    "NGBoostDistributionType",
    "NGBoostConfigType",
    "NGBoostPredictConfigType",
    "NGBoostPredictResultType",
    # SHAP Types
    "ShapValuesType",
    "ShapBaseValueType",
    "ShapResultType",
    "TreeExplainerConfigType",
    "FeatureImportanceType",
    # RegressorChain Types
    "RegressorChainBaseConfigType",
    "RegressorChainConfigType",
    # GMM Types
    "GMMCovarianceType",
    "GMMConfigType",
    # GP Types
    "GPKernelType",
    "GPConfigType",
    "GPPredictResultType",
    # Scipy Result Types
    "StatsDescribeResultType",
    "RobustStatsResultType",
    "CorrelationResultType",
    "HistogramResultType",
    "KdeResultType",
    "CurveFitResultType",
    "OptimizeResultType",
    # Scipy Dual Annealing Types
    "DualAnnealBoundsType",
    "DualAnnealConfigType",
    "DualAnnealResultType",
    # Model Blob
    "XGBoostModelBlobType",
    "LightGBMModelBlobType",
    "GPModelBlobType",
    "ScipyModelBlobType",
    "ShapModelBlobType",
    "NGBoostModelBlobType",
    "SklearnModelBlobType",
    "MAPIEBaseModelDataType",
    "TreeModelBlobType",
    "AnyModelBlobType",
    "ModelBlobType",
]
