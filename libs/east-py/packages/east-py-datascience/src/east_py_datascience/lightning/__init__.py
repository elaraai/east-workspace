#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Lightning neural network platform functions for East - train, predict, encode, decode, generate.

The platform functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip. The East type definitions
(config, blob, and result types) are re-exported here for building inputs with
``coerce_to`` and validating outputs.
"""

from east_py_datascience.lightning.lightning_impl import (
    lightning_decode,
    lightning_decode_conditional,
    lightning_encode,
    lightning_generate_sequence,
    lightning_impl,
    lightning_predict,
    lightning_train,
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
    "lightning_train",
    "lightning_predict",
    "lightning_encode",
    "lightning_decode",
    "lightning_decode_conditional",
    "lightning_generate_sequence",
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
