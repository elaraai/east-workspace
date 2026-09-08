#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The East helpers for ordering variants; structural equality, scalars, and
a parameter that merely shares a module binding's name."""
from east import IntegerType, StringType, VariantType, compare_for, equal_for, some, variant

Shape = VariantType([("circle", IntegerType), ("label", StringType)])
left = variant("circle", 3, Shape)
right = variant("circle", 3, Shape)
same = equal_for(Shape)(left, right)
same_py = left == right
ordered = compare_for(Shape)(left, right)
count = 3
bigger = count > 1
held = some(3)


def rank(held):
    return held > 1


ranked = rank(5)
