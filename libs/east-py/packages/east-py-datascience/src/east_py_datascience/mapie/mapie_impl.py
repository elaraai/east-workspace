#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""MAPIE conformal prediction implementation (MAPIE 1.2.0 API).

Provides prediction intervals with coverage guarantees using
conformal prediction methods.
"""

from typing import Any

import numpy as np
from east import variant
from east.runtime.platform import platform_function, platform_functions
from east.types.types import (
    ArrayType,
    BlobType,
    FloatType,
    IntegerType,
    MatrixType,
    NullType,
    OptionType,
    StructType,
    VariantType,
    VectorType,
)
from east.types.values import EastArray, EastBlob, EastMatrix, EastStruct, EastVariant, EastVector

from east_py_datascience._categorical import (
    apply_categorical,
    categorical_config,
    categorical_options,
    prepare_categorical,
)
from east_py_datascience._common import (
    deserialize,
    extra_guard,
    option_tag,
    quiet_warnings,
    serialize,
)
from east_py_datascience.types import MAPIEBaseModelDataType

# ============================================================================
# Type Definitions for MAPIE
# ============================================================================

# MAPIE regressor model blob type (MAPIE 1.2.0)
MAPIERegressorBlobType = VariantType(
    [
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
    ]
)
"""Fitted MAPIE conformal regressor blob.

Cases: ``mapie_split`` (split-conformal), ``mapie_cross``
(cross-conformal), ``mapie_cqr`` (conformalized quantile regression) -
each carrying ``{data: MAPIEBaseModelDataType, n_features: Integer,
confidence_level: Float}``.
"""

# MAPIE classifier model blob type (single-case variant for consistency)
MAPIEClassifierBlobType = VariantType(
    [
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
"""Fitted MAPIE split-conformal classifier blob.

Single case ``mapie_classifier``: ``data`` (``MAPIEBaseModelDataType``),
``n_features``, ``n_classes`` (internal 0-indexed count), ``classes``
(``Vector<Integer>`` - original label values for remapping predictions
back), ``confidence_level``.
"""

# Interval result type
IntervalResultType = StructType(
    [
        ("lower", VectorType(FloatType)),
        ("pred", VectorType(FloatType)),
        ("upper", VectorType(FloatType)),
    ]
)
"""Conformal prediction interval result for regression.

Fields: ``lower``, ``pred``, ``upper`` (all ``Vector<Float>``, one entry
per input row) at the confidence level the model was calibrated with.
"""

# Prediction set result type
PredictionSetResultType = StructType(
    [
        ("pred", VectorType(IntegerType)),
        ("sets", ArrayType(ArrayType(IntegerType))),
        ("probabilities", MatrixType(FloatType)),
        ("set_sizes", VectorType(IntegerType)),
    ]
)
"""Conformal prediction set result for classification.

Fields: ``pred`` (``Vector<Integer>`` argmax label per row, original label
space), ``sets`` (``Array<Array<Integer>>`` conformal prediction set per
row in original label space), ``probabilities``
(``Matrix<Float>`` base-classifier ``predict_proba`` output,
shape ``n_rows × n_classes``), ``set_sizes``
(``Vector<Integer>`` number of classes in each prediction set).
"""

# Uncertainty predictor type (for SHAP integration)
UncertaintyPredictorType = VariantType(
    [
        (
            "mapie_interval_width",
            StructType([("data", BlobType), ("n_features", IntegerType)]),
        ),
        (
            "mapie_set_size",
            StructType([("data", BlobType), ("n_features", IntegerType)]),
        ),
    ]
)
"""Lightweight uncertainty predictor blob for SHAP integration.

Cases: ``mapie_interval_width`` (wraps a MAPIE regressor; ``predict``
returns ``upper - lower`` interval width), ``mapie_set_size`` (wraps a
MAPIE classifier; ``predict`` returns conformal set size). Both carry
``{data: Blob, n_features: Integer}``.
"""

# Config types - use full XGBoost/LightGBM config types for complete parameter support
XGBoostConfigType = StructType(
    [
        ("n_estimators", OptionType(IntegerType)),
        ("max_depth", OptionType(IntegerType)),
        ("learning_rate", OptionType(FloatType)),
        ("min_child_weight", OptionType(IntegerType)),
        ("subsample", OptionType(FloatType)),
        ("colsample_bytree", OptionType(FloatType)),
        ("reg_alpha", OptionType(FloatType)),
        ("reg_lambda", OptionType(FloatType)),
        ("gamma", OptionType(FloatType)),
        ("random_state", OptionType(IntegerType)),
        ("n_jobs", OptionType(IntegerType)),
        ("sample_weight", OptionType(VectorType(FloatType))),
        ("categorical_features", OptionType(VectorType(IntegerType))),
        ("categorical_n", OptionType(VectorType(IntegerType))),
        ("max_cat_to_onehot", OptionType(IntegerType)),
        ("max_cat_threshold", OptionType(IntegerType)),
        ("scale_pos_weight", OptionType(FloatType)),
    ]
)
"""XGBoost hyperparameter configuration for MAPIE base models.

Fields: ``n_estimators`` (default 100), ``max_depth`` (default 6),
``learning_rate`` (default 0.3), ``min_child_weight`` (default 1),
``subsample`` (default 1.0), ``colsample_bytree`` (default 1.0),
``reg_alpha`` (default 0), ``reg_lambda`` (default 1), ``gamma``
(default 0), ``random_state``, ``n_jobs`` (default -1),
``sample_weight`` (per-row training weights), ``categorical_features``
(0-based column indices for native categorical splits),
``categorical_n`` (total category count per categorical feature, one
entry per entry in ``categorical_features``),
``max_cat_to_onehot``, ``max_cat_threshold``.
"""

LightGBMConfigType = StructType(
    [
        ("n_estimators", OptionType(IntegerType)),
        ("max_depth", OptionType(IntegerType)),
        ("learning_rate", OptionType(FloatType)),
        ("num_leaves", OptionType(IntegerType)),
        ("min_child_samples", OptionType(IntegerType)),
        ("subsample", OptionType(FloatType)),
        ("colsample_bytree", OptionType(FloatType)),
        ("reg_alpha", OptionType(FloatType)),
        ("reg_lambda", OptionType(FloatType)),
        ("random_state", OptionType(IntegerType)),
        ("n_jobs", OptionType(IntegerType)),
    ]
)
"""LightGBM hyperparameter configuration for MAPIE base models.

Fields: ``n_estimators`` (default 100), ``max_depth`` (default -1,
unlimited), ``learning_rate`` (default 0.1), ``num_leaves`` (default 31),
``min_child_samples`` (default 20), ``subsample`` (default 1.0),
``colsample_bytree`` (default 1.0), ``reg_alpha`` (default 0),
``reg_lambda`` (default 0), ``random_state``, ``n_jobs`` (default -1).
"""

BaseModelType = VariantType(
    [
        ("xgboost", XGBoostConfigType),
        ("lightgbm", LightGBMConfigType),
    ]
)
"""Base regressor choice for ``MAPIEConfigType``.

Cases: ``xgboost`` (``XGBoostConfigType``), ``lightgbm``
(``LightGBMConfigType``).
"""

ConformalMethodType = VariantType(
    [
        ("split", NullType),
        ("cross", NullType),
    ]
)
"""Conformal method for ``MAPIEConfigType``.

Cases: ``split`` (split-conformal - fit on train, calibrate on calib),
``cross`` (cross-conformal - combines train+calib with cross-validation).
"""

MAPIEConfigType = StructType(
    [
        ("base_model", BaseModelType),
        ("method", OptionType(ConformalMethodType)),
        ("confidence_level", OptionType(FloatType)),
        ("cv_folds", OptionType(IntegerType)),
        ("random_state", OptionType(IntegerType)),
        ("conformity_eps", OptionType(FloatType)),
    ]
)
"""Configuration for training a MAPIE conformal regressor.

Fields: ``base_model`` (``BaseModelType``, required - ``xgboost`` or
``lightgbm``), ``method`` (``ConformalMethodType``, default ``split``),
``confidence_level`` (target coverage probability, default 0.9),
``cv_folds`` (folds for ``cross`` method, default 5), ``random_state``,
``conformity_eps`` (conformity-score consistency-check tolerance,
default 1e-04).
"""

MAPIECQRConfigType = StructType(
    [
        ("xgboost_config", XGBoostConfigType),
        ("confidence_level", OptionType(FloatType)),
        ("random_state", OptionType(IntegerType)),
    ]
)
"""Configuration for training a MAPIE conformalized quantile regressor.

Fields: ``xgboost_config`` (``XGBoostConfigType``, required - parameters
mapped onto ``HistGradientBoostingRegressor``: ``n_estimators`` →
``max_iter`` (default 100), ``max_depth`` (default 6), ``learning_rate``
(default 0.1), ``reg_lambda`` → ``l2_regularization`` (default 0)),
``confidence_level`` (default 0.9), ``random_state``.
"""

ClassificationMethodType = VariantType(
    [
        ("lac", NullType),
        ("aps", NullType),
    ]
)
"""Conformity score method for ``MAPIEClassifierConfigType``.

Cases: ``lac`` (Least Ambiguous Classifier - default, tighter sets),
``aps`` (Adaptive Prediction Sets - better coverage on hard examples).
"""

BaseClassifierType = VariantType(
    [
        ("xgboost", XGBoostConfigType),
        ("lightgbm", LightGBMConfigType),
    ]
)
"""Base classifier choice for ``MAPIEClassifierConfigType``.

Cases: ``xgboost`` (``XGBoostConfigType``), ``lightgbm``
(``LightGBMConfigType``).
"""

MAPIEClassifierConfigType = StructType(
    [
        ("base_model", BaseClassifierType),
        ("method", OptionType(ClassificationMethodType)),
        ("confidence_level", OptionType(FloatType)),
        ("random_state", OptionType(IntegerType)),
    ]
)
"""Configuration for training a MAPIE split-conformal classifier.

Fields: ``base_model`` (``BaseClassifierType``, required - ``xgboost``
or ``lightgbm``), ``method`` (``ClassificationMethodType``, default
``lac``), ``confidence_level`` (target coverage probability, default 0.9),
``random_state``.
"""


# ============================================================================
# Base Model Creation
# ============================================================================


def _create_base_estimator(base_model_variant: EastVariant, random_state, classifier: bool):
    """The sklearn-compatible base estimator a ``BaseModelType`` / ``BaseClassifierType`` names.

    Returns:
        ``(estimator, cat_indices, categorical_n)``: the categorical indices
        and counts are the XGBoost config's (LightGBM takes none here).
    """
    model_type = base_model_variant.type
    config = base_model_variant.value

    if model_type == "xgboost":
        from xgboost import XGBClassifier, XGBRegressor

        cat_indices, categorical_n = categorical_config(config)
        estimator_cls = XGBClassifier if classifier else XGBRegressor
        estimator = estimator_cls(
            n_estimators=int(config["n_estimators"].unwrap_or(100)),
            max_depth=int(config["max_depth"].unwrap_or(6)),
            learning_rate=float(config["learning_rate"].unwrap_or(0.3)),
            min_child_weight=int(config["min_child_weight"].unwrap_or(1)),
            subsample=float(config["subsample"].unwrap_or(1.0)),
            colsample_bytree=float(config["colsample_bytree"].unwrap_or(1.0)),
            reg_alpha=float(config["reg_alpha"].unwrap_or(0)),
            reg_lambda=float(config["reg_lambda"].unwrap_or(1)),
            gamma=float(config["gamma"].unwrap_or(0)),
            random_state=random_state,
            n_jobs=int(config["n_jobs"].unwrap_or(-1)),
            verbosity=0,
            enable_categorical=cat_indices is not None,
            max_cat_to_onehot=int(config["max_cat_to_onehot"].unwrap_or(4)),
            max_cat_threshold=int(config["max_cat_threshold"].unwrap_or(64)),
        )
        return estimator, cat_indices, categorical_n

    if model_type == "lightgbm":
        from lightgbm import LGBMClassifier, LGBMRegressor

        estimator_cls = LGBMClassifier if classifier else LGBMRegressor
        estimator = estimator_cls(
            n_estimators=int(config["n_estimators"].unwrap_or(100)),
            max_depth=int(config["max_depth"].unwrap_or(-1)),
            learning_rate=float(config["learning_rate"].unwrap_or(0.1)),
            num_leaves=int(config["num_leaves"].unwrap_or(31)),
            min_child_samples=int(config["min_child_samples"].unwrap_or(20)),
            subsample=float(config["subsample"].unwrap_or(1.0)),
            colsample_bytree=float(config["colsample_bytree"].unwrap_or(1.0)),
            reg_alpha=float(config["reg_alpha"].unwrap_or(0)),
            reg_lambda=float(config["reg_lambda"].unwrap_or(0)),
            random_state=random_state,
            n_jobs=int(config["n_jobs"].unwrap_or(-1)),
            verbose=-1,
        )
        return estimator, None, None

    raise ValueError(f"Unknown base model type: {model_type}")


def _base_model_data(
    base_model_type: str,
    model_bytes: EastBlob,
    n_features: int,
    cat_indices: list[int] | None,
    categorical_n: list[int] | None,
    n_classes: int | None = None,
) -> EastVariant:
    """The ``MAPIEBaseModelDataType`` a blob stores: the serialised MAPIE wrapper inside the
    base model's own blob shape, so the categorical encoding travels with it.

    Fields follow the ``XGBoostModelBlobType`` / ``LightGBMModelBlobType`` case
    order; the platform validates the whole blob against the declared output
    type on return.
    """
    fields: dict[str, Any] = {"data": model_bytes, "n_features": n_features}
    if n_classes is not None:
        fields["n_classes"] = n_classes
    if base_model_type == "xgboost":
        fields["categorical_features"], fields["categorical_n"] = categorical_options(
            cat_indices, categorical_n
        )
    kind = "classifier" if n_classes is not None else "regressor"
    return EastVariant(base_model_type, EastVariant(f"{base_model_type}_{kind}", EastStruct(fields)))


def extract_base_model_data(data_variant: EastVariant) -> tuple[EastBlob, list[int] | None, list[int] | None]:
    """The serialised MAPIE wrapper and categorical encoding inside a ``MAPIEBaseModelDataType``.

    Returns:
        ``(model_bytes, cat_indices, categorical_n)``; the categorical entries
        are ``None`` for a LightGBM or histogram (CQR) base model.
    """
    if data_variant.type == "xgboost":
        inner_struct = data_variant.value.value  # the xgboost_* blob struct
        cat_indices, categorical_n = categorical_config(inner_struct)
        return inner_struct["data"], cat_indices, categorical_n
    if data_variant.type == "lightgbm":
        return data_variant.value.value["data"], None, None
    return data_variant.value, None, None  # histogram: a bare blob


_check_mapie_support = extra_guard("mapie", "mapie", "MAPIE")


# ============================================================================
# Regression Implementations (MAPIE 1.2.0 API)
# ============================================================================


@platform_function(
    name="mapie_train_conformal_regressor",
    inputs=[MatrixType(FloatType), VectorType(FloatType), MatrixType(FloatType), VectorType(FloatType), MAPIEConfigType],
    output=MAPIERegressorBlobType,
)
def mapie_train_conformal_regressor_impl(
    X_train: EastMatrix,
    y_train: EastVector,
    X_calib: EastMatrix,
    y_calib: EastVector,
    config: EastStruct,
) -> EastVariant:
    """Train a MAPIE conformal regressor with split or cross-conformal method.

    Fits the base model on the training set, then calibrates prediction
    intervals on the calibration set (split), or combines both sets and
    cross-fits (cross). Uses the MAPIE 1.2.0 API
    (``SplitConformalRegressor`` / ``CrossConformalRegressor``).

    Args:
        X_train: ``Matrix<Float>`` (``EastMatrix``) - training features,
            shape ``(n_train, n_features)``.
        y_train: ``Vector<Float>`` (``EastVector``) - training targets,
            length ``n_train``.
        X_calib: ``Matrix<Float>`` (``EastMatrix``) - calibration features,
            shape ``(n_calib, n_features)``; must have the same number of
            columns as ``X_train``.
        y_calib: ``Vector<Float>`` (``EastVector``) - calibration targets,
            length ``n_calib``.
        config: ``MAPIEConfigType`` (``EastStruct``) with fields:

            - ``base_model`` (``BaseModelType``, required): ``xgboost``
              ``XGBoostConfigType`` with ``{n_estimators (100), max_depth (6),
              learning_rate (0.3), min_child_weight (1), subsample (1.0),
              colsample_bytree (1.0), reg_alpha (0), reg_lambda (1),
              gamma (0), random_state, n_jobs (-1), sample_weight,
              categorical_features, categorical_n, max_cat_to_onehot,
              max_cat_threshold}``; or ``lightgbm`` ``LightGBMConfigType``
              with ``{n_estimators (100), max_depth (-1), learning_rate (0.1),
              num_leaves (31), min_child_samples (20), subsample (1.0),
              colsample_bytree (1.0), reg_alpha (0), reg_lambda (0),
              random_state, n_jobs (-1)}``.
            - ``method`` (``Option<ConformalMethodType>``): ``split`` (default)
              or ``cross`` (uses ``cv_folds``).
            - ``confidence_level`` (``Option<Float>``): target coverage
              probability, default 0.9.
            - ``cv_folds`` (``Option<Integer>``): cross-validation folds for
              ``cross`` method, default 5.
            - ``random_state`` (``Option<Integer>``): seed forwarded to the
              base model.

    Returns:
        ``MAPIERegressorBlobType`` (``EastVariant``): tagged ``mapie_split``
        or ``mapie_cross`` with ``{data: MAPIEBaseModelDataType,
        n_features: Integer, confidence_level: Float}``, where
        ``MAPIEBaseModelDataType`` is tagged ``xgboost``
        (``XGBoostModelBlobType``) or ``lightgbm``
        (``LightGBMModelBlobType``).  Use with
        :func:`mapie_predict_interval_impl`.

    Raises:
        NotImplementedError: the ``mapie`` extra is not installed.
        RuntimeError: shape mismatch between X/y arrays, categorical index
            out of bounds or non-integer values, or training failure.
    """
    _check_mapie_support()
    from mapie.conformity_scores import AbsoluteConformityScore
    from mapie.regression import CrossConformalRegressor, SplitConformalRegressor

    # Convert inputs
    X_train_np = X_train.to_numpy()
    y_train_np = y_train.to_numpy()
    X_calib_np = X_calib.to_numpy()
    y_calib_np = y_calib.to_numpy()

    # Validate shapes
    if X_train_np.shape[0] != y_train_np.shape[0]:
        raise RuntimeError(
            f"mapie_train_conformal_regressor: X_train has {X_train_np.shape[0]} samples "
            f"but y_train has {y_train_np.shape[0]} samples"
        )
    if X_calib_np.shape[0] != y_calib_np.shape[0]:
        raise RuntimeError(
            f"mapie_train_conformal_regressor: X_calib has {X_calib_np.shape[0]} samples "
            f"but y_calib has {y_calib_np.shape[0]} samples"
        )
    if X_train_np.shape[1] != X_calib_np.shape[1]:
        raise RuntimeError(
            f"mapie_train_conformal_regressor: X_train has {X_train_np.shape[1]} features "
            f"but X_calib has {X_calib_np.shape[1]} features"
        )

    # Extract config
    base_model_config = config["base_model"]
    method = option_tag(config["method"], "split")
    confidence_level = float(config["confidence_level"].unwrap_or(0.9))
    cv_folds = int(config["cv_folds"].unwrap_or(5))
    random_state = config["random_state"].unwrap_or(None)
    if random_state is not None:
        random_state = int(random_state)
    conformity_eps = float(config["conformity_eps"].unwrap_or(1e-04))

    base_model, categorical_features, categorical_n = _create_base_estimator(
        base_model_config, random_state, classifier=False
    )
    base_model_type = base_model_config.type

    # sample_weight is an XGBoost-config field; the LightGBM config has none
    sample_weight_raw = (
        base_model_config.value["sample_weight"].unwrap_or(None) if base_model_type == "xgboost" else None
    )
    fit_params = {}
    if sample_weight_raw is not None:
        fit_params["sample_weight"] = sample_weight_raw.to_numpy()

    # Prepare categorical features for XGBoost (validates and converts to category dtype)
    X_train_np, categorical_features, _ = prepare_categorical(
        X_train_np, categorical_features, "mapie_train_conformal_regressor",
        categorical_n=categorical_n,
    )
    X_calib_np = apply_categorical(
        X_calib_np, categorical_features, "mapie_train_conformal_regressor",
        categorical_n=categorical_n,
    )

    try:
        with quiet_warnings():

            if method == "split":
                # Split conformal: train base model, then conformalize
                base_model.fit(X_train_np, y_train_np, **fit_params)
                # Create conformity score with relaxed eps for numerical precision
                conformity_score = AbsoluteConformityScore(sym=True)
                conformity_score.eps = conformity_eps  # Relax consistency check tolerance
                mapie = SplitConformalRegressor(
                    estimator=base_model,
                    confidence_level=confidence_level,
                    conformity_score=conformity_score,
                    prefit=True,
                )
                mapie.conformalize(X_calib_np, y_calib_np)
                variant_type = "mapie_split"
            elif method == "cross":
                # Cross conformal: combine train and calib, use cross-validation
                if categorical_features is not None:
                    import pandas as pd
                    X_all = pd.concat([X_train_np, X_calib_np], ignore_index=True)
                else:
                    X_all = np.vstack([X_train_np, X_calib_np])
                y_all = np.hstack([y_train_np, y_calib_np])
                mapie = CrossConformalRegressor(
                    estimator=base_model,
                    confidence_level=confidence_level,
                    cv=cv_folds,
                )
                # For cross conformal, pass fit_params through fit_conformalize
                mapie.fit_conformalize(X_all, y_all, fit_params=fit_params if fit_params else None)
                variant_type = "mapie_cross"
            else:
                raise RuntimeError(
                    f"mapie_train_conformal_regressor: Unknown method '{method}'"
                )

    except Exception as e:
        raise RuntimeError(
            f"mapie_train_conformal_regressor: Training failed - {e}"
        ) from e

    # Serialize the MAPIE wrapper; the categorical encoding rides in the blob struct
    n_features = X_train_np.shape[1]
    data_variant = _base_model_data(
        base_model_type, serialize({"mapie": mapie}), n_features, categorical_features, categorical_n
    )

    return EastVariant(
        variant_type,
        EastStruct(
            {
                "data": data_variant,
                "n_features": n_features,
                "confidence_level": confidence_level,
            }
        ),
    )


@platform_function(
    name="mapie_train_cqr",
    inputs=[MatrixType(FloatType), VectorType(FloatType), MatrixType(FloatType), VectorType(FloatType), MAPIECQRConfigType],
    output=MAPIERegressorBlobType,
)
def mapie_train_cqr_impl(
    X_train: EastMatrix,
    y_train: EastVector,
    X_calib: EastMatrix,
    y_calib: EastVector,
    config: EastStruct,
) -> EastVariant:
    """Train a MAPIE Conformalized Quantile Regression model.

    Uses ``sklearn.ensemble.HistGradientBoostingRegressor`` with quantile
    loss, which natively supports MAPIE's ``ConformalizedQuantileRegressor``.
    Training and calibration sets are combined internally.

    Args:
        X_train: ``Matrix<Float>`` (``EastMatrix``) - training features.
        y_train: ``Vector<Float>`` (``EastVector``) - training targets.
        X_calib: ``Matrix<Float>`` (``EastMatrix``) - calibration features.
        y_calib: ``Vector<Float>`` (``EastVector``) - calibration targets.
        config: ``MAPIECQRConfigType`` (``EastStruct``) with fields:

            - ``xgboost_config`` (``XGBoostConfigType``, required): parameters
              mapped to ``HistGradientBoostingRegressor`` - ``n_estimators``
              becomes ``max_iter`` (default 100), ``max_depth`` (default 6),
              ``learning_rate`` (default 0.1), ``reg_lambda`` becomes
              ``l2_regularization`` (default 0).
            - ``confidence_level`` (``Option<Float>``): target coverage
              probability, default 0.9.
            - ``random_state`` (``Option<Integer>``): seed.

    Returns:
        ``MAPIERegressorBlobType`` (``EastVariant``) tagged ``mapie_cqr``
        with ``{data: MAPIEBaseModelDataType (histogram), n_features:
        Integer, confidence_level: Float}``.  Use with
        :func:`mapie_predict_interval_impl`.

    Raises:
        NotImplementedError: the ``mapie`` extra is not installed.
        RuntimeError: shape mismatch between X/y arrays or training failure.
    """
    _check_mapie_support()
    from mapie.regression import ConformalizedQuantileRegressor
    from sklearn.ensemble import HistGradientBoostingRegressor

    # Convert inputs
    X_train_np = X_train.to_numpy()
    y_train_np = y_train.to_numpy()
    X_calib_np = X_calib.to_numpy()
    y_calib_np = y_calib.to_numpy()

    # Validate shapes
    if X_train_np.shape[0] != y_train_np.shape[0]:
        raise RuntimeError(
            f"mapie_train_cqr: X_train has {X_train_np.shape[0]} samples "
            f"but y_train has {y_train_np.shape[0]} samples"
        )
    if X_calib_np.shape[0] != y_calib_np.shape[0]:
        raise RuntimeError(
            f"mapie_train_cqr: X_calib has {X_calib_np.shape[0]} samples "
            f"but y_calib has {y_calib_np.shape[0]} samples"
        )

    # Extract config - use xgboost_config params to configure HistGradientBoosting
    xgb_config = config["xgboost_config"]
    confidence_level = float(config["confidence_level"].unwrap_or(0.9))
    random_state = config["random_state"].unwrap_or(None)
    if random_state is not None:
        random_state = int(random_state)

    # Create HistGradientBoostingRegressor with quantile loss (native CQR support)
    # Map XGBoost-like params to HistGradientBoosting params
    hgb_params = {
        "loss": "quantile",  # Required for CQR
        "max_iter": int(xgb_config["n_estimators"].unwrap_or(100)),
        "max_depth": int(xgb_config["max_depth"].unwrap_or(6)),
        "learning_rate": float(xgb_config["learning_rate"].unwrap_or(0.1)),
        "l2_regularization": float(xgb_config["reg_lambda"].unwrap_or(0)),
        "random_state": random_state,
    }

    try:
        with quiet_warnings():

            # Combine train and calib for CQR (it handles internal splitting)
            X_all = np.vstack([X_train_np, X_calib_np])
            y_all = np.hstack([y_train_np, y_calib_np])

            # CQR with HistGradientBoostingRegressor - natively supported by MAPIE
            base_model = HistGradientBoostingRegressor(**hgb_params)
            mapie_cqr = ConformalizedQuantileRegressor(
                estimator=base_model,
                confidence_level=confidence_level,
                prefit=False,
            )
            mapie_cqr.fit(X_all, y_all)
            mapie_cqr.conformalize(X_all, y_all)

    except Exception as e:
        raise RuntimeError(f"mapie_train_cqr: Training failed - {e}") from e

    return EastVariant(
        "mapie_cqr",
        EastStruct(
            {
                "data": variant("histogram", serialize({"mapie": mapie_cqr}), MAPIEBaseModelDataType),
                "n_features": X_train_np.shape[1],
                "confidence_level": confidence_level,
            }
        ),
    )


@platform_function(
    name="mapie_predict_interval",
    inputs=[MAPIERegressorBlobType, MatrixType(FloatType)],
    output=IntervalResultType,
)
def mapie_predict_interval_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastStruct:
    """Predict regression targets with conformal prediction intervals.

    Returns point predictions and lower/upper bounds at the confidence level
    the model was calibrated with.

    Args:
        model_blob: ``MAPIERegressorBlobType`` (``EastVariant``) - a blob
            produced by :func:`mapie_train_conformal_regressor_impl` or
            :func:`mapie_train_cqr_impl` (tagged ``mapie_split``,
            ``mapie_cross``, or ``mapie_cqr``).
        X: ``Matrix<Float>`` (``EastMatrix``) - features to predict, must
            have the same number of columns the model was trained with.

    Returns:
        ``IntervalResultType`` (``EastStruct``): ``lower``, ``pred``,
        ``upper`` (all ``Vector<Float>``), one entry per input row.

    Raises:
        NotImplementedError: the ``mapie`` extra is not installed.
        RuntimeError: feature-count mismatch or prediction failure.
    """
    _check_mapie_support()
    model_data = model_blob.value
    model_bytes, categorical_features, categorical_n = extract_base_model_data(model_data["data"])
    model = deserialize(model_bytes)["mapie"]
    n_features = model_data["n_features"]

    X_np = X.to_numpy()
    if X_np.shape[1] != n_features:
        raise RuntimeError(
            f"mapie_predict_interval: Model trained with {n_features} features "
            f"but X has {X_np.shape[1]} features"
        )

    # Apply categorical feature conversion if model was trained with them
    X_np = apply_categorical(
        X_np, categorical_features, "mapie_predict_interval",
        categorical_n=categorical_n,
    )

    try:
        with quiet_warnings():

            # MAPIE 1.2.0: predict_interval() returns (predictions, intervals)
            # intervals shape: (n_samples, 2, n_confidence_levels)
            y_pred, y_intervals = model.predict_interval(X_np)

            # Extract lower and upper bounds (first confidence level)
            lower = y_intervals[:, 0, 0]
            upper = y_intervals[:, 1, 0]

    except Exception as e:
        raise RuntimeError(f"mapie_predict_interval: Prediction failed - {e}") from e

    return EastStruct(
        {
            "lower": EastVector(FloatType, lower.ravel().astype(np.float64)),
            "pred": EastVector(FloatType, y_pred.ravel().astype(np.float64)),
            "upper": EastVector(FloatType, upper.ravel().astype(np.float64)),
        }
    )


# ============================================================================
# Classification Implementations (MAPIE 1.2.0 API)
# ============================================================================


@platform_function(
    name="mapie_train_conformal_classifier",
    inputs=[
        MatrixType(FloatType),
        VectorType(IntegerType),
        MatrixType(FloatType),
        VectorType(IntegerType),
        MAPIEClassifierConfigType,
    ],
    output=MAPIEClassifierBlobType,
)
def mapie_train_conformal_classifier_impl(
    X_train: EastMatrix,
    y_train: EastVector,
    X_calib: EastMatrix,
    y_calib: EastVector,
    config: EastStruct,
) -> EastVariant:
    """Train a MAPIE split-conformal classifier with prediction sets.

    Fits the base classifier on the training set, then calibrates prediction
    sets on the calibration set using ``SplitConformalClassifier``.  Class
    labels are automatically remapped to a contiguous 0-indexed range
    internally and remapped back in :func:`mapie_predict_set_impl`.

    Args:
        X_train: ``Matrix<Float>`` (``EastMatrix``) - training features,
            shape ``(n_train, n_features)``.
        y_train: ``Vector<Integer>`` (``EastVector``) - integer class labels,
            length ``n_train``.
        X_calib: ``Matrix<Float>`` (``EastMatrix``) - calibration features;
            must have the same number of columns as ``X_train``.
        y_calib: ``Vector<Integer>`` (``EastVector``) - calibration class
            labels.
        config: ``MAPIEClassifierConfigType`` (``EastStruct``) with fields:

            - ``base_model`` (``BaseClassifierType``, required): ``xgboost``
              ``XGBoostConfigType`` or ``lightgbm`` ``LightGBMConfigType``
              (see :func:`mapie_train_conformal_regressor_impl` for field
              details; ``sample_weight`` supported for XGBoost).
            - ``method`` (``Option<ClassificationMethodType>``): ``lac``
              (Least Ambiguous Classifier, default) or ``aps`` (Adaptive
              Prediction Sets).
            - ``confidence_level`` (``Option<Float>``): target coverage,
              default 0.9.
            - ``random_state`` (``Option<Integer>``): seed.

    Returns:
        ``MAPIEClassifierBlobType`` (``EastVariant``) tagged
        ``mapie_classifier`` with ``{data: MAPIEBaseModelDataType,
        n_features: Integer, n_classes: Integer,
        classes: Vector<Integer> (original labels),
        confidence_level: Float}``.  Use with
        :func:`mapie_predict_set_impl`.

    Raises:
        NotImplementedError: the ``mapie`` extra is not installed.
        RuntimeError: shape mismatch, categorical index out of bounds or
            non-integer values, or training failure.
    """
    _check_mapie_support()
    from mapie.classification import SplitConformalClassifier

    # Convert inputs
    X_train_np = X_train.to_numpy()
    y_train_np = y_train.to_numpy()
    X_calib_np = X_calib.to_numpy()
    y_calib_np = y_calib.to_numpy()

    # Validate shapes
    if X_train_np.shape[0] != y_train_np.shape[0]:
        raise RuntimeError(
            f"mapie_train_conformal_classifier: X_train has {X_train_np.shape[0]} samples "
            f"but y_train has {y_train_np.shape[0]} samples"
        )
    if X_calib_np.shape[0] != y_calib_np.shape[0]:
        raise RuntimeError(
            f"mapie_train_conformal_classifier: X_calib has {X_calib_np.shape[0]} samples "
            f"but y_calib has {y_calib_np.shape[0]} samples"
        )
    if X_train_np.shape[1] != X_calib_np.shape[1]:
        raise RuntimeError(
            f"mapie_train_conformal_classifier: X_train has {X_train_np.shape[1]} features "
            f"but X_calib has {X_calib_np.shape[1]} features"
        )

    # Extract config
    base_model_config = config["base_model"]
    conformity_score = option_tag(config["method"], "lac")
    confidence_level = float(config["confidence_level"].unwrap_or(0.9))
    random_state = config["random_state"].unwrap_or(None)
    if random_state is not None:
        random_state = int(random_state)

    base_clf, categorical_features, categorical_n = _create_base_estimator(
        base_model_config, random_state, classifier=True
    )
    base_model_type = base_model_config.type

    # XGBoost needs contiguous 0-based labels over the union of both sets; the
    # original labels are stored in the blob so predictions map back
    original_classes, inverse = np.unique(
        np.concatenate([y_train_np, y_calib_np]), return_inverse=True
    )
    n_classes_internal = len(original_classes)
    y_train_np = inverse[: len(y_train_np)]
    y_calib_np = inverse[len(y_train_np) :]

    # sample_weight is an XGBoost-config field; the LightGBM config has none
    sample_weight_raw = (
        base_model_config.value["sample_weight"].unwrap_or(None) if base_model_type == "xgboost" else None
    )
    fit_params = {}
    if sample_weight_raw is not None:
        fit_params["sample_weight"] = sample_weight_raw.to_numpy()

    # Prepare categorical features for XGBoost (validates and converts to category dtype)
    X_train_np, categorical_features, _ = prepare_categorical(
        X_train_np, categorical_features, "mapie_train_conformal_classifier",
        categorical_n=categorical_n,
    )
    X_calib_np = apply_categorical(
        X_calib_np, categorical_features, "mapie_train_conformal_classifier",
        categorical_n=categorical_n,
    )

    try:
        with quiet_warnings():

            # Train classifier on training set
            base_clf.fit(X_train_np, y_train_np, **fit_params)

            # Create SplitConformalClassifier with prefit estimator
            mapie_clf = SplitConformalClassifier(
                estimator=base_clf,
                confidence_level=confidence_level,
                conformity_score=conformity_score,
                prefit=True,
            )
            mapie_clf.conformalize(X_calib_np, y_calib_np)

    except Exception as e:
        raise RuntimeError(
            f"mapie_train_conformal_classifier: Training failed - {e}"
        ) from e

    # Serialize the MAPIE wrapper and the base classifier (for predict_proba);
    # the categorical encoding rides in the blob struct
    n_features = X_train_np.shape[1]
    data_variant = _base_model_data(
        base_model_type,
        serialize({"mapie": mapie_clf, "base_clf": base_clf}),
        n_features,
        categorical_features,
        categorical_n,
        n_classes=n_classes_internal,
    )

    # Return original class labels to caller (not internal 0..n-1)
    return EastVariant(
        "mapie_classifier",
        EastStruct(
            {
                "data": data_variant,
                "n_features": n_features,
                "n_classes": n_classes_internal,
                "classes": EastVector(IntegerType, original_classes.ravel().astype(np.int64)),
                "confidence_level": confidence_level,
            }
        ),
    )


@platform_function(
    name="mapie_predict_set",
    inputs=[MAPIEClassifierBlobType, MatrixType(FloatType)],
    output=PredictionSetResultType,
)
def mapie_predict_set_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastStruct:
    """Predict classification labels and conformal prediction sets.

    Returns point predictions, the prediction set per row (class indices
    meeting the coverage threshold), class probabilities from the base
    classifier, and per-row set sizes.

    Args:
        model_blob: ``MAPIEClassifierBlobType`` (``EastVariant``) - a blob
            produced by :func:`mapie_train_conformal_classifier_impl`
            (tagged ``mapie_classifier``).
        X: ``Matrix<Float>`` (``EastMatrix``) - features to predict; must
            have the same number of columns the model was trained with.

    Returns:
        ``PredictionSetResultType`` (``EastStruct``):

        - ``pred`` (``Vector<Integer>``): argmax class label per row
          (in original label space).
        - ``sets`` (``Array<Array<Integer>>``): per-row list of class labels
          included in the prediction set (original label space).
        - ``probabilities`` (``Matrix<Float>``): base-classifier
          ``predict_proba`` output, shape ``(n_rows, n_classes)``.
        - ``set_sizes`` (``Vector<Integer>``): number of classes in each
          prediction set.

    Raises:
        NotImplementedError: the ``mapie`` extra is not installed.
        RuntimeError: feature-count mismatch or prediction failure.
    """
    _check_mapie_support()
    model_data = model_blob.value
    model_bytes, categorical_features, categorical_n = extract_base_model_data(model_data["data"])
    combined_model = deserialize(model_bytes)
    mapie_model = combined_model["mapie"]
    base_clf = combined_model["base_clf"]
    # The original labels live in the blob struct, not the pickle
    original_classes = model_data["classes"].to_numpy()
    n_features = model_data["n_features"]

    X_np = X.to_numpy()
    if X_np.shape[1] != n_features:
        raise RuntimeError(
            f"mapie_predict_set: Model trained with {n_features} features "
            f"but X has {X_np.shape[1]} features"
        )

    # Apply categorical feature conversion if model was trained with them
    X_np = apply_categorical(
        X_np, categorical_features, "mapie_predict_set",
        categorical_n=categorical_n,
    )

    try:
        with quiet_warnings():

            # MAPIE 1.2.0: predict_set() returns (predictions, sets)
            # sets shape: (n_samples, n_classes, n_confidence_levels)
            y_pred, y_sets = mapie_model.predict_set(X_np)

            # y_sets shape: (n_samples, n_classes, 1) for single confidence level
            sets_matrix = y_sets[:, :, 0].astype(int)  # (n_samples, n_classes)
            set_sizes = sets_matrix.sum(axis=1)  # Number of classes in each set

            # Get class probabilities via the stored base classifier
            proba = base_clf.predict_proba(X_np)  # (n_samples, n_classes)

    except Exception as e:
        raise RuntimeError(f"mapie_predict_set: Prediction failed - {e}") from e

    # Back to the original label space: predictions, and each row's set
    # (the mask's true positions)
    y_pred = original_classes[y_pred]
    sets_remapped = [
        [int(label) for label in original_classes[np.flatnonzero(row)]] for row in sets_matrix
    ]

    return EastStruct(
        {
            "pred": EastVector(IntegerType, y_pred.ravel().astype(np.int64)),
            "sets": EastArray(
                ArrayType(IntegerType),
                [EastArray(IntegerType, s) for s in sets_remapped],
            ),
            "probabilities": EastMatrix(FloatType, np.atleast_2d(proba).astype(np.float64)),
            "set_sizes": EastVector(IntegerType, set_sizes.ravel().astype(np.int64)),
        }
    )


# ============================================================================
# Uncertainty Predictor Implementations (for SHAP integration)
# ============================================================================


@platform_function(
    name="mapie_uncertainty_predictor_regressor",
    inputs=[MAPIERegressorBlobType],
    output=UncertaintyPredictorType,
)
def mapie_uncertainty_predictor_regressor_impl(
    model_blob: EastVariant,
) -> EastVariant:
    """Wrap a MAPIE regressor as an interval-width uncertainty predictor.

    Produces a lightweight blob whose ``predict`` returns ``upper - lower``
    (interval width) rather than a point prediction.  Designed for use with
    :func:`shap_kernel_explainer_create_impl <east_py_datascience.shap.shap_impl.shap_kernel_explainer_create_impl>`
    to explain which features drive prediction uncertainty.

    Args:
        model_blob: ``MAPIERegressorBlobType`` (``EastVariant``) - a blob
            tagged ``mapie_split``, ``mapie_cross``, or ``mapie_cqr`` from
            :func:`mapie_train_conformal_regressor_impl` or
            :func:`mapie_train_cqr_impl`.

    Returns:
        ``UncertaintyPredictorType`` (``EastVariant``) tagged
        ``mapie_interval_width`` with ``{data: Blob, n_features: Integer}``.

    Raises:
        NotImplementedError: the ``mapie`` extra is not installed.
        RuntimeError: ``model_blob`` is not a MAPIE regressor variant.
    """
    _check_mapie_support()
    model_type = model_blob.type
    model_data = model_blob.value

    if model_type not in ("mapie_split", "mapie_cross", "mapie_cqr"):
        raise RuntimeError(
            f"mapie_uncertainty_predictor_regressor: Expected MAPIE regressor, "
            f"got {model_type}"
        )

    model_bytes, _, _ = extract_base_model_data(model_data["data"])
    n_features = model_data["n_features"]

    return EastVariant(
        "mapie_interval_width",
        EastStruct(
            {
                "data": model_bytes,
                "n_features": n_features,
            }
        ),
    )


@platform_function(
    name="mapie_uncertainty_predictor_classifier",
    inputs=[MAPIEClassifierBlobType],
    output=UncertaintyPredictorType,
)
def mapie_uncertainty_predictor_classifier_impl(
    model_blob: EastVariant,
) -> EastVariant:
    """Wrap a MAPIE classifier as a set-size uncertainty predictor.

    Produces a lightweight blob whose ``predict`` returns the prediction
    set size (number of classes in the conformal set) rather than class
    probabilities.  Designed for use with
    :func:`shap_kernel_explainer_create_impl <east_py_datascience.shap.shap_impl.shap_kernel_explainer_create_impl>`
    to explain which features drive classification ambiguity.

    Args:
        model_blob: ``MAPIEClassifierBlobType`` (``EastVariant``) - a blob
            tagged ``mapie_classifier`` from
            :func:`mapie_train_conformal_classifier_impl`.

    Returns:
        ``UncertaintyPredictorType`` (``EastVariant``) tagged
        ``mapie_set_size`` with ``{data: Blob, n_features: Integer}``.

    Raises:
        NotImplementedError: the ``mapie`` extra is not installed.
    """
    _check_mapie_support()
    model_data = model_blob.value  # the single mapie_classifier case
    model_bytes, _, _ = extract_base_model_data(model_data["data"])
    n_features = model_data["n_features"]

    return EastVariant(
        "mapie_set_size",
        EastStruct(
            {
                "data": model_bytes,
                "n_features": n_features,
            }
        ),
    )


# ============================================================================
# Platform Function Registration
# ============================================================================

# Collected from the @platform_function decorations above.
mapie_impl = platform_functions(__name__)

__all__ = [
    "mapie_impl",
    "extract_base_model_data",
]
