#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""SHAP platform functions for East.

Provides model-agnostic feature importance and explainability using SHAP values.
Uses cloudpickle for explainer serialization.
"""

import importlib.util
import warnings

import numpy as np
from east.runtime.platform import platform_function, platform_functions
from east.types.types import FloatType, MatrixType
from east.types.values import EastArray, EastBlob, EastMatrix, EastStruct, EastVariant, EastVector

from east_py_datascience.types import (
    FeatureImportanceType,
    ModelBlobType,
    ShapResultType,
    ShapValuesType,
    StringVectorType,
    TreeExplainerConfigType,
    _get_option,
)

# ============================================================================
# Serialization Helpers
# ============================================================================


def _serialize_explainer(explainer) -> EastBlob:
    """Serialize SHAP explainer using cloudpickle."""
    import cloudpickle

    try:
        return EastBlob(cloudpickle.dumps(explainer))
    except Exception as e:
        raise RuntimeError(
            f"_serialize_explainer: Failed to serialize explainer - {e}"
        ) from e


def _deserialize_explainer(blob: EastBlob):
    """Deserialize SHAP explainer using cloudpickle."""
    import cloudpickle

    try:
        return cloudpickle.loads(bytes(blob))
    except Exception as e:
        raise RuntimeError(
            f"_deserialize_explainer: Failed to deserialize explainer - {e}"
        ) from e


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
_HAS_SHAP_SUPPORT = importlib.util.find_spec("shap") is not None


def _check_shap_support() -> None:
    """Check if shap support is available."""
    if not _HAS_SHAP_SUPPORT:
        raise NotImplementedError(
            "Shap support requires the 'shap' extra. "
            "Add east-py-datascience[shap] to your pyproject.toml dependencies."
        )


# ============================================================================
# Platform Function Implementations
# ============================================================================


def _extract_tree_model(model_blob: EastVariant, function_name: str):
    """Extract the underlying tree model from a model blob variant.

    Returns:
        Tuple of (model, n_features)
    """
    model_type = model_blob.type
    model_value = model_blob.value

    # Supported model types
    xgboost_types = ("xgboost_regressor", "xgboost_classifier", "xgboost_quantile")
    mapie_regressor_types = ("mapie_split", "mapie_cross", "mapie_cqr")
    mapie_classifier_types = ("mapie_classifier",)

    if model_type not in xgboost_types + mapie_regressor_types + mapie_classifier_types:
        raise RuntimeError(
            f"{function_name}: TreeExplainer requires XGBoost or MAPIE-XGBoost model, got {model_type}. "
            "Use KernelExplainer for other model types."
        )

    n_features = int(model_value["n_features"])

    if model_type in xgboost_types:
        # Direct XGBoost model
        model_data = _deserialize_model(model_value["data"])

        # For quantile models, select the median quantile (or closest to 0.5)
        if model_type == "xgboost_quantile":
            quantiles = sorted(model_data.keys())
            median_q = min(quantiles, key=lambda q: abs(q - 0.5))
            model = model_data[median_q]
        elif model_type == "xgboost_classifier":
            # Classifier stores {"model": xgb_model, "classes": ...}
            model = model_data["model"]
        else:
            model = model_data

    elif model_type in mapie_regressor_types:
        # MAPIE regressor - extract underlying XGBoost estimator
        data_variant = model_value["data"]
        base_model_type = data_variant.type

        if base_model_type != "xgboost":
            raise RuntimeError(
                f"{function_name}: TreeExplainer requires XGBoost base model, "
                f"but MAPIE model uses {base_model_type}. Use KernelExplainer instead."
            )

        model_bytes, _, _ = _extract_from_mapie_data(data_variant)
        combined = _deserialize_model(model_bytes)
        mapie_model = combined["mapie"]

        # Extract the underlying estimator from MAPIE
        # MAPIE 1.2.0 uses _estimator, older versions use single_estimator_ or estimator_
        if hasattr(mapie_model, '_estimator'):
            model = mapie_model._estimator
        elif hasattr(mapie_model, 'single_estimator_'):
            model = mapie_model.single_estimator_
        elif hasattr(mapie_model, 'estimator_'):
            model = mapie_model.estimator_
        elif hasattr(mapie_model, 'estimator'):
            model = mapie_model.estimator
        else:
            raise RuntimeError(
                f"{function_name}: Could not extract base estimator from MAPIE regressor"
            )

    elif model_type in mapie_classifier_types:
        # MAPIE classifier - extract underlying XGBoost estimator
        data_variant = model_value["data"]
        base_model_type = data_variant.type

        if base_model_type != "xgboost":
            raise RuntimeError(
                f"{function_name}: TreeExplainer requires XGBoost base model, "
                f"but MAPIE model uses {base_model_type}. Use KernelExplainer instead."
            )

        model_bytes, _, _ = _extract_from_mapie_data(data_variant)
        combined = _deserialize_model(model_bytes)
        mapie_model = combined["mapie"]

        # Extract the underlying estimator from MAPIE classifier
        # MAPIE 1.2.0 uses _estimator, older versions use single_estimator_ or estimator
        if hasattr(mapie_model, '_estimator'):
            model = mapie_model._estimator
        elif hasattr(mapie_model, 'single_estimator_'):
            model = mapie_model.single_estimator_
        elif hasattr(mapie_model, 'estimator_'):
            model = mapie_model.estimator_
        elif hasattr(mapie_model, 'estimator'):
            model = mapie_model.estimator
        else:
            raise RuntimeError(
                f"{function_name}: Could not extract base estimator from MAPIE classifier"
            )
    else:
        raise RuntimeError(f"{function_name}: Unsupported model type {model_type}")

    return model, n_features


@platform_function(
    name="shap_tree_explainer_create",
    inputs=[TreeExplainerConfigType],
    output=ModelBlobType,
)
def shap_tree_explainer_create_impl(
    config: EastVariant,
) -> EastVariant:
    """Create a SHAP TreeExplainer for tree-based models.

    Accepts a variant config choosing between path-dependent and
    interventional attribution.

    Accepted model blob types via ``config.model``:

    - ``XGBoostModelBlobType`` cases: ``xgboost_regressor``,
      ``xgboost_classifier``, ``xgboost_quantile`` - used directly.
    - ``MAPIERegressorBlobType`` cases: ``mapie_split``, ``mapie_cross``,
      ``mapie_cqr`` - the underlying XGBoost estimator is extracted from
      the MAPIE wrapper (LightGBM base models are **not** supported; use
      :func:`shap_kernel_explainer_create_impl` instead).
    - ``MAPIEClassifierBlobType`` case: ``mapie_classifier`` - same
      XGBoost-only restriction applies.

    Args:
        config: ``TreeExplainerConfigType`` (``EastVariant``), one of:

            - ``path_dependent`` ``{model: ModelBlobType}``: uses the tree
              structure alone for attribution - fast, no background data
              required.
            - ``interventional`` ``{model: ModelBlobType,
              background: Matrix<Float>}``: marginalises over the background
              distribution to break feature correlations (causal attribution).
              For XGBoost models with categorical features the SHAP C++
              extension is used directly (Python guard bypassed).

    Returns:
        ``ModelBlobType`` (``EastVariant``) tagged ``shap_tree_explainer``
        with ``{data: Blob (cloudpickle), n_features: Integer}``.  Pass to
        :func:`shap_compute_values_impl`.

    Raises:
        NotImplementedError: the ``shap`` extra is not installed.
        RuntimeError: unsupported model type, non-XGBoost base model inside
            a MAPIE wrapper, or explainer creation failure.
    """
    _check_shap_support()
    import shap

    function_name = "shap_tree_explainer_create"

    config_mode = config.type
    config_value = config.value

    if config_mode not in ("path_dependent", "interventional"):
        raise RuntimeError(
            f"{function_name}: Expected path_dependent or interventional config, got {config_mode}"
        )

    try:
        model_blob = config_value["model"]
        model, n_features = _extract_tree_model(model_blob, function_name)

        background_data = None
        has_categorical = False
        if config_mode == "interventional":
            background_data = config_value["background"].to_numpy()

            # Check for categorical features — SHAP interventional TreeExplainer
            # doesn't support them, so we fall back to KernelExplainer
            model_type = model_blob.type
            if model_type in ("xgboost_regressor", "xgboost_classifier", "xgboost_quantile"):
                cat_opt = _get_option(model_blob.value.get("categorical_features"), None)
                if cat_opt is not None:
                    has_categorical = True
    except Exception as e:
        raise RuntimeError(f"{function_name}: Invalid input data - {e}") from e

    # Create explainer
    try:
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)
            if config_mode == "interventional":
                explainer = shap.TreeExplainer(
                    model,
                    data=background_data,
                    feature_perturbation="interventional",
                )
                if has_categorical:
                    # Bypass SHAP's Python-level guard for XGBoost categorical
                    # features. The C++ extension (since SHAP 0.49.0) correctly
                    # handles categorical splits, but the Python guard
                    # (_xgboost_cat_unsupported) blocks it preemptively.
                    explainer.model.cat_feature_indices = None
            else:
                explainer = shap.TreeExplainer(model)
    except Exception as e:
        raise RuntimeError(
            f"{function_name}: Failed to create TreeExplainer - {e}"
        ) from e

    explainer_tag = "shap_tree_explainer"
    return EastVariant(
        explainer_tag,
        EastStruct(
            {
                "data": _serialize_explainer(explainer),
                "n_features": n_features,
            }
        ),
    )


def _get_predict_fn(model, model_type: str, categorical_features=None, categorical_n=None):
    """Get appropriate predict function for model type."""
    try:
        if model_type == "torch_mlp":
            # Torch model needs special handling
            import torch

            def predict_fn(X):
                try:
                    model.eval()
                    with torch.no_grad():
                        X_tensor = torch.tensor(X, dtype=torch.float32)
                        output = model(X_tensor).numpy()
                    return output.flatten() if output.shape[1] == 1 else output
                except Exception as e:
                    raise RuntimeError(
                        f"_get_predict_fn: Torch prediction failed - {e}"
                    ) from e

            return predict_fn
        elif model_type == "ngboost_regressor":
            # NGBoost predict returns mean
            return lambda X: model.predict(X)
        elif model_type == "gp_regressor":
            # GP predict returns mean
            return lambda X: model.predict(X)
        elif model_type == "regressor_chain":
            # RegressorChain predict returns multi-target predictions
            # For SHAP, we return the first target (or could average)
            return (
                lambda X: model.predict(X)[:, 0]
                if model.predict(X).ndim > 1
                else model.predict(X)
            )
        elif model_type in ("mapie_split", "mapie_cross", "mapie_cqr"):
            # MAPIE regressor - returns point prediction from predict_interval
            import warnings

            def predict_fn(X):
                # Apply categorical features if needed
                X_pred = _apply_categorical_for_predict(X, categorical_features, categorical_n)
                with warnings.catch_warnings():
                    warnings.filterwarnings("ignore", category=Warning)
                    y_pred, _ = model.predict_interval(X_pred)
                return y_pred

            return predict_fn
        elif model_type == "mapie_classifier":
            # MAPIE classifier - returns class probabilities
            import warnings

            def predict_fn(X):
                # Apply categorical features if needed
                X_pred = _apply_categorical_for_predict(X, categorical_features, categorical_n)
                with warnings.catch_warnings():
                    warnings.filterwarnings("ignore", category=Warning)
                    # Get base classifier for probabilities
                    if hasattr(model, "estimator") and hasattr(model.estimator, "predict_proba"):
                        return model.estimator.predict_proba(X_pred)
                    else:
                        # Fallback to predict_set probabilities via stored base_clf
                        y_pred, _ = model.predict_set(X_pred)
                        return y_pred

            return predict_fn
        elif model_type == "mapie_interval_width":
            # Uncertainty predictor for MAPIE regressor - returns interval width
            import warnings

            def predict_fn(X):
                X_pred = _apply_categorical_for_predict(X, categorical_features, categorical_n)
                with warnings.catch_warnings():
                    warnings.filterwarnings("ignore", category=Warning)
                    _, y_intervals = model.predict_interval(X_pred)
                    # Interval width = upper - lower
                    lower = y_intervals[:, 0, 0]
                    upper = y_intervals[:, 1, 0]
                    return upper - lower

            return predict_fn
        elif model_type == "mapie_set_size":
            # Uncertainty predictor for MAPIE classifier - returns set size
            import warnings

            def predict_fn(X):
                X_pred = _apply_categorical_for_predict(X, categorical_features, categorical_n)
                with warnings.catch_warnings():
                    warnings.filterwarnings("ignore", category=Warning)
                    _, y_sets = model.predict_set(X_pred)
                    # Set size = number of classes in prediction set
                    set_sizes = y_sets[:, :, 0].sum(axis=1).astype(float)
                    return set_sizes

            return predict_fn
        else:
            # Tree-based models
            return lambda X: model.predict(X)
    except Exception as e:
        raise RuntimeError(
            f"_get_predict_fn: Failed to create predict function - {e}"
        ) from e


def _apply_categorical_for_predict(X, categorical_features, categorical_n=None):
    """Apply categorical dtype conversion for prediction if needed.

    Matches the categorical handling in mapie_impl.py and xgboost_impl.py.
    """
    if categorical_features is None:
        return X

    import pandas as pd

    X_np = X.values if isinstance(X, pd.DataFrame) else X

    df = pd.DataFrame(X_np)
    for i, idx in enumerate(categorical_features):
        if idx < 0 or idx >= X_np.shape[1]:
            continue  # Skip invalid indices silently during SHAP computation
        col = df[idx]
        if categorical_n is not None:
            n_cats = categorical_n[i]
            # NaN-safe: convert valid values to int, values outside [0, n) become NaN
            values = [int(v) if pd.notna(v) else np.nan for v in col.values]
            df[idx] = pd.Categorical(values, categories=range(n_cats))
        else:
            # Original behavior: infer categories from data
            df[idx] = col.astype(int).astype("category")

    return df


def _extract_from_mapie_data(data_variant):
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
        cat_features = cat_opt.to_numpy(dtype=np.int64).tolist() if cat_opt is not None else None
        cat_n = cat_n_opt.to_numpy(dtype=np.int64).tolist() if cat_n_opt is not None else None
        return model_bytes, cat_features, cat_n
    elif outer_type == "lightgbm":
        inner = data_variant.value  # LightGBMModelBlobType variant
        inner_struct = inner.value
        return inner_struct.get("data"), None, None
    else:  # histogram
        return data_variant.value, None, None  # bare blob


def _extract_model_from_blob(model_blob: EastVariant, function_name: str):
    """Extract model, n_features, categorical_features, categorical_n from model blob.

    Returns:
        Tuple of (model, n_features, categorical_features, categorical_n, model_type)
    """
    model_type = model_blob.type
    model_data = model_blob.value
    categorical_features = None
    categorical_n = None

    # Handle MAPIE models with nested variant structure
    if model_type in ("mapie_split", "mapie_cross", "mapie_cqr") or model_type == "mapie_classifier":
        data_variant = model_data["data"]
        model_bytes, categorical_features, categorical_n = _extract_from_mapie_data(data_variant)
        combined = _deserialize_model(model_bytes)
        model = combined["mapie"]
        n_features = int(model_data["n_features"])
    elif model_type in ("mapie_interval_width", "mapie_set_size"):
        # Uncertainty predictors - data contains { mapie }
        combined = _deserialize_model(model_data["data"])
        model = combined["mapie"]
        n_features = int(model_data["n_features"])
    else:
        # Standard model blobs
        deserialized = _deserialize_model(model_data["data"])
        # Handle Torch model package format (dict with "model" key)
        if (
            model_type == "torch_mlp"
            and isinstance(deserialized, dict)
            and "model" in deserialized
        ):
            model = deserialized["model"]
        else:
            model = deserialized
        n_features = int(model_data["n_features"])

        # Extract categorical_n from xgboost model blobs
        if model_type in ("xgboost_regressor", "xgboost_classifier", "xgboost_quantile"):
            cat_n_opt = _get_option(model_data.get("categorical_n"), None)
            categorical_n = cat_n_opt.to_numpy(dtype=np.int64).tolist() if cat_n_opt is not None else None

    return model, n_features, categorical_features, categorical_n, model_type


@platform_function(
    name="shap_kernel_explainer_create",
    inputs=[ModelBlobType, MatrixType(FloatType)],
    output=ModelBlobType,
)
def shap_kernel_explainer_create_impl(
    model_blob: EastVariant,
    X_background: EastArray,
) -> EastVariant:
    """Create a SHAP KernelExplainer for any model type.

    Model-agnostic explainer that treats the model as a black box and
    approximates SHAP values via weighted linear regression over coalition
    samples.  Slower than :func:`shap_tree_explainer_create_impl` but
    supports all model types in ``ModelBlobType``, including:

    - XGBoost / LightGBM regressors and classifiers.
    - Torch MLP, NGBoost, Gaussian Process.
    - MAPIE regressor/classifier wrappers (any base model, including
      LightGBM).
    - MAPIE uncertainty predictors (``mapie_interval_width``,
      ``mapie_set_size``) for explaining uncertainty rather than predictions.
    - ``regressor_chain``, ``gp_regressor``, ``ngboost_regressor``.

    Args:
        model_blob: ``ModelBlobType`` (``EastVariant``) - any supported
            model blob; the appropriate predict function is selected
            automatically based on the variant tag.
        X_background: ``Matrix<Float>`` (``EastMatrix``) - background
            dataset used to marginalise feature contributions; typically
            a sample or summary of the training set.

    Returns:
        ``ModelBlobType`` (``EastVariant``) tagged ``shap_kernel_explainer``
        with ``{data: Blob (cloudpickle), n_features: Integer}``.  Pass to
        :func:`shap_compute_values_impl`.

    Raises:
        NotImplementedError: the ``shap`` extra is not installed.
        RuntimeError: unsupported model type, invalid background data, or
            explainer creation failure.
    """
    _check_shap_support()
    import shap

    function_name = "shap_kernel_explainer_create"

    try:
        model, n_features, categorical_features, categorical_n, model_type = _extract_model_from_blob(
            model_blob, function_name
        )
    except Exception as e:
        raise RuntimeError(f"{function_name}: Invalid input data - {e}") from e

    try:
        X_bg = X_background.to_numpy()
    except Exception as e:
        raise RuntimeError(f"{function_name}: Invalid input data - {e}") from e

    # Get predict function for the model type
    predict_fn = _get_predict_fn(model, model_type, categorical_features, categorical_n)

    # Create KernelExplainer with background data
    try:
        # Suppress SHAP warnings
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)
            explainer = shap.KernelExplainer(predict_fn, X_bg)
    except Exception as e:
        raise RuntimeError(
            f"{function_name}: Failed to create KernelExplainer - {e}"
        ) from e

    return EastVariant(
        "shap_kernel_explainer",
        EastStruct(
            {
                "data": _serialize_explainer(explainer),
                "n_features": n_features,
            }
        ),
    )


@platform_function(
    name="shap_compute_values",
    inputs=[ModelBlobType, MatrixType(FloatType), StringVectorType],
    output=ShapResultType,
)
def shap_compute_values_impl(
    explainer_blob: EastVariant,
    X: EastArray,
    feature_names: EastArray,
) -> EastStruct:
    """Compute SHAP values for a set of samples.

    Handles regression, binary classification, and multi-class
    classification automatically:

    - Regression / binary classification: returns a ``matrix_2d``
      ``(n_samples, n_features)`` SHAP matrix and a single base value.
    - Multi-class (more than 2 classes): returns a ``tensor_3d`` list of
      ``(n_features, n_classes)`` matrices (one per sample) and a
      ``per_class`` base value vector.

    For XGBoost models with categorical features the SHAP Python guard
    (``_xgboost_cat_unsupported``) is bypassed so the C++ extension handles
    categorical splits correctly.

    Args:
        explainer_blob: ``ModelBlobType`` (``EastVariant``) tagged
            ``shap_tree_explainer`` or ``shap_kernel_explainer``, produced
            by :func:`shap_tree_explainer_create_impl` or
            :func:`shap_kernel_explainer_create_impl`.
        X: ``Matrix<Float>`` (``EastMatrix``) - samples to explain.
        feature_names: ``Array<String>`` (``EastArray``) - one name per
            feature column; included verbatim in the result.

    Returns:
        ``ShapResultType`` (``EastStruct``):

        - ``shap_values`` (``ShapValuesType`` - ``EastVariant``): tagged
          ``matrix_2d`` ``Matrix<Float>`` for regression/binary, or
          ``tensor_3d`` ``Array<Matrix<Float>>`` for multi-class.
        - ``base_value`` (``ShapBaseValueType`` - ``EastVariant``): tagged
          ``single`` ``Float`` or ``per_class`` ``Vector<Float>``.
        - ``feature_names`` (``Array<String>``): echoed back from input.

    Raises:
        NotImplementedError: the ``shap`` extra is not installed.
        RuntimeError: ``explainer_blob`` is not an explainer variant,
            invalid input data, or SHAP computation failure.
    """
    _check_shap_support()
    function_name = "shap_compute_values"

    if explainer_blob.type not in ("shap_tree_explainer", "shap_kernel_explainer"):
        raise RuntimeError(
            f"{function_name}: Expected SHAP explainer, got {explainer_blob.type}"
        )

    try:
        explainer = _deserialize_explainer(explainer_blob.value["data"])
    except Exception as e:
        raise RuntimeError(f"{function_name}: Invalid input data - {e}") from e

    try:
        X_np = X.to_numpy()
    except Exception as e:
        raise RuntimeError(f"{function_name}: Invalid input data - {e}") from e

    # Compute SHAP values
    try:
        # Bypass SHAP's Python-level guard for XGBoost categorical features.
        # The C++ extension correctly handles categorical splits, but the
        # Python guard (_xgboost_cat_unsupported) blocks it preemptively.
        if hasattr(explainer, 'model') and hasattr(explainer.model, 'cat_feature_indices'):
            explainer.model.cat_feature_indices = None

        # Suppress SHAP warnings
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=Warning)
            shap_values = explainer.shap_values(X_np)
    except Exception as e:
        raise RuntimeError(
            f"{function_name}: Failed to compute SHAP values - {e}"
        ) from e

    # Determine if multi-class (more than 2 classes)
    try:
        base_value_raw = explainer.expected_value
        is_multiclass = False
        n_classes = 1

        # Check for multi-class: list/array with > 2 elements or 3D shap_values
        if isinstance(shap_values, list):
            n_classes = len(shap_values)
            is_multiclass = n_classes > 2
        elif shap_values.ndim == 3:
            n_classes = shap_values.shape[2]
            is_multiclass = n_classes > 2

        # Convert feature names
        names_list = [str(name) for name in feature_names]
        from east.types.types import StringType

        if is_multiclass:
            # Multi-class: return 3D tensor and per-class base values
            if isinstance(shap_values, list):
                # Convert list of 2D arrays to 3D array (n_samples, n_features, n_classes)
                shap_3d = np.stack(shap_values, axis=2)
            else:
                shap_3d = shap_values  # Already 3D

            # Convert 3D array to list of matrices (one per sample)
            # Shape: (n_samples, n_features, n_classes) -> list of (n_features, n_classes) matrices
            tensor_3d_list = [
                EastMatrix(FloatType, np.atleast_2d(shap_3d[i]).astype(np.float64))  # (n_features, n_classes)
                for i in range(shap_3d.shape[0])
            ]

            # Base values per class
            if isinstance(base_value_raw, (np.ndarray, list)):
                base_values = [float(v) for v in base_value_raw]
            else:
                base_values = [float(base_value_raw)] * n_classes

            return EastStruct(
                {
                    "shap_values": EastVariant(
                        "tensor_3d",
                        EastArray(MatrixType(FloatType), tensor_3d_list),
                    ),
                    "base_value": EastVariant(
                        "per_class",
                        EastVector(FloatType, np.array(base_values, dtype=np.float64)),
                    ),
                    "feature_names": EastArray(StringType, names_list),
                }
            )
        else:
            # Regression or binary classification: return 2D matrix
            if isinstance(shap_values, list):
                # Binary: take positive class (index 1)
                shap_2d = shap_values[1] if len(shap_values) > 1 else shap_values[0]
            elif shap_values.ndim == 3:
                # Binary with 3D output: take positive class
                shap_2d = (
                    shap_values[:, :, 1]
                    if shap_values.shape[2] > 1
                    else shap_values[:, :, 0]
                )
            else:
                shap_2d = shap_values

            # Ensure 2D
            if shap_2d.ndim == 1:
                shap_2d = shap_2d.reshape(1, -1)

            # Single base value (for binary, use positive class)
            if isinstance(base_value_raw, (np.ndarray, list)):
                base_value = (
                    float(base_value_raw[1])
                    if len(base_value_raw) > 1
                    else float(base_value_raw[0])
                )
            else:
                base_value = float(base_value_raw)

            return EastStruct(
                {
                    "shap_values": EastVariant(
                        "matrix_2d",
                        EastMatrix(FloatType, np.atleast_2d(shap_2d).astype(np.float64)),
                    ),
                    "base_value": EastVariant("single", base_value),
                    "feature_names": EastArray(StringType, names_list),
                }
            )
    except Exception as e:
        raise RuntimeError(
            f"{function_name}: Failed to process SHAP results - {e}"
        ) from e


@platform_function(
    name="shap_feature_importance",
    inputs=[ShapValuesType, StringVectorType],
    output=FeatureImportanceType,
)
def shap_feature_importance_impl(
    shap_values: EastVariant,
    feature_names: EastArray,
) -> EastStruct:
    """Compute global feature importance as mean absolute SHAP values.

    Aggregates across samples (and classes for multi-class models) to
    produce a single importance score per feature.

    Args:
        shap_values: ``ShapValuesType`` (``EastVariant``) from
            :func:`shap_compute_values_impl`:

            - ``matrix_2d`` ``Matrix<Float>`` ``(n_samples, n_features)``:
              regression or binary classification - ``mean(|SHAP|)`` across
              samples.
            - ``tensor_3d`` ``Array<Matrix<Float>>`` (one ``(n_features,
              n_classes)`` matrix per sample): multi-class -
              ``mean(|SHAP|)`` across samples and classes.

        feature_names: ``Array<String>`` (``EastArray``) - one name per
            feature column.

    Returns:
        ``FeatureImportanceType`` (``EastStruct``):

        - ``feature_names`` (``Array<String>``): echoed back.
        - ``importances`` (``Vector<Float>``): mean ``|SHAP|`` per feature.
        - ``std`` (``Option<Vector<Float>>``): always ``some`` - standard
          deviation of ``|SHAP|`` per feature.

    Raises:
        NotImplementedError: the ``shap`` extra is not installed.
        RuntimeError: unrecognised ``shap_values`` variant tag or
            computation failure.
    """
    _check_shap_support()
    function_name = "shap_feature_importance"

    try:
        variant_type = shap_values.type
        if variant_type == "matrix_2d":
            # 2D: (n_samples, n_features)
            shap_np = shap_values.value.to_numpy()
            mean_abs_shap = np.abs(shap_np).mean(axis=0)
            std_shap = np.abs(shap_np).std(axis=0)
        elif variant_type == "tensor_3d":
            # 3D: list of (n_features, n_classes) matrices, one per sample
            # Convert to numpy 3D array
            tensor_list = list(shap_values.value)
            shap_3d = np.stack([m.to_numpy() for m in tensor_list], axis=0)
            # Shape: (n_samples, n_features, n_classes)
            # Mean across samples and classes to get per-feature importance
            mean_abs_shap = np.abs(shap_3d).mean(axis=(0, 2))
            std_shap = np.abs(shap_3d).std(axis=(0, 2))
        else:
            raise RuntimeError(
                f"{function_name}: Expected matrix_2d or tensor_3d variant, got {variant_type}"
            )
    except Exception as e:
        raise RuntimeError(f"{function_name}: Invalid input data - {e}") from e

    # Mean absolute SHAP value per feature
    try:
        # Convert feature names
        names_list = [str(name) for name in feature_names]

        from east.types.types import StringType

        return EastStruct(
            {
                "feature_names": EastArray(StringType, names_list),
                "importances": EastVector(FloatType, mean_abs_shap.ravel().astype(np.float64)),
                "std": EastVariant("some", EastVector(FloatType, std_shap.ravel().astype(np.float64))),
            }
        )
    except Exception as e:
        raise RuntimeError(
            f"{function_name}: Failed to compute feature importance - {e}"
        ) from e


# ============================================================================
# Platform Function Registration
# ============================================================================

shap_impl = platform_functions(__name__)

__all__ = [
    "shap_impl",
]
