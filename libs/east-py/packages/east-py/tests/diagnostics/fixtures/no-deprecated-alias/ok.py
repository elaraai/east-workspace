#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The TypeScript spellings."""
from east import East, ArrayType, IntegerType, StringType


@East.function([ArrayType(IntegerType), StringType], IntegerType)
def canonical(b, xs, s):
    total = b.let(xs.reduce(lambda b, acc, x: acc + x, 0))
    low = b.let(s.lower_case())
    both = b.let(East.Boolean.bit_and(total > 1, low == "a"))
    return East.if_else(both, total, 0)
