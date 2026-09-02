#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""python's round() on a Float expression."""
from east import East, FloatType


@East.function([FloatType], FloatType)
def rounds(b, x):
    a = b.let(round(x))  # expect: no-python-round
    c = b.let(round(x, 2))  # expect: no-python-round
    return a + c
