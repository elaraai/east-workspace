#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""Rows assembled by python, then handed to a body."""
from east import ArrayType, East, IntegerType

RATES = [n * 2 for n in range(5)]  # expect: no-python-east-data


@East.function([IntegerType], IntegerType)
def scaled(b, x):
    rates = b.const(RATES, ArrayType(IntegerType))
    return rates.get(0) + x
