#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Operator forks raise instead of silently diverging (#624, phase 0 of #623).

`//` (python floors, IntegerDivide truncates), `%` (python takes the sign of
the divisor, IntegerRemainder/FloatRemainder the dividend), Integer `**`
(python promotes a negative exponent to float) and a negative literal index
(python counts from the end) mean something different per element than the IR
they build — and the purity gate picked a side silently. These are
AUTHORING-SPELLING pins only: each python spelling raises at build time and
the named East twin is accepted by the builder. The twins' VALUE semantics
(IntegerDivide/IntegerRemainder/IntegerPow/FloatRemainder/ArrayGet) are
pinned by the TS compliance corpus, not here (test policy, #623).
"""

import pytest

from east import East, ExpressionError, FloatType, IntegerType


def test_operator_fork_spellings_raise_with_their_named_twins():
    for fn, twin in [
        (lambda _b, v: v // 3, r"East\.Integer\.divide"),
        (lambda _b, v: 10 // v, r"East\.Integer\.divide"),
        (lambda _b, v: v % 3, r"East\.Integer\.remainder"),
        (lambda _b, v: 10 % v, r"East\.Integer\.remainder"),
        (lambda _b, v: v ** 2, r"East\.Integer\.pow"),
        (lambda _b, v: 2 ** v, r"East\.Integer\.pow"),
        # `/` on Integers already raised; its fix-it must name the spelling
        # that works, not the `//` that raises too
        (lambda _b, v: v / 3, r"East\.Integer\.divide"),
    ]:
        with pytest.raises(ExpressionError, match=twin):
            East.function([IntegerType], IntegerType, fn)
    with pytest.raises(ExpressionError, match=r"East\.Float\.remainder"):
        East.function([FloatType], FloatType, lambda _b, v: v % 3.0)
    # ...and the builder accepts each named twin (the corpus pins the values)
    assert East.function([IntegerType], IntegerType,
                         lambda _b, v: East.Integer.divide(v, 3))(-10) == -3
    assert East.function([IntegerType], IntegerType,
                         lambda _b, v: East.Integer.remainder(v, 3))(-10) == -1
    assert East.function([IntegerType], IntegerType,
                         lambda _b, v: East.Integer.pow(v, -1))(2) == 0
    assert East.function([FloatType], FloatType,
                         lambda _b, v: East.Float.remainder(v, 3.0))(-10.0) == -1.0
    # Float ** coincides with python on ordinary inputs, so it stays
    assert East.function([FloatType], FloatType, lambda _b, v: v ** 2.0)(3.0) == 9.0


def test_negative_array_index_raises_and_the_spelled_form_works():
    from east.types.types import ArrayType, DictType

    t = ArrayType(IntegerType)
    with pytest.raises(ExpressionError, match=r"a\.get\(a\.size\(\) - 1\)"):
        East.function([t], IntegerType, lambda _b, a: a[-1])
    assert East.function([t], IntegerType,
                         lambda _b, a: a.get(a.size() - 1))([10, 20, 30]) == 30
    assert East.function([t], IntegerType, lambda _b, a: a[1])([10, 20, 30]) == 20
    # a Dict's Integer keys are real keys, so a negative KEY stays legal
    from east import EastDict

    dt = DictType(IntegerType, IntegerType)
    assert East.function([dt], IntegerType, lambda _b, d: d[-1])(
        EastDict(IntegerType, IntegerType, {-1: 42})) == 42


def test_operator_fork_raises_reach_the_eager_path():
    # The defect the raises close: the same lambda computed DIFFERENT values
    # depending on whether the purity gate traced it or fell back to python.
    # An eligible callback must now surface the fork loudly, not pick a side.
    from east import EastArray

    arr = EastArray(IntegerType, [-10, 10])
    with pytest.raises(ExpressionError, match=r"East\.Integer\.remainder"):
        arr.map(lambda _b, x: x % 3)
    with pytest.raises(ExpressionError, match=r"East\.Integer\.divide"):
        arr.map(lambda _b, x: x // 3)
