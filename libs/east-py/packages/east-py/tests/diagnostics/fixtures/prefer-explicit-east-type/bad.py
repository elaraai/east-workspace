#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""Python containers the build cannot lift."""
from east import East, IntegerType


@East.function([IntegerType], IntegerType)
def counts(b, x):
    seen = b.let([])  # expect: prefer-explicit-east-type
    made = b.let(list())  # expect: prefer-explicit-east-type
    pair = b.const((1, 2))  # expect: prefer-explicit-east-type
    return x
