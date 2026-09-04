#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""SHAP platform functions for East.

Provides model-agnostic feature importance and explainability using SHAP values.
Uses cloudpickle for explainer serialization.
"""


import numpy as np
from east import some
from east.runtime.platform import platform_function, platform_functions
from east.types.types import FloatType, MatrixType, StringType
from east.types.values import EastArray, EastMatrix, EastStruct, EastVariant, EastVector

from east_py_datascience._categorical import apply_categorical
from east_py_datascience._common import deserialize, extra_guard, quiet_warnings, serialize
from east_py_datascience.mapie.mapie_impl import extract_base_model_data
from east_py_datascience.types import (
    AnyModelBlobType,
    FeatureImportanceType,
    ShapModelBlobType,
    ShapResultType,
    ShapValuesType,
    StringVectorType,
    TreeExplainerConfigType,
)

_check_shap_support = extra_guard("shap", "shap", "SHAP")


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
        model_data = deserialize(model_value["data"])

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

    else:
        # A MAPIE wrapper (regressor or classifier): explain its underlying
        # XGBoost estimator
        data_variant = model_value["data"]
        if data_variant.type != "xgboost":
            raise RuntimeError(
                f"{function_name}: TreeExplainer requires XGBoost base model, "
                f"but MAPIE model uses {data_variant.type}. Use KernelExplainer instead."
            )
        model_bytes, _, _ = extract_base_model_data(data_variant)
        mapie_model = deserialize(model_bytes)["mapie"]
        # MAPIE 1.2 keeps the fitted estimator on _estimator; older releases
        # used single_estimator_ / estimator_ / estimator
        for attr in ("_estimator", "single_estimator_", "estimator_", "estimator"):
            if hasattr(mapie_model, attr):
                model = getattr(mapie_model, attr)
                break
        else:
            raise RuntimeError(
                f"{function_name}: Could not extract base estimator from MAPIE model"
            )

    return model, n_features


@platform_function(
    name="shap_tree_explainer_create",
    inputs=[TreeExplainerConfigType],
    output=ShapModelBlobType,
)
def shap_tree_explainer_create(
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
      :func:`shap_kernel_explainer_create` instead).
    - ``MAPIEClassifierBlobType`` case: ``mapie_classifier`` - same
      XGBoost-only restriction applies.

    Args:
        config: ``TreeExplainerConfigType`` (``EastVariant``), one of:

            - ``path_dependent`` ``{model: TreeModelBlobType}``: uses the tree
              structure alone for attribution - fast, no background data
              required.
            - ``interventional`` ``{model: TreeModelBlobType,
              background: Matrix<Float>}``: marginalises over the background
              distribution to break feature correlations (causal attribution).
              For XGBoost models with categorical features the SHAP C++
              extension is used directly (Python guard bypassed).

    Returns:
        ``ShapModelBlobType`` (``EastVariant``) tagged ``shap_tree_explainer``
        with ``{data: Blob (cloudpickle), n_features: Integer}``.  Pass to
        :func:`shap_compute_values`.

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

    model_blob = config_value["model"]
    model, n_features = _extract_tree_model(model_blob, function_name)

    background_data = None
    has_categorical = False
    if config_mode == "interventional":
        background_data = config_value["background"].to_numpy()
        # SHAP's Python guard rejects interventional mode on categorical
        # XGBoost models; the C++ path handles them, so the guard is bypassed
        # below when the blob carries categorical features
        if model_blob.type in ("xgboost_regressor", "xgboost_classifier", "xgboost_quantile"):
            has_categorical = model_blob.value["categorical_features"].is_some()

    # Create explainer
    try:
        with quiet_warnings():
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
                "data": serialize(explainer),
                "n_features": n_features,
            }
        ),
    )


def _get_predict_fn(model, model_type: str, categorical_features=None, categorical_n=None):
    """The ``X -> prediction`` callable KernelExplainer perturbs, for a model type."""

    def prepared(X):
        # KernelExplainer hands the predict function plain arrays (or, with a
        # DataFrame background, frames); replay the training-time categorical
        # encoding on the raw values
        X_np = X.values if hasattr(X, "values") else X
        return apply_categorical(X_np, categorical_features, "shap_kernel_explainer", categorical_n)

    if model_type == "torch_mlp":
        import torch

        def predict_torch(X):
            model.eval()
            with torch.no_grad():
                output = model(torch.tensor(X, dtype=torch.float32)).numpy()
            return output.flatten() if output.shape[1] == 1 else output

        return predict_torch
    if model_type == "regressor_chain":
        # Multi-target: explain the first target
        def predict_first_target(X):
            pred = model.predict(X)
            return pred[:, 0] if pred.ndim > 1 else pred

        return predict_first_target
    if model_type in ("mapie_split", "mapie_cross", "mapie_cqr"):

        def predict_point(X):
            with quiet_warnings():
                y_pred, _ = model.predict_interval(prepared(X))
            return y_pred

        return predict_point
    if model_type == "mapie_classifier":

        def predict_proba(X):
            X_pred = prepared(X)
            with quiet_warnings():
                if hasattr(model, "estimator") and hasattr(model.estimator, "predict_proba"):
                    return model.estimator.predict_proba(X_pred)
                y_pred, _ = model.predict_set(X_pred)
                return y_pred

        return predict_proba
    if model_type == "mapie_interval_width":

        def predict_width(X):
            with quiet_warnings():
                _, y_intervals = model.predict_interval(prepared(X))
            return y_intervals[:, 1, 0] - y_intervals[:, 0, 0]

        return predict_width
    if model_type == "mapie_set_size":

        def predict_set_size(X):
            with quiet_warnings():
                _, y_sets = model.predict_set(prepared(X))
            return y_sets[:, :, 0].sum(axis=1).astype(float)

        return predict_set_size
    # Tree models, NGBoost and GP: the point prediction
    return model.predict


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
    if model_type in ("mapie_split", "mapie_cross", "mapie_cqr", "mapie_classifier"):
        data_variant = model_data["data"]
        model_bytes, categorical_features, categorical_n = extract_base_model_data(data_variant)
        combined = deserialize(model_bytes)
        model = combined["mapie"]
        n_features = int(model_data["n_features"])
    elif model_type in ("mapie_interval_width", "mapie_set_size"):
        # Uncertainty predictors - data contains { mapie }
        combined = deserialize(model_data["data"])
        model = combined["mapie"]
        n_features = int(model_data["n_features"])
    else:
        # Standard model blobs
        deserialized = deserialize(model_data["data"])
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
            cat_n_opt = model_data["categorical_n"].unwrap_or(None)
            categorical_n = cat_n_opt.to_numpy(dtype=np.int64).tolist() if cat_n_opt is not None else None

    return model, n_features, categorical_features, categorical_n, model_type


@platform_function(
    name="shap_kernel_explainer_create",
    inputs=[AnyModelBlobType, MatrixType(FloatType)],
    output=ShapModelBlobType,
)
def shap_kernel_explainer_create(
    model_blob: EastVariant,
    X_background: EastMatrix,
) -> EastVariant:
    """Create a SHAP KernelExplainer for any model type.

    Model-agnostic explainer that treats the model as a black box and
    approximates SHAP values via weighted linear regression over coalition
    samples.  Slower than :func:`shap_tree_explainer_create` but
    supports all model types in ``AnyModelBlobType``, including:

    - XGBoost / LightGBM regressors and classifiers.
    - Torch MLP, NGBoost, Gaussian Process.
    - MAPIE regressor/classifier wrappers (any base model, including
      LightGBM).
    - MAPIE uncertainty predictors (``mapie_interval_width``,
      ``mapie_set_size``) for explaining uncertainty rather than predictions.
    - ``regressor_chain``, ``gp_regressor``, ``ngboost_regressor``.

    Args:
        model_blob: ``AnyModelBlobType`` (``EastVariant``) - any supported
            model blob; the appropriate predict function is selected
            automatically based on the variant tag.
        X_background: ``Matrix<Float>`` (``EastMatrix``) - background
            dataset used to marginalise feature contributions; typically
            a sample or summary of the training set.

    Returns:
        ``ShapModelBlobType`` (``EastVariant``) tagged ``shap_kernel_explainer``
        with ``{data: Blob (cloudpickle), n_features: Integer}``.  Pass to
        :func:`shap_compute_values`.

    Raises:
        NotImplementedError: the ``shap`` extra is not installed.
        RuntimeError: unsupported model type, invalid background data, or
            explainer creation failure.
    """
    _check_shap_support()
    import shap

    function_name = "shap_kernel_explainer_create"

    model, n_features, categorical_features, categorical_n, model_type = _extract_model_from_blob(
        model_blob, function_name
    )
    X_bg = X_background.to_numpy()

    # Get predict function for the model type
    predict_fn = _get_predict_fn(model, model_type, categorical_features, categorical_n)

    # Create KernelExplainer with background data
    try:
        # Suppress SHAP warnings
        with quiet_warnings():
            explainer = shap.KernelExplainer(predict_fn, X_bg)
    except Exception as e:
        raise RuntimeError(
            f"{function_name}: Failed to create KernelExplainer - {e}"
        ) from e

    return EastVariant(
        "shap_kernel_explainer",
        EastStruct(
            {
                "data": serialize(explainer),
                "n_features": n_features,
            }
        ),
    )


@platform_function(
    name="shap_compute_values",
    inputs=[ShapModelBlobType, MatrixType(FloatType), StringVectorType],
    output=ShapResultType,
)
def shap_compute_values(
    explainer_blob: EastVariant,
    X: EastMatrix,
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
        explainer_blob: ``ShapModelBlobType`` (``EastVariant``) tagged
            ``shap_tree_explainer`` or ``shap_kernel_explainer``, produced
            by :func:`shap_tree_explainer_create` or
            :func:`shap_kernel_explainer_create`.
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

    explainer = deserialize(explainer_blob.value["data"])
    X_np = X.to_numpy()

    # Compute SHAP values
    try:
        # Bypass SHAP's Python-level guard for XGBoost categorical features.
        # The C++ extension correctly handles categorical splits, but the
        # Python guard (_xgboost_cat_unsupported) blocks it preemptively.
        if hasattr(explainer, 'model') and hasattr(explainer.model, 'cat_feature_indices'):
            explainer.model.cat_feature_indices = None

        # Suppress SHAP warnings
        with quiet_warnings():
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
def shap_feature_importance(
    shap_values: EastVariant,
    feature_names: EastArray,
) -> EastStruct:
    """Compute global feature importance as mean absolute SHAP values.

    Aggregates across samples (and classes for multi-class models) to
    produce a single importance score per feature.

    Args:
        shap_values: ``ShapValuesType`` (``EastVariant``) from
            :func:`shap_compute_values`:

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

    if shap_values.type == "matrix_2d":
        # (n_samples, n_features)
        abs_shap = np.abs(shap_values.value.to_numpy())
        mean_abs_shap = abs_shap.mean(axis=0)
        std_shap = abs_shap.std(axis=0)
    elif shap_values.type == "tensor_3d":
        # One (n_features, n_classes) matrix per sample -> (n_samples, n_features, n_classes);
        # average over samples and classes
        abs_shap = np.abs(np.stack([m.to_numpy() for m in shap_values.value], axis=0))
        mean_abs_shap = abs_shap.mean(axis=(0, 2))
        std_shap = abs_shap.std(axis=(0, 2))
    else:
        raise RuntimeError(
            f"{function_name}: Expected matrix_2d or tensor_3d variant, got {shap_values.type}"
        )

    return EastStruct(
        {
            "feature_names": EastArray(StringType, [str(name) for name in feature_names]),
            "importances": EastVector(FloatType, mean_abs_shap.ravel().astype(np.float64)),
            "std": some(EastVector(FloatType, std_shap.ravel().astype(np.float64))),
        }
    )


# ============================================================================
# Platform Function Registration
# ============================================================================

shap_impl = platform_functions(__name__)

__all__ = [
    "shap_impl",
]
