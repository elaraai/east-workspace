#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""Empty containers whose East type is a guess."""
from east import East, IntegerType


@East.function([IntegerType], IntegerType)
def counts(b, x):
    seen = b.let([])  # expect: prefer-explicit-east-type
    tally = b.const({})  # expect: prefer-explicit-east-type
    made = b.let(list())  # expect: prefer-explicit-east-type
    b.do(seen)
    b.do(tally)
    b.do(made)
    return x
