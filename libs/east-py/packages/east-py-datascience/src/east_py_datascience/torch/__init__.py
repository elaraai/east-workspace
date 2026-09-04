#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""PyTorch platform functions for East - MLP train, predict, encode, and decode.

The platform functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip. The East type definitions
(config, blob, and result types) are re-exported here for building inputs with
``coerce_to`` and validating outputs.
"""

from east_py_datascience.torch.torch_impl import (
    TorchTrainOutputType,
    torch_impl,
    torch_mlp_decode,
    torch_mlp_encode,
    torch_mlp_predict,
    torch_mlp_predict_multi,
    torch_mlp_train,
    torch_mlp_train_multi,
)
from east_py_datascience.types import (
    ModelBlobType,
    TorchActivationType,
    TorchLossType,
    TorchMLPConfigType,
    TorchOptimizerType,
    TorchOutputActivationType,
    TorchTrainConfigType,
    TorchTrainResultType,
)

__all__ = [
    # Platform registration
    "torch_impl",
    # Directly-callable implementations
    "torch_mlp_train",
    "torch_mlp_train_multi",
    "torch_mlp_predict",
    "torch_mlp_predict_multi",
    "torch_mlp_encode",
    "torch_mlp_decode",
    # East type definitions - config
    "TorchActivationType",
    "TorchOutputActivationType",
    "TorchLossType",
    "TorchOptimizerType",
    "TorchMLPConfigType",
    "TorchTrainConfigType",
    # East type definitions - results / blobs
    "TorchTrainResultType",
    "TorchTrainOutputType",
    "ModelBlobType",
]
