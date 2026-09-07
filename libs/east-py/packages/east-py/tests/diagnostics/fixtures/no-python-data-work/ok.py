#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The cleaning expressed in East, where it runs on every row — and helpers
that only ever see python data."""
from east import East, FloatType, StringType

COLUMNS = ["Name"]


def describe(label):
    return label.strip()


def norm(col):
    return col.strip().lower()


@East.function([StringType], FloatType)
def parsed(b, s):
    trimmed = b.let(East.String.trim(s))
    return East.String.parse(FloatType, trimmed)


@East.function([StringType], StringType)
def labelled(b, s):
    return s + norm(COLUMNS[0])
