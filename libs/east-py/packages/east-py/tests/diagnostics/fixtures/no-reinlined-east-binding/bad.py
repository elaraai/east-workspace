#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""An expression tree copied at every use."""
from east import East, IntegerType


@East.function([IntegerType], IntegerType)
def totals(b, x):
    doubled = x * 2  # expect: no-reinlined-east-binding
    return doubled + doubled
