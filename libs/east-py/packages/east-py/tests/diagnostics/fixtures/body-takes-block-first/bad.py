#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""Bodies that do not take the block first, or use the block as a value."""
from east import East, IntegerType

East.function([IntegerType], IntegerType, lambda x: x + 1)  # expect: body-takes-block-first
East.function([], IntegerType, lambda: 1)  # expect: body-takes-block-first


@East.function([IntegerType], IntegerType)
def reads_off_the_block(b, x):
    return b.price  # expect: body-takes-block-first


@East.function([IntegerType], IntegerType)
def adds_the_block(b, x):
    return x + b  # expect: body-takes-block-first


@East.function([IntegerType, IntegerType], IntegerType)
def too_few(b, x):  # expect: body-takes-block-first
    return x


@East.function([IntegerType], IntegerType)
def calls_the_block(b, x):
    return b(x)  # expect: body-takes-block-first
