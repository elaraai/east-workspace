#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Type-of-type definitions for East's homoiconic type system.

This module defines the meta-types that represent East types as East values:
- LiteralValueType: The type of primitive literal values in IR
- LiteralValue: Python type alias for literal value variants
- EastTypeType: The recursive type that represents all East types
- EastTypeValue: Python type alias for serialized East type values

These enable types to be serialized, transmitted, and reflected upon within East.
"""

from __future__ import annotations

from datetime import datetime
from typing import TypeAlias

# Import type constructors - these will be updated when types.py is cleaned up
from east.types.types import (
    ArrayType,
    BlobType,
    BooleanType,
    DateTimeType,
    FloatType,
    IntegerType,
    NullType,
    StringType,
    StructType,
    VariantType,
    recursive_type,
)
from east.types.values import EastBlob, EastVariant

# =============================================================================
# LiteralValueType - The type of primitive literal values in IR
# =============================================================================

# Used to represent the values in ValueIR nodes
LiteralValueType = VariantType(
    [
        ("Null", NullType),
        ("Boolean", BooleanType),
        ("Integer", IntegerType),
        ("Float", FloatType),
        ("String", StringType),
        ("DateTime", DateTimeType),
        ("Blob", BlobType),
    ]
)


# =============================================================================
# LiteralValue - Python type for literal value variants
# =============================================================================

# The Python type of literal values in IR
# Each case is an EastVariant with the case name and Python value type
LiteralValue: TypeAlias = (
    EastVariant[None]  # Null
    | EastVariant[bool]  # Boolean
    | EastVariant[int]  # Integer
    | EastVariant[float]  # Float
    | EastVariant[str]  # String
    | EastVariant[datetime]  # DateTime
    | EastVariant[EastBlob]  # Blob
)


# =============================================================================
# EastTypeType - The type of East types (meta-type)
# =============================================================================

# The type of East values, represented as an EastType.
# This format is used for serialization of types, IR, etc.
# It also opens the door to type reflection and meta-programming within East.
EastTypeType = recursive_type(
    lambda type_ref: VariantType(
        [
            ("Never", NullType),
            ("Null", NullType),
            ("Boolean", NullType),
            ("Integer", NullType),
            ("Float", NullType),
            ("String", NullType),
            ("DateTime", NullType),
            ("Blob", NullType),
            ("Ref", type_ref),
            ("Array", type_ref),
            ("Set", type_ref),
            ("Dict", StructType([("key", type_ref), ("value", type_ref)])),
            ("Struct", ArrayType(StructType([("name", StringType), ("type", type_ref)]))),
            ("Variant", ArrayType(StructType([("name", StringType), ("type", type_ref)]))),
            ("Recursive", IntegerType),
            (
                "Function",
                StructType(
                    [
                        ("inputs", ArrayType(type_ref)),
                        ("output", type_ref),
                    ]
                ),
            ),
            (
                "AsyncFunction",
                StructType(
                    [
                        ("inputs", ArrayType(type_ref)),
                        ("output", type_ref),
                    ]
                ),
            ),
            ("Vector", type_ref),
            ("Matrix", type_ref),
        ]
    )
)


# =============================================================================
# EastTypeValue - Python type for serialized East types
# =============================================================================

# A serializable representation of East types.
# This is what EastType values look like when serialized as East values.
EastTypeValue: TypeAlias = EastVariant


# =============================================================================
# IRType - The type of IR nodes (meta-type)
# =============================================================================

# The East type that represents IR nodes.
# IR nodes are homoiconic - they are East values themselves.
# This is a recursive type because IR nodes can contain other IR nodes.

# Location struct type used in IR
LocationType = StructType(
    [
        ("filename", StringType),
        ("line", IntegerType),
        ("column", IntegerType),
    ]
)

# IRLabel struct type used in While/For loops
IRLabelType = StructType(
    [
        ("name", StringType),
        ("location", ArrayType(LocationType)),
    ]
)

# IfCase struct type used in IfElse IR
IfCaseType = recursive_type(
    lambda ir_ref: StructType(
        [
            ("predicate", ir_ref),
            ("body", ir_ref),
        ]
    )
)

# MatchCase struct type used in Match IR
MatchCaseType = recursive_type(
    lambda ir_ref: StructType(
        [
            ("case", StringType),
            ("variable", ir_ref),
            ("body", ir_ref),
        ]
    )
)

# DictEntry struct type used in NewDict IR
DictEntryType = recursive_type(
    lambda ir_ref: StructType(
        [
            ("key", ir_ref),
            ("value", ir_ref),
        ]
    )
)

# StructField struct type used in Struct IR
StructFieldIRType = recursive_type(
    lambda ir_ref: StructType(
        [
            ("name", StringType),
            ("value", ir_ref),
        ]
    )
)

# The full IR type - all possible IR node variants
# NOTE: Order must match TypeScript IRType in east/src/ir.ts exactly!
# Variant tags are encoded as indices in beast2 serialization.
IRType = recursive_type(
    lambda ir_ref: VariantType(
        [
            # 0: Error
            (
                "Error",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("message", ir_ref),
                    ]
                ),
            ),
            # 1: TryCatch
            (
                "TryCatch",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("try_body", ir_ref),
                        ("catch_body", ir_ref),
                        ("message", ir_ref),
                        ("stack", ir_ref),
                        ("finally_body", ir_ref),
                    ]
                ),
            ),
            # 2: Value
            (
                "Value",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("value", LiteralValueType),
                    ]
                ),
            ),
            # 3: Variable
            (
                "Variable",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("name", StringType),
                        ("mutable", BooleanType),
                        ("captured", BooleanType),
                    ]
                ),
            ),
            # 4: Let
            (
                "Let",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("variable", ir_ref),
                        ("value", ir_ref),
                    ]
                ),
            ),
            # 5: Assign
            (
                "Assign",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("variable", ir_ref),
                        ("value", ir_ref),
                    ]
                ),
            ),
            # 6: As
            (
                "As",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("value", ir_ref),
                    ]
                ),
            ),
            # 7: Function
            (
                "Function",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("captures", ArrayType(ir_ref)),
                        ("parameters", ArrayType(ir_ref)),
                        ("body", ir_ref),
                    ]
                ),
            ),
            # 8: AsyncFunction
            (
                "AsyncFunction",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("captures", ArrayType(ir_ref)),
                        ("parameters", ArrayType(ir_ref)),
                        ("body", ir_ref),
                    ]
                ),
            ),
            # 9: Call
            (
                "Call",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("function", ir_ref),
                        ("arguments", ArrayType(ir_ref)),
                    ]
                ),
            ),
            # 10: CallAsync
            (
                "CallAsync",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("function", ir_ref),
                        ("arguments", ArrayType(ir_ref)),
                    ]
                ),
            ),
            # 11: NewRef
            (
                "NewRef",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("value", ir_ref),
                    ]
                ),
            ),
            # 12: NewArray
            (
                "NewArray",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("values", ArrayType(ir_ref)),
                    ]
                ),
            ),
            # 13: NewSet
            (
                "NewSet",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("values", ArrayType(ir_ref)),
                    ]
                ),
            ),
            # 14: NewDict
            (
                "NewDict",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("values", ArrayType(StructType([("key", ir_ref), ("value", ir_ref)]))),
                    ]
                ),
            ),
            # 15: NewVector
            (
                "NewVector",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("values", ArrayType(ir_ref)),
                    ]
                ),
            ),
            # 16: NewMatrix
            (
                "NewMatrix",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("values", ArrayType(ir_ref)),
                        ("rows", IntegerType),
                        ("cols", IntegerType),
                    ]
                ),
            ),
            # 17: Struct
            (
                "Struct",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        (
                            "fields",
                            ArrayType(StructType([("name", StringType), ("value", ir_ref)])),
                        ),
                    ]
                ),
            ),
            # 16: GetField
            (
                "GetField",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("field", StringType),
                        ("struct", ir_ref),
                    ]
                ),
            ),
            # 17: Variant
            (
                "Variant",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("case", StringType),
                        ("value", ir_ref),
                    ]
                ),
            ),
            # 18: Block
            (
                "Block",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("statements", ArrayType(ir_ref)),
                    ]
                ),
            ),
            # 19: IfElse
            (
                "IfElse",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("ifs", ArrayType(StructType([("predicate", ir_ref), ("body", ir_ref)]))),
                        ("else_body", ir_ref),
                    ]
                ),
            ),
            # 20: Match
            (
                "Match",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("variant", ir_ref),
                        (
                            "cases",
                            ArrayType(
                                StructType(
                                    [("case", StringType), ("variable", ir_ref), ("body", ir_ref)]
                                )
                            ),
                        ),
                    ]
                ),
            ),
            # 21: UnwrapRecursive
            (
                "UnwrapRecursive",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("value", ir_ref),
                    ]
                ),
            ),
            # 22: WrapRecursive
            (
                "WrapRecursive",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("value", ir_ref),
                    ]
                ),
            ),
            # 23: While
            (
                "While",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("predicate", ir_ref),
                        ("label", IRLabelType),
                        ("body", ir_ref),
                    ]
                ),
            ),
            # 24: ForArray
            (
                "ForArray",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("array", ir_ref),
                        ("label", IRLabelType),
                        ("key", ir_ref),
                        ("value", ir_ref),
                        ("body", ir_ref),
                    ]
                ),
            ),
            # 25: ForSet
            (
                "ForSet",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("set", ir_ref),
                        ("label", IRLabelType),
                        ("key", ir_ref),
                        ("body", ir_ref),
                    ]
                ),
            ),
            # 26: ForDict
            (
                "ForDict",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("dict", ir_ref),
                        ("label", IRLabelType),
                        ("key", ir_ref),
                        ("value", ir_ref),
                        ("body", ir_ref),
                    ]
                ),
            ),
            # 27: Return
            (
                "Return",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("value", ir_ref),
                    ]
                ),
            ),
            # 28: Continue
            (
                "Continue",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("label", IRLabelType),
                    ]
                ),
            ),
            # 29: Break
            (
                "Break",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("label", IRLabelType),
                    ]
                ),
            ),
            # 30: Builtin
            (
                "Builtin",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("builtin", StringType),
                        ("type_parameters", ArrayType(EastTypeType)),
                        ("arguments", ArrayType(ir_ref)),
                    ]
                ),
            ),
            # 31: Platform
            (
                "Platform",
                StructType(
                    [
                        ("type", EastTypeType),
                        ("location", ArrayType(LocationType)),
                        ("name", StringType),
                        ("type_parameters", ArrayType(EastTypeType)),
                        ("arguments", ArrayType(ir_ref)),
                        ("async", BooleanType),
                        ("optional", BooleanType),
                    ]
                ),
            ),
        ]
    )
)


# =============================================================================
# Exports
# =============================================================================

__all__ = [
    "LiteralValueType",
    "LiteralValue",
    "EastTypeType",
    "EastTypeValue",
    "LocationType",
    "IRLabelType",
    "IfCaseType",
    "MatchCaseType",
    "DictEntryType",
    "StructFieldIRType",
    "IRType",
]
