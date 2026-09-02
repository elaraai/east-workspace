#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""East's own conditionals and collection queries; python booleans over python values."""
from east import East, ArrayType, BooleanType, IntegerType

DEBUG = False


@East.function([IntegerType, ArrayType(IntegerType), BooleanType], IntegerType)
def branches(b, x, xs, flag):
    a = b.let(East.if_else(x > 1, 1, 2))
    both = b.let((x > 1) & (x < 5))
    neither = b.let(~flag)
    n = b.let(xs.size())
    has = b.let(xs.has(x))
    total = b.let(0)
    b.if_(x > 1, lambda b: b.assign(total, total + 1)).else_(lambda b: b.assign(total, 0))
    b.for_(xs, lambda b, v, i: b.assign(total, total + v))
    if DEBUG:  # a python value decides at build time
        total = b.let(total + 1)
    return a + n + East.if_else(both | has | neither, total, 0)
