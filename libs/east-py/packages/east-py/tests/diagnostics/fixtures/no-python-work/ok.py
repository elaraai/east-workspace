#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""Eager callbacks that stay in East: East methods, macros, immutable values, the allowed builtins."""
from east import East, EastArray, IntegerType, StructType, struct
from east.runtime.platform import platform_function

items = EastArray(IntegerType, [1, 2, 3])
config = struct({"offset": 1}, StructType([("offset", IntegerType)]))
doubled = items.map(lambda b, v: v * 2)
big = items.filter(lambda b, v: v > 1)
as_float = items.map(lambda b, v: East.Integer.to_float(v))
shifted = items.map(lambda b, v: v + config.offset)  # an immutable value captures
magnitude = items.map(lambda b, v: abs(v))  # abs, bool and isinstance are the builtins a capture admits


def twice(v):
    """A macro: every global it loads is liftable, so the capture runs it at build time."""
    return v * 2


def thrice(v):
    return twice(v) + v


twiced = items.map(lambda b, v: twice(v))
thriced = items.map(lambda b, v: thrice(v))


def bump(b, x):
    """A builder helper in an East.function body: a macro, not a capture."""
    return x * 2


@East.function([IntegerType], IntegerType)
def with_a_helper(b, x):
    return bump(b, x)


@platform_function("count_big", inputs=[EastArray], output=IntegerType)
def count_big(xs):
    return xs.filter(lambda b, v: v > 1).size()


rows = [(2, "b"), (1, "a")]
rows.sort(key=lambda row: row[0])  # a python list: python's sort
