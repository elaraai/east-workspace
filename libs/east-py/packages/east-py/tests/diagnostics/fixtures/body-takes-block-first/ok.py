#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""Every body takes the block first and uses it for statements only."""
from east import East, ArrayType, IntegerType


@East.function([IntegerType], IntegerType)
def add_one(b, x):
    y = b.let(x + 1)
    b.if_(x > 0, lambda b: b.assign(y, y + 1))
    return y


double = East.function([IntegerType], IntegerType, lambda b, x: x * 2)


def bump(b, x):
    """A builder helper: it takes the block and appends to it."""
    return b.let(x + 1)


@East.function([ArrayType(IntegerType)], IntegerType)
def with_a_helper(b, xs):
    total = bump(b, xs.size())  # the block handed on: composition, not a value
    return xs.map(lambda b, x, i: x + i).reduce(lambda b, acc, x: acc + x, total)
