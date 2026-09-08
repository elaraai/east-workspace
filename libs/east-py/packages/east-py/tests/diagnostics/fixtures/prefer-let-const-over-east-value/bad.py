#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""East.value where the block builder belongs."""
from east import East, IntegerType


@East.function([IntegerType], IntegerType)
def held(b, x):
    v = East.value(3, IntegerType)  # expect: prefer-let-const-over-east-value
    return v + x
