#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""General variant construction in traced kernels (#541).

The 2-arg ``variant(case, payload)`` construction carries no VariantType, so
a traced kernel needs the type from context. These pin every context that
supplies it — the build's declared output (threaded to the root lift), a
``if_else()`` sibling, a typed struct field — and the deferred ``if_else`` over
variant branches in both arms. The exact spellings are the issue's repro.
"""

import pytest

from east import (
    East,
    EastArray,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    east_null,
    if_else,
    none,
    some,
    variant,
)
from east.expression import ExpressionError
from east.types.values import is_east_null

Source = VariantType([("vessel", StringType), ("added", NullType)])
Row = StructType([("code", StringType)])


def _rows() -> EastArray:
    return EastArray(Row, [{"code": "TANK-1"}, {"code": "ADDED"}])


def _classify(r):
    return if_else(r["code"] == "ADDED", variant("added", east_null),
                 variant("vessel", r["code"]))


def test_bare_variant_with_expression_payload_types_from_out():
    out = _rows().map(East.function([Row], Source, lambda r: variant("vessel", r["code"])))
    assert [(v.type, v.value) for v in out] == [("vessel", "TANK-1"), ("vessel", "ADDED")]


def test_bare_variant_with_literal_payload_types_from_out():
    out = _rows().map(East.function([Row], Source, lambda r: variant("added", east_null)))
    assert [v.type for v in out] == ["added", "added"]
    assert all(is_east_null(v.value) for v in out)


def test_where_with_variant_branches_defers_to_out():
    out = _rows().map(East.function([Row], Source, _classify))
    assert [v.type for v in out] == ["vessel", "added"]
    assert out[0].value == "TANK-1"
    assert is_east_null(out[1].value)


def test_where_with_variant_branches_without_context_raises_the_actionable_error():
    # A build's declared output always types the root, so the context-free
    # spelling is an eager call with no out=.
    with pytest.raises(ExpressionError, match="needs a type from context"):
        _rows().map(_classify)


def test_variant_inside_struct_field_types_from_out():
    wrapper = StructType([("src", Source)])
    out = _rows().map(
        East.function([Row], wrapper, lambda r: {"src": _classify(r)})
    )
    assert [row["src"].type for row in out] == ["vessel", "added"]


def test_unknown_case_names_the_declared_cases():
    with pytest.raises(ExpressionError, match="not in"):
        East.function([Row], Source, lambda r: variant("boat", r["code"]))


def test_payload_type_mismatch_is_named():
    with pytest.raises(ExpressionError, match="payload has type Integer, expected String"):
        East.function([Row], Source, lambda r: variant("vessel", 1))


def test_bare_variant_without_any_context_raises_the_actionable_error():
    with pytest.raises(ExpressionError, match="needs a VariantType from context"):
        _rows().map(lambda r: variant("vessel", r["code"]))


def test_options_still_trace_without_out():
    # The pre-existing some/none contract, untouched by the general fix.
    out = _rows().map(
        East.function([Row], OptionType(StringType),
                      lambda r: if_else(r["code"] == "ADDED", none, some(r["code"])))
    )
    assert [v.type for v in out] == [("some"), ("none")]
    assert out[0].value == "TANK-1"


def test_where_sibling_types_a_variant_branch():
    # One arm lifts unaided (some), the other (none) types from it — and a
    # general variant arm types from a typed sibling the same way, via an
    # expression whose type is already known.
    typed = East.function([Row], Source, lambda r: variant("vessel", r["code"]))
    out = _rows().map(
        East.function([Row], Source,
                      lambda r: if_else(r["code"] == "ADDED", variant("added", east_null),
                                        typed(r)))
    )
    assert [v.type for v in out] == ["vessel", "added"]
