#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""The operators python and East disagree on."""
from east import East, ArrayType, IntegerType


@East.function([IntegerType, ArrayType(IntegerType)], IntegerType)
def forks(b, x, xs):
    a = b.let(x // 2)  # expect: no-operator-fork
    c = b.let(x % 3)  # expect: no-operator-fork
    d = b.let(x ** 2)  # expect: no-operator-fork
    e = b.let(xs[-1])  # expect: no-operator-fork
    return a + c + d + e
