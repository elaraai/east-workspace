#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""IR push-down tests: traced kernels + eager-method integration (issue #256).

``east.kernel`` traces pure python lambdas into East IR compiled by east-c;
eager collection methods push callbacks down automatically when the purity
gate allows, and fall back to the per-element python path otherwise.
"""

import pytest

from east import (
    EastBlob,
    FloatType,
    IntegerType,
    KernelTraceError,
    StringType,
    StructType,
    kernel,
    where,
)
from east.kernel import _eligible, try_push_down
from east.types.values.structural import EastFunction

ROW = StructType([("sku", StringType), ("price", FloatType), ("qty", FloatType)])

CSV = b"sku,price,qty\nA-1,2.5,4.0\nB-2,150.0,1.0\nA-1,10.0,2.0\n"


def _rows():
    return EastBlob(CSV).decode_csv(ROW)


# ─── explicit kernels ────────────────────────────────────────────────────────


def test_kernel_arithmetic():
    k = kernel(ROW, lambda r: r.price * r.qty)
    assert k({"sku": "x", "price": 2.5, "qty": 4.0}) == 10.0


def test_kernel_comparison_and_boolean_algebra():
    k = kernel(ROW, lambda r: (r.sku == "A-1") & (r.price > 100.0))
    assert k({"sku": "A-1", "price": 150.0, "qty": 1.0}) is True
    assert k({"sku": "B-2", "price": 150.0, "qty": 1.0}) is False


def test_kernel_where_conditional():
    k = kernel(ROW, lambda r: where(r.qty > 0.0, r.price / r.qty, 0.0))
    assert k({"sku": "x", "price": 10.0, "qty": 4.0}) == 2.5
    assert k({"sku": "x", "price": 10.0, "qty": 0.0}) == 0.0


def test_kernel_multi_param_fold_step():
    step = kernel([FloatType, ROW], lambda acc, r: acc + r.price)
    assert step(1.0, {"sku": "x", "price": 2.5, "qty": 0.0}) == 3.5


def test_kernel_integer_and_string_ops():
    ki = kernel(IntegerType, lambda x: (x * x) + 1)
    assert ki(7) == 50
    ks = kernel(ROW, lambda r: r.sku.upper() + "!")
    assert ks({"sku": "abc", "price": 0.0, "qty": 0.0}) == "ABC!"


def test_kernel_untraceable_raises():
    with pytest.raises(KernelTraceError, match="cannot be traced"):
        kernel(ROW, lambda r: r.price if r.qty > 0 else 0.0)


def test_kernel_out_mismatch_raises():
    with pytest.raises(TypeError, match="expected"):
        kernel(ROW, lambda r: r.price, out=StringType)


def test_kernel_type_errors_are_loud():
    with pytest.raises(KernelTraceError, match="no field"):
        kernel(ROW, lambda r: r.missing)
    with pytest.raises(KernelTraceError, match="coercion"):
        kernel(ROW, lambda r: r.price + r.sku.length())


# ─── the purity gate ────────────────────────────────────────────────────────


def test_gate_accepts_pure_lambdas():
    assert _eligible(lambda r: r.price * r.qty)
    rate = 1.1
    assert _eligible(lambda r: r.price * rate)  # scalar closure is stable


def test_gate_rejects_module_and_callable_references():
    import random

    assert not _eligible(lambda r: random.random())
    model = {"weights": 1.0}
    assert not _eligible(lambda r: model["weights"])  # mutable closure


def test_gate_rejects_closure_mutation():
    count = 0

    def bump(r):
        nonlocal count
        count += 1
        return r

    assert not _eligible(bump)


def test_try_push_down_respects_declared_output():
    # Declared Boolean output but traced Float -> no push-down (the python
    # path's truthiness semantics are preserved)
    from east.types.types import BooleanType

    ef = EastFunction(lambda el, idx: el, [FloatType, IntegerType], BooleanType)
    assert try_push_down(ef) is None


# ─── eager-method integration (implicit push-down) ──────────────────────────


def test_map_pushes_down_pure_lambda():
    amounts = _rows().map(lambda r: r["price"] * r["qty"])
    assert list(amounts) == [10.0, 150.0, 20.0]


def test_map_accepts_precompiled_kernel():
    k = kernel(ROW, lambda r: r.price * r.qty)
    amounts = _rows().map(k)
    assert list(amounts) == [10.0, 150.0, 20.0]


def test_filter_pushes_down_and_matches_python_semantics():
    rows = _rows()
    hot = rows.filter(lambda r: (r["sku"] == "A-1") & (r["price"] > 5.0))
    assert [r["price"] for r in hot] == [10.0]


def test_filter_truthiness_falls_back():
    # Python truthiness on a Float is untraceable as Boolean — must still work
    rows = _rows().filter(lambda r: r["qty"] - 1.0)
    assert [r["sku"] for r in rows] == ["A-1", "A-1"]


def test_fold_pushes_down():
    total = _rows().fold(0.0, lambda acc, r: acc + r["price"] * r["qty"])
    assert total == 180.0


def test_impure_lambda_keeps_python_semantics():
    seen = []
    rows = _rows()
    doubled = rows.map(lambda r: (seen.append(r["sku"]), r["price"] * 2.0)[1])
    assert list(doubled) == [5.0, 300.0, 20.0]
    # map() samples fn on the first element to infer the output type (a
    # pre-existing behaviour), then the python path runs once per element —
    # crucially NOT once total, which is what a mis-applied trace would give
    assert seen == ["A-1", "A-1", "B-2", "A-1"]


def test_group_by_native_path():
    groups = _rows().group_by(lambda r: r["sku"])
    assert sorted(groups.keys()) == ["A-1", "B-2"]
    assert [r["price"] for r in groups["A-1"]] == [2.5, 10.0]
    assert [r["price"] for r in groups["B-2"]] == [150.0]


def test_to_dict_and_sorted_push_down():
    rows = _rows()
    total_by_sku = rows.to_dict(
        key=lambda r: r["sku"],
        value=lambda r: r["price"] * r["qty"],
        combine=lambda a, b: a + b,
    )
    assert total_by_sku["A-1"] == 30.0
    assert total_by_sku["B-2"] == 150.0

    by_price = rows.sorted(key=lambda r: r["price"])
    assert [r["price"] for r in by_price] == [2.5, 10.0, 150.0]


def test_map_with_where_and_closure_scalar():
    minimum = 5.0
    clamped = _rows().map(lambda r: where(r["price"] < minimum, minimum, r["price"]))
    assert list(clamped) == [5.0, 150.0, 10.0]


# ─── struct attribute access (uniform lambda DX on both paths) ──────────────


def test_struct_field_attribute_access():
    rows = _rows()
    assert rows[0].sku == "A-1"
    assert rows[0].price == 2.5
    with pytest.raises(AttributeError, match="no attribute or field"):
        _ = rows[0].missing
    # methods still shadow fields; item access always works
    assert rows[0]["qty"] == 4.0


def test_attribute_lambdas_work_on_both_paths():
    rows = _rows()
    traced = rows.map(lambda r: r.price * r.qty)
    sink = []
    python_path = rows.map(lambda r: (sink, r.price * r.qty)[1])
    assert list(traced) == list(python_path)


# ─── differential: traced and python paths must agree ───────────────────────

_DIFF_CASES = [
    ("map-arith", lambda rows, f: rows.map(f), lambda r: r.price * r.qty + 1.0),
    ("map-where", lambda rows, f: rows.map(f), lambda r: where(r.qty > 1.0, r.price, 0.0)),
    ("map-string", lambda rows, f: rows.map(f), lambda r: r.sku.lower() + "?"),
    ("filter-pred", lambda rows, f: rows.filter(f), lambda r: (r.price > 5.0) | (r.qty > 3.0)),
    ("sort-key", lambda rows, f: rows.sorted(key=f), lambda r: -r.price),
    ("toset-key", lambda rows, f: rows.to_set(f), lambda r: r.sku),
]


@pytest.mark.parametrize(("name", "invoke", "fn"), _DIFF_CASES, ids=[c[0] for c in _DIFF_CASES])
def test_traced_matches_python_path(name, invoke, fn):
    rows = _rows()

    # the natural call: gate-eligible, so it traces into a native kernel
    assert _eligible(fn), f"{name}: expected the differential lambda to be traceable"

    traced = invoke(rows, fn)

    # force the python path with a gate-defeating (but semantically inert)
    # closure over a mutable object
    poison = []

    def python_fn(*args):
        _ = poison
        return fn(*args)

    python_result = invoke(rows, python_fn)

    if hasattr(traced, "keys"):
        assert sorted(traced.keys()) == sorted(python_result.keys())
    else:
        assert list(traced) == list(python_result)
