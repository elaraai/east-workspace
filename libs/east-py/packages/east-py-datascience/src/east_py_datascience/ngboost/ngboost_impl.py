#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""NGBoost platform functions for East.

Provides probabilistic predictions with natural gradient boosting.
Uses cloudpickle for model serialization.
"""


import numpy as np
from east import some, variant
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
    NGBoostConfigType,
    NGBoostDistributionType,
    NGBoostModelBlobType,
    NGBoostPredictConfigType,
    NGBoostPredictResultType,
)

_check_ngboost_support = extra_guard("ngboost", "ngboost", "NGBoost")


# ============================================================================
# Platform Function Implementations
# ============================================================================


@platform_function(
    name="ngboost_train_regressor",
    inputs=[MatrixType(FloatType), VectorType(FloatType), NGBoostConfigType],
    output=NGBoostModelBlobType,
)
def ngboost_train_regressor_impl(
    X: EastMatrix,
    y: EastVector,
    config: EastStruct,
) -> EastVariant:
    """Train an NGBoost probabilistic regressor and return a serialized model blob.

    Fits natural gradient boosted decision trees using either a Normal or
    LogNormal output distribution. Use :func:`ngboost_predict_impl` for point
    predictions and :func:`ngboost_predict_dist_impl` for full uncertainty
    quantification.

    Args:
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix, one row per
            sample.
        y: ``Vector<Float>`` (``EastVector``) - continuous target values; must
            have the same number of rows as ``X``.
        config: ``NGBoostConfigType`` (``EastStruct``) with fields:

            - ``n_estimators`` (``Option<Integer>``): number of boosting stages
              (default 500).
            - ``learning_rate`` (``Option<Float>``): shrinkage applied to each
              stage (default 0.01).
            - ``minibatch_frac`` (``Option<Float>``): fraction of samples used
              per stage (default 1.0).
            - ``col_sample`` (``Option<Float>``): fraction of features sampled
              per stage (default 1.0).
            - ``random_state`` (``Option<Integer>``): random seed (default
              None).
            - ``distribution`` (``Option<NGBoostDistributionType>``):
              ``normal`` (default) or ``lognormal``.

    Returns:
        ``NGBoostModelBlobType`` (``EastVariant``) tagged ``ngboost_regressor``:
        ``{data: Blob (cloudpickle), distribution: NGBoostDistributionType,
        n_features: Integer}``.

    Raises:
        NotImplementedError: the ``ngboost`` extra is not installed.
        RuntimeError: shape mismatch or training failure.
    """
    _check_ngboost_support()
    from ngboost import NGBRegressor
    from ngboost.distns import LogNormal, Normal

    X_np = X.to_numpy()
    y_np = y.to_numpy()

    if X_np.shape[0] != y_np.shape[0]:
        raise RuntimeError(
            f"ngboost_train_regressor: X has {X_np.shape[0]} samples "
            f"but y has {y_np.shape[0]} samples"
        )

    n_features = X_np.shape[1]

    try:
        dist_name = option_tag(config["distribution"], "normal")
        dist_class = Normal if dist_name == "normal" else LogNormal

        random_state = config["random_state"].unwrap_or(None)
        if random_state is not None:
            random_state = int(random_state)

        # Suppress NGBoost warnings during training
        with quiet_warnings():
            model = NGBRegressor(
                Dist=dist_class,
                n_estimators=int(config["n_estimators"].unwrap_or(500)),
                learning_rate=float(config["learning_rate"].unwrap_or(0.01)),
                minibatch_frac=float(config["minibatch_frac"].unwrap_or(1.0)),
                col_sample=float(config["col_sample"].unwrap_or(1.0)),
                random_state=random_state,
                verbose=False,
            )
            model.fit(X_np, y_np)
    except Exception as e:
        raise RuntimeError(
            f"ngboost_train_regressor: Training failed with X shape {X_np.shape} - {e}"
        ) from e

    model_data = serialize(model)

    return EastVariant(
        "ngboost_regressor",
        EastStruct(
            {
                "data": model_data,
                "distribution": variant(dist_name, None, NGBoostDistributionType),
                "n_features": n_features,
            }
        ),
    )


@platform_function(
    name="ngboost_predict",
    inputs=[NGBoostModelBlobType, MatrixType(FloatType)],
    output=VectorType(FloatType),
)
def ngboost_predict_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastVector:
    """Predict the distributional mean with a trained NGBoost regressor.

    Args:
        model_blob: ``NGBoostModelBlobType`` (``EastVariant``) tagged
            ``ngboost_regressor`` - as returned by
            :func:`ngboost_train_regressor_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix; must have the
            same number of columns the model was trained with.

    Returns:
        ``Vector<Float>`` (``EastVector``) - distributional mean per row.

    Raises:
        NotImplementedError: the ``ngboost`` extra is not installed.
        RuntimeError: wrong model blob type, invalid input data, or prediction
            failure.
    """
    _check_ngboost_support()
    payload = expect_case(model_blob, "ngboost_regressor", "ngboost_predict")

    X_np = X.to_numpy()

    try:
        model = deserialize(payload["data"])
        # Suppress warnings during prediction
        with quiet_warnings():
            y_pred = model.predict(X_np)
        return EastVector(FloatType, y_pred.ravel().astype(np.float64))
    except Exception as e:
        raise RuntimeError(
            f"ngboost_predict: Prediction failed with X shape {X_np.shape} - {e}"
        ) from e


@platform_function(
    name="ngboost_predict_dist",
    inputs=[NGBoostModelBlobType, MatrixType(FloatType), NGBoostPredictConfigType],
    output=NGBoostPredictResultType,
)
def ngboost_predict_dist_impl(
    model_blob: EastVariant,
    X: EastMatrix,
    config: EastStruct,
) -> EastStruct:
    """Predict the full distribution (mean, std, and confidence interval) with NGBoost.

    The confidence interval is derived from the distributional standard
    deviation using a normal approximation via scipy's percent-point function.

    Args:
        model_blob: ``NGBoostModelBlobType`` (``EastVariant``) tagged
            ``ngboost_regressor`` - as returned by
            :func:`ngboost_train_regressor_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix; must have the
            same number of columns the model was trained with.
        config: ``NGBoostPredictConfigType`` (``EastStruct``) with fields:

            - ``confidence_level`` (``Option<Float>``): symmetric confidence
              interval coverage; e.g. 0.95 gives a 95% CI (default 0.95).

    Returns:
        ``NGBoostPredictResultType`` (``EastStruct``):

        - ``predictions`` (``Vector<Float>``): distributional mean per row.
        - ``std`` (``Option<Vector<Float>>``): standard deviation per row
          (always ``some``).
        - ``lower`` (``Option<Vector<Float>>``): lower CI bound per row
          (always ``some``).
        - ``upper`` (``Option<Vector<Float>>``): upper CI bound per row
          (always ``some``).

    Raises:
        NotImplementedError: the ``ngboost`` extra is not installed.
        RuntimeError: wrong model blob type, invalid input data, or prediction
            failure.
    """
    _check_ngboost_support()
    payload = expect_case(model_blob, "ngboost_regressor", "ngboost_predict_dist")

    X_np = X.to_numpy()

    try:
        model = deserialize(payload["data"])

        # Get distribution predictions
        # Suppress warnings during prediction
        with quiet_warnings():
            dist_pred = model.pred_dist(X_np)

        # Extract mean and std
        # NGBoost distributions have loc (mean) and scale (std) attributes
        loc = dist_pred.loc
        scale = dist_pred.scale

        # Compute confidence intervals
        from scipy import stats

        confidence = float(config["confidence_level"].unwrap_or(0.95))
        alpha = 1 - confidence
        z = stats.norm.ppf(1 - alpha / 2)

        lower = loc - z * scale
        upper = loc + z * scale

        return EastStruct(
            {
                "predictions": EastVector(FloatType, loc.ravel().astype(np.float64)),
                "std": some(EastVector(FloatType, scale.ravel().astype(np.float64))),
                "lower": some(EastVector(FloatType, lower.ravel().astype(np.float64))),
                "upper": some(EastVector(FloatType, upper.ravel().astype(np.float64))),
            }
        )
    except Exception as e:
        raise RuntimeError(
            f"ngboost_predict_dist: Prediction failed with X shape {X_np.shape} - {e}"
        ) from e


# ============================================================================
# Platform Function Registration
# ============================================================================

ngboost_impl = platform_functions(__name__)

__all__ = [
    "ngboost_impl",
]
