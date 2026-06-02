#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Runtime conformance (is_value_of) and type inference (type_of), plus the EastValue union."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from east.types.values._helpers import dtype_matches_element
from east.types.values.collections import EastArray, EastDict, EastSet
from east.types.values.guards import (
    is_east_struct,
    is_east_variant,
)
from east.types.values.primitives import EastBlob, EastNull
from east.types.values.structural import (
    EastOption,
    EastRef,
    EastStruct,
    EastVariant,
)
from east.types.values.tensor import EastMatrix, EastVector

if TYPE_CHECKING:
    from east.types.types import EastType


# Union of all East value types (for type annotations)
EastValue = (
    EastNull
    | bool
    | int
    | float
    | str
    | EastBlob
    | datetime
    | EastVector
    | EastMatrix
    | EastArray
    | EastSet
    | EastDict
    | EastStruct
    | EastVariant
    | EastOption
    | EastRef
)


# =============================================================================
# TypeGuard functions for East value types
# =============================================================================


def is_value_of(
    value: EastValue,
    typ: EastType,
    type_ctx: list[EastType] | None = None,
    nodes_visited: set[int] | None = None,
) -> bool:
    """Check if a value conforms to an East type.

    Args:
        value: The value to check
        typ: The East type to validate against
        type_ctx: Internal parameter for resolving recursive type references
        nodes_visited: Internal parameter for cycle detection in values

    Returns:
        True if value matches type, False otherwise
    """
    # Initialize type context if needed
    if type_ctx is None:
        type_ctx = []

    # Handle Never type
    if typ["type"] == "Never":
        return False

    # Handle primitive types
    if typ["type"] == "Null":
        return value is None or isinstance(value, EastNull)
    if typ["type"] == "Boolean":
        return isinstance(value, bool)
    if typ["type"] == "Integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if typ["type"] == "Float":
        return isinstance(value, float)
    if typ["type"] == "String":
        return isinstance(value, str)
    if typ["type"] == "DateTime":
        return isinstance(value, datetime)
    if typ["type"] == "Blob":
        return isinstance(value, (bytes, bytearray, EastBlob))

    # Handle Vector type — logical element must match and the backing buffer's
    # storage dtype must be valid for that element (a Float vector backed by an
    # int buffer, or a Vector<Integer> matched against Vector<Float>, both fail).
    if typ["type"] == "Vector":
        return (
            isinstance(value, EastVector)
            and value.element_type.type == typ["value"]["type"]
            and dtype_matches_element(value.data.dtype, value.element_type)
        )

    # Handle Matrix type
    if typ["type"] == "Matrix":
        return (
            isinstance(value, EastMatrix)
            and value.element_type.type == typ["value"]["type"]
            and dtype_matches_element(value.data.dtype, value.element_type)
        )

    # Handle EastRef type
    if typ["type"] == "Ref":
        if not isinstance(value, EastRef):
            return False
        # Push current type onto context for recursive references
        type_ctx.append(typ)
        try:
            return is_value_of(value.value, typ["value"], type_ctx, nodes_visited)  # type: ignore[typeddict-item]
        finally:
            type_ctx.pop()

    # Handle Array type
    if typ["type"] == "Array":
        if not isinstance(value, EastArray):
            return False
        # Push current type onto context for recursive references
        type_ctx.append(typ)
        try:
            for elem in value:
                if not is_value_of(elem, typ["value"], type_ctx, nodes_visited):  # type: ignore[typeddict-item]
                    return False
            return True
        finally:
            type_ctx.pop()

    # Handle Set type
    if typ["type"] == "Set":
        if not isinstance(value, EastSet):
            return False
        # Push current type onto context for recursive references
        type_ctx.append(typ)
        try:
            for elem in value:
                if not is_value_of(elem, typ["value"], type_ctx, nodes_visited):  # type: ignore[typeddict-item]
                    return False
            return True
        finally:
            type_ctx.pop()

    # Handle Dict type
    if typ["type"] == "Dict":
        if not isinstance(value, EastDict):
            return False
        dict_type = typ["value"]
        # Push current type onto context for recursive references
        type_ctx.append(typ)
        try:
            for k, v in value.items():
                if not is_value_of(k, dict_type["key"], type_ctx, nodes_visited):
                    return False
                if not is_value_of(v, dict_type["value"], type_ctx, nodes_visited):
                    return False
            return True
        finally:
            type_ctx.pop()

    # Handle Struct type — fields are matched by NAME, not position (the C
    # bridge marshals structs by name, so the validator must too).
    if typ["type"] == "Struct":
        if not is_east_struct(value):
            return False
        type_fields = typ["value"]
        if len(value) != len(type_fields):
            return False
        # Push current type onto context for recursive references
        type_ctx.append(typ)
        try:
            for field_def in type_fields:
                field_name = field_def["name"]
                if field_name not in value:
                    return False
                if not is_value_of(value[field_name], field_def["type"], type_ctx, nodes_visited):
                    return False
            return True
        finally:
            type_ctx.pop()

    # Handle Variant type
    if typ["type"] == "Variant":
        if not is_east_variant(value):
            return False
        variant_tag = value.type
        variant_value = value.value
        # Find the case type
        cases = typ["value"]
        # Push current type onto context for recursive references
        type_ctx.append(typ)
        try:
            for case in cases:
                if case["name"] == variant_tag:
                    return is_value_of(variant_value, case["type"], type_ctx, nodes_visited)
            return False  # Case not found
        finally:
            type_ctx.pop()

    # Handle Recursive type
    if typ["type"] == "Recursive":
        scope_id = typ["value"]
        if not isinstance(scope_id, int):
            raise ValueError(f"Recursive type must have integer scope_id, got {type(scope_id)}")

        # Resolve the scope_id to the actual type from the context stack
        stack_index = len(type_ctx) - scope_id
        if stack_index < 0 or stack_index >= len(type_ctx):
            raise ValueError(
                f"Invalid recursive scope_id {scope_id} (type_ctx len={len(type_ctx)}, calculated index={stack_index})"
            )

        resolved_type = type_ctx[stack_index]

        # Check for value cycles to avoid infinite recursion
        value_id = id(value)
        if nodes_visited is None:
            nodes_visited = set()
        if value_id in nodes_visited:
            return True  # Already validated this object
        nodes_visited.add(value_id)

        return is_value_of(value, resolved_type, type_ctx, nodes_visited)

    # Handle Function type
    if typ["type"] == "Function":
        raise TypeError("JavaScript/Python functions cannot be converted to East functions")

    # Unknown type
    raise NotImplementedError(f"is_value_of not implemented for type: {typ}")


def type_of(value: EastValue, nodes_visited: set[int] | None = None) -> EastType:
    """Infer the East type of a Python value.

    For a variant, the inferred type is a single-case ``VariantType`` — variant
    inference is lossy by nature (the other cases are unknowable from one value).

    Args:
        value: Python value
        nodes_visited: Internal parameter for reference-cycle detection

    Returns:
        East type

    Raises:
        TypeError: If the value's type cannot be inferred (including cyclic refs)
    """
    # Lazy imports to avoid circular dependencies
    from east.types.types import (
        ArrayType,
        BlobType,
        BooleanType,
        DateTimeType,
        DictType,
        FloatType,
        IntegerType,
        MatrixType,
        NullType,
        RefType,
        SetType,
        StringType,
        StructType,
        VariantType,
        VectorType,
    )

    # --- leaf / non-recursing values ---
    if value is None or isinstance(value, EastNull):
        return NullType
    if isinstance(value, bool):
        return BooleanType
    if isinstance(value, int):
        return IntegerType
    if isinstance(value, float):
        return FloatType
    if isinstance(value, str):
        return StringType
    if isinstance(value, (bytes, bytearray)):
        return BlobType
    if isinstance(value, datetime):
        return DateTimeType
    if isinstance(value, EastVector):
        return VectorType(value.element_type)
    if isinstance(value, EastMatrix):
        return MatrixType(value.element_type)
    if isinstance(value, EastArray):
        return ArrayType(value.element_type)
    if isinstance(value, EastSet):
        return SetType(value.element_type)
    if isinstance(value, EastDict):
        return DictType(value.key_type, value.value_type)

    # --- recursing / structural values: guard against reference cycles ---
    if nodes_visited is None:
        nodes_visited = set()
    value_id = id(value)
    if value_id in nodes_visited:
        raise TypeError("Cannot infer the type of a cyclic value")
    nodes_visited.add(value_id)
    try:
        if isinstance(value, EastRef):
            # EastRef carries no type at runtime — infer from the contained value
            return RefType(type_of(value.value, nodes_visited))
        if is_east_variant(value):
            return VariantType([(value.type, type_of(value.value, nodes_visited))])
        if isinstance(value, EastStruct):
            return StructType([(key, type_of(val, nodes_visited)) for key, val in value.items()])
        if isinstance(value, dict):
            # Backward compat for plain dicts treated as structs
            return StructType([(key, type_of(val, nodes_visited)) for key, val in value.items()])
        if callable(value):
            raise TypeError(f"Cannot infer type of callable {value}")
        raise TypeError(f"Cannot infer type of {type(value).__name__}")
    finally:
        nodes_visited.discard(value_id)


# =============================================================================
# Exports
# =============================================================================

