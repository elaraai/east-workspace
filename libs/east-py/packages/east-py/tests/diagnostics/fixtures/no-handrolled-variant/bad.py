#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""A dict wearing a variant's shape."""
from east import East, IntegerType, StringType, StructFieldDef, StructType

Row = StructType([StructFieldDef("kind", StringType), StructFieldDef("size", IntegerType)])
seed = {"type": "circle", "value": 3}  # expect: no-handrolled-variant


@East.function([IntegerType], IntegerType)
def sized(b, x):
    shape = b.let({"type": "circle", "value": 3})  # expect: no-handrolled-variant
    b.do(shape)
    return x
