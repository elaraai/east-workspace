#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""Every declaration on a statement of its own."""
from east import ArrayType, East, IntegerType


@East.function([IntegerType], IntegerType)
def totals(b, x):
    base = b.const(x, IntegerType)
    total = b.let(base + 1)
    two = b.const(2, IntegerType)
    rows = b.let([x, two], ArrayType(IntegerType))
    b.do(rows)
    return total
