#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""A python local holding an expression, read twice or inside a body that runs repeatedly."""
from east import ArrayType, East, EastArray, IntegerType, StructType

Row = StructType([("qty", IntegerType), ("price", IntegerType)])


@East.function([IntegerType], IntegerType)
def helper(b, x):
    return x * 2


@East.function([ArrayType(IntegerType)], IntegerType)
def read_twice(b, xs):
    n = xs.size() * 2  # expect: no-reinlined-east-binding
    return n + n


@East.function([ArrayType(Row)], ArrayType(IntegerType))
def inside_a_callback(b, rows):
    table = rows.sort(lambda _b, r: r.qty)  # expect: no-reinlined-east-binding
    return rows.map(lambda _b, r: table.size() + r.qty)


@East.function([ArrayType(IntegerType)], IntegerType)
def inside_a_loop_body(b, xs):
    limit = xs.size() * 2  # expect: no-reinlined-east-binding
    acc = b.let(0)
    b.for_(xs, lambda b, v, _i, _label: b.assign(acc, acc + v + limit))
    return acc


@East.function([IntegerType], IntegerType)
def inside_a_nested_function(b, x):
    offset = x * 2  # expect: no-reinlined-east-binding
    f = b.const(East.function([IntegerType], IntegerType, lambda _b, y: y + offset))
    return f(1)


@East.function([ArrayType(IntegerType)], IntegerType)
def twice_inside_one_arm(b, xs):
    n = xs.size() * 2  # expect: no-reinlined-east-binding
    out = b.let(0)
    b.if_(n > 3, lambda b: b.assign(out, n + n))
    return out


@East.function([ArrayType(IntegerType)], IntegerType)
def twice_inside_one_if_else_arm(b, xs):
    n = xs.size() * 2  # expect: no-reinlined-east-binding
    return East.if_else(xs.size() > 3, n + n, 0)


@East.function([IntegerType], IntegerType)
def a_call_of_an_artifact(b, x):
    v = helper(x)  # expect: no-reinlined-east-binding
    return v + v


@East.function([IntegerType], IntegerType)
def a_fresh_collection(b, x):
    acc = East.new_array(IntegerType)  # expect: no-reinlined-east-binding
    return East.block(acc.push_last(x), acc.size())


ITEMS = EastArray(Row, [{"qty": 2, "price": 3}])


def doubled(b, r):
    m = r.qty * 2  # expect: no-reinlined-east-binding
    return m + m


TOTALS = ITEMS.map(doubled)
