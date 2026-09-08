#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""A real East.function, python helpers, eager East values built outside any
body — data, not a macro — and an f-string that is prose, not a key."""
from east import East, EastStruct, IntegerType, StringType, StructType, none, some

Row = StructType([("org", StringType), ("line", IntegerType)])


@East.function([IntegerType], IntegerType)
def doubled(b, size):
    return size * 2


def default_limit():
    return 100


def held(value):
    if value is None:
        return none
    return some(EastStruct({"org": "acme", "line": value}))


def endpoint(host, port):
    return f"{host}:{port}"


def label(name, count):
    return f"{name} has {count}"


@East.function([StringType], StringType)
def labelled(b, s):
    return s + label("rows", 3)
