#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""A dict wearing a variant's shape, reaching East."""
from east import East, IntegerType, StringType, VariantType, array, coerce_to

Shape = VariantType([("circle", IntegerType), ("label", StringType)])
SEED = {"type": "circle", "value": 3}  # expect: no-handrolled-variant
seeded = coerce_to(SEED, Shape)
rows = array(Shape, [{"type": "label", "value": "x"}])  # expect: no-handrolled-variant


@East.function([IntegerType], IntegerType)
def sized(b, x):
    shape = b.let({"type": "circle", "value": 3})  # expect: no-handrolled-variant
    return x
