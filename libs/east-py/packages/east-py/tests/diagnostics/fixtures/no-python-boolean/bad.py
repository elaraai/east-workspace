#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""Python's boolean protocol over an expression."""
from east import East, ArrayType, IntegerType


@East.function([IntegerType, ArrayType(IntegerType)], IntegerType)
def collapses(b, x, xs):
    if x > 1:  # expect: no-python-boolean
        pass
    a = b.let(x > 1 and x < 5)  # expect: no-python-boolean
    c = b.let(not x)  # expect: no-python-boolean
    d = b.let(len(xs))  # expect: no-python-boolean
    e = b.let(x in xs)  # expect: no-python-boolean
    for v in xs:  # expect: no-python-boolean
        pass
    f = b.let(int(x))  # expect: no-python-boolean
    g = b.let(1 if x else 2)  # expect: no-python-boolean
    assert x > 0  # expect: no-python-boolean
    h = b.let(1 if bool(x) else 2)  # expect: no-python-boolean
    i = b.let(sum(xs))  # expect: no-python-boolean
    j = b.let(max(x, 1))  # expect: no-python-boolean
    k = b.let(max(xs))  # expect: no-python-boolean
    return a + c + d + e + f + g + h + i + j + k
