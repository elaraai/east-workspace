#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Kernel-tracer hardening (#543): the proxy bail for f-strings (#530), the
``EAST_KERNEL_STRICT`` observable fallback, and the #536 keyword sweep —
``out=``-family pins accepted by the traced twins AND threaded into the
callback's trace as its expected type (so a pinned callback can build a
general variant, #541).
"""

import pytest

from east import (
    EastArray,
    EastDict,
    IntegerType,
    NullType,
    SetType,
    StringType,
    StructType,
    VariantType,
    east_null,
    kernel,
    variant,
    where,
)
from east.kernel import KernelTraceError

Source = VariantType([("vessel", StringType), ("added", NullType)])
Row = StructType([("code", StringType)])


def _rows() -> EastArray:
    return EastArray(Row, [{"code": "TANK-1"}, {"code": "ADDED"}])


# ── #530: f-strings / str() bail loudly instead of constant-folding ────────

def test_fstring_in_an_explicit_kernel_raises():
    with pytest.raises(KernelTraceError, match="constant-fold"):
        kernel(StringType, lambda s: f"<{s}>")


def test_str_call_in_an_explicit_kernel_raises():
    with pytest.raises(KernelTraceError, match="constant-fold"):
        kernel(StringType, lambda s: "<" + str(s) + ">")


def test_fstring_on_the_eager_path_falls_back_to_a_CORRECT_python_result():
    # The issue's silent-garbage case: before the bail, the traced constant
    # '<KernelExpr String>' was returned for every element.
    arr = EastArray(StringType, ["p", "q"])
    assert list(arr.map(lambda s: f"<{s}>", out=StringType)) == ["<p>", "<q>"]


def test_repr_still_works_for_diagnostics():
    got = kernel(StringType, lambda s: _probe_repr(s))("x")
    assert got == "x"


def _probe_repr(s):
    # repr() must stay usable (error messages, debugging) — only str()/format
    # bail. The lambda returns the expression untouched after taking a repr.
    assert "KernelExpr" in repr(s)
    return s


# ── EAST_KERNEL_STRICT: eligible-but-untraceable raises ────────────────────

def test_strict_mode_raises_for_an_eligible_lambda_that_cannot_trace(monkeypatch):
    monkeypatch.setenv("EAST_KERNEL_STRICT", "1")
    arr = EastArray(StringType, ["p", "q"])
    # An f-string lambda passes the purity gate but fails to trace — strict
    # surfaces the silent per-element fallback as the underlying trace error.
    with pytest.raises(KernelTraceError, match="constant-fold"):
        arr.map(lambda s: f"<{s}>", out=StringType)


def test_strict_mode_keeps_the_python_fallback_for_impure_lambdas(monkeypatch):
    monkeypatch.setenv("EAST_KERNEL_STRICT", "1")
    log: list = []
    arr = EastArray(IntegerType, [1, 2])
    # Mutating a closure fails the PURITY gate — not eligible, so the silent
    # python path is still the contract, strict or not.
    assert list(arr.map(lambda x: (log.append(x) or x + 1), out=IntegerType)) == [2, 3]
    assert log == [1, 2]


def test_without_strict_the_fallback_stays_silent_and_correct():
    arr = EastArray(StringType, ["p"])
    assert list(arr.map(lambda s: f"<{s}>", out=StringType)) == ["<p>"]


# ── #536: the out= sweep, threading the hint into the callback ─────────────

def test_map_out_is_accepted_and_types_a_variant_building_callback():
    out = _rows().map(lambda r: variant("vessel", r["code"]), out=Source)
    assert [(v.type, v.value) for v in out] == [("vessel", "TANK-1"), ("vessel", "ADDED")]


def test_map_out_contradiction_raises():
    with pytest.raises(KernelTraceError, match="out= declares"):
        kernel(ArrayTypeOf(IntegerType), lambda a: a.map(lambda x: x + 1, out=StringType))


def ArrayTypeOf(t):
    from east import ArrayType

    return ArrayType(t)


def test_filter_map_out_types_the_some_payload():
    from east import none, some

    out = _rows().filter_map(
        lambda r: where(r["code"] == "ADDED", none, some(variant("vessel", r["code"]))),
        out=Source,
    )
    assert [(v.type, v.value) for v in out] == [("vessel", "TANK-1")]


def test_map_reduce_out_is_accepted():
    arr = EastArray(IntegerType, [1, 2, 3])
    got = arr.map_reduce(lambda x: x * 2, lambda a, b: a + b, out=IntegerType)
    assert got == 12


def test_flatten_out_pins_the_element_type():
    from east import ArrayType

    arr = EastArray(ArrayType(IntegerType), [[1, 2], [3]])
    got = arr.flatten_to_array(lambda xs: xs, out=IntegerType)
    assert list(got) == [1, 2, 3]
    with pytest.raises(KernelTraceError, match="out= declares"):
        kernel(ArrayType(ArrayType(IntegerType)),
               lambda a: a.flatten_to_array(lambda xs: xs, out=StringType))


def test_to_dict_key_and_value_outs_type_the_projections():
    d = EastDict(StringType, IntegerType, {"a": 1, "b": 2})
    got = d.to_dict(
        lambda k, _v: variant("vessel", k),
        lambda _k, v: v,
        None,
        key_out=Source,
        value_out=IntegerType,
    )
    assert {k.type for k in got} == {"vessel"}


def test_group_fold_key_out_types_a_variant_group_key():
    d = EastDict(StringType, IntegerType, {"a": 1, "ADDED": 2})
    got = d.group_fold(
        lambda k, _v: where(k == "ADDED", variant("added", east_null),
                            variant("vessel", k)),
        lambda _gk: 0,
        lambda acc, _k, v: acc + v,
        key_out=Source,
        acc_out=IntegerType,
    )
    assert {k.type for k in got} == {"vessel", "added"}
    assert sum(got.values()) == 3


def test_every_some_take_the_pred_keyword():
    arr = EastArray(IntegerType, [1, 2, 3])
    assert kernel(ArrayTypeOf(IntegerType), lambda a: a.every(pred=lambda x: x > 0))(arr)
    assert not kernel(ArrayTypeOf(IntegerType), lambda a: a.some(pred=lambda x: x > 5))(arr)


def test_set_to_array_takes_the_key_keyword():
    from east import EastSet

    s = EastSet(IntegerType, [3, 1, 2])
    got = kernel(SetType(IntegerType), lambda x: x.to_array(key=lambda e: e * 10))(s)
    assert list(got) == [10, 20, 30]


def test_group_to_arrays_takes_the_value_fn_keyword():
    d = EastDict(StringType, IntegerType, {"a": 1, "b": 2})
    got = kernel(
        _dict_t(), lambda x: x.group_to_arrays(lambda k, _v: k, value_fn=lambda _k, v: v)
    )(d)
    assert {k: list(v) for k, v in got.items()} == {"a": [1], "b": [2]}


def _dict_t():
    from east import DictType

    return DictType(StringType, IntegerType)
