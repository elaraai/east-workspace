#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The cleaning expressed in East, where it runs on every row."""
from east import East, FloatType, StringType


def describe(label):
    return label.strip()


@East.function([StringType], FloatType)
def parsed(b, s):
    trimmed = b.let(East.String.trim(s))
    return East.String.parse_float(trimmed)
