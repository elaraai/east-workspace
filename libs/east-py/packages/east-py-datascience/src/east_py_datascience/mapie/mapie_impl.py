#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""MAPIE conformal prediction implementation (MAPIE 1.2.0 API).

Provides prediction intervals with coverage guarantees using
conformal prediction methods.
"""

import warnings

# Suppress sklearn DeprecationWarning from MAPIE's internal EnsembleRegressor
# which doesn't implement __sklearn_tags__ (MAPIE bug, not ours)
warnings.filterwarnings("ignore", category=DeprecationWarning, module="sklearn")

import importlib.util

import numpy as np
from east.runtime.platform import platform_function, platform_functions

# ============================================================================
# Type Definitions for MAPIE
# ============================================================================
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

from east_py_datascience.types import (
    LightGBMModelBlobType,
    XGBoostModelBlobType,
    _get_option,
)

# Tagged model data - variant tag indicates base model type, value is the structured blob
MAPIEBaseModelDataType = VariantType(
    [
        ("xgboost", XGBoostModelBlobType),
        ("lightgbm", LightGBMModelBlobType),
        ("histogram", BlobType),
    ]
)

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

# Interval result type
IntervalResultType = StructType(
    [
        ("lower", VectorType(FloatType)),
        ("pred", VectorType(FloatType)),
        ("upper", VectorType(FloatType)),
    ]
)

# Prediction set result type
PredictionSetResultType = StructType(
    [
        ("pred", VectorType(IntegerType)),
        ("sets", ArrayType(ArrayType(IntegerType))),
        ("probabilities", MatrixType(FloatType)),
        ("set_sizes", VectorType(IntegerType)),
    ]
)

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
    ]
)

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

BaseModelType = VariantType(
    [
        ("xgboost", XGBoostConfigType),
        ("lightgbm", LightGBMConfigType),
    ]
)

ConformalMethodType = VariantType(
    [
        ("split", NullType),
        ("cross", NullType),
    ]
)

MAPIEConfigType = StructType(
    [
        ("base_model", BaseModelType),
        ("method", OptionType(ConformalMethodType)),
        ("confidence_level", OptionType(FloatType)),
        ("cv_folds", OptionType(IntegerType)),
        ("random_state", OptionType(IntegerType)),
    ]
)

MAPIECQRConfigType = StructType(
    [
        ("xgboost_config", XGBoostConfigType),
        ("confidence_level", OptionType(FloatType)),
        ("random_state", OptionType(IntegerType)),
    ]
)

ClassificationMethodType = VariantType(
    [
        ("lac", NullType),
        ("aps", NullType),
    ]
)

BaseClassifierType = VariantType(
    [
        ("xgboost", XGBoostConfigType),
        ("lightgbm", LightGBMConfigType),
    ]
)

MAPIEClassifierConfigType = StructType(
    [
        ("base_model", BaseClassifierType),
        ("method", OptionType(ClassificationMethodType)),
        ("confidence_level", OptionType(FloatType)),
        ("random_state", OptionType(IntegerType)),
    ]
)


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


# ============================================================================
# Categorical Feature Helpers
# ============================================================================


def _prepare_categorical_features(X_np, categorical_features, func_name: str, categorical_n=None):
    """Prepare feature matrix with categorical columns for training.

    Args:
        X_np: numpy array of features
        categorical_features: list of column indices that are categorical, or None
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

    cat_indices = [int(i) for i in categorical_features]

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

    Args:
        X_np: numpy array of features
        categorical_features: list of column indices that are categorical, or None
        func_name: name of the calling function for error messages
        categorical_n: plain list of ints (one per categorical feature) giving the
                       total number of categories, or None to infer from data

    Returns:
        X_prepared - either the original numpy array or a pandas DataFrame
    """
    if categorical_features is None:
        return X_np

    import pandas as pd

    df = pd.DataFrame(X_np)
    for i, idx in enumerate(categorical_features):
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
# Base Model Creation
# ============================================================================


def _create_base_regressor(base_model_variant: EastVariant, random_state):
    """Create base sklearn-compatible regressor from config.

    Returns:
        Tuple of (model, categorical_features, categorical_n)
    """
    model_type = base_model_variant.type
    config = base_model_variant.value

    if model_type == "xgboost":
        from xgboost import XGBRegressor

        # Get n_jobs from config, default to -1
        n_jobs = _get_option(config.get("n_jobs"), -1)
        n_jobs = int(n_jobs) if n_jobs is not None else -1

        # Get categorical features config
        categorical_features = _get_option(config.get("categorical_features"), None)
        if categorical_features is not None:
            categorical_features = [int(x) for x in categorical_features.data]

        # Get categorical_n config
        categorical_n_opt = _get_option(config.get("categorical_n"), None)
        categorical_n = None
        if categorical_n_opt is not None:
            categorical_n = categorical_n_opt.data.astype(np.int64).tolist()

        max_cat_to_onehot = _get_option(config.get("max_cat_to_onehot"), None)
        if max_cat_to_onehot is not None:
            max_cat_to_onehot = int(max_cat_to_onehot)

        max_cat_threshold = _get_option(config.get("max_cat_threshold"), None)
        if max_cat_threshold is not None:
            max_cat_threshold = int(max_cat_threshold)

        # Build kwargs
        kwargs = {
            "n_estimators": int(_get_option(config.get("n_estimators"), 100)),
            "max_depth": int(_get_option(config.get("max_depth"), 6)),
            "learning_rate": float(_get_option(config.get("learning_rate"), 0.3)),
            "min_child_weight": int(_get_option(config.get("min_child_weight"), 1)),
            "subsample": float(_get_option(config.get("subsample"), 1.0)),
            "colsample_bytree": float(_get_option(config.get("colsample_bytree"), 1.0)),
            "reg_alpha": float(_get_option(config.get("reg_alpha"), 0)),
            "reg_lambda": float(_get_option(config.get("reg_lambda"), 1)),
            "gamma": float(_get_option(config.get("gamma"), 0)),
            "random_state": random_state,
            "n_jobs": n_jobs,
            "verbosity": 0,
        }

        # Add categorical features params if specified
        if categorical_features is not None:
            kwargs["enable_categorical"] = True
        if max_cat_to_onehot is not None:
            kwargs["max_cat_to_onehot"] = max_cat_to_onehot
        if max_cat_threshold is not None:
            kwargs["max_cat_threshold"] = max_cat_threshold

        return XGBRegressor(**kwargs), categorical_features, categorical_n

    elif model_type == "lightgbm":
        from lightgbm import LGBMRegressor

        # Get n_jobs from config, default to -1
        n_jobs = _get_option(config.get("n_jobs"), -1)
        n_jobs = int(n_jobs) if n_jobs is not None else -1

        return LGBMRegressor(
            n_estimators=int(_get_option(config.get("n_estimators"), 100)),
            max_depth=int(_get_option(config.get("max_depth"), -1)),
            learning_rate=float(_get_option(config.get("learning_rate"), 0.1)),
            num_leaves=int(_get_option(config.get("num_leaves"), 31)),
            min_child_samples=int(_get_option(config.get("min_child_samples"), 20)),
            subsample=float(_get_option(config.get("subsample"), 1.0)),
            colsample_bytree=float(_get_option(config.get("colsample_bytree"), 1.0)),
            reg_alpha=float(_get_option(config.get("reg_alpha"), 0)),
            reg_lambda=float(_get_option(config.get("reg_lambda"), 0)),
            random_state=random_state,
            n_jobs=n_jobs,
            verbose=-1,
        ), None, None  # No categorical features for LightGBM in this context
    else:
        raise ValueError(f"Unknown base model type: {model_type}")


def _create_base_classifier(base_model_variant: EastVariant, random_state):
    """Create base sklearn-compatible classifier from config.

    Returns:
        Tuple of (model, categorical_features, categorical_n)
    """
    model_type = base_model_variant.type
    config = base_model_variant.value

    if model_type == "xgboost":
        from xgboost import XGBClassifier

        # Get n_jobs from config, default to -1
        n_jobs = _get_option(config.get("n_jobs"), -1)
        n_jobs = int(n_jobs) if n_jobs is not None else -1

        # Get categorical features config
        categorical_features = _get_option(config.get("categorical_features"), None)
        if categorical_features is not None:
            categorical_features = [int(x) for x in categorical_features.data]

        # Get categorical_n config
        categorical_n_opt = _get_option(config.get("categorical_n"), None)
        categorical_n = None
        if categorical_n_opt is not None:
            categorical_n = categorical_n_opt.data.astype(np.int64).tolist()

        max_cat_to_onehot = _get_option(config.get("max_cat_to_onehot"), None)
        if max_cat_to_onehot is not None:
            max_cat_to_onehot = int(max_cat_to_onehot)

        max_cat_threshold = _get_option(config.get("max_cat_threshold"), None)
        if max_cat_threshold is not None:
            max_cat_threshold = int(max_cat_threshold)

        # Build kwargs
        kwargs = {
            "n_estimators": int(_get_option(config.get("n_estimators"), 100)),
            "max_depth": int(_get_option(config.get("max_depth"), 6)),
            "learning_rate": float(_get_option(config.get("learning_rate"), 0.3)),
            "min_child_weight": int(_get_option(config.get("min_child_weight"), 1)),
            "subsample": float(_get_option(config.get("subsample"), 1.0)),
            "colsample_bytree": float(_get_option(config.get("colsample_bytree"), 1.0)),
            "reg_alpha": float(_get_option(config.get("reg_alpha"), 0)),
            "reg_lambda": float(_get_option(config.get("reg_lambda"), 1)),
            "gamma": float(_get_option(config.get("gamma"), 0)),
            "random_state": random_state,
            "n_jobs": n_jobs,
            "verbosity": 0,
        }

        # Add categorical features params if specified
        if categorical_features is not None:
            kwargs["enable_categorical"] = True
        if max_cat_to_onehot is not None:
            kwargs["max_cat_to_onehot"] = max_cat_to_onehot
        if max_cat_threshold is not None:
            kwargs["max_cat_threshold"] = max_cat_threshold

        return XGBClassifier(**kwargs), categorical_features, categorical_n

    elif model_type == "lightgbm":
        from lightgbm import LGBMClassifier

        # Get n_jobs from config, default to -1
        n_jobs = _get_option(config.get("n_jobs"), -1)
        n_jobs = int(n_jobs) if n_jobs is not None else -1

        return LGBMClassifier(
            n_estimators=int(_get_option(config.get("n_estimators"), 100)),
            max_depth=int(_get_option(config.get("max_depth"), -1)),
            learning_rate=float(_get_option(config.get("learning_rate"), 0.1)),
            num_leaves=int(_get_option(config.get("num_leaves"), 31)),
            min_child_samples=int(_get_option(config.get("min_child_samples"), 20)),
            subsample=float(_get_option(config.get("subsample"), 1.0)),
            colsample_bytree=float(_get_option(config.get("colsample_bytree"), 1.0)),
            reg_alpha=float(_get_option(config.get("reg_alpha"), 0)),
            reg_lambda=float(_get_option(config.get("reg_lambda"), 0)),
            random_state=random_state,
            n_jobs=n_jobs,
            verbose=-1,
        ), None, None  # No categorical features for LightGBM in this context
    else:
        raise ValueError(f"Unknown base classifier type: {model_type}")



# Lazy import guard for optional dependency
_HAS_MAPIE_SUPPORT = importlib.util.find_spec("mapie") is not None


def _check_mapie_support() -> None:
    """Check if mapie support is available."""
    if not _HAS_MAPIE_SUPPORT:
        raise NotImplementedError(
            "Mapie support requires the 'mapie' extra. "
            "Add east-py-datascience[mapie] to your pyproject.toml dependencies."
        )


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
    """Train a MAPIE conformal regressor (MAPIE 1.2.0 API)."""
    _check_mapie_support()
    from mapie.conformity_scores import AbsoluteConformityScore
    from mapie.regression import CrossConformalRegressor, SplitConformalRegressor

    # Convert inputs
    try:
        X_train_np = X_train.data
        y_train_np = y_train.data
        X_calib_np = X_calib.data
        y_calib_np = y_calib.data
    except Exception as e:
        raise RuntimeError(
            f"mapie_train_conformal_regressor: Invalid input data - {e}"
        ) from e

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
    base_model_config = config.get("base_model")
    method_variant = _get_option(config.get("method"), None)
    confidence_level = float(_get_option(config.get("confidence_level"), 0.9))
    cv_folds = int(_get_option(config.get("cv_folds"), 5))
    random_state = _get_option(config.get("random_state"), None)
    if random_state is not None:
        random_state = int(random_state)
    conformity_eps = float(_get_option(config.get("conformity_eps"), 1e-04))

    # Determine method
    method = "split" if method_variant is None else method_variant.type

    # Create base model (returns tuple: model, categorical_features, categorical_n)
    base_model, categorical_features, categorical_n = _create_base_regressor(base_model_config, random_state)
    base_model_type = base_model_config.type

    # Extract sample_weight from base model config if provided
    base_config_value = base_model_config.value
    sample_weight_raw = _get_option(base_config_value.get("sample_weight"), None)
    fit_params = {}
    if sample_weight_raw is not None:
        fit_params["sample_weight"] = sample_weight_raw.data

    # Prepare categorical features for XGBoost (validates and converts to category dtype)
    X_train_np, categorical_features, _ = _prepare_categorical_features(
        X_train_np, categorical_features, "mapie_train_conformal_regressor",
        categorical_n=categorical_n,
    )
    X_calib_np = _apply_categorical_features(
        X_calib_np, categorical_features, "mapie_train_conformal_regressor",
        categorical_n=categorical_n,
    )

    try:
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)

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

    # Serialize MAPIE model only (categorical metadata stored in structured blob)
    import cloudpickle
    combined_model = {"mapie": mapie}
    model_bytes = EastBlob(cloudpickle.dumps(combined_model))
    n_features = X_train_np.shape[1]

    # Build nested variant based on base model type
    if base_model_type == "xgboost":
        cat_features_blob = EastVariant(
            "some", EastVector(IntegerType, np.array(categorical_features, dtype=np.int64))
        ) if categorical_features else EastVariant("none", None)
        cat_n_blob = EastVariant(
            "some", EastVector(IntegerType, np.array(categorical_n, dtype=np.int64))
        ) if categorical_n else EastVariant("none", None)
        data_variant = EastVariant("xgboost", EastVariant("xgboost_regressor", EastStruct({
            "data": model_bytes,
            "n_features": n_features,
            "categorical_features": cat_features_blob,
            "categorical_n": cat_n_blob,
        })))
    elif base_model_type == "lightgbm":
        data_variant = EastVariant("lightgbm", EastVariant("lightgbm_regressor", EastStruct({
            "data": model_bytes,
            "n_features": n_features,
        })))
    else:
        data_variant = EastVariant(base_model_type, model_bytes)

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
    """Train a MAPIE CQR (Conformalized Quantile Regression) model.

    Uses sklearn's HistGradientBoostingRegressor which has native quantile
    support and is natively supported by MAPIE's CQR.
    """
    _check_mapie_support()
    from mapie.regression import ConformalizedQuantileRegressor
    from sklearn.ensemble import HistGradientBoostingRegressor

    # Convert inputs
    try:
        X_train_np = X_train.data
        y_train_np = y_train.data
        X_calib_np = X_calib.data
        y_calib_np = y_calib.data
    except Exception as e:
        raise RuntimeError(f"mapie_train_cqr: Invalid input data - {e}") from e

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
    xgb_config = config.get("xgboost_config")
    confidence_level = float(_get_option(config.get("confidence_level"), 0.9))
    random_state = _get_option(config.get("random_state"), None)
    if random_state is not None:
        random_state = int(random_state)

    # Create HistGradientBoostingRegressor with quantile loss (native CQR support)
    # Map XGBoost-like params to HistGradientBoosting params
    hgb_params = {
        "loss": "quantile",  # Required for CQR
        "max_iter": int(_get_option(xgb_config.get("n_estimators"), 100)),
        "max_depth": int(_get_option(xgb_config.get("max_depth"), 6)),
        "learning_rate": float(_get_option(xgb_config.get("learning_rate"), 0.1)),
        "l2_regularization": float(_get_option(xgb_config.get("reg_lambda"), 0)),
        "random_state": random_state,
    }

    try:
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)

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

    # Serialize MAPIE model only
    import cloudpickle
    combined_model = {"mapie": mapie_cqr}
    model_bytes = EastBlob(cloudpickle.dumps(combined_model))
    n_features = X_train_np.shape[1]

    return EastVariant(
        "mapie_cqr",
        EastStruct(
            {
                "data": EastVariant("histogram", model_bytes),
                "n_features": n_features,
                "confidence_level": confidence_level,
            }
        ),
    )


def _extract_from_base_model_data(data_variant):
    """Extract blob + categorical info from MAPIEBaseModelDataType nested variant.

    Returns:
        Tuple of (model_bytes, categorical_features, categorical_n)
    """
    outer_type = data_variant.type  # "xgboost", "lightgbm", or "histogram"
    if outer_type == "xgboost":
        inner = data_variant.value  # XGBoostModelBlobType variant
        inner_struct = inner.value  # e.g. xgboost_regressor struct
        model_bytes = inner_struct.get("data")
        cat_opt = _get_option(inner_struct.get("categorical_features"), None)
        cat_n_opt = _get_option(inner_struct.get("categorical_n"), None)
        cat_features = cat_opt.data.astype(np.int64).tolist() if cat_opt is not None else None
        cat_n = cat_n_opt.data.astype(np.int64).tolist() if cat_n_opt is not None else None
        return model_bytes, cat_features, cat_n
    elif outer_type == "lightgbm":
        inner = data_variant.value  # LightGBMModelBlobType variant
        inner_struct = inner.value
        return inner_struct.get("data"), None, None
    else:  # histogram
        return data_variant.value, None, None  # bare blob


@platform_function(
    name="mapie_predict_interval",
    inputs=[MAPIERegressorBlobType, MatrixType(FloatType)],
    output=IntervalResultType,
)
def mapie_predict_interval_impl(
    model_blob: EastVariant,
    X: EastMatrix,
) -> EastStruct:
    """Predict with intervals using the model's calibrated confidence level."""
    _check_mapie_support()
    model_data = model_blob.value

    # Load model - data is a nested variant (MAPIEBaseModelDataType)
    data_variant = model_data.get("data")
    model_bytes, categorical_features, categorical_n = _extract_from_base_model_data(data_variant)
    combined_model = _deserialize_model(model_bytes)
    model = combined_model["mapie"]

    n_features = model_data.get("n_features")

    # Convert input
    try:
        X_np = X.data
    except Exception as e:
        raise RuntimeError(f"mapie_predict_interval: Invalid input data - {e}") from e

    # Validate
    if X_np.shape[1] != n_features:
        raise RuntimeError(
            f"mapie_predict_interval: Model trained with {n_features} features "
            f"but X has {X_np.shape[1]} features"
        )

    # Apply categorical feature conversion if model was trained with them
    X_np = _apply_categorical_features(
        X_np, categorical_features, "mapie_predict_interval",
        categorical_n=categorical_n,
    )

    try:
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)

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
) -> EastStruct:
    """Train a MAPIE conformal classifier (MAPIE 1.2.0 API)."""
    _check_mapie_support()
    from mapie.classification import SplitConformalClassifier

    # Convert inputs
    try:
        X_train_np = X_train.data
        y_train_np = y_train.data
        X_calib_np = X_calib.data
        y_calib_np = y_calib.data
    except Exception as e:
        raise RuntimeError(
            f"mapie_train_conformal_classifier: Invalid input data - {e}"
        ) from e

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
    base_model_config = config.get("base_model")
    method_variant = _get_option(config.get("method"), None)
    confidence_level = float(_get_option(config.get("confidence_level"), 0.9))
    random_state = _get_option(config.get("random_state"), None)
    if random_state is not None:
        random_state = int(random_state)

    # Determine conformity score method
    conformity_score = "lac" if method_variant is None else method_variant.type

    # Create base classifier (returns tuple: model, categorical_features, categorical_n)
    base_clf, categorical_features, categorical_n = _create_base_classifier(base_model_config, random_state)
    base_model_type = base_model_config.type

    # Remap class labels to be 0-indexed and contiguous
    # XGBoost requires class labels to be [0, 1, 2, ...]
    # Use union of train + calib to ensure all classes are mapped
    all_classes = np.unique(np.concatenate([y_train_np, y_calib_np]))
    n_classes_internal = len(all_classes)
    label_map = {orig: idx for idx, orig in enumerate(all_classes)}
    y_train_np = np.array([label_map[y] for y in y_train_np])
    y_calib_np = np.array([label_map[y] for y in y_calib_np])
    # Store original classes for later remapping predictions back
    original_classes = all_classes

    # Extract sample_weight from base model config if provided
    base_config_value = base_model_config.value
    sample_weight_raw = _get_option(base_config_value.get("sample_weight"), None)
    fit_params = {}
    if sample_weight_raw is not None:
        fit_params["sample_weight"] = sample_weight_raw.data

    # Prepare categorical features for XGBoost (validates and converts to category dtype)
    X_train_np, categorical_features, _ = _prepare_categorical_features(
        X_train_np, categorical_features, "mapie_train_conformal_classifier",
        categorical_n=categorical_n,
    )
    X_calib_np = _apply_categorical_features(
        X_calib_np, categorical_features, "mapie_train_conformal_classifier",
        categorical_n=categorical_n,
    )

    try:
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)

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

    # Serialize MAPIE wrapper and base classifier (categorical metadata stored in structured blob)
    import cloudpickle
    combined_model = {
        "mapie": mapie_clf,
        "base_clf": base_clf,
    }
    model_bytes = EastBlob(cloudpickle.dumps(combined_model))
    n_features = X_train_np.shape[1]

    # Build nested variant based on base model type
    if base_model_type == "xgboost":
        cat_features_blob = EastVariant(
            "some", EastVector(IntegerType, np.array(categorical_features, dtype=np.int64))
        ) if categorical_features else EastVariant("none", None)
        cat_n_blob = EastVariant(
            "some", EastVector(IntegerType, np.array(categorical_n, dtype=np.int64))
        ) if categorical_n else EastVariant("none", None)
        data_variant = EastVariant("xgboost", EastVariant("xgboost_classifier", EastStruct({
            "data": model_bytes,
            "n_features": n_features,
            "n_classes": n_classes_internal,
            "categorical_features": cat_features_blob,
            "categorical_n": cat_n_blob,
        })))
    elif base_model_type == "lightgbm":
        data_variant = EastVariant("lightgbm", EastVariant("lightgbm_classifier", EastStruct({
            "data": model_bytes,
            "n_features": n_features,
            "n_classes": n_classes_internal,
        })))
    else:
        data_variant = EastVariant(base_model_type, model_bytes)

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
    """Predict with prediction sets using the model's calibrated confidence level."""
    _check_mapie_support()
    # Extract struct from variant (mapie_classifier)
    model_data = model_blob.value
    # Load model - data is a nested variant (MAPIEBaseModelDataType)
    data_variant = model_data.get("data")
    model_bytes, categorical_features, categorical_n = _extract_from_base_model_data(data_variant)
    combined_model = _deserialize_model(model_bytes)
    mapie_model = combined_model["mapie"]
    base_clf = combined_model["base_clf"]
    # Get original_classes from outer struct (not cloudpickle)
    original_classes_vec = model_data.get("classes")
    original_classes = original_classes_vec.data if original_classes_vec is not None else None
    n_features = model_data.get("n_features")

    # Convert input
    try:
        X_np = X.data
    except Exception as e:
        raise RuntimeError(f"mapie_predict_set: Invalid input data - {e}") from e

    # Validate
    if X_np.shape[1] != n_features:
        raise RuntimeError(
            f"mapie_predict_set: Model trained with {n_features} features "
            f"but X has {X_np.shape[1]} features"
        )

    # Apply categorical feature conversion if model was trained with them
    X_np = _apply_categorical_features(
        X_np, categorical_features, "mapie_predict_set",
        categorical_n=categorical_n,
    )

    try:
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)

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

    # Remap predictions back to original class labels if we have the mapping
    if original_classes is not None:
        y_pred = np.array([original_classes[p] for p in y_pred])
        # Remap set indices too
        sets_remapped = [
            [int(original_classes[i]) for i in np.where(row)[0]]
            for row in sets_matrix
        ]
    else:
        sets_remapped = [
            [int(i) for i in np.where(row)[0]]
            for row in sets_matrix
        ]

    return EastStruct(
        {
            "pred": EastVector(IntegerType, y_pred.ravel().astype(np.int64)),
            # Convert boolean mask to class indices (where mask is 1)
            "sets": EastArray(
                ArrayType(ArrayType(IntegerType)),
                [EastArray(ArrayType(IntegerType), s) for s in sets_remapped],
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
    """Create an uncertainty predictor from a MAPIE regressor.

    The resulting model blob predicts interval width (upper - lower) instead of
    point predictions. Use with SHAP KernelExplainer to explain uncertainty.
    """
    _check_mapie_support()
    model_type = model_blob.type
    model_data = model_blob.value

    if model_type not in ("mapie_split", "mapie_cross", "mapie_cqr"):
        raise RuntimeError(
            f"mapie_uncertainty_predictor_regressor: Expected MAPIE regressor, "
            f"got {model_type}"
        )

    # Extract the serialized model data from nested variant
    data_variant = model_data.get("data")
    model_bytes, _, _ = _extract_from_base_model_data(data_variant)
    n_features = model_data.get("n_features")

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
    """Create an uncertainty predictor from a MAPIE classifier.

    The resulting model blob predicts prediction set size instead of
    class probabilities. Use with SHAP KernelExplainer to explain uncertainty.
    """
    _check_mapie_support()
    # Classifier is a variant with single case "mapie_classifier"
    model_data = model_blob.value
    # data is a nested variant (MAPIEBaseModelDataType)
    data_variant = model_data.get("data")
    model_bytes, _, _ = _extract_from_base_model_data(data_variant)
    n_features = model_data.get("n_features")

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
]
