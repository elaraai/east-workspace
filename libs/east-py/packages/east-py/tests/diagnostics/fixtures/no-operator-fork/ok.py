#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The East spellings, and python operators over python values."""
from east import East, ArrayType, IntegerType


@East.function([IntegerType, ArrayType(IntegerType)], IntegerType)
def spelled(b, x, xs):
    a = b.let(East.Integer.divide(x, 2))
    c = b.let(East.Integer.remainder(x, 3))
    d = b.let(East.Integer.pow(x, 2))
    e = b.let(xs.get(xs.size() - 1))
    half = 7 // 2  # python values: python's operators
    return a + c + d + e + half
