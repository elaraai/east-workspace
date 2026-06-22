#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""XGBoost platform functions for East.

Provides gradient boosting for regression and classification.
Uses cloudpickle for model serialization to enable portable inference.
"""

import importlib.util
import warnings

import numpy as np
from east.runtime.platform import platform_function, platform_functions
from east.types.types import FloatType, IntegerType, MatrixType, VectorType
from east.types.values import EastBlob, EastMatrix, EastStruct, EastVariant, EastVector

from east_py_datascience.types import (
    ModelBlobType,
    XGBoostConfigType,
    XGBoostQuantileConfigType,
    XGBoostQuantilePredictResultType,
    _get_option,
)

# ============================================================================
# Categorical Feature Helpers
# ============================================================================


def _prepare_categorical_features(X_np, categorical_features, func_name: str, categorical_n=None):
    """Prepare feature matrix with categorical columns.

    When categorical_n is provided, uses pd.Categorical with an explicit category
    range [0, n) per feature. This ensures a consistent category space between
    training and prediction — values outside [0, n) become NaN at predict time,
    which XGBoost handles natively via learned default branch directions.

    Args:
        X_np: numpy array of features
        categorical_features: EastVector of column indices that are categorical, or None
        func_name: name of the calling function for error messages
        categorical_n: plain list of ints (one per categorical feature) giving the
                       total number of categories, or None to infer from data

    Returns:
        Tuple of (X_prepared, cat_indices, enable_categorical) where:
        - X_prepared is either the original numpy array or a pandas DataFrame
        - cat_indices is the list of categorical indices or None
        - enable_categorical is True if categorical features are used
    """
    if categorical_features is None:
        return X_np, None, False

    cat_indices = categorical_features.to_numpy(dtype=np.int64).tolist()

    # Validate indices
    for idx in cat_indices:
        if idx < 0 or idx >= X_np.shape[1]:
            raise RuntimeError(
                f"{func_name}: categorical_features index {idx} "
                f"out of bounds for {X_np.shape[1]} features"
            )

    # Validate categorical_n length matches categorical_features
    if categorical_n is not None and len(categorical_n) != len(cat_indices):
        raise RuntimeError(
            f"{func_name}: categorical_n has {len(categorical_n)} entries "
            f"but categorical_features has {len(cat_indices)} entries"
        )

    # Convert to DataFrame with categorical columns
    # XGBoost requires integer category indices, so convert floats to ints first
    import pandas as pd

    df = pd.DataFrame(X_np)
    for i, idx in enumerate(cat_indices):
        col = df[idx]
        if categorical_n is not None:
            n_cats = categorical_n[i]
            # NaN-safe integer check: only validate non-NaN values
            valid_mask = col.notna()
            if valid_mask.any():
                col_valid = col[valid_mask]
                non_integer_mask = col_valid != col_valid.astype(int)
                if non_integer_mask.any():
                    bad_row = non_integer_mask.idxmax()
                    bad_value = col[bad_row]
                    raise RuntimeError(
                        f"{func_name}: categorical column {idx} contains non-integer value "
                        f"{bad_value} at row {bad_row}. Categorical features must contain "
                        f"whole numbers (0.0, 1.0, 2.0, ...) representing category indices."
                    )
            # Convert to int where valid, keep NaN; values outside [0, n) become NaN
            values = [int(v) if pd.notna(v) else np.nan for v in col.values]
            df[idx] = pd.Categorical(values, categories=range(n_cats))
        else:
            # Original behavior: infer categories from data
            non_integer_mask = col != col.astype(int)
            if non_integer_mask.any():
                bad_row = non_integer_mask.idxmax()
                bad_value = col[bad_row]
                raise RuntimeError(
                    f"{func_name}: categorical column {idx} contains non-integer value "
                    f"{bad_value} at row {bad_row}. Categorical features must contain "
                    f"whole numbers (0.0, 1.0, 2.0, ...) representing category indices."
                )
            df[idx] = col.astype(int).astype("category")

    return df, cat_indices, True


def _apply_categorical_features(X_np, categorical_features, func_name: str, categorical_n=None):
    """Apply categorical dtypes to feature matrix for prediction.

    When categorical_n is provided, uses pd.Categorical with an explicit category
    range [0, n) per feature. Values outside [0, n) become NaN, which XGBoost
    handles natively via learned default branch directions.

    Args:
        X_np: numpy array of features
        categorical_features: EastVariant option of column indices, or None
        func_name: name of the calling function for error messages
        categorical_n: plain list of ints (one per categorical feature) giving the
                       total number of categories, or None to infer from data

    Returns:
        X_prepared - either the original numpy array or a pandas DataFrame
    """
    cat_features_opt = _get_option(categorical_features, None)
    if cat_features_opt is None:
        return X_np

    cat_indices = cat_features_opt.to_numpy()

    import pandas as pd

    df = pd.DataFrame(X_np)
    for i, idx in enumerate(cat_indices):
        if idx < 0 or idx >= X_np.shape[1]:
            raise RuntimeError(
                f"{func_name}: categorical_features index {idx} "
                f"out of bounds for {X_np.shape[1]} features"
            )
        col = df[idx]
        if categorical_n is not None:
            n_cats = categorical_n[i]
            # NaN-safe: convert valid values to int, values outside [0, n) become NaN
            values = [int(v) if pd.notna(v) else np.nan for v in col.values]
            df[idx] = pd.Categorical(values, categories=range(n_cats))
        else:
            # Original behavior: infer categories from data
            non_integer_mask = col != col.astype(int)
            if non_integer_mask.any():
                bad_row = non_integer_mask.idxmax()
                bad_value = col[bad_row]
                raise RuntimeError(
                    f"{func_name}: categorical column {idx} contains non-integer value "
                    f"{bad_value} at row {bad_row}. Categorical features must contain "
                    f"whole numbers (0.0, 1.0, 2.0, ...) representing category indices."
                )
            df[idx] = col.astype(int).astype("category")

    return df


# ============================================================================
# Serialization Helpers
# ============================================================================


def _serialize_model(model) -> EastBlob:
    """Serialize model using cloudpickle."""
    import cloudpickle

    return EastBlob(cloudpickle.dumps(model))


def _deserialize_model(blob: EastBlob):
    """Deserialize model using cloudpickle."""
    import cloudpickle

    return cloudpickle.loads(bytes(blob))



# Lazy import guard for optional dependency
_HAS_XGBOOST_SUPPORT = importlib.util.find_spec("xgboost") is not None


def _check_xgboost_support() -> None:
    """Check if xgboost support is available."""
    if not _HAS_XGBOOST_SUPPORT:
        raise NotImplementedError(
            "Xgboost support requires the 'xgboost' extra. "
            "Add east-py-datascience[xgboost] to your pyproject.toml dependencies."
        )


# ============================================================================
# Platform Function Implementations
# ============================================================================


@platform_function(
    name="xgboost_train_regressor",
    inputs=[MatrixType(FloatType), VectorType(FloatType), XGBoostConfigType],
    output=ModelBlobType,
)
def xgboost_train_regressor_impl(
    X: EastMatrix,
    y: EastVector,
    config: EastStruct,
) -> EastVariant:
    """Train an XGBoost regressor and return a serialized model blob.

    Supports optional per-sample weighting and categorical features with an
    explicit or inferred category space.

    Args:
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix, one row per
            sample.
        y: ``Vector<Float>`` (``EastVector``) - continuous target values; must
            have the same number of rows as ``X``.
        config: ``XGBoostConfigType`` (``EastStruct``) with fields:

            - ``n_estimators`` (``Option<Integer>``): number of boosting rounds
              (default 100).
            - ``max_depth`` (``Option<Integer>``): maximum tree depth (default
              6).
            - ``learning_rate`` (``Option<Float>``): shrinkage step size
              (default 0.3).
            - ``min_child_weight`` (``Option<Integer>``): minimum sum of
              instance weights in a leaf (default 1).
            - ``subsample`` (``Option<Float>``): row subsampling ratio per tree
              (default 1.0).
            - ``colsample_bytree`` (``Option<Float>``): column subsampling ratio
              per tree (default 1.0).
            - ``reg_alpha`` (``Option<Float>``): L1 regularization on weights
              (default 0.0).
            - ``reg_lambda`` (``Option<Float>``): L2 regularization on weights
              (default 1.0).
            - ``gamma`` (``Option<Float>``): minimum loss reduction required to
              make a split (default 0.0).
            - ``random_state`` (``Option<Integer>``): random seed (default
              None).
            - ``n_jobs`` (``Option<Integer>``): parallel threads; -1 uses all
              cores (default -1).
            - ``sample_weight`` (``Option<Vector<Float>>``): per-sample weights;
              must match row count of ``X`` (default uniform).
            - ``categorical_features`` (``Option<Vector<Integer>>``): zero-based
              column indices treated as categorical (default None).
            - ``categorical_n`` (``Option<Vector<Integer>>``): number of
              categories per categorical feature; must match length of
              ``categorical_features``; values outside [0, n) become NaN
              (default infer from data).
            - ``max_cat_to_onehot`` (``Option<Integer>``): threshold below which
              XGBoost uses one-hot encoding for a categorical (default 4).
            - ``max_cat_threshold`` (``Option<Integer>``): max categories before
              using a partition-based split (default 64).

    Returns:
        ``ModelBlobType`` (``EastVariant``) tagged ``xgboost_regressor``:
        ``{data: Blob (cloudpickle), n_features: Integer,
        categorical_features: Option<Vector<Integer>>,
        categorical_n: Option<Vector<Integer>>}``.

    Raises:
        NotImplementedError: the ``xgboost`` extra is not installed.
        RuntimeError: shape mismatch, invalid categorical indices, or training
            failure.
    """
    _check_xgboost_support()
    import xgboost as xgb

    try:
        X_np = X.to_numpy()
        y_np = y.to_numpy()
    except Exception as e:
        raise RuntimeError(f"xgboost_train_regressor: Invalid input data - {e}") from e

    if X_np.shape[0] != y_np.shape[0]:
        raise RuntimeError(
            f"xgboost_train_regressor: X has {X_np.shape[0]} samples "
            f"but y has {y_np.shape[0]} samples"
        )

    n_features = X_np.shape[1]

    # Extract sample weights if provided
    sample_weight_opt = _get_option(config.get("sample_weight"), None)
    sample_weight_np = None
    if sample_weight_opt is not None:
        sample_weight_np = sample_weight_opt.to_numpy()
        if sample_weight_np.shape[0] != X_np.shape[0]:
            raise RuntimeError(
                f"xgboost_train_regressor: sample_weight has {sample_weight_np.shape[0]} "
                f"elements but X has {X_np.shape[0]} samples"
            )

    # Extract categorical features config
    categorical_features = _get_option(config.get("categorical_features"), None)
    categorical_n_opt = _get_option(config.get("categorical_n"), None)
    cat_n_list = None
    if categorical_n_opt is not None:
        cat_n_list = categorical_n_opt.to_numpy(dtype=np.int64).tolist()
    X_train, cat_indices, enable_categorical = _prepare_categorical_features(
        X_np, categorical_features, "xgboost_train_regressor", categorical_n=cat_n_list
    )

    # Extract categorical config options
    max_cat_to_onehot = _get_option(config.get("max_cat_to_onehot"), None)
    max_cat_threshold = _get_option(config.get("max_cat_threshold"), None)

    try:
        random_state = _get_option(config.get("random_state"), None)
        if random_state is not None:
            random_state = int(random_state)

        n_jobs = _get_option(config.get("n_jobs"), -1)
        if n_jobs is not None:
            n_jobs = int(n_jobs)

        # Suppress XGBoost warnings during training
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)
            model = xgb.XGBRegressor(
                n_estimators=int(_get_option(config.get("n_estimators"), 100)),
                max_depth=int(_get_option(config.get("max_depth"), 6)),
                learning_rate=float(_get_option(config.get("learning_rate"), 0.3)),
                min_child_weight=int(_get_option(config.get("min_child_weight"), 1)),
                subsample=float(_get_option(config.get("subsample"), 1.0)),
                colsample_bytree=float(
                    _get_option(config.get("colsample_bytree"), 1.0)
                ),
                reg_alpha=float(_get_option(config.get("reg_alpha"), 0.0)),
                reg_lambda=float(_get_option(config.get("reg_lambda"), 1.0)),
                gamma=float(_get_option(config.get("gamma"), 0.0)),
                random_state=random_state,
                n_jobs=n_jobs,
                enable_categorical=enable_categorical,
                max_cat_to_onehot=int(max_cat_to_onehot) if max_cat_to_onehot else 4,
                max_cat_threshold=int(max_cat_threshold) if max_cat_threshold else 64,
            )
            model.fit(X_train, y_np, sample_weight=sample_weight_np)
    except Exception as e:
        raise RuntimeError(
            f"xgboost_train_regressor: Training failed with X shape {X_np.shape} - {e}"
        ) from e

    model_data = _serialize_model(model)

    # Store categorical features for prediction
    cat_features_blob = None
    if cat_indices is not None:
        cat_features_blob = EastVariant(
            "some", EastVector(IntegerType, np.array(cat_indices, dtype=np.int64))
        )
    else:
        cat_features_blob = EastVariant("none", None)

    cat_n_blob = EastVariant("some", EastVector(IntegerType, np.array(cat_n_list, dtype=np.int64))) if cat_n_list else EastVariant("none", None)

    return EastVariant(
        "xgboost_regressor",
        EastStruct(
            {
                "data": model_data,
                "n_features": n_features,
                "categorical_features": cat_features_blob,
                "categorical_n": cat_n_blob,
            }
        ),
    )


@platform_function(
    name="xgboost_train_classifier",
    inputs=[MatrixType(FloatType), VectorType(IntegerType), XGBoostConfigType],
    output=ModelBlobType,
)
def xgboost_train_classifier_impl(
    X: EastMatrix,
    y: EastVector,
    config: EastStruct,
) -> EastVariant:
    """Train an XGBoost classifier and return a serialized model blob.

    Class labels are remapped to contiguous 0-indexed integers internally;
    the original labels are stored in the blob so predictions are remapped
    back on inference.

    Args:
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix, one row per
            sample.
        y: ``Vector<Integer>`` (``EastVector``) - integer class labels; must
            have the same number of rows as ``X``.
        config: ``XGBoostConfigType`` (``EastStruct``) - see
            :func:`xgboost_train_regressor_impl` for field descriptions.
            All fields apply identically.

    Returns:
        ``ModelBlobType`` (``EastVariant``) tagged ``xgboost_classifier``:
        ``{data: Blob (cloudpickle of {model, classes}), n_features: Integer,
        n_classes: Integer, categorical_features: Option<Vector<Integer>>,
        categorical_n: Option<Vector<Integer>>}``.

    Raises:
        NotImplementedError: the ``xgboost`` extra is not installed.
        RuntimeError: shape mismatch, invalid categorical indices, or training
            failure.
    """
    _check_xgboost_support()
    import xgboost as xgb

    try:
        X_np = X.to_numpy()
        y_np = y.to_numpy()
    except Exception as e:
        raise RuntimeError(f"xgboost_train_classifier: Invalid input data - {e}") from e

    if X_np.shape[0] != y_np.shape[0]:
        raise RuntimeError(
            f"xgboost_train_classifier: X has {X_np.shape[0]} samples "
            f"but y has {y_np.shape[0]} samples"
        )

    n_features = X_np.shape[1]

    # Remap class labels to be 0-indexed and contiguous
    # XGBoost requires class labels to be [0, 1, 2, ...]
    unique_classes = np.unique(y_np)
    n_classes = len(unique_classes)

    # Create mapping from original labels to 0-indexed
    label_map = {orig: idx for idx, orig in enumerate(unique_classes)}
    y_np = np.array([label_map[y] for y in y_np])

    # Extract sample weights if provided
    sample_weight_opt = _get_option(config.get("sample_weight"), None)
    sample_weight_np = None
    if sample_weight_opt is not None:
        sample_weight_np = sample_weight_opt.to_numpy()
        if sample_weight_np.shape[0] != X_np.shape[0]:
            raise RuntimeError(
                f"xgboost_train_classifier: sample_weight has {sample_weight_np.shape[0]} "
                f"elements but X has {X_np.shape[0]} samples"
            )

    # Extract categorical features config
    categorical_features = _get_option(config.get("categorical_features"), None)
    categorical_n_opt = _get_option(config.get("categorical_n"), None)
    cat_n_list = None
    if categorical_n_opt is not None:
        cat_n_list = categorical_n_opt.to_numpy(dtype=np.int64).tolist()
    X_train, cat_indices, enable_categorical = _prepare_categorical_features(
        X_np, categorical_features, "xgboost_train_classifier", categorical_n=cat_n_list
    )

    # Extract categorical config options
    max_cat_to_onehot = _get_option(config.get("max_cat_to_onehot"), None)
    max_cat_threshold = _get_option(config.get("max_cat_threshold"), None)

    try:
        random_state = _get_option(config.get("random_state"), None)
        if random_state is not None:
            random_state = int(random_state)

        n_jobs = _get_option(config.get("n_jobs"), -1)
        if n_jobs is not None:
            n_jobs = int(n_jobs)

        # Suppress XGBoost warnings during training
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)
            model = xgb.XGBClassifier(
                n_estimators=int(_get_option(config.get("n_estimators"), 100)),
                max_depth=int(_get_option(config.get("max_depth"), 6)),
                learning_rate=float(_get_option(config.get("learning_rate"), 0.3)),
                min_child_weight=int(_get_option(config.get("min_child_weight"), 1)),
                subsample=float(_get_option(config.get("subsample"), 1.0)),
                colsample_bytree=float(
                    _get_option(config.get("colsample_bytree"), 1.0)
                ),
                reg_alpha=float(_get_option(config.get("reg_alpha"), 0.0)),
                reg_lambda=float(_get_option(config.get("reg_lambda"), 1.0)),
                gamma=float(_get_option(config.get("gamma"), 0.0)),
                random_state=random_state,
                n_jobs=n_jobs,
                enable_categorical=enable_categorical,
                max_cat_to_onehot=int(max_cat_to_onehot) if max_cat_to_onehot else 4,
                max_cat_threshold=int(max_cat_threshold) if max_cat_threshold else 64,
                # Class-imbalance lever for binary classification. Default None
                # leaves XGBoost's own default (1.0) untouched.
                scale_pos_weight=_get_option(config.get("scale_pos_weight"), None),
            )
            model.fit(X_train, y_np, sample_weight=sample_weight_np)
    except Exception as e:
        raise RuntimeError(
            f"xgboost_train_classifier: Training failed with X shape {X_np.shape} - {e}"
        ) from e

    # Store model and class mapping together for prediction remapping
    model_data = _serialize_model({"model": model, "classes": unique_classes})

    # Store categorical features for prediction
    cat_features_blob = None
    if cat_indices is not None:
        cat_features_blob = EastVariant(
            "some", EastVector(IntegerType, np.array(cat_indices, dtype=np.int64))
        )
    else:
        cat_features_blob = EastVariant("none", None)

    cat_n_blob = EastVariant("some", EastVector(IntegerType, np.array(cat_n_list, dtype=np.int64))) if cat_n_list else EastVariant("none", None)

    return EastVariant(
        "xgboost_classifier",
        EastStruct(
            {
                "data": model_data,
                "n_features": n_features,
                "n_classes": n_classes,
                "categorical_features": cat_features_blob,
                "categorical_n": cat_n_blob,
            }
        ),
    )


@platform_function(
    name="xgboost_predict",
    inputs=[ModelBlobType, MatrixType(FloatType)],
    output=VectorType(FloatType),
)
def xgboost_predict_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastVector:
    """Predict continuous values with a trained XGBoost regressor.

    Args:
        model_blob: ``ModelBlobType`` (``EastVariant``) tagged
            ``xgboost_regressor`` - as returned by
            :func:`xgboost_train_regressor_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix; must have the
            same number of columns the model was trained with.

    Returns:
        ``Vector<Float>`` (``EastVector``) - one predicted value per row.

    Raises:
        NotImplementedError: the ``xgboost`` extra is not installed.
        RuntimeError: wrong model blob type, invalid input data, or prediction
            failure.
    """
    _check_xgboost_support()
    if model_blob.type != "xgboost_regressor":
        raise RuntimeError(
            f"xgboost_predict: Expected xgboost_regressor, got {model_blob.type}"
        )

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(f"xgboost_predict: Invalid input data - {e}") from e

    # Apply categorical features if present
    cat_n_opt = _get_option(model_blob.value.get("categorical_n"), None)
    cat_n_list = cat_n_opt.to_numpy(dtype=np.int64).tolist() if cat_n_opt is not None else None
    X_pred = _apply_categorical_features(
        X_np, model_blob.value.get("categorical_features"), "xgboost_predict",
        categorical_n=cat_n_list,
    )

    try:
        model = _deserialize_model(model_blob.value["data"])
        # Suppress warnings during prediction
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)
            y_pred = model.predict(X_pred)
        return EastVector(FloatType, y_pred.ravel().astype(np.float64))
    except Exception as e:
        raise RuntimeError(
            f"xgboost_predict: Prediction failed with X shape {X_np.shape} - {e}"
        ) from e


@platform_function(
    name="xgboost_predict_class",
    inputs=[ModelBlobType, MatrixType(FloatType)],
    output=VectorType(IntegerType),
)
def xgboost_predict_class_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastVector:
    """Predict class labels with a trained XGBoost classifier.

    Predictions are remapped from the internal 0-indexed labels back to the
    original class labels seen during training.

    Args:
        model_blob: ``ModelBlobType`` (``EastVariant``) tagged
            ``xgboost_classifier`` - as returned by
            :func:`xgboost_train_classifier_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix; must have the
            same number of columns the model was trained with.

    Returns:
        ``Vector<Integer>`` (``EastVector``) - one predicted class label per
        row, using the original label values from training.

    Raises:
        NotImplementedError: the ``xgboost`` extra is not installed.
        RuntimeError: wrong model blob type, invalid input data, or prediction
            failure.
    """
    _check_xgboost_support()
    if model_blob.type != "xgboost_classifier":
        raise RuntimeError(
            f"xgboost_predict_class: Expected xgboost_classifier, got {model_blob.type}"
        )

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(f"xgboost_predict_class: Invalid input data - {e}") from e

    # Apply categorical features if present
    cat_n_opt = _get_option(model_blob.value.get("categorical_n"), None)
    cat_n_list = cat_n_opt.to_numpy(dtype=np.int64).tolist() if cat_n_opt is not None else None
    X_pred = _apply_categorical_features(
        X_np, model_blob.value.get("categorical_features"), "xgboost_predict_class",
        categorical_n=cat_n_list,
    )

    try:
        model_dict = _deserialize_model(model_blob.value["data"])
        model = model_dict["model"]
        classes = model_dict["classes"]

        # Suppress warnings during prediction
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)
            y_pred = model.predict(X_pred)

        # Remap predictions back to original labels
        y_pred = classes[y_pred]

        return EastVector(IntegerType, y_pred.ravel().astype(np.int64))
    except Exception as e:
        raise RuntimeError(
            f"xgboost_predict_class: Prediction failed with X shape {X_np.shape} - {e}"
        ) from e


@platform_function(
    name="xgboost_predict_proba",
    inputs=[ModelBlobType, MatrixType(FloatType)],
    output=MatrixType(FloatType),
)
def xgboost_predict_proba_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastMatrix:
    """Get class probability estimates from a trained XGBoost classifier.

    Probabilities are in the order of the 0-indexed internal class labels,
    which corresponds to the sorted order of the original labels seen at
    training.

    Args:
        model_blob: ``ModelBlobType`` (``EastVariant``) tagged
            ``xgboost_classifier`` - as returned by
            :func:`xgboost_train_classifier_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix; must have the
            same number of columns the model was trained with.

    Returns:
        ``Matrix<Float>`` (``EastMatrix``) - shape ``(n_samples, n_classes)``
        where each row sums to 1.0.

    Raises:
        NotImplementedError: the ``xgboost`` extra is not installed.
        RuntimeError: wrong model blob type, invalid input data, or prediction
            failure.
    """
    _check_xgboost_support()
    if model_blob.type != "xgboost_classifier":
        raise RuntimeError(
            f"xgboost_predict_proba: Expected xgboost_classifier, got {model_blob.type}"
        )

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(f"xgboost_predict_proba: Invalid input data - {e}") from e

    # Apply categorical features if present
    cat_n_opt = _get_option(model_blob.value.get("categorical_n"), None)
    cat_n_list = cat_n_opt.to_numpy(dtype=np.int64).tolist() if cat_n_opt is not None else None
    X_pred = _apply_categorical_features(
        X_np, model_blob.value.get("categorical_features"), "xgboost_predict_proba",
        categorical_n=cat_n_list,
    )

    try:
        model_dict = _deserialize_model(model_blob.value["data"])
        model = model_dict["model"]
        # Note: probabilities are in order of 0-indexed classes, which matches
        # the classes array order. No remapping needed for probabilities.

        # Suppress warnings during prediction
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)
            proba = model.predict_proba(X_pred)
        return EastMatrix(FloatType, np.atleast_2d(proba).astype(np.float64))
    except Exception as e:
        raise RuntimeError(
            f"xgboost_predict_proba: Prediction failed with X shape {X_np.shape} - {e}"
        ) from e


@platform_function(
    name="xgboost_train_quantile",
    inputs=[MatrixType(FloatType), VectorType(FloatType), XGBoostQuantileConfigType],
    output=ModelBlobType,
)
def xgboost_train_quantile_impl(
    X: EastMatrix,
    y: EastVector,
    config: EastStruct,
) -> EastVariant:
    """Train one XGBoost quantile regressor per requested quantile.

    Uses XGBoost's ``reg:quantileerror`` objective with ``quantile_alpha``
    set per model. All models share the same hyperparameters.

    Args:
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix, one row per
            sample.
        y: ``Vector<Float>`` (``EastVector``) - continuous target values; must
            have the same number of rows as ``X``.
        config: ``XGBoostQuantileConfigType`` (``EastStruct``) with fields:

            - ``quantiles`` (``Vector<Float>``): quantile levels to predict;
              each must be strictly in (0, 1).
            - ``n_estimators`` (``Option<Integer>``): boosting rounds per model
              (default 100).
            - ``max_depth`` (``Option<Integer>``): maximum tree depth (default
              6).
            - ``learning_rate`` (``Option<Float>``): step size (default 0.3).
            - ``min_child_weight`` (``Option<Integer>``): minimum leaf weight
              (default 1).
            - ``subsample`` (``Option<Float>``): row subsampling ratio (default
              1.0).
            - ``colsample_bytree`` (``Option<Float>``): column subsampling ratio
              (default 1.0).
            - ``reg_alpha`` (``Option<Float>``): L1 regularization (default
              0.0).
            - ``reg_lambda`` (``Option<Float>``): L2 regularization (default
              1.0).
            - ``gamma`` (``Option<Float>``): minimum loss reduction for a split
              (default 0.0).
            - ``random_state`` (``Option<Integer>``): random seed (default
              None).
            - ``n_jobs`` (``Option<Integer>``): parallel threads (default -1).
            - ``sample_weight`` (``Option<Vector<Float>>``): per-sample weights
              (default uniform).
            - ``categorical_features`` (``Option<Vector<Integer>>``): column
              indices to treat as categorical (default None).
            - ``categorical_n`` (``Option<Vector<Integer>>``): category count
              per categorical feature (default infer from data).
            - ``max_cat_to_onehot`` (``Option<Integer>``): one-hot threshold
              (default 4).
            - ``max_cat_threshold`` (``Option<Integer>``): partition-split
              threshold (default 64).

    Returns:
        ``ModelBlobType`` (``EastVariant``) tagged ``xgboost_quantile``:
        ``{data: Blob (cloudpickle of {q: model} dict), quantiles:
        Vector<Float>, n_features: Integer, categorical_features:
        Option<Vector<Integer>>, categorical_n: Option<Vector<Integer>>}``.

    Raises:
        NotImplementedError: the ``xgboost`` extra is not installed.
        RuntimeError: quantile out of range, shape mismatch, or training
            failure.
    """
    _check_xgboost_support()
    import xgboost as xgb

    try:
        X_np = X.to_numpy()
        y_np = y.to_numpy()
    except Exception as e:
        raise RuntimeError(f"xgboost_train_quantile: Invalid input data - {e}") from e

    if X_np.shape[0] != y_np.shape[0]:
        raise RuntimeError(
            f"xgboost_train_quantile: X has {X_np.shape[0]} samples "
            f"but y has {y_np.shape[0]} samples"
        )

    n_features = X_np.shape[1]

    # Get quantiles from config
    quantiles_arr = config.get("quantiles")
    quantiles = quantiles_arr.to_numpy(dtype=np.float64).tolist()

    # Validate quantiles
    for q in quantiles:
        if not 0 < q < 1:
            raise RuntimeError(
                f"xgboost_train_quantile: Quantiles must be in (0, 1), got {q}"
            )

    # Extract sample weights if provided
    sample_weight_opt = _get_option(config.get("sample_weight"), None)
    sample_weight_np = None
    if sample_weight_opt is not None:
        sample_weight_np = sample_weight_opt.to_numpy()
        if sample_weight_np.shape[0] != X_np.shape[0]:
            raise RuntimeError(
                f"xgboost_train_quantile: sample_weight has {sample_weight_np.shape[0]} "
                f"elements but X has {X_np.shape[0]} samples"
            )

    # Extract categorical features config
    categorical_features = _get_option(config.get("categorical_features"), None)
    categorical_n_opt = _get_option(config.get("categorical_n"), None)
    cat_n_list = None
    if categorical_n_opt is not None:
        cat_n_list = categorical_n_opt.to_numpy(dtype=np.int64).tolist()
    X_train, cat_indices, enable_categorical = _prepare_categorical_features(
        X_np, categorical_features, "xgboost_train_quantile", categorical_n=cat_n_list
    )

    # Extract categorical config options
    max_cat_to_onehot = _get_option(config.get("max_cat_to_onehot"), None)
    max_cat_threshold = _get_option(config.get("max_cat_threshold"), None)

    try:
        random_state = _get_option(config.get("random_state"), None)
        if random_state is not None:
            random_state = int(random_state)

        n_jobs = _get_option(config.get("n_jobs"), -1)
        if n_jobs is not None:
            n_jobs = int(n_jobs)

        # Base parameters for all quantile models
        base_params = {
            "n_estimators": int(_get_option(config.get("n_estimators"), 100)),
            "max_depth": int(_get_option(config.get("max_depth"), 6)),
            "learning_rate": float(_get_option(config.get("learning_rate"), 0.3)),
            "min_child_weight": int(_get_option(config.get("min_child_weight"), 1)),
            "subsample": float(_get_option(config.get("subsample"), 1.0)),
            "colsample_bytree": float(_get_option(config.get("colsample_bytree"), 1.0)),
            "reg_alpha": float(_get_option(config.get("reg_alpha"), 0.0)),
            "reg_lambda": float(_get_option(config.get("reg_lambda"), 1.0)),
            "gamma": float(_get_option(config.get("gamma"), 0.0)),
            "random_state": random_state,
            "n_jobs": n_jobs,
            "verbosity": 0,
            "enable_categorical": enable_categorical,
            "max_cat_to_onehot": int(max_cat_to_onehot) if max_cat_to_onehot else 4,
            "max_cat_threshold": int(max_cat_threshold) if max_cat_threshold else 64,
        }

        # Train one model per quantile
        models = {}
        # Suppress XGBoost warnings during training
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)
            for q in quantiles:
                model = xgb.XGBRegressor(
                    objective="reg:quantileerror",
                    quantile_alpha=q,
                    **base_params,
                )
                model.fit(X_train, y_np, sample_weight=sample_weight_np)
                models[q] = model

    except Exception as e:
        raise RuntimeError(
            f"xgboost_train_quantile: Training failed with X shape {X_np.shape} - {e}"
        ) from e

    model_data = _serialize_model(models)

    # Store categorical features for prediction
    cat_features_blob = None
    if cat_indices is not None:
        cat_features_blob = EastVariant(
            "some", EastVector(IntegerType, np.array(cat_indices, dtype=np.int64))
        )
    else:
        cat_features_blob = EastVariant("none", None)

    cat_n_blob = EastVariant("some", EastVector(IntegerType, np.array(cat_n_list, dtype=np.int64))) if cat_n_list else EastVariant("none", None)

    return EastVariant(
        "xgboost_quantile",
        EastStruct(
            {
                "data": model_data,
                "quantiles": EastVector(FloatType, np.array(quantiles, dtype=np.float64)),
                "n_features": n_features,
                "categorical_features": cat_features_blob,
                "categorical_n": cat_n_blob,
            }
        ),
    )


@platform_function(
    name="xgboost_predict_quantile",
    inputs=[ModelBlobType, MatrixType(FloatType)],
    output=XGBoostQuantilePredictResultType,
)
def xgboost_predict_quantile_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastStruct:
    """Predict all quantile levels with a trained XGBoost quantile model.

    Args:
        model_blob: ``ModelBlobType`` (``EastVariant``) tagged
            ``xgboost_quantile`` - as returned by
            :func:`xgboost_train_quantile_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - feature matrix; must have the
            same number of columns the model was trained with.

    Returns:
        ``XGBoostQuantilePredictResultType`` (``EastStruct``):
        ``quantiles`` (``Vector<Float>``, sorted) and ``predictions``
        (``Matrix<Float>`` of shape ``(n_samples, n_quantiles)`` where column
        ``i`` corresponds to ``quantiles[i]``).

    Raises:
        NotImplementedError: the ``xgboost`` extra is not installed.
        RuntimeError: wrong model blob type, invalid input data, or prediction
            failure.
    """
    _check_xgboost_support()
    if model_blob.type != "xgboost_quantile":
        raise RuntimeError(
            f"xgboost_predict_quantile: Expected xgboost_quantile, got {model_blob.type}"
        )

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(f"xgboost_predict_quantile: Invalid input data - {e}") from e

    # Apply categorical features if present
    cat_n_opt = _get_option(model_blob.value.get("categorical_n"), None)
    cat_n_list = cat_n_opt.to_numpy(dtype=np.int64).tolist() if cat_n_opt is not None else None
    X_pred = _apply_categorical_features(
        X_np, model_blob.value.get("categorical_features"), "xgboost_predict_quantile",
        categorical_n=cat_n_list,
    )

    n_samples = X_np.shape[0]

    try:
        # Deserialize models dict
        models = _deserialize_model(model_blob.value["data"])

        # Use the model dict keys directly (they are the original quantile values)
        # This avoids float precision issues from serialization/deserialization
        quantiles_list = sorted(models.keys())
        n_quantiles = len(quantiles_list)

        # Predict each quantile
        predictions = np.zeros((n_samples, n_quantiles))
        # Suppress warnings during prediction
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)
            for i, q in enumerate(quantiles_list):
                predictions[:, i] = models[q].predict(X_pred)

        return EastStruct(
            {
                "quantiles": EastVector(FloatType, np.array(quantiles_list, dtype=np.float64)),
                "predictions": EastMatrix(FloatType, np.atleast_2d(predictions).astype(np.float64)),
            }
        )
    except Exception as e:
        raise RuntimeError(
            f"xgboost_predict_quantile: Prediction failed with X shape {X_np.shape} - {e}"
        ) from e


# ============================================================================
# Platform Function Registration
# ============================================================================

# Collected from the @platform_function decorations above.
xgboost_impl = platform_functions(__name__)

__all__ = [
    "xgboost_impl",
]
