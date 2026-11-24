#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The comparers tell East values apart by East's identity, never Python's ``id``.

Every read of a C-backed container is a new Python object over the same C
value, freed once the read is done, and CPython hands a freed object's ``id``
to the next object made. ``equal_for`` and ``compare_for`` marked the pairs
they had compared by ``id``: a value that holds itself was never met again, so
comparing it never ended — east-py's replay of the patch suite's "Apply
conflicts" died of it — and, in a process whose heap handed the ids back in
step, a pair compared and freed lent its mark to the next pair, which was then
counted equal unread. ``is_for`` took two reads of one value for two values.
Each comparer is checked as ``east`` exports it, its Cython build, and as its
pure-Python twin; the marks themselves through ``east.utils._identity``.
"""

from __future__ import annotations

from typing import Any

import pytest

from east import East, coerce_to, compare_for, equal_for, is_for
from east.types.types import (
    ArrayType,
    DictType,
    IntegerType,
    StringType,
    StructType,
    recursive_type,
)
from east.utils._identity import Marks, east_identity, pair_met, type_can_cycle
from east.utils.ordering import _py_compare_for, _py_equal_for, _py_is_for

EQUAL = pytest.mark.parametrize("equal", [equal_for, _py_equal_for], ids=["cython", "python"])
COMPARE = pytest.mark.parametrize("compare", [compare_for, _py_compare_for], ids=["cython", "python"])
IS = pytest.mark.parametrize("is_", [is_for, _py_is_for], ids=["cython", "python"])
EACH = pytest.mark.parametrize("factory", [equal_for, _py_equal_for, compare_for, _py_compare_for],
                               ids=["equal-cython", "equal-python", "compare-cython", "compare-python"])

#: A node whose children are nodes: a value of it can hold itself.
Loop = recursive_type(lambda self: StructType([("n", IntegerType), ("children", ArrayType(self))]))

Row = ArrayType(IntegerType)


def _holding_itself(n: int, times: int = 1) -> Any:
    """A ``Loop`` whose children are itself, ``times`` over, made in east-c as a program makes it."""

    def body(b: Any) -> Any:
        one = b.const(East.wrap_recursive({"n": n, "children": []}, Loop))
        for _ in range(times):
            b.do(one.unwrap().children.push_last(one))
        return one

    return East.function([], Loop, body)()


def test_a_container_is_known_by_its_c_value_through_every_read() -> None:
    rows = coerce_to([[1], [1]], ArrayType(Row))
    first, again = rows[0], rows[0]
    assert first is not again, "each read a new Python object"
    assert east_identity(first) == east_identity(again), "over one C value"
    assert east_identity(first) != east_identity(rows[1])


def test_a_mark_holds_the_pair_it_was_keyed_by() -> None:
    rows = coerce_to([[1], [2]], ArrayType(Row))
    marks: Marks = {}
    x, y = rows[0], rows[1]
    assert not pair_met(marks, x, y)
    assert pair_met(marks, rows[0], rows[1]), "two new reads of the pair met"
    held, met = marks[east_identity(x)]
    assert held is x and met[east_identity(y)] is y, "held, so neither id is handed on"
    assert pair_met(marks, x, rows[0]), "one value counts equal"
    assert list(marks) == [east_identity(x)], "and is not marked"


def test_a_type_can_hold_itself_only_where_a_recursive_type_stands() -> None:
    assert type_can_cycle(Loop)
    assert type_can_cycle(ArrayType(Loop))
    assert type_can_cycle(DictType(StringType, Loop))
    assert type_can_cycle(StructType([("n", IntegerType), ("loop", Loop)]))
    assert not type_can_cycle(ArrayType(DictType(StringType, Row)))
    assert not type_can_cycle(StructType([("rows", ArrayType(Row))]))


@EACH
def test_only_a_value_that_can_hold_itself_is_marked(factory: Any) -> None:
    Flat = ArrayType(DictType(StringType, Row))
    marks: Marks = {}
    factory(Flat)(coerce_to([{"k": [1]}], Flat), coerce_to([{"k": [1]}], Flat), marks)
    assert marks == {}
    factory(Loop)(_holding_itself(1), _holding_itself(1), marks)
    assert marks, "a value that holds itself"
    assert all(hasattr(held, "_c_ptr") for held, _ in marks.values()), \
        "each mark an array's: a struct read is a new object every time, never marked"


@EQUAL
def test_a_value_that_holds_itself_is_compared_to_an_end(equal: Any) -> None:
    eq = equal(Loop)
    assert eq(_holding_itself(1), _holding_itself(1))
    assert not eq(_holding_itself(1), _holding_itself(2))
    assert not eq(_holding_itself(1), _holding_itself(1, times=2))


@COMPARE
def test_a_value_that_holds_itself_is_ordered_to_an_end(compare: Any) -> None:
    cmp = compare(Loop)
    assert cmp(_holding_itself(1), _holding_itself(1)) == 0
    assert cmp(_holding_itself(1), _holding_itself(2)) == -1
    assert cmp(_holding_itself(2), _holding_itself(1)) == 1
    # Its one child is itself, met again; then the other has a second.
    assert cmp(_holding_itself(1), _holding_itself(1, times=2)) == -1


@IS
def test_two_reads_of_one_container_are_one_value(is_: Any) -> None:
    rows = coerce_to([[1], [1]], ArrayType(Row))
    assert is_(Row)(rows[0], rows[0])
    assert not is_(Row)(rows[0], rows[1]), "equal, but two values"
    named = coerce_to({"a": [1], "b": [1]}, DictType(StringType, Row))
    assert is_(Row)(named["a"], named["a"])
    assert not is_(Row)(named["a"], named["b"])
