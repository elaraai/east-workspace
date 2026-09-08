#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""Declarations buried inside expressions."""
from east import ArrayType, East, IntegerType


@East.function([IntegerType], IntegerType)
def totals(b, x):
    total = b.let(b.const(x, IntegerType) + 1)  # expect: no-let-const-in-expression
    rows = b.let([x, b.const(2, IntegerType)], ArrayType(IntegerType))  # expect: no-let-const-in-expression
    b.do(rows)
    return total
