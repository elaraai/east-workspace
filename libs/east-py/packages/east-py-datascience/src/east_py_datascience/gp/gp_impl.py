#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Gaussian Process platform functions for East.

Provides Gaussian Process regression using scikit-learn.
Uses cloudpickle for model serialization.
"""

import warnings

# Suppress sklearn convergence warnings - these are expected for small test datasets
warnings.filterwarnings("ignore", module="sklearn")

import importlib.util  # noqa: E402

import numpy as np  # noqa: E402
from east.runtime.platform import platform_function, platform_functions  # noqa: E402
from east.types.types import FloatType, MatrixType, VectorType  # noqa: E402
from east.types.values import (  # noqa: E402
    EastBlob,
    EastMatrix,
    EastStruct,
    EastVariant,
    EastVector,
)

from east_py_datascience.types import (  # noqa: E402
    GPConfigType,
    GPModelBlobType,
    GPPredictResultType,
    _get_enum_tag,
    _get_option,
)

# ============================================================================
# Serialization Helpers
# ============================================================================


def _serialize_model(model) -> EastBlob:
    """Serialize GP model using cloudpickle."""
    import cloudpickle

    try:
        return EastBlob(cloudpickle.dumps(model))
    except Exception as e:
        raise RuntimeError(f"_serialize_model: Failed to serialize model - {e}") from e


def _deserialize_model(blob: EastBlob):
    """Deserialize GP model using cloudpickle."""
    import cloudpickle

    try:
        return cloudpickle.loads(bytes(blob))
    except Exception as e:
        raise RuntimeError(
            f"_deserialize_model: Failed to deserialize model - {e}"
        ) from e


def _get_kernel(kernel_type: str):
    """Get sklearn kernel object from kernel type name."""
    from sklearn.gaussian_process.kernels import (
        RBF,
        ConstantKernel,
        DotProduct,
        Matern,
        RationalQuadratic,
    )

    try:
        kernel_map = {
            "rbf": ConstantKernel() * RBF(),
            "matern_1_2": ConstantKernel() * Matern(nu=0.5),
            "matern_3_2": ConstantKernel() * Matern(nu=1.5),
            "matern_5_2": ConstantKernel() * Matern(nu=2.5),
            "rational_quadratic": ConstantKernel() * RationalQuadratic(),
            "dot_product": ConstantKernel() * DotProduct(),
        }

        return kernel_map.get(kernel_type, ConstantKernel() * RBF())
    except Exception as e:
        raise RuntimeError(f"_get_kernel: Failed to create kernel - {e}") from e



# Lazy import guard for optional dependency
_HAS_GP_SUPPORT = importlib.util.find_spec("sklearn") is not None


def _check_gp_support() -> None:
    """Check if gp support is available."""
    if not _HAS_GP_SUPPORT:
        raise NotImplementedError(
            "Gp support requires the 'gp' extra. "
            "Add east-py-datascience[gp] to your pyproject.toml dependencies."
        )


# ============================================================================
# Platform Function Implementations
# ============================================================================


@platform_function(
    name="gp_train",
    inputs=[MatrixType(FloatType), VectorType(FloatType), GPConfigType],
    output=GPModelBlobType,
)
def gp_train_impl(
    X: EastMatrix,
    y: EastVector,
    config: EastStruct,
) -> EastVariant:
    """Train a Gaussian Process regressor and return a serialized model blob.

    Fits a scikit-learn GaussianProcessRegressor with a kernel composed of a
    ConstantKernel multiplied by the chosen base kernel. The kernel
    hyperparameters are optimized by maximizing the log-marginal likelihood,
    optionally with multiple restarts.

    Args:
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix, one row per
            sample.
        y: ``Vector<Float>`` (``EastVector``) - continuous target values; must
            have the same number of rows as ``X``.
        config: ``GPConfigType`` (``EastStruct``) with fields:

            - ``kernel`` (``Option<GPKernelType>``): one of ``rbf`` (squared
              exponential, default), ``matern_1_2`` (exponential, nu=0.5),
              ``matern_3_2`` (nu=1.5), ``matern_5_2`` (nu=2.5),
              ``rational_quadratic``, or ``dot_product``.
            - ``alpha`` (``Option<Float>``): noise variance added to the
              diagonal of the kernel matrix for numerical stability (default
              1e-10).
            - ``n_restarts_optimizer`` (``Option<Integer>``): number of
              restarts of the kernel hyperparameter optimizer (default 0).
            - ``normalize_y`` (``Option<Boolean>``): subtract the mean of
              ``y`` before fitting (default False).
            - ``random_state`` (``Option<Integer>``): seed for optimizer
              restarts (default None).

    Returns:
        ``ModelBlobType`` (``EastVariant``) tagged ``gp_regressor``:
        ``{data: Blob (cloudpickle), n_features: Integer,
        kernel_type: String}`` for use with :func:`gp_predict_impl` /
        :func:`gp_predict_std_impl`.

    Raises:
        NotImplementedError: the ``gp`` extra is not installed.
        RuntimeError: shape mismatch or training failure.
    """
    _check_gp_support()
    from sklearn.gaussian_process import GaussianProcessRegressor

    # Data conversion
    try:
        X_np = X.to_numpy()
        y_np = y.to_numpy()
    except Exception as e:
        raise RuntimeError(f"gp_train: Invalid input data - {e}") from e

    # Shape validation
    if X_np.shape[0] != y_np.shape[0]:
        raise RuntimeError(
            f"gp_train: X and y have different sample counts - "
            f"X has {X_np.shape[0]} samples, y has {y_np.shape[0]} samples"
        )

    n_features = X_np.shape[1]

    # Extract config
    kernel_variant = _get_option(config.get("kernel"), None)
    kernel_type = _get_enum_tag(kernel_variant) if kernel_variant else "rbf"
    kernel = _get_kernel(kernel_type)

    alpha = _get_option(config.get("alpha"), 1e-10)
    alpha = float(alpha) if alpha is not None else 1e-10

    n_restarts = _get_option(config.get("n_restarts_optimizer"), 0)
    n_restarts = int(n_restarts) if n_restarts is not None else 0

    normalize_y = _get_option(config.get("normalize_y"), False)
    normalize_y = bool(normalize_y) if normalize_y is not None else False

    random_state = _get_option(config.get("random_state"), None)
    if random_state is not None:
        random_state = int(random_state)

    # Create and train GP
    try:
        # Suppress sklearn GP warnings during training
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)
            gp = GaussianProcessRegressor(
                kernel=kernel,
                alpha=alpha,
                n_restarts_optimizer=n_restarts,
                normalize_y=normalize_y,
                random_state=random_state,
            )

            gp.fit(X_np, y_np)
    except Exception as e:
        raise RuntimeError(
            f"gp_train: Training failed with X shape {X_np.shape} - {e}"
        ) from e

    return EastVariant(
        "gp_regressor",
        EastStruct(
            {
                "data": _serialize_model(gp),
                "n_features": n_features,
                "kernel_type": kernel_type,
            }
        ),
    )


@platform_function(
    name="gp_predict",
    inputs=[GPModelBlobType, MatrixType(FloatType)],
    output=VectorType(FloatType),
)
def gp_predict_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastVector:
    """Predict the posterior mean with a trained Gaussian Process regressor.

    Args:
        model_blob: ``ModelBlobType`` (``EastVariant``) tagged
            ``gp_regressor`` - as returned by :func:`gp_train_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix; must have the
            same number of columns the model was trained with.

    Returns:
        ``Vector<Float>`` (``EastVector``) - posterior mean per row.

    Raises:
        NotImplementedError: the ``gp`` extra is not installed.
        RuntimeError: wrong model blob type, invalid input data, or prediction
            failure.
    """
    _check_gp_support()
    # Model type check
    if model_blob.type != "gp_regressor":
        raise RuntimeError(f"gp_predict: Expected gp_regressor, got {model_blob.type}")

    # Deserialize model
    gp = _deserialize_model(model_blob.value["data"])

    # Data conversion
    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(f"gp_predict: Invalid input data - {e}") from e

    # Make predictions
    try:
        # Suppress warnings during prediction
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)
            predictions = gp.predict(X_np, return_std=False)
    except Exception as e:
        raise RuntimeError(
            f"gp_predict: Prediction failed with X shape {X_np.shape} - {e}"
        ) from e

    return EastVector(FloatType, predictions.ravel().astype(np.float64))


@platform_function(
    name="gp_predict_std",
    inputs=[GPModelBlobType, MatrixType(FloatType)],
    output=GPPredictResultType,
)
def gp_predict_std_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastStruct:
    """Predict posterior mean and standard deviation with a trained GP regressor.

    Args:
        model_blob: ``ModelBlobType`` (``EastVariant``) tagged
            ``gp_regressor`` - as returned by :func:`gp_train_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix; must have the
            same number of columns the model was trained with.

    Returns:
        ``GPPredictResultType`` (``EastStruct``):

        - ``mean`` (``Vector<Float>``): posterior mean per row.
        - ``std`` (``Vector<Float>``): posterior standard deviation per row;
          larger values indicate higher epistemic uncertainty.

    Raises:
        NotImplementedError: the ``gp`` extra is not installed.
        RuntimeError: wrong model blob type, invalid input data, or prediction
            failure.
    """
    _check_gp_support()
    # Model type check
    if model_blob.type != "gp_regressor":
        raise RuntimeError(
            f"gp_predict_std: Expected gp_regressor, got {model_blob.type}"
        )

    # Deserialize model
    gp = _deserialize_model(model_blob.value["data"])

    # Data conversion
    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(f"gp_predict_std: Invalid input data - {e}") from e

    # Make predictions
    try:
        # Suppress warnings during prediction
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)
            mean, std = gp.predict(X_np, return_std=True)
    except Exception as e:
        raise RuntimeError(
            f"gp_predict_std: Prediction failed with X shape {X_np.shape} - {e}"
        ) from e

    return EastStruct(
        {
            "mean": EastVector(FloatType, mean.ravel().astype(np.float64)),
            "std": EastVector(FloatType, std.ravel().astype(np.float64)),
        }
    )


# ============================================================================
# Platform Function Registration
# ============================================================================

gp_impl = platform_functions(__name__)

__all__ = [
    "gp_impl",
]
