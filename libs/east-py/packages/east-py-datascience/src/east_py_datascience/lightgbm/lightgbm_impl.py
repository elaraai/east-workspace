#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""LightGBM platform functions for East.

Provides fast gradient boosting for regression and classification.
Uses cloudpickle for model serialization.
"""


import numpy as np
from east.runtime.platform import platform_function, platform_functions
from east.types.types import FloatType, IntegerType, MatrixType, VectorType
from east.types.values import EastMatrix, EastStruct, EastVariant, EastVector

from east_py_datascience._common import (
    deserialize,
    expect_case,
    extra_guard,
    quiet_warnings,
    serialize,
)
from east_py_datascience.types import (
    LightGBMConfigType,
    LightGBMModelBlobType,
)

_check_lightgbm_support = extra_guard("lightgbm", "lightgbm", "LightGBM")


# ============================================================================
# Platform Function Implementations
# ============================================================================


@platform_function(
    name="lightgbm_train_regressor",
    inputs=[MatrixType(FloatType), VectorType(FloatType), LightGBMConfigType],
    output=LightGBMModelBlobType,
)
def lightgbm_train_regressor(
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
        ``LightGBMModelBlobType`` (``EastVariant``) tagged ``lightgbm_regressor``:
        ``{data: Blob (cloudpickle), n_features: Integer}``.

    Raises:
        NotImplementedError: the ``lightgbm`` extra is not installed.
        RuntimeError: shape mismatch or training failure.
    """
    _check_lightgbm_support()
    import lightgbm as lgb

    X_np = X.to_numpy()
    y_np = y.to_numpy()

    if X_np.shape[0] != y_np.shape[0]:
        raise RuntimeError(
            f"lightgbm_train_regressor: X has {X_np.shape[0]} samples "
            f"but y has {y_np.shape[0]} samples"
        )

    n_features = X_np.shape[1]

    random_state = config["random_state"].unwrap_or(None)
    if random_state is not None:
        random_state = int(random_state)

    n_jobs = int(config["n_jobs"].unwrap_or(-1))

    try:
        # Suppress LightGBM warnings during training
        with quiet_warnings():
            model = lgb.LGBMRegressor(
                n_estimators=int(config["n_estimators"].unwrap_or(100)),
                max_depth=int(config["max_depth"].unwrap_or(-1)),
                learning_rate=float(config["learning_rate"].unwrap_or(0.1)),
                num_leaves=int(config["num_leaves"].unwrap_or(31)),
                min_child_samples=int(config["min_child_samples"].unwrap_or(20)),
                subsample=float(config["subsample"].unwrap_or(1.0)),
                colsample_bytree=float(
                    config["colsample_bytree"].unwrap_or(1.0)
                ),
                reg_alpha=float(config["reg_alpha"].unwrap_or(0.0)),
                reg_lambda=float(config["reg_lambda"].unwrap_or(0.0)),
                random_state=random_state,
                n_jobs=n_jobs,
                verbose=-1,
            )
            model.fit(X_np, y_np)
    except Exception as e:
        raise RuntimeError(
            f"lightgbm_train_regressor: Training failed with X shape {X_np.shape} - {e}"
        ) from e

    model_data = serialize(model)

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
    output=LightGBMModelBlobType,
)
def lightgbm_train_classifier(
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
            :func:`lightgbm_train_regressor` for field descriptions.
            All fields apply identically.

    Returns:
        ``LightGBMModelBlobType`` (``EastVariant``) tagged ``lightgbm_classifier``:
        ``{data: Blob (cloudpickle), n_features: Integer, n_classes: Integer}``.

    Raises:
        NotImplementedError: the ``lightgbm`` extra is not installed.
        RuntimeError: shape mismatch or training failure.
    """
    _check_lightgbm_support()
    import lightgbm as lgb

    X_np = X.to_numpy()
    y_np = y.to_numpy()

    if X_np.shape[0] != y_np.shape[0]:
        raise RuntimeError(
            f"lightgbm_train_classifier: X has {X_np.shape[0]} samples "
            f"but y has {y_np.shape[0]} samples"
        )

    n_features = X_np.shape[1]
    n_classes = len(np.unique(y_np))

    random_state = config["random_state"].unwrap_or(None)
    if random_state is not None:
        random_state = int(random_state)

    n_jobs = int(config["n_jobs"].unwrap_or(-1))

    try:
        # Suppress LightGBM warnings during training
        with quiet_warnings():
            model = lgb.LGBMClassifier(
                n_estimators=int(config["n_estimators"].unwrap_or(100)),
                max_depth=int(config["max_depth"].unwrap_or(-1)),
                learning_rate=float(config["learning_rate"].unwrap_or(0.1)),
                num_leaves=int(config["num_leaves"].unwrap_or(31)),
                min_child_samples=int(config["min_child_samples"].unwrap_or(20)),
                subsample=float(config["subsample"].unwrap_or(1.0)),
                colsample_bytree=float(
                    config["colsample_bytree"].unwrap_or(1.0)
                ),
                reg_alpha=float(config["reg_alpha"].unwrap_or(0.0)),
                reg_lambda=float(config["reg_lambda"].unwrap_or(0.0)),
                random_state=random_state,
                n_jobs=n_jobs,
                verbose=-1,
            )
            model.fit(X_np, y_np)
    except Exception as e:
        raise RuntimeError(
            f"lightgbm_train_classifier: Training failed with X shape {X_np.shape} - {e}"
        ) from e

    model_data = serialize(model)

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
    inputs=[LightGBMModelBlobType, MatrixType(FloatType)],
    output=VectorType(FloatType),
)
def lightgbm_predict(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastVector:
    """Predict continuous values with a trained LightGBM regressor.

    Args:
        model_blob: ``LightGBMModelBlobType`` (``EastVariant``) tagged
            ``lightgbm_regressor`` - as returned by
            :func:`lightgbm_train_regressor`.
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
    payload = expect_case(model_blob, "lightgbm_regressor", "lightgbm_predict")

    model = deserialize(payload["data"])

    X_np = X.to_numpy()

    try:
        # Suppress sklearn warnings during prediction
        with quiet_warnings():
            y_pred = model.predict(X_np)
    except Exception as e:
        raise RuntimeError(
            f"lightgbm_predict: Prediction failed with X shape {X_np.shape} - {e}"
        ) from e

    return EastVector(FloatType, y_pred.ravel().astype(np.float64))


@platform_function(
    name="lightgbm_predict_class",
    inputs=[LightGBMModelBlobType, MatrixType(FloatType)],
    output=VectorType(IntegerType),
)
def lightgbm_predict_class(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastVector:
    """Predict class labels with a trained LightGBM classifier.

    Args:
        model_blob: ``LightGBMModelBlobType`` (``EastVariant``) tagged
            ``lightgbm_classifier`` - as returned by
            :func:`lightgbm_train_classifier`.
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
    payload = expect_case(model_blob, "lightgbm_classifier", "lightgbm_predict_class")

    model = deserialize(payload["data"])

    X_np = X.to_numpy()

    try:
        # Suppress sklearn warnings during prediction
        with quiet_warnings():
            y_pred = model.predict(X_np)
    except Exception as e:
        raise RuntimeError(
            f"lightgbm_predict_class: Prediction failed with X shape {X_np.shape} - {e}"
        ) from e

    return EastVector(IntegerType, y_pred.ravel().astype(np.int64))


@platform_function(
    name="lightgbm_predict_proba",
    inputs=[LightGBMModelBlobType, MatrixType(FloatType)],
    output=MatrixType(FloatType),
)
def lightgbm_predict_proba(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastMatrix:
    """Get class probability estimates from a trained LightGBM classifier.

    Args:
        model_blob: ``LightGBMModelBlobType`` (``EastVariant``) tagged
            ``lightgbm_classifier`` - as returned by
            :func:`lightgbm_train_classifier`.
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
    payload = expect_case(model_blob, "lightgbm_classifier", "lightgbm_predict_proba")

    model = deserialize(payload["data"])

    X_np = X.to_numpy()

    try:
        # Suppress sklearn warnings during prediction
        with quiet_warnings():
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
