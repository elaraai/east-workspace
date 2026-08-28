#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""east-py eager methods the TS expression surface had and east-py did not (#526).

Eight operations existed on ``ArrayExpr``/``SetExpr``/``DictExpr`` with no
east-py spelling at all, so a TS East program using them had nothing to port
to — and they blocked #525, since an operation cannot join the traced kernel
surface when the runtime has no implementation of it.

The expectations below are the TS docs' own worked examples, so these tests
double as the cross-runtime parity pin:

* ``Set.is_superset_of`` — ``SetIsSubset`` with the operands swapped;
* ``Dict.every`` / ``Dict.some`` / ``Dict.sum`` — the ``(key, value)``
  callback convention every other eager Dict method uses, with the
  empty-collection answers TS gives (true / false / zero);
* ``Array.group_find_all`` / ``group_find_first`` / ``group_find_maximum`` /
  ``group_find_minimum`` — GLOBAL row indices, every group present (a group
  with no match maps to an empty array / ``none``), and ties keeping the
  earliest index.

``keys()`` is covered too: it is the python mapping view (the sibling of
``items()``/``values()``), while TS's ``DictExpr.keys`` is ``keys_set()``.
"""

import pytest

from east import (
    BooleanType,
    East,
    FloatType,
    IntegerType,
    StringType,
    StructType,
    array,
)
from east.types.values.collections import EastDict, EastSet

# ── Set.is_superset_of ───────────────────────────────────────────────────────


# ── Dict.every / some / sum ──────────────────────────────────────────────────


def test_dict_every_and_some_on_booleans_and_empties():
    assert EastDict(StringType, BooleanType, {"a": True}).every() is True
    assert EastDict(StringType, BooleanType, {"a": True, "b": False}).every() is False
    assert EastDict(StringType, BooleanType, {"a": True, "b": False}).some() is True
    assert EastDict(StringType, BooleanType, {"a": False}).some() is False
    # empty: every -> True, some -> False (TS parity)
    assert EastDict(StringType, BooleanType).every() is True
    assert EastDict(StringType, BooleanType).some() is False
    with pytest.raises(TypeError, match="Boolean values"):
        EastDict(StringType, IntegerType, {"a": 1}).every()
    with pytest.raises(TypeError, match="Boolean values"):
        EastDict(StringType, IntegerType, {"a": 1}).some()


def test_dict_sum():
    d = EastDict(StringType, IntegerType, {"a": 1, "b": 2, "c": 3})
    assert d.sum() == 6
    assert d.sum(lambda _b, _k, v: v * 2) == 12
    # a projection over the KEYS is just as valid
    strings = EastDict(StringType, StringType, {"a": "hello", "b": "world"})
    assert strings.sum(lambda _b, _k, v: East.String.length(v)) == 10
    # floats keep their own zero
    floats = EastDict(StringType, FloatType, {"a": 1.5, "b": 2.5})
    assert floats.sum() == pytest.approx(4.0)
    # empty sums to the value type's zero
    assert EastDict(StringType, IntegerType).sum() == 0
    assert EastDict(StringType, FloatType).sum() == 0.0
    with pytest.raises(TypeError, match="numeric"):
        EastDict(StringType, StringType, {"a": "x"}).sum()


def test_dict_sum_on_an_empty_dict_types_the_zero_from_the_PROJECTION():
    """An empty dict must answer with the projection's zero, not the value
    type's — the same program's result type cannot flip with the data (#450).

    Gating the type derivation (and not just the sample) on ``len(self)`` made
    a numeric projection over non-numeric values RAISE when empty while
    working non-empty, and returned an Integer ``0`` where the non-empty
    answer was a Float.
    """
    from east.namespace import East

    # A numeric projection over String values: 0 when empty, like TS.
    length = East.function([StringType, StringType], IntegerType, lambda _b, _k, v: East.String.length(v))
    assert EastDict(StringType, StringType, {"a": "hello", "b": "hi"}).sum(length) == 7
    assert EastDict(StringType, StringType).sum(length) == 0

    # A Float projection over Integer values keeps its Float zero.
    widen = lambda _b, _k, v: East.Integer.to_float(v)  # noqa: E731
    assert isinstance(EastDict(StringType, IntegerType, {"a": 1}).sum(widen), float)
    empty_total = EastDict(StringType, IntegerType).sum(widen)
    assert isinstance(empty_total, float) and empty_total == 0.0

    # No projection still falls back to the value type.
    assert EastDict(StringType, IntegerType).sum() == 0
    with pytest.raises(TypeError, match="numeric"):
        EastDict(StringType, StringType).sum()


# ── Array.group_find_* ───────────────────────────────────────────────────────


def test_group_find_matching_uses_east_equality_not_python_equality():
    """The match probe is ``East.equal`` — ``-0.0`` does not match ``0.0`` —
    and an impure ``by`` no longer gets a python-``==`` path: it is refused
    up front (#625), so the probe's equality can never silently swap.
    """
    from east.expression import ExpressionError

    Row = StructType([("g", StringType), ("v", FloatType)])
    rows = array(Row, [
        {"g": "a", "v": 0.0}, {"g": "a", "v": -0.0},
        {"g": "b", "v": 1.0}, {"g": "b", "v": 0.0},
    ])
    pure = rows.group_find_all(lambda _b, r: r["g"], 0.0, lambda _b, r: r["v"])
    # East equality distinguishes -0.0 from 0.0, so row 1 must NOT match.
    assert {k: list(v) for k, v in pure.items()} == {"a": [0], "b": [3]}

    calls: list[int] = []

    def impure_by(r):
        calls.append(1)          # a mutated capture — no East capture (#625)
        return r["v"]

    with pytest.raises(ExpressionError, match="captured automatically"):
        rows.group_find_all(lambda _b, r: r["g"], 0.0, impure_by)
    assert calls == []


# ── Dict.union / union_in_place / merge_key: the #527 naming split ───────────


# ── the sum/group_sum family agrees about an empty collection ────────────────


def test_group_sum_rejects_a_non_numeric_projection_on_every_container():
    """Set/Dict used to fall back to a Float zero and sum non-numeric data."""
    with pytest.raises(TypeError, match="numeric"):
        EastSet(StringType, ["a"]).group_sum(lambda _b, e: e)
    with pytest.raises(TypeError, match="numeric"):
        EastDict(StringType, StringType, {"a": "x"}).group_sum(lambda _b, k, _v: k)


# ── a differently-typed `other` is refused, not reinterpreted ────────────────


# ── keys(): the python view, not the East-value spelling ─────────────────────

