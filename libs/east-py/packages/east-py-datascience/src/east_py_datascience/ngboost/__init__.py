#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""NGBoost probabilistic gradient boosting for East - regression with uncertainty.

The platform functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip. The East type definitions
(config, blob, and result types) are re-exported here for building inputs with
``coerce_to`` and validating outputs.
"""

from east_py_datascience.ngboost.ngboost_impl import (
    ngboost_impl,
    ngboost_predict,
    ngboost_predict_dist,
    ngboost_train_regressor,
)
from east_py_datascience.types import (
    ModelBlobType,
    NGBoostConfigType,
    NGBoostDistributionType,
    NGBoostPredictConfigType,
    NGBoostPredictResultType,
)

__all__ = [
    # Platform registration
    "ngboost_impl",
    # Directly-callable implementations
    "ngboost_train_regressor",
    "ngboost_predict",
    "ngboost_predict_dist",
    # East type definitions
    "NGBoostConfigType",
    "NGBoostDistributionType",
    "NGBoostPredictConfigType",
    "NGBoostPredictResultType",
    "ModelBlobType",
]
