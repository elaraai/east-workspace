#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""A real East.function, a plain python helper, and eager East values built
outside any body — which are data, not a macro."""
from east import East, EastStruct, IntegerType, StringType, StructFieldDef, StructType, none, some

Row = StructType([StructFieldDef("org", StringType), StructFieldDef("line", IntegerType)])


@East.function([IntegerType], IntegerType)
def doubled(b, size):
    return size * 2


def default_limit():
    return 100


def held(value):
    if value is None:
        return none
    return some(EastStruct({"org": "acme", "line": value}))
