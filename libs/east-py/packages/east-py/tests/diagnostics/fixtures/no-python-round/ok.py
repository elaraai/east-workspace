#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""East's explicit rounding; python's round() on a python value."""
from east import East, FloatType


@East.function([FloatType], FloatType)
def rounds(b, x):
    a = b.let(East.Float.round_half(x))
    c = b.let(East.Float.round_floor(x))
    half = round(2.5)  # a python value
    return a + c + half
