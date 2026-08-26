#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Outer match-arm bindings stay visible inside NESTED match arms (#603).

Match arm variables used fixed generated names (``__m0``/``__t{i}``), so a
nested match rebound the same name in the runtime environment and an outer
binding read inside the inner arm resolved against the INNER payload — a
hard error when the shapes disagreed, a silently wrong value when they
happened to align. The trace-time checks were always right (they use the
type carried on the expression), which is what made it hard to find; each
case here checks the runtime VALUE.
"""

import pytest

from east import (
    East,
    OptionType,
    StringType,
    StructType,
    coerce_to,
    kernel,
    some,
)
from east.expression import ExpressionError

Inner = StructType([("inner_only", StringType), ("label", StringType)])
Outer = StructType([
    ("label", OptionType(StringType)),
    ("plain", StringType),
    ("nested", OptionType(Inner)),
])
T = OptionType(Outer)

VAL = coerce_to(some({
    "label": some("OUTER-LABEL"),
    "plain": "OUTER-PLAIN",
    "nested": some({"inner_only": "INNER-ONLY", "label": "INNER-LABEL"}),
}), T)


def _nested(read):
    """The issue's shape: a nested match whose inner arm reads the OUTER
    binding. Every arm returns String so arm typing cannot mask the value."""
    return lambda x: x.match({"none": lambda _n: "NO-OUTER", "some": lambda o:
        o["nested"].match({"none": lambda _m: "NO-INNER",
                           "some": lambda i: read(o, i)})})


@pytest.mark.parametrize(("read", "expected"), [
    (lambda o, i: i["label"], "INNER-LABEL"),
    (lambda o, i: o["plain"], "OUTER-PLAIN"),
    (lambda o, i: o["label"].unwrap_or("LOST"), "OUTER-LABEL"),
    (lambda o, i: o["label"].match({"none": lambda _n: "NO-LABEL",
                                    "some": lambda s: s}), "OUTER-LABEL"),
], ids=["inner-binding", "outer-plain-field", "outer-option-unwrap_or",
        "outer-option-match"])
def test_inner_arm_reads_resolve_against_the_right_binding(read, expected):
    assert kernel([T], _nested(read))(VAL) == expected


def test_outer_option_predicate_inside_inner_arm():
    got = kernel([T], _nested(
        lambda o, i: East.if_else(o["label"].is_some(), i["label"], "NO-LABEL")))(VAL)
    assert got == "INNER-LABEL"


def test_the_silent_shape_collision_case():
    """Both structs have a ``label`` field with compatible types — the
    original silent-wrong-value presentation. The outer's is an Option, so
    coalescing it must see OUTER-LABEL, never the inner's plain String."""
    got = kernel([T], _nested(
        lambda o, i: o["label"].unwrap_or(i["label"])))(VAL)
    assert got == "OUTER-LABEL"


def test_unwrap_or_defaults_still_see_their_own_option():
    """unwrap_or chained inside another unwrap_or's consumer — the
    _match_option spelling of the same nesting."""
    got = kernel([T], lambda x: x.match({
        "none": lambda _n: "NO-OUTER",
        "some": lambda o: o["label"].unwrap_or(o["plain"]),
    }))(VAL)
    assert got == "OUTER-LABEL"


def test_missing_field_still_fails_at_trace_time_naming_the_outer_struct():
    with pytest.raises(ExpressionError, match="label, plain, nested"):
        kernel([T], _nested(lambda o, i: o["inner_only"]))
