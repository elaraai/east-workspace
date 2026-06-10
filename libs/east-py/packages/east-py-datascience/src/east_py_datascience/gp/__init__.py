#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Gaussian Process regression for East - posterior mean and uncertainty.

The ``*_impl`` functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip. The East type definitions
(config, blob, and result types) are re-exported here for building inputs with
``coerce_to`` and validating outputs.
"""

from east_py_datascience.gp.gp_impl import (
    gp_impl,
    gp_predict_impl,
    gp_predict_std_impl,
    gp_train_impl,
)
from east_py_datascience.types import (
    GPConfigType,
    GPKernelType,
    GPPredictResultType,
    ModelBlobType,
)

__all__ = [
    # Platform registration
    "gp_impl",
    # Directly-callable implementations
    "gp_train_impl",
    "gp_predict_impl",
    "gp_predict_std_impl",
    # East type definitions
    "GPConfigType",
    "GPKernelType",
    "GPPredictResultType",
    "ModelBlobType",
]
