#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The python authoring surface: explicit builds + eager-method capture (#256).

``east.expression`` captures a python body into East IR compiled by east-c;
eager collection methods capture their callbacks the same way, as
``East.function`` bodies with the builtin's declared signature (#625) — a
callback with no East capture raises the named error up front, and there is
no per-element python path behind it.
"""

import pytest

from east import (
    ArrayType,
    BooleanType,
    East,
    EastBlob,
    ExpressionError,
    FloatType,
    IntegerType,
    OptionType,
    StringType,
    StructType,
    if_else,
    none,
)
from east.expression import _eligible, capture_callback
from east.types.values.structural import EastFunction

ROW = StructType([("sku", StringType), ("price", FloatType), ("qty", FloatType)])

CSV = b"sku,price,qty\nA-1,2.5,4.0\nB-2,150.0,1.0\nA-1,10.0,2.0\n"


def _rows():
    return EastBlob(CSV).decode_csv(ROW)


# ─── explicit kernels ────────────────────────────────────────────────────────


def test_kernel_untraceable_raises():
    with pytest.raises(ExpressionError, match="cannot be traced"):
        East.function([ROW], FloatType, lambda r: r.price if r.qty > 0 else 0.0)


def test_kernel_out_mismatch_raises():
    with pytest.raises(ExpressionError, match="produced Float, declared out is String"):
        East.function([ROW], StringType, lambda r: r.price)


def test_kernel_type_errors_are_loud():
    with pytest.raises(ExpressionError, match="no field"):
        East.function([ROW], FloatType, lambda r: r.missing)
    with pytest.raises(ExpressionError, match="coercion"):
        East.function([ROW], FloatType, lambda r: r.price + r.sku.length())


# The #624 operator-fork pins live in test_expression_operators.py, spelled
# with the East.function builder (#625).


# ─── the capture validator ──────────────────────────────────────────────────
# `_eligible` is the predicate behind the refusal: it proves a body does no
# python work before the capture runs it once over proxies. A False here is
# what `capture_callback` turns into the named ExpressionError.


def test_capture_callback_respects_declared_output():
    # Declared Boolean output but traced Float -> the capture names the
    # mismatch (#625); there is no silent python path to fall back to.
    from east.types.types import BooleanType

    ef = EastFunction(lambda el, idx: el, [FloatType, IntegerType], BooleanType)
    with pytest.raises(ExpressionError, match="produced Float"):
        capture_callback(ef)


# ─── eager-method integration (implicit push-down) ──────────────────────────


def test_filter_truthiness_raises():
    # Python truthiness on a Float is not an East Boolean predicate: the
    # capture names the mismatch (#625) — spell the comparison explicitly.
    with pytest.raises(ExpressionError, match="produced Float"):
        _rows().filter(lambda r: r["qty"] - 1.0)
    rows = _rows().filter(lambda r: (r["qty"] - 1.0) != 0.0)
    assert [r["sku"] for r in rows] == ["A-1", "A-1"]


def test_impure_lambda_is_refused():
    seen = []
    rows = _rows()
    # A closure-mutating callback has no East capture (#625): the raise lands
    # before any element runs — crucially the side effect never fires once at
    # build time either, which is what a mis-applied trace would give.
    with pytest.raises(ExpressionError, match="captured automatically"):
        rows.map(lambda r: (seen.append(r["sku"]), r["price"] * 2.0)[1])
    assert seen == []


# ─── struct attribute access (uniform lambda DX on both paths) ──────────────


# ─── one semantics: python work around the same body is refused loudly ──────

_DIFF_CASES = [
    ("map-arith", lambda rows, f: rows.map(f), lambda r: r.price * r.qty + 1.0),
    ("map-if-else", lambda rows, f: rows.map(f), lambda r: if_else(r.qty > 1.0, r.price, 0.0)),
    ("map-string", lambda rows, f: rows.map(f), lambda r: r.sku.lower() + "?"),
    ("filter-pred", lambda rows, f: rows.filter(f), lambda r: (r.price > 5.0) | (r.qty > 3.0)),
    ("sort-key", lambda rows, f: rows.sorted(key=f), lambda r: -r.price),
    ("toset-key", lambda rows, f: rows.to_set(f), lambda r: r.sku),
]


@pytest.mark.parametrize(("name", "invoke", "fn"), _DIFF_CASES, ids=[c[0] for c in _DIFF_CASES])
def test_python_work_around_the_same_body_is_refused(name, invoke, fn):
    """Two syntactically identical callbacks can never differ by purity
    (#625): the clean body captures and runs native, and the SAME body behind
    a mutable python capture raises the named error instead of silently
    taking a second execution path."""
    rows = _rows()

    assert _eligible(fn), f"{name}: expected the clean lambda to be traceable"
    traced = invoke(rows, fn)
    assert traced is not None

    poison = []

    def python_fn(el):
        _ = poison
        return fn(el)

    with pytest.raises(ExpressionError, match="captured automatically"):
        invoke(rows, python_fn)


# ─── options: `none` lifts into traced kernels (issue #376) ──────────────────


def test_kernel_bare_none_reports_missing_type_context():
    # A bare `none` with nothing to type it must hit the type-from-context
    # diagnostic. It was dead code because `none.value` is east_null, not
    # Python None, so callers got a generic "cannot lift" instead. A build's
    # ROOT is always typed by the declared output, so the case lives one
    # level down: a callback slot that carries no out=.
    with pytest.raises(ExpressionError, match="needs a type from context"):
        East.function([ROW], BooleanType,
                      lambda r: r.sku.split("-").first_map(lambda _v: none).is_none())


# ─── #393: the whole builtin surface traces ──────────────────────────────────

SROW = StructType([("id", StringType), ("data", StringType)])


def test_untraceable_ops_still_fail_loud():
    with pytest.raises(ExpressionError):
        East.function([SROW], ArrayType(IntegerType),
                      lambda r: r.data.split("|").map(lambda v: len(v)))
    with pytest.raises(ExpressionError):
        East.function([SROW], OptionType(FloatType), lambda r: r.id.try_parse("not a type"))


# ─── #393 hardening: differentials, empties, nesting, auto push-down ─────────


def test_new_op_errors_are_loud_and_specific():
    with pytest.raises(ExpressionError, match="predicate must return Boolean"):
        East.function([SROW], ArrayType(StringType),
                      lambda r: r.data.split("|").filter(lambda v: v.length()))
    with pytest.raises(ExpressionError, match="accumulator"):
        East.function([SROW], IntegerType,
                      lambda r: r.data.split("|").fold(0, lambda acc, v: v))
    with pytest.raises(ExpressionError, match="string_join"):
        East.function([SROW], StringType,
                      lambda r: r.data.split("|").map(lambda v: v.length()).string_join(","))


def test_captured_collection_needs_an_explicit_capture():
    from east import EastDict

    table = EastDict(StringType, StringType, {"A-1": "first"})
    fn = lambda r: table.get_or_default(r.sku, "other")  # noqa: E731
    # mutable capture: the auto-wrap refuses — snapshot-vs-live is an
    # explicit choice (East.function snapshots, .bind stays live)
    assert not _eligible(fn)
    with pytest.raises(ExpressionError, match="captured automatically"):
        capture_callback(EastFunction(fn, [ROW], StringType))


# ─── #399: bind side-tables by reference (C-level partial application) ───────


def _bind_setup():
    from east import EastDict
    from east.types.types import DictType

    table = EastDict(StringType, FloatType, {"A-1": 2.0, "B-2": 3.0})
    k = East.function(
        [ROW, DictType(StringType, FloatType)], FloatType,
        lambda r, t: t.get_or_default(r.sku, 0.0) * r.qty)
    return table, k


def test_bind_type_mismatch_is_loud():
    from east import EastDict

    _table, k = _bind_setup()
    with pytest.raises(TypeError, match="bind\\(\\) value 0 has East type"):
        k.bind(EastDict(StringType, StringType, {"x": "y"}))
    with pytest.raises(TypeError, match="needs at least one value"):
        k.bind()
    with pytest.raises(TypeError, match="3 values"):
        k.bind(_table, _table, _table)


def test_bind_requires_native_kernel():
    with pytest.raises(TypeError, match="compiled East function"):
        from east.runtime._compiler_eastc import bind_kernel

        bind_kernel(lambda x: x, (1.0,))


# ─── #409: precompiled kernels run natively through eager methods ────────────


# ─── #403: control-flow parity — first_map + short-circuiting some/every ────


def test_quantifier_error_message_unchanged():
    with pytest.raises(ExpressionError, match="predicate must return Boolean"):
        East.function([SROW], BooleanType,
                      lambda r: r.data.split("|").some(lambda v: v.length()))


def test_first_map_requires_option_result():
    with pytest.raises(ExpressionError, match="must return some"):
        East.function([SROW], BooleanType, lambda r: r.data.split("|").first_map(lambda v: v.length()))


# ─── #411: trace-time CSE — shared subexpressions bind once ─────────────────


