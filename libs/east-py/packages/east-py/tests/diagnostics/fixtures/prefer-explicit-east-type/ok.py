#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The East type given, or the value built by East."""
from east import ArrayType, DictType, East, IntegerType, StringType


@East.function([IntegerType], IntegerType)
def counts(b, x):
    seen = b.let([], ArrayType(IntegerType))
    tally = b.const({}, DictType(StringType, IntegerType))
    filled = b.let(East.new_array(IntegerType, [1, 2, 3]))
    row = b.const({"n": x})
    return filled.size() + row.n
