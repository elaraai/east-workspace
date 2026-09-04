#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""One binding, evaluated once — and a single use, which copies nothing."""
from east import East, IntegerType


@East.function([IntegerType], IntegerType)
def totals(b, x):
    doubled = b.let(x * 2)
    once = x + 1
    return doubled + doubled + once
