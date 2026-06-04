#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Total ordering for East values.

East defines a total ordering across all types, which is used for:
- Sorted sets
- Sorted dicts (by key)
- Comparison operations

The ordering is defined lexicographically by:
1. Type order (EastNull < Boolean < Integer < Float < String < EastBlob < DateTime < Array < Set < Dict < Struct < Variant)
2. Within each type, use the natural ordering

Special cases:
- NaN floats are ordered (NaN < -Infinity < ... < Infinity)
- Containers are compared lexicographically
"""

from __future__ import annotations

import contextlib
import math
from typing import Any

from east.types.types import (
    is_array_type,
    is_async_function_type,
    is_blob_type,
    is_boolean_type,
    is_datetime_type,
    is_dict_type,
    is_float_type,
    is_function_type,
    is_integer_type,
    is_matrix_type,
    is_never_type,
    is_null_type,
    is_recursive_type,
    is_ref_type,
    is_set_type,
    is_string_type,
    is_struct_type,
    is_variant_type,
    is_vector_type,
)
from east.types.values import EastBlob, EastMatrix, EastVector

# Type ordering: lower number means comes first
TYPE_ORDER = {
    "Null": 0,
    "Boolean": 1,
    "Integer": 2,
    "Float": 3,
    "String": 4,
    "Blob": 5,
    "DateTime": 6,
    "Array": 7,
    "Set": 8,
    "Dict": 9,
    "Ref": 10,
    "Struct": 11,
    "Variant": 12,
    "Vector": 13,
    "Matrix": 14,
}


def make_east_key(type_val: Any) -> type:
    """Create an EastKey class for a specific type.

    Args:
        type_val: The East type to create a key class for

    Returns:
        A key class that can be used with sorted() and SortedContainers

    Example:
        >>> IntKey = make_east_key(IntegerType)
        >>> sorted(values, key=IntKey)
        >>> SortedSet(key=make_east_key(element_type))
    """
    compare = compare_for(type_val)

    class EastKey:
        """Wrapper for East values to use in Python sorted() and SortedContainers."""

        __slots__ = ("value",)

        def __init__(self, value: Any):
            """Create a key wrapper for a value."""
            self.value = value

        def __lt__(self, other: EastKey) -> bool:
            """Less than comparison using East semantics."""
            return compare(self.value, other.value) < 0

        def __le__(self, other: EastKey) -> bool:
            """Less than or equal comparison using East semantics."""
            return compare(self.value, other.value) <= 0

        def __gt__(self, other: EastKey) -> bool:
            """Greater than comparison using East semantics."""
            return compare(self.value, other.value) > 0

        def __ge__(self, other: EastKey) -> bool:
            """Greater than or equal comparison using East semantics."""
            return compare(self.value, other.value) >= 0

        def __eq__(self, other: object) -> bool:
            """Equality comparison using East semantics."""
            if not isinstance(other, EastKey):
                return NotImplemented
            return compare(self.value, other.value) == 0

        def __hash__(self) -> int:
            """Hash based on the value."""
            return hash(self.value)

    return EastKey


def equal_for(type_val: Any, type_ctx: list[Any] | None = None) -> Any:
    """Create a type-specific equality function.

    Args:
        type_val: The East type to create an equality function for
        type_ctx: Optional context for handling recursive types (internal use)

    Returns:
        A function that compares two values of the given type for equality

    Note:
        - Handles special cases like NaN equality for floats
        - Detects cycles in recursive structures
        - Uses structural equality for all types
    """
    from east.types.values import EastArray, EastDict, EastSet

    if type_ctx is None:
        type_ctx = []

    if is_never_type(type_val):

        def equal_never(_x, _y, _ctx=None):
            raise RuntimeError("Attempted to compare values of type .Never")

        return equal_never

    if is_null_type(type_val):
        return lambda _x, _y, _ctx=None: True

    if is_boolean_type(type_val):
        return lambda x, y, _ctx=None: x == y

    if is_integer_type(type_val):
        return lambda x, y, _ctx=None: x == y

    if is_float_type(type_val):

        def equal_float(x: float, y: float, _ctx=None) -> bool:
            import math

            # NaN == NaN is true in East
            if math.isnan(x):
                return math.isnan(y)
            # In East's total ordering, -0.0 != 0.0
            if x == 0.0 and y == 0.0:
                # Check for -0 vs +0 using copysign
                return math.copysign(1.0, x) == math.copysign(1.0, y)
            return x == y

        return equal_float

    if is_string_type(type_val):
        return lambda x, y, _ctx=None: x == y

    if is_datetime_type(type_val):
        return lambda x, y, _ctx=None: x == y

    if is_blob_type(type_val):

        def equal_blob(x: EastBlob, y: EastBlob, _ctx=None) -> bool:
            if len(x.data) != len(y.data):
                return False
            return all(a == b for a, b in zip(x.data, y.data, strict=False))

        return equal_blob

    if is_vector_type(type_val):
        elem_equal = equal_for(type_val.value, type_ctx)

        def equal_vector(x: EastVector, y: EastVector, _ctx=None) -> bool:
            if x is y:
                return True
            if len(x._data) != len(y._data):
                return False
            for i in range(len(x._data)):
                if not elem_equal(x._data[i], y._data[i]):
                    return False
            return True

        return equal_vector

    if is_matrix_type(type_val):
        elem_equal = equal_for(type_val.value, type_ctx)

        def equal_matrix(x: EastMatrix, y: EastMatrix, _ctx=None) -> bool:
            if x is y:
                return True
            if x.rows != y.rows or x.cols != y.cols:
                return False
            xd = x._data.ravel()
            yd = y._data.ravel()
            for i in range(len(xd)):
                if not elem_equal(xd[i], yd[i]):
                    return False
            return True

        return equal_matrix

    if is_array_type(type_val):
        type_ctx.append(None)  # Placeholder
        value_comparer = equal_for(type_val.value, type_ctx)

        def equal_array(x: EastArray, y: EastArray, ctx=None) -> bool:
            # Fast path - same object
            if x is y:
                return True

            # Create context if needed (top-level call)
            if ctx is None:
                ctx = {}

            # Check if we've visited this pair (cycle detection)
            x_id = id(x)
            if x_id in ctx and id(y) in ctx[x_id]:
                return True  # Cycle - we're re-encountering this pair

            # Mark as visited
            if x_id not in ctx:
                ctx[x_id] = set()
            ctx[x_id].add(id(y))

            # Compare lengths
            if len(x) != len(y):
                return False

            # Compare elements
            return all(value_comparer(x[i], y[i], ctx) for i in range(len(x)))

        type_ctx[-1] = equal_array
        type_ctx.pop()  # Pop the Array from type_ctx
        return equal_array

    if is_set_type(type_val):
        type_ctx.append(None)  # Placeholder

        def equal_set(x: EastSet, y: EastSet, _ctx=None) -> bool:
            if len(x) != len(y):
                return False
            # Sets use value equality via __contains__
            return all(item in y for item in x)

        type_ctx[-1] = equal_set
        type_ctx.pop()  # Pop the Set from type_ctx
        return equal_set

    if is_dict_type(type_val):
        type_ctx.append(None)  # Placeholder
        value_comparer = equal_for(type_val.value["value"], type_ctx)

        def equal_dict(x: EastDict, y: EastDict, ctx=None) -> bool:
            # Fast path - same object
            if x is y:
                return True

            # Create context if needed
            if ctx is None:
                ctx = {}

            # Check if we've visited this pair (cycle detection)
            x_id = id(x)
            if x_id in ctx and id(y) in ctx[x_id]:
                return True  # Cycle

            # Mark as visited
            if x_id not in ctx:
                ctx[x_id] = set()
            ctx[x_id].add(id(y))

            # Compare sizes
            if len(x) != len(y):
                return False

            # Compare key-value pairs
            for key, x_val in x.items():
                if key not in y:
                    return False
                y_val = y[key]
                if not value_comparer(x_val, y_val, ctx):
                    return False

            return True

        type_ctx[-1] = equal_dict
        type_ctx.pop()  # Pop the Dict from type_ctx
        return equal_dict

    if is_ref_type(type_val):
        from east.types.values import EastRef

        # Get inner value comparer
        type_ctx.append(None)  # Placeholder
        inner_comparer = equal_for(type_val.value, type_ctx)

        def equal_ref(x: EastRef, y: EastRef, ctx=None) -> bool:
            # Fast path - same identity
            if x is y:
                return True

            # Create context if needed (top-level call)
            if ctx is None:
                ctx = {}

            # Check if we've visited this pair (cycle detection)
            x_id = id(x)
            if x_id in ctx and id(y) in ctx[x_id]:
                return True  # Cycle - already comparing

            # Mark as visited
            if x_id not in ctx:
                ctx[x_id] = set()
            ctx[x_id].add(id(y))

            # Compare inner values
            return inner_comparer(x.value, y.value, ctx)

        type_ctx[-1] = equal_ref
        type_ctx.pop()  # Pop the Ref from type_ctx
        return equal_ref

    if is_struct_type(type_val):
        field_comparers: list[tuple[str, Any]] = []

        def equal_struct(x, y, ctx=None) -> bool:
            # Create context if needed
            if ctx is None:
                ctx = {}

            # Check if we've visited this pair (cycle detection)
            x_id = id(x)
            if x_id in ctx and id(y) in ctx[x_id]:
                return True  # Cycle

            # Mark as visited
            if x_id not in ctx:
                ctx[x_id] = set()
            ctx[x_id].add(id(y))

            # Compare fields - handle both dict and EastStruct
            for field_name, comparer in field_comparers:
                x_val = x[field_name]
                y_val = y[field_name]
                if not comparer(x_val, y_val, ctx):
                    return False

            return True

        type_ctx.append(equal_struct)
        # Structs don't record markers - only Variants do (they're the roots of recursive types)
        for field_struct in type_val.value:
            field_name = field_struct["name"]
            field_type = field_struct["type"]
            field_comparers.append((field_name, equal_for(field_type, type_ctx)))
        type_ctx.pop()
        return equal_struct

    if is_variant_type(type_val):
        case_comparers: dict[str, Any] = {}

        def equal_variant(x, y, ctx=None) -> bool:
            # Handle both dict and EastVariant objects
            x_tag = x["type"]
            y_tag = y["type"]
            x_val = x["value"]
            y_val = y["value"]

            # Check tags first
            if x_tag != y_tag:
                return False

            # Create context if needed
            if ctx is None:
                ctx = {}

            # Check if we've visited this pair (cycle detection)
            x_id = id(x)
            if x_id in ctx and id(y) in ctx[x_id]:
                return True  # Cycle

            # Mark as visited
            if x_id not in ctx:
                ctx[x_id] = set()
            ctx[x_id].add(id(y))

            # Compare values
            return case_comparers[x_tag](x_val, y_val, ctx)

        type_ctx.append(equal_variant)
        for case_struct in type_val.value:
            case_name = case_struct["name"]
            case_type = case_struct["type"]
            case_comparers[case_name] = equal_for(case_type, type_ctx)
        type_ctx.pop()
        return equal_variant

    if is_recursive_type(type_val):
        # Look up the comparer from the type context using integer scope_id
        scope_id = type_val.value
        if not isinstance(scope_id, int):
            raise ValueError(f"Recursive type must have integer scope_id, got {type(scope_id)}")

        ctx_index = len(type_ctx) - scope_id
        if ctx_index < 0 or ctx_index >= len(type_ctx):
            raise ValueError(
                f"Invalid recursive scope_id {scope_id} "
                f"(ctx len={len(type_ctx)}, calculated index={ctx_index})"
            )
        return type_ctx[ctx_index]

    if is_function_type(type_val) or is_async_function_type(type_val):
        # Functions are always considered equal for equality comparison
        return lambda _x, _y: True

    raise RuntimeError(f"Unknown type encountered during type printing: {type_val.type}")


def is_for(type_val: Any, type_ctx: list[Any] | None = None) -> Any:
    """Create an identity comparer for a given type.

    Identity comparison uses Python `is` for mutables (Array, Set, Dict),
    value comparison for immutables (primitives, EastBlob), and field-by-field
    comparison for structs and variants.

    Args:
        type_val: The East type to create a comparer for
        type_ctx: Stack of comparers for recursive types (internal)

    Returns:
        A function (x, y, ctx) -> bool that performs identity comparison
    """
    if type_ctx is None:
        type_ctx = []

    if is_never_type(type_val):

        def is_never(_x: Any, _y: Any, _ctx: Any = None) -> bool:
            raise RuntimeError("Attempted to compare values of type .Never")

        return is_never

    if is_null_type(type_val):
        return lambda _x, _y, _ctx=None: True

    if is_boolean_type(type_val):
        return lambda x, y, _ctx=None: x == y

    if is_integer_type(type_val):
        return lambda x, y, _ctx=None: x == y

    if is_float_type(type_val):
        # For identity, NaN == NaN but don't use Object.is (treats -0/+0 different)
        return lambda x, y, _ctx=None: (math.isnan(x) and math.isnan(y)) or x == y

    if is_string_type(type_val):
        return lambda x, y, _ctx=None: x == y

    if is_datetime_type(type_val):
        return lambda x, y, _ctx=None: x.timestamp() == y.timestamp()

    if is_blob_type(type_val):
        # Blobs are immutable, compare by value
        def is_blob(x: Any, y: Any, _ctx: Any = None) -> bool:
            if isinstance(x, EastBlob):
                x = x.data
            if isinstance(y, EastBlob):
                y = y.data
            if len(x) != len(y):
                return False
            return all(a == b for a, b in zip(x, y, strict=True))

        return is_blob

    if is_vector_type(type_val):
        # `is` compares by identity; value equality is via Equal/equal_for
        return lambda x, y, _ctx=None: x is y

    if is_matrix_type(type_val):
        # `is` compares by identity; value equality is via Equal/equal_for
        return lambda x, y, _ctx=None: x is y

    if is_array_type(type_val):
        # Mutable: identity comparison
        return lambda x, y, _ctx=None: x is y

    if is_set_type(type_val):
        # Mutable: identity comparison
        return lambda x, y, _ctx=None: x is y

    if is_dict_type(type_val):
        # Mutable: identity comparison
        return lambda x, y, _ctx=None: x is y

    if is_ref_type(type_val):
        # Mutable types compared by identity
        return lambda x, y, _ctx=None: x is y

    if is_struct_type(type_val):
        # Build field comparers
        field_comparers: list[tuple[str, Any]] = []

        def is_struct(x: Any, y: Any, ctx: Any = None) -> bool:
            for field_name, field_comparer in field_comparers:
                if not field_comparer(x[field_name], y[field_name], ctx):
                    return False
            return True

        type_ctx.append(is_struct)
        # Structs don't record markers - only Variants do (they're the roots of recursive types)
        for field_struct in type_val.value:
            field_name = field_struct["name"]
            field_type = field_struct["type"]
            field_comparers.append((field_name, is_for(field_type, type_ctx)))
        type_ctx.pop()
        return is_struct

    if is_variant_type(type_val):
        # Build case comparers
        case_comparers: dict[str, Any] = {}

        def is_variant(x: Any, y: Any, ctx: Any = None) -> bool:
            if x["type"] != y["type"]:
                return False
            case_key = x["type"]
            return case_comparers[case_key](x["value"], y["value"], ctx)

        type_ctx.append(is_variant)
        for case_struct in type_val.value:
            case_name = case_struct["name"]
            case_type = case_struct["type"]
            case_comparers[case_name] = is_for(case_type, type_ctx)
        type_ctx.pop()
        return is_variant

    if is_recursive_type(type_val):
        # Look up the comparer from the type context using integer scope_id
        scope_id = type_val.value
        if not isinstance(scope_id, int):
            raise ValueError(f"Recursive type must have integer scope_id, got {type(scope_id)}")

        ctx_index = len(type_ctx) - scope_id
        if ctx_index < 0 or ctx_index >= len(type_ctx):
            raise ValueError(
                f"Invalid recursive scope_id {scope_id} "
                f"(ctx len={len(type_ctx)}, calculated index={ctx_index})"
            )
        return type_ctx[ctx_index]

    if is_function_type(type_val):
        raise RuntimeError("Attempted to compare values of type .Function")

    raise RuntimeError(f"Unknown type encountered during type printing: {type_val.type}")


def compare_for(type_val: Any, type_ctx: list[Any] | None = None) -> Any:
    """Create a three-way comparer for a given type.

    Returns a function that compares two values and returns:
    - -1 if x < y
    - 0 if x == y
    - 1 if x > y

    Args:
        type_val: The East type to create a comparer for
        type_ctx: Stack of comparers for recursive types (internal)

    Returns:
        A function (x, y, ctx) -> Literal[-1, 0, 1]
    """
    if type_ctx is None:
        type_ctx = []

    if is_never_type(type_val):

        def compare_never(_x: Any, _y: Any, _ctx: Any = None) -> int:
            raise RuntimeError("Attempted to compare values of type .Never")

        return compare_never

    if is_null_type(type_val):
        return lambda _x, _y, _ctx=None: 0

    if is_boolean_type(type_val):
        # False < True
        return lambda x, y, _ctx=None: (1 if x else 0) - (1 if y else 0)

    if is_integer_type(type_val):
        return lambda x, y, _ctx=None: -1 if x < y else (1 if x > y else 0)

    if is_float_type(type_val):

        def compare_float(x: float, y: float, _ctx: Any = None) -> int:
            # NaN is ordered last, -0 < 0
            if math.isnan(x):
                return 0 if math.isnan(y) else 1
            if math.isnan(y):
                return -1
            # Handle -0 vs +0
            if x == 0 and y == 0:
                # Check for -0 vs +0
                x_neg_zero = math.copysign(1.0, x) < 0
                y_neg_zero = math.copysign(1.0, y) < 0
                if x_neg_zero and not y_neg_zero:
                    return -1
                if not x_neg_zero and y_neg_zero:
                    return 1
            return -1 if x < y else (1 if x > y else 0)

        return compare_float

    if is_string_type(type_val):
        return lambda x, y, _ctx=None: -1 if x < y else (1 if x > y else 0)

    if is_datetime_type(type_val):
        return (
            lambda x, y, _ctx=None: -1
            if x.timestamp() < y.timestamp()
            else (1 if x.timestamp() > y.timestamp() else 0)
        )

    if is_blob_type(type_val):

        def compare_blob(x: Any, y: Any, _ctx: Any = None) -> int:
            if isinstance(x, EastBlob):
                x = x.data
            if isinstance(y, EastBlob):
                y = y.data
            # Lexicographic byte comparison
            min_len = min(len(x), len(y))
            for i in range(min_len):
                if x[i] < y[i]:
                    return -1
                if x[i] > y[i]:
                    return 1
            return -1 if len(x) < len(y) else (1 if len(x) > len(y) else 0)

        return compare_blob

    if is_vector_type(type_val):
        elem_compare = compare_for(type_val.value, type_ctx)

        def compare_vector(x: EastVector, y: EastVector, _ctx: Any = None) -> int:
            if x is y:
                return 0
            length = min(len(x._data), len(y._data))
            for i in range(length):
                cmp = elem_compare(x._data[i], y._data[i])
                if cmp != 0:
                    return cmp
            return -1 if len(x._data) < len(y._data) else (1 if len(x._data) > len(y._data) else 0)

        return compare_vector

    if is_matrix_type(type_val):
        elem_compare = compare_for(type_val.value, type_ctx)

        def compare_matrix(x: EastMatrix, y: EastMatrix, _ctx: Any = None) -> int:
            if x is y:
                return 0
            if x.rows != y.rows:
                return -1 if x.rows < y.rows else 1
            if x.cols != y.cols:
                return -1 if x.cols < y.cols else 1
            flat_x = x._data.ravel()
            flat_y = y._data.ravel()
            for i in range(len(flat_x)):
                cmp = elem_compare(flat_x[i], flat_y[i])
                if cmp != 0:
                    return cmp
            return 0

        return compare_matrix

    if is_array_type(type_val):
        value_comparer: Any = None

        def compare_array(x: list, y: list, ctx: dict | None = None) -> int:
            # Fast path
            if x is y:
                return 0

            # Cycle detection
            if ctx is None:
                ctx = {}
            x_id = id(x)
            if x_id in ctx and id(y) in ctx[x_id]:
                return 0  # Cycle

            # Mark as visited
            if x_id not in ctx:
                ctx[x_id] = set()
            ctx[x_id].add(id(y))

            # Lexicographic comparison
            min_len = min(len(x), len(y))
            for i in range(min_len):
                c = value_comparer(x[i], y[i], ctx)
                if c != 0:
                    return c
            return -1 if len(x) < len(y) else (1 if len(x) > len(y) else 0)

        type_ctx.append(compare_array)
        value_comparer = compare_for(type_val.value, type_ctx)
        type_ctx.pop()
        return compare_array

    if is_set_type(type_val):
        # Sets are assumed to be sorted
        type_ctx.append(None)  # Placeholder
        key_comparer = compare_for(type_val.value, type_ctx)
        # Create a key class for sorting elements
        elem_key_class = make_east_key(type_val.value)

        def compare_set(x: set, y: set, ctx: Any = None) -> int:
            # Fast path
            if x is y:
                return 0

            # Sort sets first (Python sets don't maintain order) using East ordering
            x_sorted = sorted(x, key=elem_key_class)
            y_sorted = sorted(y, key=elem_key_class)

            # Co-iterate sorted sets
            x_iter = iter(x_sorted)
            y_iter = iter(y_sorted)
            try:
                while True:
                    try:
                        x_elem = next(x_iter)
                    except StopIteration:
                        # x exhausted, check if y has more
                        try:
                            next(y_iter)
                            return -1  # y has more, x < y
                        except StopIteration:
                            return 0  # Both exhausted, equal
                    try:
                        y_elem = next(y_iter)
                    except StopIteration:
                        return 1  # y exhausted but x has more, x > y

                    c = key_comparer(x_elem, y_elem, ctx)
                    if c != 0:
                        return c
            except StopIteration:
                pass
            return 0

        type_ctx[-1] = compare_set
        type_ctx.pop()
        return compare_set

    if is_dict_type(type_val):
        # Dicts are assumed to be sorted by key
        key_comparer = compare_for(type_val.value["key"], type_ctx)
        value_comparer_dict: Any = None

        def compare_dict(x: dict, y: dict, ctx: dict | None = None) -> int:
            # Fast path
            if x is y:
                return 0

            # Cycle detection
            if ctx is None:
                ctx = {}
            x_id = id(x)
            if x_id in ctx and id(y) in ctx[x_id]:
                return 0  # Cycle

            # Mark as visited
            if x_id not in ctx:
                ctx[x_id] = set()
            ctx[x_id].add(id(y))

            # Co-iterate (dicts maintain sorted order by key)
            x_iter = iter(x.items())
            y_iter = iter(y.items())
            try:
                while True:
                    try:
                        xk, xv = next(x_iter)
                    except StopIteration:
                        # x exhausted, check if y has more
                        try:
                            next(y_iter)
                            return -1  # y has more, x < y
                        except StopIteration:
                            return 0  # Both exhausted, equal
                    try:
                        yk, yv = next(y_iter)
                    except StopIteration:
                        return 1  # y exhausted but x has more, x > y

                    kc = key_comparer(xk, yk, None)  # Keys don't have cycles
                    if kc != 0:
                        return kc
                    vc = value_comparer_dict(xv, yv, ctx)
                    if vc != 0:
                        return vc
            except StopIteration:
                pass
            return 0

        type_ctx.append(compare_dict)
        value_comparer_dict = compare_for(type_val.value["value"], type_ctx)
        type_ctx.pop()
        return compare_dict

    if is_ref_type(type_val):
        from east.types.values import EastRef

        # Get inner value comparer
        inner_comparer: Any = None

        def compare_ref(x: EastRef, y: EastRef, ctx: dict | None = None) -> int:
            # Fast path - same identity
            if x is y:
                return 0

            # Create context if needed
            if ctx is None:
                ctx = {}

            # Check if we've visited this pair (cycle detection)
            x_id = id(x)
            if x_id in ctx and id(y) in ctx[x_id]:
                return 0  # Cycle - treat as equal

            # Mark as visited
            if x_id not in ctx:
                ctx[x_id] = set()
            ctx[x_id].add(id(y))

            # Compare inner values
            return inner_comparer(x.value, y.value, ctx)

        type_ctx.append(compare_ref)
        inner_comparer = compare_for(type_val.value, type_ctx)
        type_ctx.pop()
        return compare_ref

    if is_struct_type(type_val):
        # Build field comparers
        field_comparers: list[tuple[str, Any]] = []

        def compare_struct(x: Any, y: Any, ctx: Any = None) -> int:
            for field_name, field_comparer in field_comparers:
                c = field_comparer(x[field_name], y[field_name], ctx)
                if c != 0:
                    return c
            return 0

        type_ctx.append(compare_struct)
        # Structs don't record markers - only Variants do (they're the roots of recursive types)
        for field_struct in type_val.value:
            field_name = field_struct["name"]
            field_type = field_struct["type"]
            field_comparers.append((field_name, compare_for(field_type, type_ctx)))
        type_ctx.pop()
        return compare_struct

    if is_variant_type(type_val):
        # Build case comparers
        case_comparers: dict[str, Any] = {}

        def compare_variant(x: Any, y: Any, ctx: Any = None) -> int:
            # Compare tags first (lexicographic)
            if x["type"] < y["type"]:
                return -1
            if x["type"] > y["type"]:
                return 1
            # Same tag, compare values
            case_key = x["type"]
            return case_comparers[case_key](x["value"], y["value"], ctx)

        type_ctx.append(compare_variant)
        for case_struct in type_val.value:
            case_name = case_struct["name"]
            case_type = case_struct["type"]
            case_comparers[case_name] = compare_for(case_type, type_ctx)
        type_ctx.pop()
        return compare_variant

    if is_recursive_type(type_val):
        # Look up the comparer from the type context using integer scope_id
        scope_id = type_val.value
        if not isinstance(scope_id, int):
            raise ValueError(f"Recursive type must have integer scope_id, got {type(scope_id)}")

        ctx_index = len(type_ctx) - scope_id
        if ctx_index < 0 or ctx_index >= len(type_ctx):
            raise ValueError(
                f"Invalid recursive scope_id {scope_id} "
                f"(ctx len={len(type_ctx)}, calculated index={ctx_index})"
            )
        return type_ctx[ctx_index]

    if is_function_type(type_val) or is_async_function_type(type_val):
        # Functions are always considered equal for comparison
        return lambda _x, _y: 0

    raise RuntimeError(f"Unknown type encountered during type printing: {type_val.type}")


def less_for(type_val: Any, type_ctx: list[Any] | None = None) -> Any:
    """Create a less-than comparer for a given type.

    Args:
        type_val: The East type to create a comparer for
        type_ctx: Stack of comparers for recursive types (internal)

    Returns:
        A function (x, y, ctx) -> bool that returns True if x < y
    """
    comparer = compare_for(type_val, type_ctx)
    return lambda x, y, ctx=None: comparer(x, y, ctx) == -1


def not_equal_for(type_val: Any, type_ctx: list[Any] | None = None) -> Any:
    """Create a not-equal comparer for a given type.

    Args:
        type_val: The East type to create a comparer for
        type_ctx: Stack of comparers for recursive types (internal)

    Returns:
        A function (x, y, ctx) -> bool that returns True if x != y
    """
    eq = equal_for(type_val, type_ctx)
    return lambda x, y, ctx=None: not eq(x, y, ctx)


def less_equal_for(type_val: Any, type_ctx: list[Any] | None = None) -> Any:
    """Create a less-than-or-equal comparer for a given type.

    Args:
        type_val: The East type to create a comparer for
        type_ctx: Stack of comparers for recursive types (internal)

    Returns:
        A function (x, y, ctx) -> bool that returns True if x <= y
    """
    comparer = compare_for(type_val, type_ctx)
    return lambda x, y, ctx=None: comparer(x, y, ctx) != 1


def greater_equal_for(type_val: Any, type_ctx: list[Any] | None = None) -> Any:
    """Create a greater-than-or-equal comparer for a given type.

    Args:
        type_val: The East type to create a comparer for
        type_ctx: Stack of comparers for recursive types (internal)

    Returns:
        A function (x, y, ctx) -> bool that returns True if x >= y
    """
    comparer = compare_for(type_val, type_ctx)
    return lambda x, y, ctx=None: comparer(x, y, ctx) != -1


def greater_for(type_val: Any, type_ctx: list[Any] | None = None) -> Any:
    """Create a greater-than comparer for a given type.

    Args:
        type_val: The East type to create a comparer for
        type_ctx: Stack of comparers for recursive types (internal)

    Returns:
        A function (x, y, ctx) -> bool that returns True if x > y
    """
    comparer = compare_for(type_val, type_ctx)
    return lambda x, y, ctx=None: comparer(x, y, ctx) == 1


# Preserve pure-Python versions for testing
_py_make_east_key = make_east_key
_py_compare_for = compare_for
_py_equal_for = equal_for
_py_is_for = is_for


def _is_cython_accelerated():
    """Return True if Cython-accelerated ordering is active."""
    return getattr(make_east_key, "__module__", "").endswith("_cy")


with contextlib.suppress(ImportError):
    from east.utils._ordering_cy import (  # type: ignore[import-not-found]
        cy_compare_for as compare_for,
    )
    from east.utils._ordering_cy import (
        cy_equal_for as equal_for,
    )
    from east.utils._ordering_cy import (
        cy_is_for as is_for,
    )
    from east.utils._ordering_cy import (
        cy_make_east_key as make_east_key,
    )

__all__ = [
    "TYPE_ORDER",
    "make_east_key",
    "equal_for",
    "is_for",
    "compare_for",
    "less_for",
    "not_equal_for",
    "less_equal_for",
    "greater_equal_for",
    "greater_for",
]
