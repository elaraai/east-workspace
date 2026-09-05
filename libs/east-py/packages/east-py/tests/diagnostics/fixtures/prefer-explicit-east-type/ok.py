#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The East type given, and containers that determine their own."""
from east import ArrayType, DictType, East, IntegerType, StringType


@East.function([IntegerType], IntegerType)
def counts(b, x):
    seen = b.let([], ArrayType(IntegerType))
    tally = b.const({}, DictType(StringType, IntegerType))
    filled = b.let([1, 2, 3])
    b.do(seen)
    b.do(tally)
    b.do(filled)
    return x
