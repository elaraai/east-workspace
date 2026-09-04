#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""XGBoost gradient boosting for East - regression, classification, and quantile.

The platform functions are plain Python callables taking and returning East
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
    xgboost_predict,
    xgboost_predict_class,
    xgboost_predict_proba,
    xgboost_predict_quantile,
    xgboost_train_classifier,
    xgboost_train_quantile,
    xgboost_train_regressor,
)

__all__ = [
    # Platform registration
    "xgboost_impl",
    # Directly-callable implementations
    "xgboost_train_regressor",
    "xgboost_train_classifier",
    "xgboost_predict",
    "xgboost_predict_class",
    "xgboost_predict_proba",
    "xgboost_train_quantile",
    "xgboost_predict_quantile",
    # East type definitions
    "XGBoostConfigType",
    "XGBoostQuantileConfigType",
    "XGBoostQuantilePredictResultType",
    "XGBoostModelBlobType",
    "ModelBlobType",
]
