#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Spelling pins retained from the retired ad-hoc suites (#627).

The compliance corpus + the eager replay pin what every builtin COMPUTES,
program by program; the codegen conformance suite pins that every corpus
and example program is expressible through the python surface. Six builtins
the retired suites exercised are called by no corpus or example program —
``StringRepeat``, ``ArrayFindFirst``, ``ArrayFindSortedLast``,
``ArraySortDefault`` (the east-c-only keyless sort), ``DictMapReduce`` and
``DictTryGet`` — so their python spellings are pinned here: the builtin each
method emits, and the typing rule the search family carries (#525).
"""

from __future__ import annotations

from east import (
    ArrayType,
    DictType,
    East,
    EastArray,
    EastDict,
    FloatType,
    IntegerType,
    OptionType,
    StringType,
    StructType,
    array,
    none,
    some,
)


def _builtins(built) -> set[str]:
    from east.expression.finalize import _node_children

    out: set[str] = set()
    stack = [built._east_ir]
    while stack:
        n = stack.pop()
        if n.type == "Builtin":
            out.add(n.value["builtin"])
        stack.extend(_node_children(n))
    return out


def test_string_repeat_spelling():
    Row = StructType([("s", StringType)])
    k = East.function([Row], IntegerType, lambda v: v.s.strip().repeat(2).length())
    assert "StringRepeat" in _builtins(k)
    assert k({"s": "  a,b,c  "}) == 10


def test_array_find_first_and_find_sorted_last_spellings():
    t = ArrayType(IntegerType)
    xs = EastArray(IntegerType, [1, 2, 2, 2, 5, 8])
    first = East.function([t], OptionType(IntegerType), lambda a: a.find_first(2))
    assert "ArrayFindFirst" in _builtins(first)
    assert first(xs) == some(1) and first(EastArray(IntegerType, [9])) == none
    last = East.function([t], IntegerType, lambda a: a.find_sorted_last(2))
    assert "ArrayFindSortedLast" in _builtins(last)
    assert last(xs) == 4  # the upper bound: one past the last 2


def test_find_first_targets_type_from_the_projection_not_the_target():
    """The search target takes the ELEMENT (or projection) type: a python
    ``2`` against Floats compares as ``2.0``, and a Float projection is never
    truncated to an Integer target (#525)."""
    xs = EastArray(FloatType, [1.0, 2.0, 2.0, 5.0])
    k = East.function([ArrayType(FloatType)], OptionType(IntegerType), lambda a: a.find_first(2))
    assert k(xs) == some(1)
    Row = StructType([("v", FloatType)])
    rows = array(Row, [{"v": 1.2}, {"v": 2.7}, {"v": 3.9}])
    k2 = East.function([ArrayType(Row)], OptionType(IntegerType),
                       lambda a: a.find_first(2, lambda r: r.v))
    assert k2(rows) == none


def test_sorted_without_a_key_is_the_keyless_builtin():
    t = ArrayType(IntegerType)
    k = East.function([t], t, lambda a: a.sorted())
    assert "ArraySortDefault" in _builtins(k)
    assert list(k(EastArray(IntegerType, [3, 1, 2]))) == [1, 2, 3]


def test_dict_map_reduce_spelling():
    d = DictType(StringType, IntegerType)
    k = East.function([d], IntegerType, lambda m: m.map_reduce(lambda key, v: v * 2, lambda x, y: x + y))
    assert "DictMapReduce" in _builtins(k)
    assert k(EastDict(StringType, IntegerType, {"a": 1, "b": 2})) == 6


def test_dict_try_get_spelling():
    Row = StructType([("id", StringType)])
    table = EastDict(StringType, IntegerType, {"a": 1})
    k = East.function([Row, DictType(StringType, IntegerType)], IntegerType,
                      lambda r, t: t.try_get(r.id).unwrap_or(0))
    assert "DictTryGet" in _builtins(k)
    assert k({"id": "a"}, table) == 1 and k({"id": "z"}, table) == 0
