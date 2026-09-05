#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The data bound by the block builder before it reaches the expression."""
from east import ArrayType, East, IntegerType


@East.function([ArrayType(IntegerType)], ArrayType(IntegerType))
def extended(b, xs):
    extra = b.const([4, 5, 6], ArrayType(IntegerType))
    return xs.concat(extra)
