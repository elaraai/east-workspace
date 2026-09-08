#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""A macro expanded into a body, and a body calling a composite-key helper."""
from east import East, IntegerType, StringType, VariantType, variant

Shape = VariantType([("circle", IntegerType), ("label", StringType)])


def circle(size):  # expect: no-module-scope-east-macro
    return variant("circle", size, Shape)


def row_key(org, line):  # expect: no-module-scope-east-macro
    return f"{org}|{line}"


@East.function([IntegerType], Shape)
def shaped(b, x):
    return circle(x)


@East.function([StringType], StringType)
def keyed(b, s):
    return row_key("acme", "1") + s
