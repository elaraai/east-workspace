#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""Python formatting over an expression."""
from east import East, IntegerType, StringType


@East.function([IntegerType], StringType)
def formats(b, x):
    a = b.let(f"{x}")  # expect: no-python-formatting
    c = b.let(str(x))  # expect: no-python-formatting
    d = b.let("{}".format(x))  # expect: no-python-formatting
    e = b.let(format(x))  # expect: no-python-formatting
    f = b.let("%d" % x)  # expect: no-python-formatting
    p = print(x)  # expect: no-python-formatting
    return a + c + d + e + f
