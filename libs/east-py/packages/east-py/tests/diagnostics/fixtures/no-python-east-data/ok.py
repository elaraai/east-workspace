#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The rows written out, and a comprehension that never reaches East."""
from east import ArrayType, East, IntegerType

RATES = [0, 2, 4, 6, 8]
REPORT_LABELS = [f"row {n}" for n in range(3)]


@East.function([IntegerType], IntegerType)
def scaled(b, x):
    rates = b.const(RATES, ArrayType(IntegerType))
    return rates.get(0) + x
