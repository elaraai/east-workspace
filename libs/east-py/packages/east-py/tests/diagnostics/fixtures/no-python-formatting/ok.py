#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""East's own text of a value, and python formatting over python values."""
from east import East, IntegerType, StringType


@East.function([IntegerType], StringType)
def prints(b, x):
    label = "n=" + East.String.print(IntegerType, x)
    constant = f"{3}" + str(4)  # python values
    return label + constant
