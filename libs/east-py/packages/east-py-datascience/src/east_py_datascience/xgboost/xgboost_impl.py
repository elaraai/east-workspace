#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""XGBoost platform functions for East.

Provides gradient boosting for regression and classification.
Uses cloudpickle for model serialization to enable portable inference.
"""


import numpy as np
from east.runtime.platform import platform_function, platform_functions
from east.types.types import FloatType, IntegerType, MatrixType, VectorType
from east.types.values import EastMatrix, EastStruct, EastVariant, EastVector

from east_py_datascience._categorical import (
    apply_categorical,
    categorical_config,
    categorical_options,
    prepare_categorical,
)
from east_py_datascience._common import (
    deserialize,
    expect_case,
    extra_guard,
    quiet_warnings,
    serialize,
)
from east_py_datascience.types import (
    XGBoostConfigType,
    XGBoostModelBlobType,
    XGBoostQuantileConfigType,
    XGBoostQuantilePredictResultType,
)

_check_xgboost_support = extra_guard("xgboost", "xgboost", "XGBoost")


# ============================================================================
# Platform Function Implementations
# ============================================================================


@platform_function(
    name="xgboost_train_regressor",
    inputs=[MatrixType(FloatType), VectorType(FloatType), XGBoostConfigType],
    output=XGBoostModelBlobType,
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
        ``XGBoostModelBlobType`` (``EastVariant``) tagged ``xgboost_regressor``:
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

    X_np = X.to_numpy()
    y_np = y.to_numpy()

    if X_np.shape[0] != y_np.shape[0]:
        raise RuntimeError(
            f"xgboost_train_regressor: X has {X_np.shape[0]} samples "
            f"but y has {y_np.shape[0]} samples"
        )

    n_features = X_np.shape[1]

    # Extract sample weights if provided
    sample_weight_opt = config["sample_weight"].unwrap_or(None)
    sample_weight_np = None
    if sample_weight_opt is not None:
        sample_weight_np = sample_weight_opt.to_numpy()
        if sample_weight_np.shape[0] != X_np.shape[0]:
            raise RuntimeError(
                f"xgboost_train_regressor: sample_weight has {sample_weight_np.shape[0]} "
                f"elements but X has {X_np.shape[0]} samples"
            )

    cat_indices, cat_n_list = categorical_config(config)
    X_train, cat_indices, enable_categorical = prepare_categorical(
        X_np, cat_indices, "xgboost_train_regressor", categorical_n=cat_n_list
    )

    try:
        random_state = config["random_state"].unwrap_or(None)
        if random_state is not None:
            random_state = int(random_state)

        n_jobs = int(config["n_jobs"].unwrap_or(-1))

        # Suppress XGBoost warnings during training
        with quiet_warnings():
            model = xgb.XGBRegressor(
                n_estimators=int(config["n_estimators"].unwrap_or(100)),
                max_depth=int(config["max_depth"].unwrap_or(6)),
                learning_rate=float(config["learning_rate"].unwrap_or(0.3)),
                min_child_weight=int(config["min_child_weight"].unwrap_or(1)),
                subsample=float(config["subsample"].unwrap_or(1.0)),
                colsample_bytree=float(
                    config["colsample_bytree"].unwrap_or(1.0)
                ),
                reg_alpha=float(config["reg_alpha"].unwrap_or(0.0)),
                reg_lambda=float(config["reg_lambda"].unwrap_or(1.0)),
                gamma=float(config["gamma"].unwrap_or(0.0)),
                random_state=random_state,
                n_jobs=n_jobs,
                enable_categorical=enable_categorical,
                max_cat_to_onehot=int(config["max_cat_to_onehot"].unwrap_or(4)),
                max_cat_threshold=int(config["max_cat_threshold"].unwrap_or(64)),
            )
            model.fit(X_train, y_np, sample_weight=sample_weight_np)
    except Exception as e:
        raise RuntimeError(
            f"xgboost_train_regressor: Training failed with X shape {X_np.shape} - {e}"
        ) from e

    model_data = serialize(model)

    # The encoding prediction must replay
    cat_features_blob, cat_n_blob = categorical_options(cat_indices, cat_n_list)

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
    output=XGBoostModelBlobType,
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
        ``XGBoostModelBlobType`` (``EastVariant``) tagged ``xgboost_classifier``:
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

    X_np = X.to_numpy()
    y_np = y.to_numpy()

    if X_np.shape[0] != y_np.shape[0]:
        raise RuntimeError(
            f"xgboost_train_classifier: X has {X_np.shape[0]} samples "
            f"but y has {y_np.shape[0]} samples"
        )

    n_features = X_np.shape[1]

    # XGBoost needs contiguous 0-based labels; the original labels ride along
    # in the blob so predictions map back
    unique_classes, y_np = np.unique(y_np, return_inverse=True)
    n_classes = len(unique_classes)

    # Extract sample weights if provided
    sample_weight_opt = config["sample_weight"].unwrap_or(None)
    sample_weight_np = None
    if sample_weight_opt is not None:
        sample_weight_np = sample_weight_opt.to_numpy()
        if sample_weight_np.shape[0] != X_np.shape[0]:
            raise RuntimeError(
                f"xgboost_train_classifier: sample_weight has {sample_weight_np.shape[0]} "
                f"elements but X has {X_np.shape[0]} samples"
            )

    cat_indices, cat_n_list = categorical_config(config)
    X_train, cat_indices, enable_categorical = prepare_categorical(
        X_np, cat_indices, "xgboost_train_classifier", categorical_n=cat_n_list
    )

    try:
        random_state = config["random_state"].unwrap_or(None)
        if random_state is not None:
            random_state = int(random_state)

        n_jobs = int(config["n_jobs"].unwrap_or(-1))

        # Suppress XGBoost warnings during training
        with quiet_warnings():
            model = xgb.XGBClassifier(
                n_estimators=int(config["n_estimators"].unwrap_or(100)),
                max_depth=int(config["max_depth"].unwrap_or(6)),
                learning_rate=float(config["learning_rate"].unwrap_or(0.3)),
                min_child_weight=int(config["min_child_weight"].unwrap_or(1)),
                subsample=float(config["subsample"].unwrap_or(1.0)),
                colsample_bytree=float(
                    config["colsample_bytree"].unwrap_or(1.0)
                ),
                reg_alpha=float(config["reg_alpha"].unwrap_or(0.0)),
                reg_lambda=float(config["reg_lambda"].unwrap_or(1.0)),
                gamma=float(config["gamma"].unwrap_or(0.0)),
                random_state=random_state,
                n_jobs=n_jobs,
                enable_categorical=enable_categorical,
                max_cat_to_onehot=int(config["max_cat_to_onehot"].unwrap_or(4)),
                max_cat_threshold=int(config["max_cat_threshold"].unwrap_or(64)),
                # Class-imbalance lever for binary classification. Default None
                # leaves XGBoost's own default (1.0) untouched.
                scale_pos_weight=config["scale_pos_weight"].unwrap_or(None),
            )
            model.fit(X_train, y_np, sample_weight=sample_weight_np)
    except Exception as e:
        raise RuntimeError(
            f"xgboost_train_classifier: Training failed with X shape {X_np.shape} - {e}"
        ) from e

    # Store model and class mapping together for prediction remapping
    model_data = serialize({"model": model, "classes": unique_classes})

    # The encoding prediction must replay
    cat_features_blob, cat_n_blob = categorical_options(cat_indices, cat_n_list)

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
    inputs=[XGBoostModelBlobType, MatrixType(FloatType)],
    output=VectorType(FloatType),
)
def xgboost_predict_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastVector:
    """Predict continuous values with a trained XGBoost regressor.

    Args:
        model_blob: ``XGBoostModelBlobType`` (``EastVariant``) tagged
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
    payload = expect_case(model_blob, "xgboost_regressor", "xgboost_predict")

    X_np = X.to_numpy()

    cat_indices, cat_n_list = categorical_config(payload)
    X_pred = apply_categorical(X_np, cat_indices, "xgboost_predict", categorical_n=cat_n_list)

    try:
        model = deserialize(payload["data"])
        # Suppress warnings during prediction
        with quiet_warnings():
            y_pred = model.predict(X_pred)
        return EastVector(FloatType, y_pred.ravel().astype(np.float64))
    except Exception as e:
        raise RuntimeError(
            f"xgboost_predict: Prediction failed with X shape {X_np.shape} - {e}"
        ) from e


@platform_function(
    name="xgboost_predict_class",
    inputs=[XGBoostModelBlobType, MatrixType(FloatType)],
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
        model_blob: ``XGBoostModelBlobType`` (``EastVariant``) tagged
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
    payload = expect_case(model_blob, "xgboost_classifier", "xgboost_predict_class")

    X_np = X.to_numpy()

    cat_indices, cat_n_list = categorical_config(payload)
    X_pred = apply_categorical(X_np, cat_indices, "xgboost_predict_class", categorical_n=cat_n_list)

    try:
        model_dict = deserialize(payload["data"])
        model = model_dict["model"]
        classes = model_dict["classes"]

        # Suppress warnings during prediction
        with quiet_warnings():
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
    inputs=[XGBoostModelBlobType, MatrixType(FloatType)],
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
        model_blob: ``XGBoostModelBlobType`` (``EastVariant``) tagged
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
    payload = expect_case(model_blob, "xgboost_classifier", "xgboost_predict_proba")

    X_np = X.to_numpy()

    cat_indices, cat_n_list = categorical_config(payload)
    X_pred = apply_categorical(X_np, cat_indices, "xgboost_predict_proba", categorical_n=cat_n_list)

    try:
        model_dict = deserialize(payload["data"])
        model = model_dict["model"]
        # Note: probabilities are in order of 0-indexed classes, which matches
        # the classes array order. No remapping needed for probabilities.

        # Suppress warnings during prediction
        with quiet_warnings():
            proba = model.predict_proba(X_pred)
        return EastMatrix(FloatType, np.atleast_2d(proba).astype(np.float64))
    except Exception as e:
        raise RuntimeError(
            f"xgboost_predict_proba: Prediction failed with X shape {X_np.shape} - {e}"
        ) from e


@platform_function(
    name="xgboost_train_quantile",
    inputs=[MatrixType(FloatType), VectorType(FloatType), XGBoostQuantileConfigType],
    output=XGBoostModelBlobType,
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
        ``XGBoostModelBlobType`` (``EastVariant``) tagged ``xgboost_quantile``:
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

    X_np = X.to_numpy()
    y_np = y.to_numpy()

    if X_np.shape[0] != y_np.shape[0]:
        raise RuntimeError(
            f"xgboost_train_quantile: X has {X_np.shape[0]} samples "
            f"but y has {y_np.shape[0]} samples"
        )

    n_features = X_np.shape[1]

    quantiles = config["quantiles"].to_numpy(dtype=np.float64).tolist()

    # Validate quantiles
    for q in quantiles:
        if not 0 < q < 1:
            raise RuntimeError(
                f"xgboost_train_quantile: Quantiles must be in (0, 1), got {q}"
            )

    # Extract sample weights if provided
    sample_weight_opt = config["sample_weight"].unwrap_or(None)
    sample_weight_np = None
    if sample_weight_opt is not None:
        sample_weight_np = sample_weight_opt.to_numpy()
        if sample_weight_np.shape[0] != X_np.shape[0]:
            raise RuntimeError(
                f"xgboost_train_quantile: sample_weight has {sample_weight_np.shape[0]} "
                f"elements but X has {X_np.shape[0]} samples"
            )

    cat_indices, cat_n_list = categorical_config(config)
    X_train, cat_indices, enable_categorical = prepare_categorical(
        X_np, cat_indices, "xgboost_train_quantile", categorical_n=cat_n_list
    )

    try:
        random_state = config["random_state"].unwrap_or(None)
        if random_state is not None:
            random_state = int(random_state)

        n_jobs = int(config["n_jobs"].unwrap_or(-1))

        # Base parameters for all quantile models
        base_params = {
            "n_estimators": int(config["n_estimators"].unwrap_or(100)),
            "max_depth": int(config["max_depth"].unwrap_or(6)),
            "learning_rate": float(config["learning_rate"].unwrap_or(0.3)),
            "min_child_weight": int(config["min_child_weight"].unwrap_or(1)),
            "subsample": float(config["subsample"].unwrap_or(1.0)),
            "colsample_bytree": float(config["colsample_bytree"].unwrap_or(1.0)),
            "reg_alpha": float(config["reg_alpha"].unwrap_or(0.0)),
            "reg_lambda": float(config["reg_lambda"].unwrap_or(1.0)),
            "gamma": float(config["gamma"].unwrap_or(0.0)),
            "random_state": random_state,
            "n_jobs": n_jobs,
            "verbosity": 0,
            "enable_categorical": enable_categorical,
            "max_cat_to_onehot": int(config["max_cat_to_onehot"].unwrap_or(4)),
            "max_cat_threshold": int(config["max_cat_threshold"].unwrap_or(64)),
        }

        # Train one model per quantile
        models = {}
        # Suppress XGBoost warnings during training
        with quiet_warnings():
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

    model_data = serialize(models)

    # The encoding prediction must replay
    cat_features_blob, cat_n_blob = categorical_options(cat_indices, cat_n_list)

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
    inputs=[XGBoostModelBlobType, MatrixType(FloatType)],
    output=XGBoostQuantilePredictResultType,
)
def xgboost_predict_quantile_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastStruct:
    """Predict all quantile levels with a trained XGBoost quantile model.

    Args:
        model_blob: ``XGBoostModelBlobType`` (``EastVariant``) tagged
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
    payload = expect_case(model_blob, "xgboost_quantile", "xgboost_predict_quantile")

    X_np = X.to_numpy()

    cat_indices, cat_n_list = categorical_config(payload)
    X_pred = apply_categorical(X_np, cat_indices, "xgboost_predict_quantile", categorical_n=cat_n_list)

    n_samples = X_np.shape[0]

    try:
        # Deserialize models dict
        models = deserialize(payload["data"])

        # Use the model dict keys directly (they are the original quantile values)
        # This avoids float precision issues from serialization/deserialization
        quantiles_list = sorted(models.keys())
        n_quantiles = len(quantiles_list)

        # Predict each quantile
        predictions = np.zeros((n_samples, n_quantiles))
        # Suppress warnings during prediction
        with quiet_warnings():
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
