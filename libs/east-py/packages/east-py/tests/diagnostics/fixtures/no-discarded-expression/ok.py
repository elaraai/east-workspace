#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""Statements appended with b.do(...), errors returned, chains as statements."""
from east import East, ArrayType, IntegerType


@East.function([ArrayType(IntegerType)], ArrayType(IntegerType))
def appends(b, xs):
    """A docstring is not a discarded expression."""
    acc = b.let(East.new_array(IntegerType, []))
    b.do(acc.push_last(1))
    b.if_(xs.size() > 3, lambda b: b.do(acc.push_last(2))).else_(lambda b: b.do(acc.push_last(3)))
    b.for_(xs, lambda b, v, i: b.do(acc.push_last(v)))
    return East.if_else(acc.size() > 0, acc, East.error("empty"))
