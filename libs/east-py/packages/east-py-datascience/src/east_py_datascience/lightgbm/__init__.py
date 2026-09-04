#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""LightGBM fast gradient boosting for East - regression and classification.

The platform functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip. The East type definitions
(config, blob, and result types) are re-exported here for building inputs with
``coerce_to`` and validating outputs.
"""

from east_py_datascience.lightgbm.lightgbm_impl import (
    lightgbm_impl,
    lightgbm_predict,
    lightgbm_predict_class,
    lightgbm_predict_proba,
    lightgbm_train_classifier,
    lightgbm_train_regressor,
)
from east_py_datascience.types import (
    LightGBMConfigType,
    LightGBMModelBlobType,
    ModelBlobType,
)

__all__ = [
    # Platform registration
    "lightgbm_impl",
    # Directly-callable implementations
    "lightgbm_train_regressor",
    "lightgbm_train_classifier",
    "lightgbm_predict",
    "lightgbm_predict_class",
    "lightgbm_predict_proba",
    # East type definitions
    "LightGBMConfigType",
    "LightGBMModelBlobType",
    "ModelBlobType",
]
