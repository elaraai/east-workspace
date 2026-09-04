#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""NGBoost platform functions for East.

Provides probabilistic predictions with natural gradient boosting.
Uses cloudpickle for model serialization.
"""

import importlib.util
import warnings

import numpy as np
from east.runtime.platform import platform_function, platform_functions
from east.types.types import FloatType, MatrixType, VectorType
from east.types.values import (
    EastBlob,
    EastMatrix,
    EastStruct,
    EastVariant,
    EastVector,
    east_null,
)

from east_py_datascience.types import (
    NGBoostConfigType,
    NGBoostModelBlobType,
    NGBoostPredictConfigType,
    NGBoostPredictResultType,
    _get_enum_tag,
    _get_option,
)

# ============================================================================
# Serialization Helpers
# ============================================================================


def _serialize_model(model) -> EastBlob:
    """Serialize model using cloudpickle."""
    import cloudpickle

    try:
        return EastBlob(cloudpickle.dumps(model))
    except Exception as e:
        raise RuntimeError(f"_serialize_model: Failed to serialize model - {e}") from e


def _deserialize_model(blob: EastBlob):
    """Deserialize model using cloudpickle."""
    import cloudpickle

    try:
        return cloudpickle.loads(bytes(blob))
    except Exception as e:
        raise RuntimeError(
            f"_deserialize_model: Failed to deserialize model - {e}"
        ) from e


def _make_distribution_variant(dist_name: str) -> EastVariant:
    """Create distribution enum variant."""
    return EastVariant(dist_name, east_null)



# Lazy import guard for optional dependency
_HAS_NGBOOST_SUPPORT = importlib.util.find_spec("ngboost") is not None


def _check_ngboost_support() -> None:
    """Check if ngboost support is available."""
    if not _HAS_NGBOOST_SUPPORT:
        raise NotImplementedError(
            "Ngboost support requires the 'ngboost' extra. "
            "Add east-py-datascience[ngboost] to your pyproject.toml dependencies."
        )


# ============================================================================
# Platform Function Implementations
# ============================================================================


@platform_function(
    name="ngboost_train_regressor",
    inputs=[MatrixType(FloatType), VectorType(FloatType), NGBoostConfigType],
    output=NGBoostModelBlobType,
)
def ngboost_train_regressor(
    X: EastMatrix,
    y: EastVector,
    config: EastStruct,
) -> EastVariant:
    """Train an NGBoost probabilistic regressor and return a serialized model blob.

    Fits natural gradient boosted decision trees using either a Normal or
    LogNormal output distribution. Use :func:`ngboost_predict` for point
    predictions and :func:`ngboost_predict_dist` for full uncertainty
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

    try:
        X_np = X.to_numpy()
        y_np = y.to_numpy()
    except Exception as e:
        raise RuntimeError(f"ngboost_train_regressor: Invalid input data - {e}") from e

    if X_np.shape[0] != y_np.shape[0]:
        raise RuntimeError(
            f"ngboost_train_regressor: X has {X_np.shape[0]} samples "
            f"but y has {y_np.shape[0]} samples"
        )

    n_features = X_np.shape[1]

    try:
        # Get distribution type
        dist_opt = _get_option(config.get("distribution"), None)
        dist_name = _get_enum_tag(dist_opt) if dist_opt is not None else "normal"

        dist_class = Normal if dist_name == "normal" else LogNormal

        random_state = _get_option(config.get("random_state"), None)
        if random_state is not None:
            random_state = int(random_state)

        # Suppress NGBoost warnings during training
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)
            model = NGBRegressor(
                Dist=dist_class,
                n_estimators=int(_get_option(config.get("n_estimators"), 500)),
                learning_rate=float(_get_option(config.get("learning_rate"), 0.01)),
                minibatch_frac=float(_get_option(config.get("minibatch_frac"), 1.0)),
                col_sample=float(_get_option(config.get("col_sample"), 1.0)),
                random_state=random_state,
                verbose=False,
            )
            model.fit(X_np, y_np)
    except Exception as e:
        raise RuntimeError(
            f"ngboost_train_regressor: Training failed with X shape {X_np.shape} - {e}"
        ) from e

    model_data = _serialize_model(model)

    return EastVariant(
        "ngboost_regressor",
        EastStruct(
            {
                "data": model_data,
                "distribution": _make_distribution_variant(dist_name),
                "n_features": n_features,
            }
        ),
    )


@platform_function(
    name="ngboost_predict",
    inputs=[NGBoostModelBlobType, MatrixType(FloatType)],
    output=VectorType(FloatType),
)
def ngboost_predict(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastVector:
    """Predict the distributional mean with a trained NGBoost regressor.

    Args:
        model_blob: ``NGBoostModelBlobType`` (``EastVariant``) tagged
            ``ngboost_regressor`` - as returned by
            :func:`ngboost_train_regressor`.
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
    if model_blob.type != "ngboost_regressor":
        raise RuntimeError(
            f"ngboost_predict: Expected ngboost_regressor, got {model_blob.type}"
        )

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(f"ngboost_predict: Invalid input data - {e}") from e

    try:
        model = _deserialize_model(model_blob.value["data"])
        # Suppress warnings during prediction
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)
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
def ngboost_predict_dist(
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
            :func:`ngboost_train_regressor`.
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
    if model_blob.type != "ngboost_regressor":
        raise RuntimeError(
            f"ngboost_predict_dist: Expected ngboost_regressor, got {model_blob.type}"
        )

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(f"ngboost_predict_dist: Invalid input data - {e}") from e

    try:
        model = _deserialize_model(model_blob.value["data"])

        # Get distribution predictions
        # Suppress warnings during prediction
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)
            dist_pred = model.pred_dist(X_np)

        # Extract mean and std
        # NGBoost distributions have loc (mean) and scale (std) attributes
        loc = dist_pred.loc
        scale = dist_pred.scale

        # Compute confidence intervals
        from scipy import stats

        confidence = float(_get_option(config.get("confidence_level"), 0.95))
        alpha = 1 - confidence
        z = stats.norm.ppf(1 - alpha / 2)

        lower = loc - z * scale
        upper = loc + z * scale

        return EastStruct(
            {
                "predictions": EastVector(FloatType, loc.ravel().astype(np.float64)),
                "std": EastVariant("some", EastVector(FloatType, scale.ravel().astype(np.float64))),
                "lower": EastVariant("some", EastVector(FloatType, lower.ravel().astype(np.float64))),
                "upper": EastVariant("some", EastVector(FloatType, upper.ravel().astype(np.float64))),
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
