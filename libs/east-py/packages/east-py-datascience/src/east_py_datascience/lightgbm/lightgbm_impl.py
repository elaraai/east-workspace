#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""LightGBM platform functions for East.

Provides fast gradient boosting for regression and classification.
Uses cloudpickle for model serialization.
"""

import importlib.util
import warnings

import numpy as np
from east.runtime.platform import platform_function, platform_functions
from east.types.types import FloatType, IntegerType, MatrixType, VectorType
from east.types.values import EastBlob, EastMatrix, EastStruct, EastVariant, EastVector

from east_py_datascience.types import (
    LightGBMConfigType,
    ModelBlobType,
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



# Lazy import guard for optional dependency
_HAS_LIGHTGBM_SUPPORT = importlib.util.find_spec("lightgbm") is not None


def _check_lightgbm_support() -> None:
    """Check if lightgbm support is available."""
    if not _HAS_LIGHTGBM_SUPPORT:
        raise NotImplementedError(
            "Lightgbm support requires the 'lightgbm' extra. "
            "Add east-py-datascience[lightgbm] to your pyproject.toml dependencies."
        )


# ============================================================================
# Platform Function Implementations
# ============================================================================


@platform_function(
    name="lightgbm_train_regressor",
    inputs=[MatrixType(FloatType), VectorType(FloatType), LightGBMConfigType],
    output=ModelBlobType,
)
def lightgbm_train_regressor_impl(
    X: EastMatrix,
    y: EastVector,
    config: EastStruct,
) -> EastVariant:
    """Train a LightGBM regressor and return a serialized model blob.

    Uses leaf-wise tree growth for fast training on large datasets.

    Args:
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix, one row per
            sample.
        y: ``Vector<Float>`` (``EastVector``) - continuous target values; must
            have the same number of rows as ``X``.
        config: ``LightGBMConfigType`` (``EastStruct``) with fields:

            - ``n_estimators`` (``Option<Integer>``): number of boosting rounds
              (default 100).
            - ``max_depth`` (``Option<Integer>``): maximum tree depth; -1 means
              unlimited (default -1).
            - ``learning_rate`` (``Option<Float>``): shrinkage step size
              (default 0.1).
            - ``num_leaves`` (``Option<Integer>``): maximum number of leaves per
              tree (default 31).
            - ``min_child_samples`` (``Option<Integer>``): minimum samples
              required in a leaf (default 20).
            - ``subsample`` (``Option<Float>``): row subsampling ratio per tree
              (default 1.0).
            - ``colsample_bytree`` (``Option<Float>``): column subsampling ratio
              per tree (default 1.0).
            - ``reg_alpha`` (``Option<Float>``): L1 regularization (default
              0.0).
            - ``reg_lambda`` (``Option<Float>``): L2 regularization (default
              0.0).
            - ``random_state`` (``Option<Integer>``): random seed (default
              None).
            - ``n_jobs`` (``Option<Integer>``): parallel threads; -1 uses all
              cores (default -1).

    Returns:
        ``ModelBlobType`` (``EastVariant``) tagged ``lightgbm_regressor``:
        ``{data: Blob (cloudpickle), n_features: Integer}``.

    Raises:
        NotImplementedError: the ``lightgbm`` extra is not installed.
        RuntimeError: shape mismatch or training failure.
    """
    _check_lightgbm_support()
    import lightgbm as lgb

    try:
        X_np = X.to_numpy()
        y_np = y.to_numpy()
    except Exception as e:
        raise RuntimeError(f"lightgbm_train_regressor: Invalid input data - {e}") from e

    if X_np.shape[0] != y_np.shape[0]:
        raise RuntimeError(
            f"lightgbm_train_regressor: X has {X_np.shape[0]} samples "
            f"but y has {y_np.shape[0]} samples"
        )

    n_features = X_np.shape[1]

    random_state = _get_option(config.get("random_state"), None)
    if random_state is not None:
        random_state = int(random_state)

    n_jobs = _get_option(config.get("n_jobs"), -1)
    if n_jobs is not None:
        n_jobs = int(n_jobs)

    try:
        # Suppress LightGBM warnings during training
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)
            model = lgb.LGBMRegressor(
                n_estimators=int(_get_option(config.get("n_estimators"), 100)),
                max_depth=int(_get_option(config.get("max_depth"), -1)),
                learning_rate=float(_get_option(config.get("learning_rate"), 0.1)),
                num_leaves=int(_get_option(config.get("num_leaves"), 31)),
                min_child_samples=int(_get_option(config.get("min_child_samples"), 20)),
                subsample=float(_get_option(config.get("subsample"), 1.0)),
                colsample_bytree=float(
                    _get_option(config.get("colsample_bytree"), 1.0)
                ),
                reg_alpha=float(_get_option(config.get("reg_alpha"), 0.0)),
                reg_lambda=float(_get_option(config.get("reg_lambda"), 0.0)),
                random_state=random_state,
                n_jobs=n_jobs,
                verbose=-1,
            )
            model.fit(X_np, y_np)
    except Exception as e:
        raise RuntimeError(
            f"lightgbm_train_regressor: Training failed with X shape {X_np.shape} - {e}"
        ) from e

    model_data = _serialize_model(model)

    return EastVariant(
        "lightgbm_regressor",
        EastStruct(
            {
                "data": model_data,
                "n_features": n_features,
            }
        ),
    )


@platform_function(
    name="lightgbm_train_classifier",
    inputs=[MatrixType(FloatType), VectorType(IntegerType), LightGBMConfigType],
    output=ModelBlobType,
)
def lightgbm_train_classifier_impl(
    X: EastMatrix,
    y: EastVector,
    config: EastStruct,
) -> EastVariant:
    """Train a LightGBM classifier and return a serialized model blob.

    Args:
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix, one row per
            sample.
        y: ``Vector<Integer>`` (``EastVector``) - integer class labels; must
            have the same number of rows as ``X``.
        config: ``LightGBMConfigType`` (``EastStruct``) - see
            :func:`lightgbm_train_regressor_impl` for field descriptions.
            All fields apply identically.

    Returns:
        ``ModelBlobType`` (``EastVariant``) tagged ``lightgbm_classifier``:
        ``{data: Blob (cloudpickle), n_features: Integer, n_classes: Integer}``.

    Raises:
        NotImplementedError: the ``lightgbm`` extra is not installed.
        RuntimeError: shape mismatch or training failure.
    """
    _check_lightgbm_support()
    import lightgbm as lgb

    try:
        X_np = X.to_numpy()
        y_np = y.to_numpy()
    except Exception as e:
        raise RuntimeError(
            f"lightgbm_train_classifier: Invalid input data - {e}"
        ) from e

    if X_np.shape[0] != y_np.shape[0]:
        raise RuntimeError(
            f"lightgbm_train_classifier: X has {X_np.shape[0]} samples "
            f"but y has {y_np.shape[0]} samples"
        )

    n_features = X_np.shape[1]
    n_classes = len(np.unique(y_np))

    random_state = _get_option(config.get("random_state"), None)
    if random_state is not None:
        random_state = int(random_state)

    n_jobs = _get_option(config.get("n_jobs"), -1)
    if n_jobs is not None:
        n_jobs = int(n_jobs)

    try:
        # Suppress LightGBM warnings during training
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)
            model = lgb.LGBMClassifier(
                n_estimators=int(_get_option(config.get("n_estimators"), 100)),
                max_depth=int(_get_option(config.get("max_depth"), -1)),
                learning_rate=float(_get_option(config.get("learning_rate"), 0.1)),
                num_leaves=int(_get_option(config.get("num_leaves"), 31)),
                min_child_samples=int(_get_option(config.get("min_child_samples"), 20)),
                subsample=float(_get_option(config.get("subsample"), 1.0)),
                colsample_bytree=float(
                    _get_option(config.get("colsample_bytree"), 1.0)
                ),
                reg_alpha=float(_get_option(config.get("reg_alpha"), 0.0)),
                reg_lambda=float(_get_option(config.get("reg_lambda"), 0.0)),
                random_state=random_state,
                n_jobs=n_jobs,
                verbose=-1,
            )
            model.fit(X_np, y_np)
    except Exception as e:
        raise RuntimeError(
            f"lightgbm_train_classifier: Training failed with X shape {X_np.shape} - {e}"
        ) from e

    model_data = _serialize_model(model)

    return EastVariant(
        "lightgbm_classifier",
        EastStruct(
            {
                "data": model_data,
                "n_features": n_features,
                "n_classes": n_classes,
            }
        ),
    )


@platform_function(
    name="lightgbm_predict",
    inputs=[ModelBlobType, MatrixType(FloatType)],
    output=VectorType(FloatType),
)
def lightgbm_predict_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastVector:
    """Predict continuous values with a trained LightGBM regressor.

    Args:
        model_blob: ``ModelBlobType`` (``EastVariant``) tagged
            ``lightgbm_regressor`` - as returned by
            :func:`lightgbm_train_regressor_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix; must have the
            same number of columns the model was trained with.

    Returns:
        ``Vector<Float>`` (``EastVector``) - one predicted value per row.

    Raises:
        NotImplementedError: the ``lightgbm`` extra is not installed.
        RuntimeError: wrong model blob type, invalid input data, or prediction
            failure.
    """
    _check_lightgbm_support()
    if model_blob.type != "lightgbm_regressor":
        raise RuntimeError(
            f"lightgbm_predict: Expected lightgbm_regressor, got {model_blob.type}"
        )

    model = _deserialize_model(model_blob.value["data"])

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(f"lightgbm_predict: Invalid input data - {e}") from e

    try:
        # Suppress sklearn warnings during prediction
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)
            y_pred = model.predict(X_np)
    except Exception as e:
        raise RuntimeError(
            f"lightgbm_predict: Prediction failed with X shape {X_np.shape} - {e}"
        ) from e

    return EastVector(FloatType, y_pred.ravel().astype(np.float64))


@platform_function(
    name="lightgbm_predict_class",
    inputs=[ModelBlobType, MatrixType(FloatType)],
    output=VectorType(IntegerType),
)
def lightgbm_predict_class_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastVector:
    """Predict class labels with a trained LightGBM classifier.

    Args:
        model_blob: ``ModelBlobType`` (``EastVariant``) tagged
            ``lightgbm_classifier`` - as returned by
            :func:`lightgbm_train_classifier_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix; must have the
            same number of columns the model was trained with.

    Returns:
        ``Vector<Integer>`` (``EastVector``) - one predicted class label per
        row.

    Raises:
        NotImplementedError: the ``lightgbm`` extra is not installed.
        RuntimeError: wrong model blob type, invalid input data, or prediction
            failure.
    """
    _check_lightgbm_support()
    if model_blob.type != "lightgbm_classifier":
        raise RuntimeError(
            f"lightgbm_predict_class: Expected lightgbm_classifier, got {model_blob.type}"
        )

    model = _deserialize_model(model_blob.value["data"])

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(f"lightgbm_predict_class: Invalid input data - {e}") from e

    try:
        # Suppress sklearn warnings during prediction
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)
            y_pred = model.predict(X_np)
    except Exception as e:
        raise RuntimeError(
            f"lightgbm_predict_class: Prediction failed with X shape {X_np.shape} - {e}"
        ) from e

    return EastVector(IntegerType, y_pred.ravel().astype(np.int64))


@platform_function(
    name="lightgbm_predict_proba",
    inputs=[ModelBlobType, MatrixType(FloatType)],
    output=MatrixType(FloatType),
)
def lightgbm_predict_proba_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastMatrix:
    """Get class probability estimates from a trained LightGBM classifier.

    Args:
        model_blob: ``ModelBlobType`` (``EastVariant``) tagged
            ``lightgbm_classifier`` - as returned by
            :func:`lightgbm_train_classifier_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix; must have the
            same number of columns the model was trained with.

    Returns:
        ``Matrix<Float>`` (``EastMatrix``) - shape ``(n_samples, n_classes)``
        where each row sums to 1.0.

    Raises:
        NotImplementedError: the ``lightgbm`` extra is not installed.
        RuntimeError: wrong model blob type, invalid input data, or prediction
            failure.
    """
    _check_lightgbm_support()
    if model_blob.type != "lightgbm_classifier":
        raise RuntimeError(
            f"lightgbm_predict_proba: Expected lightgbm_classifier, got {model_blob.type}"
        )

    model = _deserialize_model(model_blob.value["data"])

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(f"lightgbm_predict_proba: Invalid input data - {e}") from e

    try:
        # Suppress sklearn warnings during prediction
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)
            proba = model.predict_proba(X_np)
    except Exception as e:
        raise RuntimeError(
            f"lightgbm_predict_proba: Prediction failed with X shape {X_np.shape} - {e}"
        ) from e

    return EastMatrix(FloatType, np.atleast_2d(proba).astype(np.float64))


# ============================================================================
# Platform Function Registration
# ============================================================================

lightgbm_impl = platform_functions(__name__)

__all__ = [
    "lightgbm_impl",
]
