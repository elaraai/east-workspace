#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The block builder carries the type; a bare wrapper handed to a method stays."""
from east import East, IntegerType


@East.function([IntegerType], IntegerType)
def held(b, x):
    v = b.const(3, IntegerType)
    return v + x.max(East.value(2, IntegerType))
