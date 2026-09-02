#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""Python-idiom aliases the surface keeps as deprecated spellings."""
from east import East, ArrayType, IntegerType, StringType


@East.function([ArrayType(IntegerType), StringType], IntegerType)
def aliases(b, xs, s):
    total = b.let(xs.fold(0, lambda b, acc, x: acc + x))  # expect: no-deprecated-alias
    low = b.let(s.lower())  # expect: no-deprecated-alias
    both = b.let(East.Boolean.and_(total > 1, low == "a"))  # expect: no-deprecated-alias
    return East.if_else(both, total, 0)
