#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The neural-network types: a network as East data (#1357).

Twins of ``src/nn/nn.ts``, declared field for field so the platform
functions' signatures match the IR the TypeScript side exports. The
specification both interpreters follow is ``docs/neural-networks.md``.
"""

from __future__ import annotations

from typing import Any

from east.types.types import (
    ArrayType,
    BooleanType,
    DictType,
    FloatType,
    IntegerType,
    NullType,
    OptionType,
    RecursiveType,
    SetType,
    StringType,
    StructType,
    VariantType,
    VectorType,
)

from east_py_datascience._common import extra_guard

# One guard for the whole nn package: torch runs the python interpreter.
_check_nn_support = extra_guard("torch", "torch", "Neural network")

# ============================================================================
# Tensors
# ============================================================================

NnDTypeType = VariantType([("float", NullType), ("integer", NullType), ("boolean", NullType)])
"""An element type: ``float`` (f64 at rest, f32 or f64 in flight), ``integer`` (i64), ``boolean``."""

TensorType = StructType([("shape", ArrayType(IntegerType)), ("data", VectorType(FloatType))])
"""A float tensor: its shape and its elements in row-major order."""

IntegerTensorType = StructType([("shape", ArrayType(IntegerType)), ("data", VectorType(IntegerType))])
"""An integer tensor: its shape and its elements in row-major order."""

BooleanTensorType = StructType([("shape", ArrayType(IntegerType)), ("data", VectorType(BooleanType))])
"""A boolean tensor: its shape and its elements in row-major order."""

NnValueType = VariantType(
    [("float", TensorType), ("integer", IntegerTensorType), ("boolean", BooleanTensorType)]
)
"""A tensor of any element type: what a batch holds and what ``nn_run`` answers."""

NnBatchType = DictType(StringType, NnValueType)
"""Input name → tensor; also ``nn_run``'s result, output name → tensor."""

NnWeightsType = DictType(StringType, TensorType)
"""Weight name → float tensor (``docs/neural-networks.md`` §1 names them)."""

# ============================================================================
# The network
# ============================================================================

NnInputSpecType = StructType([("dtype", NnDTypeType), ("rank", IntegerType)])
"""What an input must be: its element type and rank."""

NnInitType = VariantType(
    [
        ("zeros", NullType),
        ("ones", NullType),
        ("constant", FloatType),
        ("normal", FloatType),
        ("uniform", FloatType),
        ("xavier_uniform", NullType),
        ("xavier_normal", NullType),
        ("kaiming_uniform", NullType),
        ("kaiming_normal", NullType),
    ]
)
"""How ``nn_init`` draws a parameter: ``normal`` is the standard deviation, ``uniform`` the bound of ``(-b, b)``."""

NnParamSpecType = StructType(
    [("shape", ArrayType(IntegerType)), ("init", NnInitType), ("trainable", BooleanType)]
)
"""A parameter: its shape, its initialisation and whether training moves it."""

NnMaskType = VariantType(
    [
        ("none", NullType),
        ("causal", NullType),
        ("segments", StructType([("ids", StringType), ("causal", BooleanType)])),
        ("key_sets", StructType([("ptr", StringType), ("keys", StringType)])),
    ]
)
"""Which keys each query of an ``attention`` may attend to (spec §4, Attention)."""

NnReduceType = VariantType([("sum", NullType), ("mean", NullType), ("max", NullType), ("min", NullType)])
NnPadModeType = VariantType([("zeros", NullType), ("replicate", NullType)])
NnGeluType = VariantType([("exact", NullType), ("tanh", NullType)])
NnConstantType = VariantType([("float", FloatType), ("integer", IntegerType), ("boolean", BooleanType)])
NnStepsType = VariantType(
    [("fixed", IntegerType), ("until", StructType([("output", StringType), ("max", IntegerType)]))]
)

_Name = StringType  # an operand: an input, a parameter or an earlier node ("node.out" for a call's or loop's)


def nn_op_type(self: Any) -> Any:
    """The operation variant of a network whose sub-networks are ``self`` (spec §4)."""
    unary = StructType([("x", _Name)])
    binary = StructType([("a", _Name), ("b", _Name)])
    axis = StructType([("x", _Name), ("axis", IntegerType)])
    return VariantType(
        [
            # indexing and layout
            ("gather", StructType([("table", _Name), ("index", _Name)])),
            (
                "embedding_bag",
                StructType(
                    [
                        ("table", _Name),
                        ("index", _Name),
                        ("weights", OptionType(_Name)),
                        ("segments", _Name),
                        ("size", _Name),
                    ]
                ),
            ),
            (
                "segment_reduce",
                StructType([("x", _Name), ("segments", _Name), ("size", _Name), ("reduce", NnReduceType)]),
            ),
            ("segment_softmax", StructType([("x", _Name), ("segments", _Name)])),
            ("segment_log_softmax", StructType([("x", _Name), ("segments", _Name)])),
            ("scatter_add", StructType([("x", _Name), ("index", _Name), ("size", _Name)])),
            ("concat", StructType([("inputs", ArrayType(_Name)), ("axis", IntegerType)])),
            (
                "split",
                StructType(
                    [("x", _Name), ("axis", IntegerType), ("sizes", ArrayType(IntegerType)), ("part", IntegerType)]
                ),
            ),
            (
                "slice",
                StructType(
                    [("x", _Name), ("axis", IntegerType), ("start", IntegerType), ("stop", OptionType(IntegerType))]
                ),
            ),
            (
                "pad",
                StructType(
                    [
                        ("x", _Name),
                        ("axis", IntegerType),
                        ("before", IntegerType),
                        ("after", IntegerType),
                        ("mode", NnPadModeType),
                    ]
                ),
            ),
            ("reshape", StructType([("x", _Name), ("shape", ArrayType(IntegerType))])),
            ("permute", StructType([("x", _Name), ("axes", ArrayType(IntegerType))])),
            ("broadcast", StructType([("x", _Name), ("like", _Name)])),
            ("where", StructType([("cond", _Name), ("a", _Name), ("b", _Name)])),
            ("constant", StructType([("value", NnConstantType)])),
            ("cast", StructType([("x", _Name), ("dtype", NnDTypeType)])),
            # dense
            ("linear", StructType([("x", _Name), ("weight", _Name), ("bias", OptionType(_Name))])),
            ("einsum", StructType([("subscripts", StringType), ("inputs", ArrayType(_Name))])),
            (
                "conv1d",
                StructType(
                    [
                        ("x", _Name),
                        ("weight", _Name),
                        ("bias", OptionType(_Name)),
                        ("stride", IntegerType),
                        ("dilation", IntegerType),
                        ("groups", IntegerType),
                    ]
                ),
            ),
            ("avg_pool1d", StructType([("x", _Name), ("kernel", IntegerType), ("stride", IntegerType)])),
            ("upsample_nearest", StructType([("x", _Name), ("scale", IntegerType)])),
            (
                "layer_norm",
                StructType([("x", _Name), ("weight", OptionType(_Name)), ("bias", OptionType(_Name)), ("eps", FloatType)]),
            ),
            (
                "group_norm",
                StructType(
                    [
                        ("x", _Name),
                        ("groups", IntegerType),
                        ("weight", OptionType(_Name)),
                        ("bias", OptionType(_Name)),
                        ("eps", FloatType),
                    ]
                ),
            ),
            # element-wise
            ("add", binary),
            ("sub", binary),
            ("mul", binary),
            ("div", binary),
            ("pow", binary),
            ("neg", unary),
            ("abs", unary),
            ("exp", unary),
            ("log", unary),
            ("log1p", unary),
            ("sqrt", unary),
            ("softplus", unary),
            ("sigmoid", unary),
            ("tanh", unary),
            ("relu", unary),
            ("gelu", StructType([("x", _Name), ("approximate", NnGeluType)])),
            ("silu", unary),
            ("clamp", StructType([("x", _Name), ("min", OptionType(FloatType)), ("max", OptionType(FloatType))])),
            ("sin", unary),
            ("cos", unary),
            (
                "nan_to_num",
                StructType([("x", _Name), ("nan", FloatType), ("posinf", FloatType), ("neginf", FloatType)]),
            ),
            ("is_nan", unary),
            ("normal_cdf", unary),
            ("log_normal_cdf", unary),
            ("normal_quantile", unary),
            ("log1mexp", unary),
            ("eq", binary),
            ("ne", binary),
            ("lt", binary),
            ("le", binary),
            ("gt", binary),
            ("ge", binary),
            ("logical_not", unary),
            ("logical_and", binary),
            ("logical_or", binary),
            # along an axis
            ("sum", axis),
            ("mean", axis),
            ("max", axis),
            ("min", axis),
            ("logsumexp", axis),
            ("softmax", axis),
            ("log_softmax", axis),
            ("cumsum", axis),
            ("cummax", axis),
            ("cummin", axis),
            ("argmax", axis),
            # attention
            (
                "attention",
                StructType(
                    [
                        ("q", _Name),
                        ("k", _Name),
                        ("v", _Name),
                        ("heads", IntegerType),
                        ("mask", NnMaskType),
                        ("bias", OptionType(_Name)),
                        ("scale", OptionType(FloatType)),
                    ]
                ),
            ),
            ("rotary", StructType([("x", _Name), ("positions", _Name), ("heads", IntegerType), ("base", FloatType)])),
            # training and noise
            ("dropout", StructType([("x", _Name), ("p", FloatType)])),
            ("stop_gradient", unary),
            ("random_normal", StructType([("like", _Name)])),
            ("random_uniform", StructType([("like", _Name)])),
            # structure
            (
                "call",
                StructType([("module", StringType), ("prefix", StringType), ("inputs", DictType(StringType, _Name))]),
            ),
            (
                "loop",
                StructType(
                    [
                        ("body", self),
                        ("carried", DictType(StringType, _Name)),
                        ("inputs", DictType(StringType, _Name)),
                        ("step", OptionType(StringType)),
                        ("steps", NnStepsType),
                    ]
                ),
            ),
        ]
    )


NetType = RecursiveType(
    lambda self: StructType(
        [
            ("inputs", DictType(StringType, NnInputSpecType)),
            ("params", DictType(StringType, NnParamSpecType)),
            ("modules", DictType(StringType, self)),
            ("nodes", ArrayType(StructType([("name", StringType), ("op", nn_op_type(self))]))),
            ("outputs", DictType(StringType, StringType)),
        ]
    )
)
"""A network as data: inputs, parameters, sub-networks, nodes in dependency order, outputs (spec §1)."""

# ============================================================================
# Running and training
# ============================================================================

NnDeviceType = VariantType([("cpu", NullType), ("cuda", NullType), ("auto", NullType)])
"""Where to run: ``auto`` is CUDA when torch finds it, else the CPU; the C runtime is the CPU."""

NnRunConfigType = StructType([("device", NnDeviceType), ("seed", IntegerType), ("training", BooleanType)])
"""``nn_run``'s configuration: the device, the seed of the random operations, whether dropout is on."""

NnOptimizerType = VariantType(
    [
        (
            "adamw",
            StructType(
                [
                    ("lr", FloatType),
                    ("beta1", FloatType),
                    ("beta2", FloatType),
                    ("eps", FloatType),
                    ("weight_decay", FloatType),
                ]
            ),
        )
    ]
)
NnScheduleType = VariantType(
    [
        ("constant", NullType),
        ("warmup_cosine", StructType([("warmup_steps", IntegerType), ("min_lr", FloatType)])),
        ("warmup_linear", StructType([("warmup_steps", IntegerType)])),
    ]
)
NnPrecisionType = VariantType([("f32", NullType), ("bf16", NullType)])

NnTrainConfigType = StructType(
    [
        ("loss", StringType),
        ("validation", OptionType(StringType)),
        ("optimizer", NnOptimizerType),
        ("schedule", NnScheduleType),
        ("clip_norm", OptionType(FloatType)),
        ("ema_decay", OptionType(FloatType)),
        ("epochs", IntegerType),
        ("patience", OptionType(IntegerType)),
        ("precision", NnPrecisionType),
        ("seed", IntegerType),
        ("device", NnDeviceType),
        ("recompute", SetType(StringType)),
    ]
)
"""``nn_train``'s configuration (spec §5)."""

NnTrainHistoryType = StructType(
    [
        ("epoch", IntegerType),
        ("loss", FloatType),
        ("validation", OptionType(FloatType)),
        ("learning_rate", FloatType),
    ]
)
NnTrainResultType = StructType(
    [("weights", NnWeightsType), ("history", ArrayType(NnTrainHistoryType)), ("best_epoch", IntegerType)]
)
"""What ``nn_train`` answers: the best epoch's weights, one history entry per epoch run, the best epoch."""

__all__ = [
    "BooleanTensorType",
    "IntegerTensorType",
    "NetType",
    "NnBatchType",
    "NnDTypeType",
    "NnDeviceType",
    "NnInitType",
    "NnInputSpecType",
    "NnMaskType",
    "NnParamSpecType",
    "NnRunConfigType",
    "NnTrainConfigType",
    "NnTrainHistoryType",
    "NnTrainResultType",
    "NnValueType",
    "NnWeightsType",
    "TensorType",
    "nn_op_type",
]
