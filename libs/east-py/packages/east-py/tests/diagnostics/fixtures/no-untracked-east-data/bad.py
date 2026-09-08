#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""Python locals feeding an East expression."""
from east import ArrayType, East, IntegerType


@East.function([ArrayType(IntegerType)], ArrayType(IntegerType))
def extended(b, xs):
    extra = [4, 5, 6]
    return xs.concat(extra)  # expect: no-untracked-east-data
