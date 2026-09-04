#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""SHAP feature explainability for East - tree and kernel explainers.

The platform functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip.  The East type definitions
(config, blob, and result types) are re-exported here for building inputs with
``coerce_to`` and validating outputs.
"""

from east_py_datascience.shap.shap_impl import (
    shap_compute_values,
    shap_feature_importance,
    shap_impl,
    shap_kernel_explainer_create,
    shap_tree_explainer_create,
)
from east_py_datascience.types import (
    FeatureImportanceType,
    ModelBlobType,
    ShapResultType,
    ShapValuesType,
    StringVectorType,
    TreeExplainerConfigType,
)

__all__ = [
    # Platform registration
    "shap_impl",
    # Directly-callable implementations
    "shap_tree_explainer_create",
    "shap_kernel_explainer_create",
    "shap_compute_values",
    "shap_feature_importance",
    # East type definitions
    "TreeExplainerConfigType",
    "ModelBlobType",
    "ShapValuesType",
    "ShapResultType",
    "FeatureImportanceType",
    "StringVectorType",
]
