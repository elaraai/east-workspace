#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""Every nested body uses the block it received."""
from east import East, ArrayType, IntegerType


@East.function([IntegerType, ArrayType(IntegerType)], IntegerType)
def nests(b, x, xs):
    y = b.let(0)
    b.if_(x > 1, lambda b: b.assign(y, 1))
    b.for_(xs, lambda b, v, i: b.assign(y, y + v))
    b.while_(y > 100, lambda b, label: b.assign(y, East.Integer.divide(y, 2)))
    return y
