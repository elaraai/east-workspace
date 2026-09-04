#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The Option constructors, and a variant that is not an Option."""
from east import East, IntegerType, OptionType, StringType, VariantCaseDef, VariantType, none, some, variant

Shape = VariantType([VariantCaseDef("circle", IntegerType), VariantCaseDef("label", StringType)])


@East.function([IntegerType], OptionType(IntegerType))
def wrapped(b, x):
    held = b.let(some(x))
    empty = b.let(none)
    tagged = b.let(variant("circle", x, Shape))
    b.do(tagged)
    return b.if_(x > 0, lambda b: held).else_(lambda b: empty)
