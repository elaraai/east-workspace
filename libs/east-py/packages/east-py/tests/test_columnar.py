#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Columnar interop tests (issue #255): to_columns/from_columns, map_batches,
bulk extend, dict update_many, and string-interning on the boxing path."""

import numpy as np
import pytest

from east import (
    ArrayType,
    BooleanType,
    EastArray,
    EastBlob,
    EastDict,
    FloatType,
    IntegerType,
    OptionType,
    StringType,
    StructType,
    array,
    if_else,
    kernel,
    none,
    some,
)

ROW = StructType(
    [
        ("sku", StringType),
        ("price", FloatType),
        ("qty", IntegerType),
        ("active", BooleanType),
        ("score", OptionType(FloatType)),
    ]
)

CSV = (
    b"sku,price,qty,active,score\n"
    b"A-1,2.5,4,true,1.5\n"
    b"B-2,150.0,1,false,\n"
    b"A-1,10.0,2,true,3.5\n"
)


def _rows():
    from east.serialization.csv import csv_parse_config

    # score: empty -> none via explicit nullStrings opt-in
    return EastBlob(CSV).decode_csv(ROW, csv_parse_config(null_strings=[""]))


# ─── to_columns ──────────────────────────────────────────────────────────────


def test_to_columns_dtypes_and_values():
    cols = _rows().to_columns()
    assert isinstance(cols["price"], np.ndarray) and cols["price"].dtype == np.float64
    assert isinstance(cols["qty"], np.ndarray) and cols["qty"].dtype == np.int64
    assert isinstance(cols["active"], np.ndarray) and cols["active"].dtype == np.bool_
    assert cols["sku"] == ["A-1", "B-2", "A-1"]
    assert list(cols["price"]) == [2.5, 150.0, 10.0]
    assert list(cols["qty"]) == [4, 1, 2]
    assert list(cols["active"]) == [True, False, True]


def test_to_columns_option_float_is_nan():
    score = _rows().to_columns(["score"])["score"]
    assert score.dtype == np.float64
    assert score[0] == 1.5
    assert np.isnan(score[1])
    assert score[2] == 3.5


def test_to_columns_subset_and_unknown_field():
    cols = _rows().to_columns(["sku", "price"])
    assert set(cols.keys()) == {"sku", "price"}
    with pytest.raises(KeyError, match="unknown field"):
        _rows().to_columns(["nope"])


def test_string_interning_dedupes_boxed_strings():
    rows = _rows()
    a, b = rows[0]["sku"], rows[2]["sku"]
    assert a == b == "A-1"
    assert a is b  # boxed through the intern table


# ─── from_columns ────────────────────────────────────────────────────────────


def test_from_columns_round_trip():
    rows = _rows()
    cols = rows.to_columns()
    rebuilt = EastArray.from_columns(ROW, cols)
    assert len(rebuilt) == len(rows)
    for lhs, rhs in zip(rebuilt, rows, strict=True):
        assert lhs["sku"] == rhs["sku"]
        assert lhs["price"] == rhs["price"]
        assert lhs["qty"] == rhs["qty"]
        assert lhs["active"] == rhs["active"]
        assert lhs["score"].type == rhs["score"].type


def test_from_columns_option_float_nan_is_none():
    T = StructType([("v", OptionType(FloatType))])
    arr = EastArray.from_columns(T, {"v": np.array([1.0, np.nan, 3.0])})
    assert [r["v"].type for r in arr] == ["some", "none", "some"]


def test_from_columns_validation():
    T = StructType([("a", FloatType), ("b", FloatType)])
    with pytest.raises(ValueError, match="expected"):
        EastArray.from_columns(T, {"a": np.array([1.0]), "b": np.array([1.0, 2.0])})
    with pytest.raises(KeyError, match="missing column"):
        EastArray.from_columns(T, {"a": np.array([1.0])})
    with pytest.raises(KeyError, match="not in element type"):
        EastArray.from_columns(T, {"a": [1.0], "b": [2.0], "c": [3.0]})


def test_vectorised_pipeline():
    """decode -> to_columns -> numpy -> from_columns, all O(columns) crossings."""
    rows = _rows()
    cols = rows.to_columns(["sku", "price", "qty"])
    amount = cols["price"] * cols["qty"].astype(np.float64)
    Out = StructType([("sku", StringType), ("amount", FloatType)])
    out = EastArray.from_columns(Out, {"sku": cols["sku"], "amount": amount})
    assert [r["amount"] for r in out] == [10.0, 150.0, 20.0]


# ─── map_batches ────────────────────────────────────────────────────────────


def test_map_batches_multiple_batches():
    rows = _rows()

    def double_price(cols):
        return {
            "sku": cols["sku"],
            "price": cols["price"] * 2.0,
            "qty": cols["qty"],
            "active": cols["active"],
            "score": cols["score"],
        }

    out = rows.map_batches(double_price, batch_size=2)  # 3 rows -> 2 batches
    assert len(out) == 3
    assert [r["price"] for r in out] == [5.0, 300.0, 20.0]


def test_map_batches_with_output_type_and_shrink():
    rows = _rows()
    Out = StructType([("sku", StringType), ("amount", FloatType)])

    def expensive_only(cols):
        amount = cols["price"] * cols["qty"].astype(np.float64)
        mask = amount > 15.0
        return {"sku": [s for s, m in zip(cols["sku"], mask, strict=True) if m],
                "amount": amount[mask]}

    out = rows.map_batches(expensive_only, out=Out, batch_size=2)
    assert [(r["sku"], r["amount"]) for r in out] == [("B-2", 150.0), ("A-1", 20.0)]


def test_map_batches_empty_array():
    empty = EastArray(ROW, [])
    out = empty.map_batches(lambda cols: cols)
    assert len(out) == 0


# ─── bulk extend ────────────────────────────────────────────────────────────


def test_extend_numpy_bulk():
    arr = EastArray(FloatType, [1.0])
    arr.extend(np.array([2.0, 3.0, 4.0]))
    assert list(arr) == [1.0, 2.0, 3.0, 4.0]

    iarr = EastArray(IntegerType, [])
    iarr.extend(np.arange(3, dtype=np.int64))
    assert list(iarr) == [0, 1, 2]


def test_extend_same_type_east_array_c_to_c():
    a = _rows()
    b = _rows()
    n = len(a)
    a.extend(b)
    assert len(a) == 2 * n
    assert a[n]["sku"] == b[0]["sku"]


def test_extend_generic_iterable():
    arr = EastArray(StringType, ["x"])
    arr.extend(["y", "z"])
    assert list(arr) == ["x", "y", "z"]


# ─── dict update_many ───────────────────────────────────────────────────────


def test_update_many_no_combine_overwrites():
    d = EastDict(StringType, FloatType, {"a": 1.0})
    d.update_many(["a", "b"], [10.0, 20.0])
    assert d["a"] == 10.0
    assert d["b"] == 20.0


def test_update_many_python_combine():
    d = EastDict(StringType, FloatType, {"a": 1.0})
    seen = []
    d.update_many(["a", "a", "b"], [2.0, 3.0, 5.0],
                  combine=lambda cur, new: (seen.append(1), cur + new)[1])
    assert d["a"] == 6.0
    assert d["b"] == 5.0
    assert len(seen) == 2  # called per collision on the python path


def test_update_many_traced_combine():
    d = EastDict(StringType, FloatType, {"a": 1.0})
    d.update_many(["a", "a", "b"], [2.0, 3.0, 5.0], combine=lambda cur, new: cur + new)
    assert d["a"] == 6.0
    assert d["b"] == 5.0


def test_update_many_precompiled_kernel_combine():
    d = EastDict(StringType, FloatType, {"a": 1.0})
    k = kernel([FloatType, FloatType], lambda cur, new: cur + new)
    d.update_many(["a", "b", "a"], [2.0, 7.0, 4.0], combine=k)
    assert d["a"] == 7.0
    assert d["b"] == 7.0


def test_update_many_length_mismatch():
    d = EastDict(StringType, FloatType)
    with pytest.raises(ValueError, match="keys but"):
        d.update_many(["a"], [1.0, 2.0])


def test_update_many_accumulator_pattern():
    """The issue's hot-loop accumulator: totals by key in one crossing."""
    rows = _rows()
    cols = rows.to_columns(["sku", "price"])
    d = EastDict(StringType, FloatType)
    d.update_many(cols["sku"], cols["price"], combine=lambda cur, new: cur + new)
    assert d["A-1"] == 12.5
    assert d["B-2"] == 150.0


# ─── dict update_many: the C-backed path (no python boxing) ─────────────────
#
# `update_many` used to force `list(keys), list(values)`, boxing every element
# C->python only for the bridge to convert it back python->C. That contradicted
# its own contract ("the whole batch crosses once") and, on deeply nested
# element types, the boxing exhausted or corrupted memory: MemoryError inside
# `_box_string` at ~42k entries and SIGSEGV under `list_extend` at ~61k.
# East-backed arrays now pass by pointer and are read with `east_array_get`.


def _nested_value_type():
    """A value shaped like the one that crashed: a struct holding an inner
    Array<Struct> of all-Option fields plus a nested struct of Options."""
    inner = StructType([
        ("grade", OptionType(StringType)),
        ("batch", OptionType(StringType)),
        ("level_before", OptionType(FloatType)),
        ("level_after", OptionType(FloatType)),
    ])
    return StructType([
        ("allocations", ArrayType(inner)),
        ("unallocated", StructType([("before", OptionType(FloatType)),
                                    ("after", OptionType(FloatType))])),
        ("quality", OptionType(StringType)),
    ])


def test_update_many_accepts_east_arrays():
    d = EastDict(StringType, FloatType)
    d.update_many(array(StringType, ["a", "b"]), array(FloatType, [1.0, 2.0]))
    assert d["a"] == 1.0 and d["b"] == 2.0


def test_update_many_east_arrays_with_native_combine():
    d = EastDict(StringType, FloatType, {"a": 1.0})
    d.update_many(array(StringType, ["a", "a", "b"]),
                  array(FloatType, [2.0, 3.0, 5.0]),
                  combine=lambda cur, new: cur + new)
    assert d["a"] == 6.0 and d["b"] == 5.0


def test_update_many_east_arrays_with_python_combine():
    # an impure combine cannot trace, so it runs per collision in python and
    # the incoming value must still be unboxed correctly on the C-backed path
    calls = []

    def combine(cur, new):
        calls.append((cur, new))
        return cur + new

    d = EastDict(StringType, FloatType, {"a": 1.0})
    d.update_many(array(StringType, ["a", "a"]), array(FloatType, [2.0, 3.0]),
                  combine=combine)
    assert d["a"] == 6.0
    assert calls == [(1.0, 2.0), (3.0, 3.0)]


def test_update_many_rejects_mismatched_element_type():
    from east.types.coercion import EastTypeError

    d = EastDict(StringType, FloatType)
    with pytest.raises(EastTypeError, match="keyed by"):
        d.update_many(array(IntegerType, [1]), array(FloatType, [1.0]))
    with pytest.raises(EastTypeError, match="this dict holds"):
        d.update_many(array(StringType, ["a"]), array(IntegerType, [1]))


def test_update_many_rejects_length_mismatch_for_east_arrays():
    d = EastDict(StringType, FloatType)
    with pytest.raises(ValueError, match="2 keys but 1 values"):
        d.update_many(array(StringType, ["a", "b"]), array(FloatType, [1.0]))


def test_update_many_deeply_nested_option_values_at_scale():
    """The regression: 61k kernel-produced nested Option values used to SIGSEGV."""
    val_t = _nested_value_type()
    key_t = StructType([("job", StringType), ("station", StringType)])
    n = 61_238

    # `allocations` comes from a source field: a bare `[]` cannot be lifted
    # into a kernel, and the point here is the value SHAPE, not how it is built.
    inner = val_t.value[0]["type"].value
    src = StructType([("id", StringType), ("station", OptionType(StringType)),
                      ("allocs", ArrayType(inner))])
    rows = array(src, [{"id": f"C{i}", "station": some(f"S{i}"),
                        "allocs": [{"grade": some("A1"), "batch": some("18"),
                                    "level_before": some(1.0),
                                    "level_after": none}]} for i in range(n)])

    k_key = kernel(src, lambda r: {"job": r["id"],
                                   "station": r["station"].unwrap_or("")})
    k_val = kernel(src, lambda r: {
        "allocations": r["allocs"],
        "unallocated": {"before": if_else(r["station"].is_some(), some(1.0), none),
                        "after": if_else(r["station"].is_some(), some(2.0), none)},
        "quality": if_else(r["station"].is_some(), some("D2"), none),
    })
    keys = rows.map(k_key, out=key_t)
    values = rows.map(k_val, out=val_t)
    assert isinstance(keys, EastArray) and isinstance(values, EastArray)

    d = EastDict(key_t, val_t)
    d.update_many(keys, values)          # SIGSEGV before the fix
    assert len(d) == n
