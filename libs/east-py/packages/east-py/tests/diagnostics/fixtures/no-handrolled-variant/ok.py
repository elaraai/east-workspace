#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""Variants built by variant(), and dicts that are only dicts."""
from east import East, IntegerType, StringType, VariantType, variant

Shape = VariantType([("circle", IntegerType), ("label", StringType)])
seed = variant("circle", 3, Shape)
settings = {"type": "circle", "value": 3, "note": "three keys, not a variant"}


def payload():
    return {"type": "circle", "value": 3}  # a JSON body for some other system: it never meets East


@East.function([IntegerType], IntegerType)
def sized(b, x):
    shape = b.const(seed, Shape)
    return x
