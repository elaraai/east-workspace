#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The Option constructors spelled the long way round."""
from east import East, IntegerType, OptionType, variant


@East.function([IntegerType], OptionType(IntegerType))
def wrapped(b, x):
    held = b.let(variant("some", x, OptionType(IntegerType)))  # expect: prefer-some-none
    empty = b.let(variant("none", None, OptionType(IntegerType)))  # expect: prefer-some-none
    return b.if_(x > 0, lambda b: held).else_(lambda b: empty)
