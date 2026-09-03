#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""Bare expression statements in a body: evaluated at build time and thrown away."""
from east import East, ArrayType, IntegerType


@East.function([ArrayType(IntegerType)], ArrayType(IntegerType))
def discards(b, xs):
    acc = b.let(East.new_array(IntegerType, []))
    acc.push_last(1)  # expect: no-discarded-expression
    East.error("boom")  # expect: no-discarded-expression
    xs.size()  # expect: no-discarded-expression
    1 + 1  # expect: no-discarded-expression
    return acc
