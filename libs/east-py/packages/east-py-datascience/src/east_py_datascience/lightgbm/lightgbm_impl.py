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
from east.runtime.platform import PlatformFunction
from east.types.types import FloatType, IntegerType, MatrixType, VectorType
from east.types.values import EastArray, EastBlob, EastMatrix, EastStruct, EastVariant, EastVector

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


def lightgbm_train_regressor_impl(
    X: EastArray,
    y: EastArray,
    config: EastStruct,
) -> EastVariant:
    """Train LightGBM regressor and return model blob."""
    _check_lightgbm_support()
    import lightgbm as lgb

    try:
        X_np = X.data
        y_np = y.data
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


def lightgbm_train_classifier_impl(
    X: EastArray,
    y: EastArray,
    config: EastStruct,
) -> EastVariant:
    """Train LightGBM classifier and return model blob."""
    _check_lightgbm_support()
    import lightgbm as lgb

    try:
        X_np = X.data
        y_np = y.data
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


def lightgbm_predict_impl(
    model_blob: EastVariant,
    X: EastArray,
) -> EastArray:
    """Make predictions with LightGBM regressor."""
    _check_lightgbm_support()
    if model_blob.type != "lightgbm_regressor":
        raise RuntimeError(
            f"lightgbm_predict: Expected lightgbm_regressor, got {model_blob.type}"
        )

    model = _deserialize_model(model_blob.value["data"])

    try:
        X_np = X.data
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


def lightgbm_predict_class_impl(
    model_blob: EastVariant,
    X: EastArray,
) -> EastArray:
    """Predict class labels with LightGBM classifier."""
    _check_lightgbm_support()
    if model_blob.type != "lightgbm_classifier":
        raise RuntimeError(
            f"lightgbm_predict_class: Expected lightgbm_classifier, got {model_blob.type}"
        )

    model = _deserialize_model(model_blob.value["data"])

    try:
        X_np = X.data
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


def lightgbm_predict_proba_impl(
    model_blob: EastVariant,
    X: EastArray,
) -> EastArray:
    """Get class probabilities from LightGBM classifier."""
    _check_lightgbm_support()
    if model_blob.type != "lightgbm_classifier":
        raise RuntimeError(
            f"lightgbm_predict_proba: Expected lightgbm_classifier, got {model_blob.type}"
        )

    model = _deserialize_model(model_blob.value["data"])

    try:
        X_np = X.data
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

lightgbm_impl = [
    PlatformFunction(
        name="lightgbm_train_regressor",
        inputs=[MatrixType(FloatType), VectorType(FloatType), LightGBMConfigType],
        output=ModelBlobType,
        type="sync",
        fn=lightgbm_train_regressor_impl,
    ),
    PlatformFunction(
        name="lightgbm_train_classifier",
        inputs=[MatrixType(FloatType), VectorType(IntegerType), LightGBMConfigType],
        output=ModelBlobType,
        type="sync",
        fn=lightgbm_train_classifier_impl,
    ),
    PlatformFunction(
        name="lightgbm_predict",
        inputs=[ModelBlobType, MatrixType(FloatType)],
        output=VectorType(FloatType),
        type="sync",
        fn=lightgbm_predict_impl,
    ),
    PlatformFunction(
        name="lightgbm_predict_class",
        inputs=[ModelBlobType, MatrixType(FloatType)],
        output=VectorType(IntegerType),
        type="sync",
        fn=lightgbm_predict_class_impl,
    ),
    PlatformFunction(
        name="lightgbm_predict_proba",
        inputs=[ModelBlobType, MatrixType(FloatType)],
        output=MatrixType(FloatType),
        type="sync",
        fn=lightgbm_predict_proba_impl,
    ),
]

__all__ = [
    "lightgbm_impl",
]
