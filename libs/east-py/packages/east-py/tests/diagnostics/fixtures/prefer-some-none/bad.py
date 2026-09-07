#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The Option constructors spelled the long way round."""
from east import East, IntegerType, OptionType, variant

EMPTY = variant("none", None, OptionType(IntegerType))  # expect: prefer-some-none
HELD = variant("some", 3, OptionType(IntegerType))  # expect: prefer-some-none


@East.function([IntegerType], OptionType(IntegerType))
def wrapped(b, x):
    return East.if_else(x > 0, variant("some", x, OptionType(IntegerType)), variant("none", None, OptionType(IntegerType)))  # expect: prefer-some-none
