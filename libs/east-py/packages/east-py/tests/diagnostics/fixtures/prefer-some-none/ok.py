#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The Option constructors, and a variant of the author's own whose case is called some."""
from east import East, IntegerType, OptionType, StringType, VariantType, none, some, variant

Shape = VariantType([("circle", IntegerType), ("label", StringType)])
Count = VariantType([("some", IntegerType), ("many", IntegerType)])
one = variant("some", 1, Count)
tagged = variant("circle", 3, Shape)


@East.function([IntegerType], OptionType(IntegerType))
def wrapped(b, x):
    held = b.let(some(x))
    return East.if_else(x > 0, held, none)
