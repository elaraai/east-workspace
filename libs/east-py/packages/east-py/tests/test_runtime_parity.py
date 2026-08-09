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
    FloatType,
    IntegerType,
    StringType,
    StructType,
    array,
    kernel,
    none,
    some,
)
from east.runtime.compiler import eager_stats
from east.types.values.collections import EastDict, EastSet


def _no_per_element_python(run):
    before = eager_stats()["trampoline_calls"]
    out = run()
    moved = eager_stats()["trampoline_calls"] - before
    return out, moved


# ── Set.is_superset_of ───────────────────────────────────────────────────────

def test_set_is_superset_of():
    s1 = EastSet(IntegerType, [1, 2, 3])
    s2 = EastSet(IntegerType, [1, 2])
    empty = EastSet(IntegerType)

    assert s1.is_superset_of(s2) is True     # {1,2,3} ⊇ {1,2}
    assert s2.is_superset_of(s1) is False    # {1,2} ⊉ {1,2,3}
    assert s1.is_superset_of(s1) is True     # reflexive
    assert s1.is_superset_of(empty) is True  # every set ⊇ {}
    assert empty.is_superset_of(s1) is False
    assert empty.is_superset_of(empty) is True


def test_set_is_superset_of_is_the_mirror_of_is_subset():
    a = EastSet(StringType, ["a", "b"])
    b = EastSet(StringType, ["b", "c"])
    for x, y in ((a, b), (b, a), (a, a)):
        assert x.is_superset_of(y) == y.is_subset(x)


# ── Dict.every / some / sum ──────────────────────────────────────────────────

def test_dict_every_and_some_with_predicate():
    d = EastDict(StringType, IntegerType, {"a": 1, "b": 2, "c": 3})

    assert d.every(lambda _k, v: v > 0) is True
    assert d.every(lambda _k, v: v > 1) is False
    assert d.some(lambda _k, v: v > 2) is True
    assert d.some(lambda _k, v: v > 3) is False
    # the callback sees the key too, like every other eager Dict callback
    assert d.every(lambda k, _v: k >= "a") is True
    assert d.some(lambda k, _v: k == "c") is True


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
    assert d.sum(lambda _k, v: v * 2) == 12
    # a projection over the KEYS is just as valid
    strings = EastDict(StringType, StringType, {"a": "hello", "b": "world"})
    assert strings.sum(lambda _k, v: len(v)) == 10
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
    length = kernel([StringType, StringType], lambda _k, v: East.String.length(v))
    assert EastDict(StringType, StringType, {"a": "hello", "b": "hi"}).sum(length) == 7
    assert EastDict(StringType, StringType).sum(length) == 0

    # A Float projection over Integer values keeps its Float zero.
    widen = lambda _k, v: East.Integer.to_float(v)  # noqa: E731
    assert isinstance(EastDict(StringType, IntegerType, {"a": 1}).sum(widen), float)
    empty_total = EastDict(StringType, IntegerType).sum(widen)
    assert isinstance(empty_total, float) and empty_total == 0.0

    # No projection still falls back to the value type.
    assert EastDict(StringType, IntegerType).sum() == 0
    with pytest.raises(TypeError, match="numeric"):
        EastDict(StringType, StringType).sum()


def test_dict_every_some_sum_run_native():
    """The short-circuit scan and the fold push down: no per-element python."""
    d = EastDict(IntegerType, FloatType, {i: float(i) for i in range(300)})
    for run in (lambda: d.every(lambda _k, v: v >= 0.0),
                lambda: d.some(lambda _k, v: v > 298.0),
                lambda: d.sum(lambda _k, v: v)):
        _out, moved = _no_per_element_python(run)
        assert moved == 0, f"{moved} per-element python trampoline call(s)"


# ── Array.group_find_* ───────────────────────────────────────────────────────

def test_group_find_all_matches_the_ts_example():
    # [1,2,3,2,5,2].groupFindAll(x => x % 2, 2n) -> { 0: [1,3,5], 1: [] }
    xs = array(IntegerType, [1, 2, 3, 2, 5, 2])
    got = xs.group_find_all(lambda x: x % 2, 2)
    assert {k: list(v) for k, v in got.items()} == {0: [1, 3, 5], 1: []}
    # a value present in neither group still lists every group
    assert {k: list(v) for k, v in xs.group_find_all(lambda x: x % 2, 99).items()} == \
        {0: [], 1: []}


def test_group_find_all_with_projection_and_empty_input():
    from east.types.types import ArrayType

    Row = StructType([("customer", StringType), ("state", StringType)])
    rows = array(Row, [
        {"customer": "acme", "state": "CA"},
        {"customer": "acme", "state": "NY"},
        {"customer": "bolt", "state": "CA"},
    ])
    got = rows.group_find_all(lambda r: r["customer"], "CA", lambda r: r["state"])
    assert {k: list(v) for k, v in got.items()} == {"acme": [0], "bolt": [2]}

    empty = array(IntegerType, [])
    out = empty.group_find_all(lambda x: x % 2, 1)
    assert len(out) == 0
    assert out.value_type == ArrayType(IntegerType)


def test_group_find_first_matches_the_ts_example():
    # [1..6].groupFindFirst(x => x % 2, 4n) -> { 0: some(3), 1: none }
    xs = array(IntegerType, [1, 2, 3, 4, 5, 6])
    got = xs.group_find_first(lambda x: x % 2, 4)
    assert dict(got.items()) == {0: some(3), 1: none}
    assert dict(xs.group_find_first(lambda x: x % 2, 5).items()) == {0: none, 1: some(4)}
    # first of SEVERAL matches in a group
    dupes = array(IntegerType, [2, 4, 2, 6, 2])
    assert dict(dupes.group_find_first(lambda x: x % 2, 2).items()) == {0: some(0)}


@pytest.mark.parametrize(
    ("rows", "target", "expected"),
    [
        ([2, 1], 2, {0: some(0), 1: none}),   # the FIRST group is the one that matches
        ([3, 2], 3, {0: none, 1: some(0)}),   # the first group misses; a sample would see `none`
    ],
)
def test_group_find_first_types_option_whichever_group_matches(rows, target, expected):
    """``Option<Integer>`` regardless of which group comes first.

    A single-case type here is the #450 failure mode: typed from whichever
    arm the first group happens to carry, the other arm fails conversion
    ("Unknown variant case"). Both orderings are asserted because only one of
    them would expose a sampled type. NB the value type currently survives
    ``out=`` being deleted — ``idxs.try_get(0)`` is pure, so the tracer
    derives the Option on its own — so this pins the OBSERVABLE contract, and
    ``out=`` stays as the guard for the day that lambda stops being traceable.
    """
    from east.types.types import IntegerType as I
    from east.types.types import OptionType

    got = array(I, rows).group_find_first(lambda x: x % 2, target)
    assert got.value_type == OptionType(I)
    assert dict(got.items()) == expected


def test_group_find_matching_uses_east_equality_not_python_equality():
    """The match probe is dual-mode ``East.equal``, so an untraceable ``by``
    (which falls back to per-element python) agrees with a traced one.

    Copied from ``find_all``, the probe originally used python ``==``; that
    silently swaps East's equality for python's on the trampolined path, and
    the two disagree on ``-0.0``/``NaN`` and on structured values.
    """
    Row = StructType([("g", StringType), ("v", FloatType)])
    rows = array(Row, [
        {"g": "a", "v": 0.0}, {"g": "a", "v": -0.0},
        {"g": "b", "v": 1.0}, {"g": "b", "v": 0.0},
    ])
    calls: list[int] = []

    def impure_by(r):
        calls.append(1)          # a mutated capture -> the tracer refuses it
        return r["v"]

    pure = rows.group_find_all(lambda r: r["g"], 0.0, lambda r: r["v"])
    impure = rows.group_find_all(lambda r: r["g"], 0.0, impure_by)
    assert calls, "the impure callback should have run per element, not traced"
    assert {k: list(v) for k, v in impure.items()} == {k: list(v) for k, v in pure.items()}
    # East equality distinguishes -0.0 from 0.0, so row 1 must NOT match.
    assert {k: list(v) for k, v in pure.items()} == {"a": [0], "b": [3]}

    calls.clear()
    pure_first = rows.group_find_first(lambda r: r["g"], 0.0, lambda r: r["v"])
    impure_first = rows.group_find_first(lambda r: r["g"], 0.0, impure_by)
    assert dict(impure_first.items()) == dict(pure_first.items())


def test_group_find_all_passes_the_row_index_to_arity_2_callbacks():
    """``key(el, idx)`` / ``by(el, idx)`` get the row index, like every other
    eager Array callback."""
    xs = array(IntegerType, [5, 2, 5, 2])
    # group by index parity, match on the element
    assert {k: list(v) for k, v in xs.group_find_all(lambda _x, i: i % 2, 5).items()} == \
        {0: [0, 2], 1: []}
    # an index-taking projection: element+index, so the match depends on BOTH
    # (rows 0 and 3 sum to 5; they land in different index-parity groups)
    assert {k: list(v) for k, v in
            xs.group_find_all(lambda _x, i: i % 2, 5, lambda x, i: x + i).items()} == \
        {0: [0], 1: [3]}
    assert dict(xs.group_find_maximum(lambda _x, i: i % 2, lambda _x, i: i).items()) == \
        {0: 2, 1: 3}
    assert dict(xs.group_find_minimum(lambda _x, i: i % 2, lambda _x, i: i).items()) == \
        {0: 0, 1: 1}


def test_group_find_minimum_and_maximum_match_the_ts_examples():
    # [1..6] grouped by parity: min indices {0: 1, 1: 0}, max {0: 5, 1: 4}
    xs = array(IntegerType, [1, 2, 3, 4, 5, 6])
    assert dict(xs.group_find_minimum(lambda x: x % 2).items()) == {0: 1, 1: 0}
    assert dict(xs.group_find_maximum(lambda x: x % 2).items()) == {0: 5, 1: 4}
    # with a projection (negate flips which index wins)
    assert dict(xs.group_find_minimum(lambda x: x % 2, lambda x: -x).items()) == {0: 5, 1: 4}
    assert dict(xs.group_find_maximum(lambda x: x % 2, lambda x: -x).items()) == {0: 1, 1: 0}


def test_group_find_extremes_keep_the_earliest_index_on_ties():
    xs = array(IntegerType, [7, 7, 7])
    assert dict(xs.group_find_minimum(lambda _x: 0).items()) == {0: 0}
    assert dict(xs.group_find_maximum(lambda _x: 0).items()) == {0: 0}


def test_group_find_extremes_use_east_total_order_on_strings():
    words = array(StringType, ["pear", "apple", "fig", "banana"])
    # grouped by first letter is trivial here, so group everything and check
    # the whole-array extremes by index
    assert dict(words.group_find_minimum(lambda _w: "all").items()) == {"all": 1}   # "apple"
    assert dict(words.group_find_maximum(lambda _w: "all").items()) == {"all": 0}   # "pear"


def test_group_find_extremes_on_empty_input():
    empty = array(IntegerType, [])
    assert len(empty.group_find_minimum(lambda x: x)) == 0
    assert len(empty.group_find_maximum(lambda x: x)) == 0


def test_group_find_family_accepts_precompiled_kernels():
    Row = StructType([("g", StringType), ("v", IntegerType)])
    rows = array(Row, [{"g": "a", "v": 1}, {"g": "a", "v": 5}, {"g": "b", "v": 3}])
    key = kernel(Row, lambda r: r["g"])
    by = kernel(Row, lambda r: r["v"])

    assert dict(rows.group_find_maximum(key, by).items()) == {"a": 1, "b": 2}
    assert dict(rows.group_find_minimum(key, by).items()) == {"a": 0, "b": 2}
    assert {k: list(v) for k, v in rows.group_find_all(key, 3, by).items()} == \
        {"a": [], "b": [2]}
    assert dict(rows.group_find_first(key, 5, by).items()) == {"a": some(1), "b": none}


# ── Dict.union / union_in_place / merge_key: the #527 naming split ───────────

def test_dict_union_is_pure_and_matches_the_old_merge():
    a = EastDict(StringType, IntegerType, {"a": 1, "b": 2})
    b = EastDict(StringType, IntegerType, {"b": 30, "c": 4})

    got = a.union(b, lambda x, y: x + y)
    assert dict(got.items()) == {"a": 1, "b": 32, "c": 4}
    # neither input touched — this is the whole point of the pure form
    assert dict(a.items()) == {"a": 1, "b": 2}
    assert dict(b.items()) == {"b": 30, "c": 4}

    # disjoint dicts need no handler; an overlap without one errors
    assert dict(a.union(EastDict(StringType, IntegerType, {"z": 9})).items()) == \
        {"a": 1, "b": 2, "z": 9}
    with pytest.raises(Exception, match="exists in both dictionaries"):
        a.union(b)


def test_dict_merge_still_works_but_warns():
    """The old spelling keeps working — it just tells you where it went."""
    a = EastDict(StringType, IntegerType, {"a": 1})
    b = EastDict(StringType, IntegerType, {"b": 2})
    with pytest.warns(DeprecationWarning, match="union"):
        got = a.merge(b)
    assert dict(got.items()) == {"a": 1, "b": 2}


def test_dict_union_in_place():
    a = EastDict(StringType, IntegerType, {"a": 1, "b": 2})
    b = EastDict(StringType, IntegerType, {"b": 30, "c": 4})
    assert a.union_in_place(b, lambda x, y: x + y) is None
    assert dict(a.items()) == {"a": 1, "b": 32, "c": 4}   # receiver mutated
    assert dict(b.items()) == {"b": 30, "c": 4}           # argument untouched
    with pytest.raises(Exception, match="exists in both dictionaries"):
        a.union_in_place(EastDict(StringType, IntegerType, {"a": 0}))


def test_dict_merge_key_is_the_ts_single_key_merge():
    """TS ``DictExpr.merge``: one key, in place, heterogeneous incoming value."""
    counts = EastDict(StringType, IntegerType, {"hello": 5})
    # the TS doc's own worked example: increment, seeding a missing key with 0
    counts.merge_key("hello", 1, lambda existing, inc: existing + inc, lambda _k: 0)
    assert dict(counts.items()) == {"hello": 6}
    counts.merge_key("world", 1, lambda existing, inc: existing + inc, lambda _k: 0)
    assert dict(counts.items()) == {"hello": 6, "world": 1}

    # without `initial`, a missing key raises rather than being created
    with pytest.raises(Exception, match="not found in dictionary"):
        counts.merge_key("nope", 1, lambda existing, inc: existing + inc)
    assert "nope" not in counts

    # the incoming value may have a DIFFERENT type from the values — the thing
    # insert_or_update cannot express (its value must be the dict's value type)
    lengths = EastDict(StringType, IntegerType, {"a": 10})
    lengths.merge_key("a", "xyz", lambda existing, s: existing + len(s))
    assert dict(lengths.items()) == {"a": 13}

    # a three-argument update also receives the key
    seen: list = []
    tagged = EastDict(StringType, StringType, {"k": "v"})
    tagged.merge_key("k", "!", lambda existing, inc, key: (seen.append(key), existing + inc)[1])
    assert dict(tagged.items()) == {"k": "v!"} and seen == ["k"]


# ── keys(): the python view, not the East-value spelling ─────────────────────

def test_dict_keys_is_the_python_view_and_keys_set_is_the_east_value():
    d = EastDict(StringType, IntegerType, {"b": 2, "a": 1})
    assert d.keys() == ["a", "b"]                  # python list, East key order
    assert isinstance(d.keys(), list)
    assert d.keys_set() == EastSet(StringType, ["a", "b"])   # the TS `keys` spelling
    assert list(d) == ["a", "b"]
    assert d.values() == [1, 2]
