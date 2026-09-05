#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""Python comparison on decoded variants and options."""
from east import IntegerType, StringType, VariantCaseDef, VariantType, some, variant

Shape = VariantType([VariantCaseDef("circle", IntegerType), VariantCaseDef("label", StringType)])
left = variant("circle", 3, Shape)
right = variant("circle", 3, Shape)
same = left == right  # expect: no-host-comparison-on-east-values
held = some(3)
ordered = held < some(4)  # expect: no-host-comparison-on-east-values
