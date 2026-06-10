#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""XGBoost gradient boosting for East - regression, classification, and quantile.

The ``*_impl`` functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip. The East type definitions
(config, blob, and result types) are re-exported here for building inputs with
``coerce_to`` and validating outputs.
"""

from east_py_datascience.types import (
    ModelBlobType,
    XGBoostConfigType,
    XGBoostModelBlobType,
    XGBoostQuantileConfigType,
    XGBoostQuantilePredictResultType,
)
from east_py_datascience.xgboost.xgboost_impl import (
    xgboost_impl,
    xgboost_predict_class_impl,
    xgboost_predict_impl,
    xgboost_predict_proba_impl,
    xgboost_predict_quantile_impl,
    xgboost_train_classifier_impl,
    xgboost_train_quantile_impl,
    xgboost_train_regressor_impl,
)

__all__ = [
    # Platform registration
    "xgboost_impl",
    # Directly-callable implementations
    "xgboost_train_regressor_impl",
    "xgboost_train_classifier_impl",
    "xgboost_predict_impl",
    "xgboost_predict_class_impl",
    "xgboost_predict_proba_impl",
    "xgboost_train_quantile_impl",
    "xgboost_predict_quantile_impl",
    # East type definitions
    "XGBoostConfigType",
    "XGBoostQuantileConfigType",
    "XGBoostQuantilePredictResultType",
    "XGBoostModelBlobType",
    "ModelBlobType",
]
