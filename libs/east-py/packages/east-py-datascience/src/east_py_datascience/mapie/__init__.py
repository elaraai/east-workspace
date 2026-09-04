#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""MAPIE conformal prediction for East - regression, CQR, and classification.

The platform functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip.  The East type definitions
(config, blob, and result types) are re-exported here for building inputs with
``coerce_to`` and validating outputs.
"""

from east_py_datascience.mapie.mapie_impl import (
    BaseClassifierType,
    BaseModelType,
    ClassificationMethodType,
    ConformalMethodType,
    IntervalResultType,
    LightGBMConfigType,
    MAPIEBaseModelDataType,
    MAPIEClassifierBlobType,
    MAPIEClassifierConfigType,
    MAPIEConfigType,
    MAPIECQRConfigType,
    MAPIERegressorBlobType,
    PredictionSetResultType,
    UncertaintyPredictorType,
    XGBoostConfigType,
    mapie_impl,
    mapie_predict_interval,
    mapie_predict_set,
    mapie_train_conformal_classifier,
    mapie_train_conformal_regressor,
    mapie_train_cqr,
    mapie_uncertainty_predictor_classifier,
    mapie_uncertainty_predictor_regressor,
)

__all__ = [
    # Platform registration
    "mapie_impl",
    # Directly-callable implementations
    "mapie_train_conformal_regressor",
    "mapie_train_cqr",
    "mapie_predict_interval",
    "mapie_train_conformal_classifier",
    "mapie_predict_set",
    "mapie_uncertainty_predictor_regressor",
    "mapie_uncertainty_predictor_classifier",
    # East type definitions
    "XGBoostConfigType",
    "LightGBMConfigType",
    "BaseModelType",
    "ConformalMethodType",
    "MAPIEConfigType",
    "MAPIECQRConfigType",
    "ClassificationMethodType",
    "BaseClassifierType",
    "MAPIEClassifierConfigType",
    "MAPIEBaseModelDataType",
    "MAPIERegressorBlobType",
    "MAPIEClassifierBlobType",
    "IntervalResultType",
    "PredictionSetResultType",
    "UncertaintyPredictorType",
]
