#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Coercion tests for the numpy columnar path (issue #386): a 1-D ndarray
against ``Array<Float/Integer/Boolean>`` fills C-side in one bulk crossing,
and a same-element-type EastArray copies C-to-C instead of re-boxing."""

import numpy as np
import pytest

from east import (
    ArrayType,
    BooleanType,
    EastArray,
    EastTypeError,
    FloatType,
    IntegerType,
    StringType,
    StructType,
    coerce_to,
)

# The exact shape of the issue's motivating caller (min-cost flow input).
FLOW = StructType(
    [
        ("start_nodes", ArrayType(IntegerType)),
        ("end_nodes", ArrayType(IntegerType)),
        ("capacities", ArrayType(IntegerType)),
        ("unit_costs", ArrayType(IntegerType)),
        ("supplies", ArrayType(IntegerType)),
    ]
)


# ─── ndarray → Array<Integer> ────────────────────────────────────────────────


def test_numpy_int64_to_integer_array():
    arr = coerce_to(np.array([1, -2, 3], dtype=np.int64), ArrayType(IntegerType))
    assert isinstance(arr, EastArray)
    assert arr.element_type == IntegerType
    assert list(arr) == [1, -2, 3]


def test_numpy_path_matches_list_path():
    data = [5, -3, 0, 2**53]
    via_numpy = coerce_to(np.array(data, dtype=np.int64), ArrayType(IntegerType))
    via_list = coerce_to(data, ArrayType(IntegerType))
    assert list(via_numpy) == list(via_list)


def test_numpy_narrow_int_dtypes_cast():
    assert list(coerce_to(np.array([1, 2], dtype=np.int32), ArrayType(IntegerType))) == [1, 2]
    assert list(coerce_to(np.array([3, 4], dtype=np.uint32), ArrayType(IntegerType))) == [3, 4]
    assert list(coerce_to(np.array([5], dtype=np.int8), ArrayType(IntegerType))) == [5]


def test_numpy_uint64_rejected_for_integer():
    with pytest.raises(EastTypeError, match="uint64"):
        coerce_to(np.array([1], dtype=np.uint64), ArrayType(IntegerType))


def test_numpy_float_rejected_for_integer():
    with pytest.raises(EastTypeError, match="float64"):
        coerce_to(np.array([1.5]), ArrayType(IntegerType))


def test_numpy_bool_rejected_for_integer():
    with pytest.raises(EastTypeError, match="bool"):
        coerce_to(np.array([True]), ArrayType(IntegerType))


# ─── ndarray → Array<Float> ──────────────────────────────────────────────────


def test_numpy_float64_to_float_array():
    arr = coerce_to(np.array([2.5, -0.5]), ArrayType(FloatType))
    assert list(arr) == [2.5, -0.5]
    assert all(isinstance(x, float) for x in arr)


def test_numpy_float32_cast():
    assert list(coerce_to(np.array([1.5], dtype=np.float32), ArrayType(FloatType))) == [1.5]


def test_numpy_int_to_float_array():
    # Mirrors the scalar rule: Float accepts int.
    arr = coerce_to(np.array([1, 2], dtype=np.int64), ArrayType(FloatType))
    assert list(arr) == [1.0, 2.0]
    assert all(isinstance(x, float) for x in arr)


def test_numpy_bool_rejected_for_float():
    with pytest.raises(EastTypeError, match="bool"):
        coerce_to(np.array([True]), ArrayType(FloatType))


# ─── ndarray → Array<Boolean> ────────────────────────────────────────────────


def test_numpy_bool_to_boolean_array():
    arr = coerce_to(np.array([True, False, True]), ArrayType(BooleanType))
    assert list(arr) == [True, False, True]
    assert all(isinstance(x, bool) for x in arr)


def test_numpy_int_rejected_for_boolean():
    with pytest.raises(EastTypeError, match="int64"):
        coerce_to(np.array([0, 1], dtype=np.int64), ArrayType(BooleanType))


# ─── shape / dtype / layout edge cases ───────────────────────────────────────


def test_numpy_2d_rejected():
    with pytest.raises(EastTypeError, match="1-D"):
        coerce_to(np.zeros((2, 2), dtype=np.int64), ArrayType(IntegerType))


def test_numpy_noncontiguous_slice():
    base = np.arange(10, dtype=np.int64)
    assert list(coerce_to(base[::2], ArrayType(IntegerType))) == [0, 2, 4, 6, 8]


def test_numpy_bigendian_normalized():
    assert list(coerce_to(np.array([1, 2], dtype=">i8"), ArrayType(IntegerType))) == [1, 2]


def test_numpy_object_dtype_rejected():
    with pytest.raises(EastTypeError, match="object"):
        coerce_to(np.array([1, "x"], dtype=object), ArrayType(IntegerType))


def test_numpy_datetime64_rejected():
    with pytest.raises(EastTypeError, match="datetime64"):
        coerce_to(np.array(["2026-01-01"], dtype="datetime64[ns]"), ArrayType(IntegerType))


def test_numpy_string_element_type_rejected():
    with pytest.raises(EastTypeError, match=r"tolist"):
        coerce_to(np.array(["a", "b"]), ArrayType(StringType))


def test_numpy_empty():
    arr = coerce_to(np.array([], dtype=np.int64), ArrayType(IntegerType))
    assert list(arr) == []


# ─── struct fields + nesting (the issue's caller shape) ──────────────────────


def test_struct_fields_take_numpy_columns():
    n = 1000
    start = np.arange(n, dtype=np.int64)
    end = np.arange(n, dtype=np.int64) + 1
    cap = np.full(n, 7, dtype=np.int64)
    cost = np.full(n, 3, dtype=np.int64)
    supplies = np.array([1, 0, -1], dtype=np.int64)
    flow = coerce_to(
        {
            "start_nodes": start,
            "end_nodes": end,
            "capacities": cap,
            "unit_costs": cost,
            "supplies": supplies,
        },
        FLOW,
    )
    assert list(flow["start_nodes"])[:3] == [0, 1, 2]
    assert list(flow["end_nodes"])[-1] == n
    assert list(flow["capacities"])[500] == 7
    assert list(flow["unit_costs"])[0] == 3
    assert list(flow["supplies"]) == [1, 0, -1]


def test_struct_field_error_is_path_pinpointed():
    with pytest.raises(EastTypeError) as e:
        coerce_to({"start_nodes": np.array([1.5])}, StructType([("start_nodes", ArrayType(IntegerType))]))
    assert e.value.path == "$.start_nodes"


def test_nested_array_of_numpy_rows():
    rows = [np.array([1, 2], dtype=np.int64), np.array([3], dtype=np.int64)]
    nested = coerce_to(rows, ArrayType(ArrayType(IntegerType)))
    assert [list(r) for r in nested] == [[1, 2], [3]]


def test_large_column_spot_checks():
    n = 170_000
    arr = coerce_to(np.arange(n, dtype=np.int64), ArrayType(IntegerType))
    assert len(arr) == n
    assert arr[0] == 0
    assert arr[n - 1] == n - 1


# ─── EastArray same-element-type fast copy ───────────────────────────────────


def test_east_array_same_type_is_copied_not_aliased():
    src = EastArray(IntegerType, [1, 2, 3])
    out = coerce_to(src, ArrayType(IntegerType))
    assert out is not src
    assert list(out) == [1, 2, 3]
    out.push_last(4)
    src.push_last(9)
    assert list(src) == [1, 2, 3, 9]
    assert list(out) == [1, 2, 3, 4]


def test_east_array_mismatched_element_still_validated():
    with pytest.raises(EastTypeError) as e:
        coerce_to(EastArray(FloatType, [1.5]), ArrayType(IntegerType))
    assert e.value.path == "$[0]"
