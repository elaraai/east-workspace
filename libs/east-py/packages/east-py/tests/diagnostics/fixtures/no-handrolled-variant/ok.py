#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""Variants built by variant(), and dicts that are only dicts."""
from east import East, IntegerType, StringType, VariantCaseDef, VariantType, variant

Shape = VariantType([VariantCaseDef("circle", IntegerType), VariantCaseDef("label", StringType)])
seed = variant("circle", 3, Shape)
settings = {"type": "circle", "value": 3, "note": "three keys, not a variant"}


@East.function([IntegerType], IntegerType)
def sized(b, x):
    shape = b.let(variant("circle", 3, Shape))
    b.do(shape)
    return x
