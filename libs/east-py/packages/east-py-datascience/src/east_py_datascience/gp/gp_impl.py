#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Gaussian Process platform functions for East.

Provides Gaussian Process regression using scikit-learn.
Uses cloudpickle for model serialization.
"""

import numpy as np
from east.runtime.platform import platform_function, platform_functions
from east.types.types import FloatType, MatrixType, VectorType
from east.types.values import (
    EastMatrix,
    EastStruct,
    EastVariant,
    EastVector,
)

from east_py_datascience._common import (
    deserialize,
    expect_case,
    extra_guard,
    option_tag,
    quiet_warnings,
    serialize,
)
from east_py_datascience.types import (
    GPConfigType,
    GPModelBlobType,
    GPPredictResultType,
)

# ============================================================================
# Helpers
# ============================================================================


def _get_kernel(kernel_type: str):
    """The sklearn kernel (a constant times the base kernel) for a ``GPKernelType`` case."""
    from sklearn.gaussian_process.kernels import (
        RBF,
        ConstantKernel,
        DotProduct,
        Matern,
        RationalQuadratic,
    )

    kernel_map = {
        "rbf": ConstantKernel() * RBF(),
        "matern_1_2": ConstantKernel() * Matern(nu=0.5),
        "matern_3_2": ConstantKernel() * Matern(nu=1.5),
        "matern_5_2": ConstantKernel() * Matern(nu=2.5),
        "rational_quadratic": ConstantKernel() * RationalQuadratic(),
        "dot_product": ConstantKernel() * DotProduct(),
    }
    return kernel_map.get(kernel_type, ConstantKernel() * RBF())


_check_gp_support = extra_guard("sklearn", "gp", "Gaussian process")


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
    X_np = X.to_numpy()
    y_np = y.to_numpy()

    # Shape validation
    if X_np.shape[0] != y_np.shape[0]:
        raise RuntimeError(
            f"gp_train: X and y have different sample counts - "
            f"X has {X_np.shape[0]} samples, y has {y_np.shape[0]} samples"
        )

    n_features = X_np.shape[1]

    # Extract config
    kernel_type = option_tag(config["kernel"], "rbf")
    kernel = _get_kernel(kernel_type)
    alpha = float(config["alpha"].unwrap_or(1e-10))
    n_restarts = int(config["n_restarts_optimizer"].unwrap_or(0))
    normalize_y = bool(config["normalize_y"].unwrap_or(False))
    random_state = config["random_state"].unwrap_or(None)
    if random_state is not None:
        random_state = int(random_state)

    # Create and train GP
    try:
        # Suppress sklearn GP warnings during training
        with quiet_warnings():
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
                "data": serialize(gp),
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
    payload = expect_case(model_blob, "gp_regressor", "gp_predict")

    # Deserialize model
    gp = deserialize(payload["data"])

    # Data conversion
    X_np = X.to_numpy()

    # Make predictions
    try:
        # Suppress warnings during prediction
        with quiet_warnings():
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
    payload = expect_case(model_blob, "gp_regressor", "gp_predict_std")

    # Deserialize model
    gp = deserialize(payload["data"])

    # Data conversion
    X_np = X.to_numpy()

    # Make predictions
    try:
        # Suppress warnings during prediction
        with quiet_warnings():
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
