#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The East type stated twice."""
from east import East, IntegerType


@East.function([IntegerType], IntegerType)
def held(b, x):
    v = b.let(East.value(3, IntegerType), IntegerType)  # expect: no-redundant-east-cast
    return v + x
