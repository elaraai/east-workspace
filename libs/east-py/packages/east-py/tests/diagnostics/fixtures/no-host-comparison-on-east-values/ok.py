#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The East helpers for variants; plain python comparison for scalars."""
from east import IntegerType, StringType, VariantCaseDef, VariantType, compare_for, equal_for, variant

Shape = VariantType([VariantCaseDef("circle", IntegerType), VariantCaseDef("label", StringType)])
left = variant("circle", 3, Shape)
right = variant("circle", 3, Shape)
same = equal_for(Shape)(left, right)
ordered = compare_for(Shape)(left, right)
count = 3
bigger = count > 1
