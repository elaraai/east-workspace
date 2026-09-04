#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""A macro expanded into a body, and a helper building a composite key."""
from east import East, IntegerType, StringType, VariantCaseDef, VariantType, variant

Shape = VariantType([VariantCaseDef("circle", IntegerType), VariantCaseDef("label", StringType)])


def circle(size):  # expect: no-module-scope-east-macro
    return variant("circle", size, Shape)


def row_key(org, line):  # expect: no-module-scope-east-macro
    return f"{org}|{line}"


@East.function([IntegerType], Shape)
def shaped(b, x):
    return circle(x)
