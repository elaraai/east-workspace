#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Iterative coordinate descent optimization for East.

Provides discrete combinatorial optimization by iteratively optimizing each
element of a parameter vector over its candidate values. Supports multi-start
sampling for better exploration of the search space.

Ported from the Julia IterativeDecisionAlgorithm (ArrayParameterSpace branch).
"""

from east.runtime.platform import PlatformFunction
from east.types.types import (
    ArrayType,
    BooleanType,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StructType,
    VariantType,
    VectorType,
)

# ============================================================================
# Type Definitions (must match TypeScript exactly)
# ============================================================================

InitialStrategyType = VariantType(
    [
        ("first", NullType),
        ("random", NullType),
    ]
)

EvaluationOrderType = VariantType(
    [
        ("sequential", NullType),
        ("random", NullType),
    ]
)

ModeType = VariantType(
    [
        ("coordinate", NullType),
        ("swap", NullType),
    ]
)

IterativeConfigType = StructType(
    [
        ("iterations", OptionType(IntegerType)),
        ("samples", OptionType(IntegerType)),
        ("initial", OptionType(InitialStrategyType)),
        ("order", OptionType(EvaluationOrderType)),
        ("random_state", OptionType(IntegerType)),
        ("mode", OptionType(ModeType)),
    ]
)


IterativeResultType = StructType(
    [
        ("best_parameters", VectorType(IntegerType)),
        ("best_objective", FloatType),
        ("iterations", IntegerType),
        ("evaluations", IntegerType),
        ("success", BooleanType),
    ]
)


# ============================================================================
# Platform Function Registration
# ============================================================================

from east_py_datascience.optimization._optimization_eastc import optimization_iterative_capsule

optimization_impl = [
    PlatformFunction(
        name="optimization_iterative",
        inputs=[
            FunctionType([VectorType(IntegerType)], FloatType),
            ArrayType(VectorType(IntegerType)),
            IterativeConfigType,
        ],
        output=IterativeResultType,
        type="sync",
        fn=None,
        c_callback=optimization_iterative_capsule,
    ),
]


__all__ = [
    # Platform implementation
    "optimization_impl",
    # Types
    "InitialStrategyType",
    "EvaluationOrderType",
    "IterativeConfigType",
    "IterativeResultType",
]
