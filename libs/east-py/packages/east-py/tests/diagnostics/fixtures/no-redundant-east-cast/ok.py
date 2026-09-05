#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The type stated once, where the binding is made."""
from east import East, IntegerType


@East.function([IntegerType], IntegerType)
def held(b, x):
    v = b.let(3, IntegerType)
    return v + x
