#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Kernel-tracer hardening (#543): the proxy bail for f-strings (#530), the
strict one-mode contract (any callback that fails to capture RAISES — there
is no per-element python fallback, #625), and the #536 keyword sweep —
``out=``-family pins accepted by the traced twins AND threaded into the
callback's trace as its expected type (so a pinned callback can build a
general variant, #541).
"""

import pytest

from east import (
    ArrayType,
    BooleanType,
    DictType,
    East,
    EastArray,
    EastDict,
    IntegerType,
    NullType,
    SetType,
    StringType,
    StructType,
    VariantType,
    east_null,
    if_else,
    variant,
)
from east.expression import ExpressionError

Source = VariantType([("vessel", StringType), ("added", NullType)])
Row = StructType([("code", StringType)])


def _rows() -> EastArray:
    return EastArray(Row, [{"code": "TANK-1"}, {"code": "ADDED"}])


# ── #530: f-strings / str() bail loudly instead of constant-folding ────────

def test_fstring_in_an_explicit_kernel_raises():
    with pytest.raises(ExpressionError, match="constant-fold"):
        East.function([StringType], StringType, lambda _b, s: f"<{s}>")


def test_str_call_in_an_explicit_kernel_raises():
    with pytest.raises(ExpressionError, match="constant-fold"):
        East.function([StringType], StringType, lambda _b, s: "<" + str(s) + ">")


def test_repr_still_works_for_diagnostics():
    got = East.function([StringType], StringType, lambda _b, s: _probe_repr(s))("x")
    assert got == "x"


def _probe_repr(s):
    # repr() must stay usable (error messages, debugging) — only str()/format
    # bail. The lambda returns the expression untouched after taking a repr.
    assert "Expression" in repr(s)
    return s


# ── any callback that fails to capture RAISES (#625) ───────────────────────

def test_an_untraceable_callback_raises_on_the_eager_path():
    arr = EastArray(StringType, ["p", "q"])
    # An f-string lambda LOOKS native but cannot trace — its failure
    # surfaces loudly instead of silently trampolining per element (the
    # hours-not-errors failure mode, #524). The error names the traced
    # spelling.
    with pytest.raises(ExpressionError, match="constant-fold"):
        arr.map(lambda _b, s: f"<{s}>", out=StringType)


def test_impure_callbacks_are_refused():
    log: list = []
    arr = EastArray(IntegerType, [1, 2])
    # Mutating a closure has no East capture (#625): refused before any
    # element runs — there is no silent per-element python path anymore.
    with pytest.raises(ExpressionError, match="captured automatically"):
        arr.map(lambda _b, x: (log.append(x) or x + 1), out=IntegerType)
    assert log == []


# ── #536: the out= sweep, threading the hint into the callback ─────────────

def test_map_out_is_accepted_and_types_a_variant_building_callback():
    out = _rows().map(lambda _b, r: variant("vessel", r["code"]), out=Source)
    assert [(v.type, v.value) for v in out] == [("vessel", "TANK-1"), ("vessel", "ADDED")]


def test_map_out_contradiction_raises():
    with pytest.raises(ExpressionError, match="out= declares"):
        East.function([ArrayTypeOf(IntegerType)], ArrayType(IntegerType),
                      lambda _b, a: a.map(lambda _b, x: x + 1, out=StringType))


def ArrayTypeOf(t):
    from east import ArrayType

    return ArrayType(t)


def test_filter_map_out_types_the_some_payload():
    from east import none, some

    out = _rows().filter_map(
        lambda _b, r: if_else(r["code"] == "ADDED", none, some(variant("vessel", r["code"]))),
        out=Source,
    )
    assert [(v.type, v.value) for v in out] == [("vessel", "TANK-1")]


def test_map_reduce_out_is_accepted():
    arr = EastArray(IntegerType, [1, 2, 3])
    got = arr.map_reduce(lambda _b, x: x * 2, lambda _b, a, b: a + b, out=IntegerType)
    assert got == 12


def test_flatten_out_pins_the_element_type():
    from east import ArrayType

    arr = EastArray(ArrayType(IntegerType), [[1, 2], [3]])
    got = arr.flat_map(lambda _b, xs: xs, out=IntegerType)
    assert list(got) == [1, 2, 3]
    with pytest.raises(ExpressionError, match="out= declares"):
        East.function([ArrayType(ArrayType(IntegerType))], ArrayType(IntegerType),
                      lambda _b, a: a.flat_map(lambda _b, xs: xs, out=StringType))


def test_to_dict_key_and_value_outs_type_the_projections():
    d = EastDict(StringType, IntegerType, {"a": 1, "b": 2})
    got = d.to_dict(
        lambda _b, _v, k: variant("vessel", k),
        lambda _b, v: v,
        None,
        key_out=Source,
        value_out=IntegerType,
    )
    assert {k.type for k in got} == {"vessel"}


def test_group_reduce_key_out_types_a_variant_group_key():
    d = EastDict(StringType, IntegerType, {"a": 1, "ADDED": 2})
    got = d.group_reduce(
        lambda _b, _v, k: if_else(k == "ADDED", variant("added", east_null),
                            variant("vessel", k)),
        lambda _b, _gk: 0,
        lambda _b, acc, v: acc + v,
        key_out=Source,
        acc_out=IntegerType,
    )
    assert {k.type for k in got} == {"vessel", "added"}
    assert sum(got.values()) == 3


def test_every_some_take_the_pred_keyword():
    arr = EastArray(IntegerType, [1, 2, 3])
    every_k = East.function([ArrayTypeOf(IntegerType)], BooleanType,
                            lambda _b, a: a.every(pred=lambda _b, x: x > 0))
    some_k = East.function([ArrayTypeOf(IntegerType)], BooleanType,
                           lambda _b, a: a.some(pred=lambda _b, x: x > 5))
    assert every_k(arr)
    assert not some_k(arr)


def test_set_to_array_takes_the_key_keyword():
    from east import EastSet

    s = EastSet(IntegerType, [3, 1, 2])
    got = East.function([SetType(IntegerType)], ArrayType(IntegerType),
                        lambda _b, x: x.to_array(key=lambda _b, e: e * 10))(s)
    assert list(got) == [10, 20, 30]


def test_group_to_arrays_takes_the_value_fn_keyword():
    d = EastDict(StringType, IntegerType, {"a": 1, "b": 2})
    got = East.function(
        [_dict_t()], DictType(StringType, ArrayType(IntegerType)),
        lambda _b, x: x.group_to_arrays(lambda _b, _v, k: k, value_fn=lambda _b, v: v))(d)
    assert {k: list(v) for k, v in got.items()} == {"a": [1], "b": [2]}


def _dict_t():
    from east import DictType

    return DictType(StringType, IntegerType)
