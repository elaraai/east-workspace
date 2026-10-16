#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""Shared work bound once; cheap names; a single read; exclusive arms; once-only bodies."""
from east import ArrayType, DictType, East, IntegerType, StringType, StructType

Row = StructType([("qty", IntegerType), ("price", IntegerType)])


@East.function([ArrayType(Row), IntegerType], IntegerType)
def bound_once(b, rows, k):
    total = b.const(rows.sum(lambda _b, r: r.qty * r.price))   # a binding: read it freely
    scaled = b.let(total * k)
    b.assign(scaled, scaled + total)
    return total + scaled + total + rows.map(lambda _b, r: r.qty + total).size()


@East.function([ArrayType(IntegerType)], ArrayType(IntegerType))
def cheap_names(b, xs):
    a = xs                                   # an alias re-emits a variable: nothing runs twice
    T = ArrayType(IntegerType)               # a type, not an expression
    k = 3                                    # a python scalar lifts as a literal
    acc = b.let([], T)
    b.do(acc.push_last(a.size() + k))
    b.do(acc.push_last(a.size() * k))
    return acc


@East.function([Row], IntegerType)
def field_alias(b, r):
    q = r.qty                                # a field read, re-emitted as a field read
    return q + q


@East.function([ArrayType(Row)], IntegerType)
def read_once(b, rows):
    n = rows.size() * 2                      # one read: emitted once
    return n


@East.function([ArrayType(Row)], IntegerType)
def exclusive_arms(b, rows):
    n = rows.size() * 2                      # one read in each of two EXCLUSIVE arms: at most one runs
    out = b.let(0)
    b.if_(n > 3, lambda b: b.assign(out, n)).else_(lambda b: b.assign(out, -n))
    return East.if_else(out > 0, n + 1, n - 1)


@East.function([DictType(StringType, IntegerType), StringType], IntegerType)
def once_only_bodies(b, d, k):
    n = d.size() * 2                         # read once, inside bodies that run at most once
    found = d.try_get(k).match({"some": lambda _b, v: v + n, "none": lambda _b, _v: 0})
    fallback = d.get(k, lambda _b, _k: n)
    return East.try_catch(lambda _b: found + fallback, lambda _b, _m: n)
