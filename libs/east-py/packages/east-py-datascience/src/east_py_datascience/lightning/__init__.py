#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Lightning neural network platform functions for East - train, predict, encode, decode, generate.

The ``*_impl`` functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip. The East type definitions
(config, blob, and result types) are re-exported here for building inputs with
``coerce_to`` and validating outputs.
"""

from east_py_datascience.lightning.lightning_impl import (
    lightning_decode_conditional_impl,
    lightning_decode_impl,
    lightning_encode_impl,
    lightning_generate_sequence_impl,
    lightning_impl,
    lightning_predict_impl,
    lightning_train_impl,
)
from east_py_datascience.types import (
    GroupWeightsType,
    LightningConfigType,
    LightningEpochCallbackType,
    LightningGenerateConfigType,
    LightningModelBlobType,
    LightningOutputType,
    LightningResultType,
    ModelBlobType,
)

__all__ = [
    # Platform registration
    "lightning_impl",
    # Directly-callable implementations
    "lightning_train_impl",
    "lightning_predict_impl",
    "lightning_encode_impl",
    "lightning_decode_impl",
    "lightning_decode_conditional_impl",
    "lightning_generate_sequence_impl",
    # East type definitions - config
    "LightningOutputType",
    "LightningConfigType",
    "LightningEpochCallbackType",
    "LightningGenerateConfigType",
    "GroupWeightsType",
    # East type definitions - results / blobs
    "LightningResultType",
    "LightningModelBlobType",
    "ModelBlobType",
]
