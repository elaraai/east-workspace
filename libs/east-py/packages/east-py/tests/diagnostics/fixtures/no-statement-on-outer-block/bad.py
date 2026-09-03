#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""A statement on an enclosing body's block from inside a nested body."""
from east import East, ArrayType, IntegerType


@East.function([IntegerType, ArrayType(IntegerType)], IntegerType)
def crosses(b, x, xs):
    y = b.let(0)
    b.if_(x > 1, lambda _b: b.assign(y, 1))  # expect: no-statement-on-outer-block
    b.for_(xs, lambda _b, v, i: b.assign(y, y + v))  # expect: no-statement-on-outer-block
    return y
