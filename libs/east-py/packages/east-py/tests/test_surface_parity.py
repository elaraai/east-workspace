#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Surface-parity tests (issue #296): the tracer's expanded op set and the
TS-expr-sugar reductions/groupings on Array/Set/Dict — all composed over
east-c builtins with native kernels."""


import pytest

from east import (
    EastBlob,
    FloatType,
    IntegerType,
    StringType,
    StructType,
)

ROW = StructType([("sku", StringType), ("price", FloatType), ("qty", IntegerType)])
CSV = b"sku,price,qty\nA,2.5,4\nB,150.0,1\nA,10.0,2\nB,3.0,5\n"


def _rows():
    return EastBlob(CSV).decode_csv(ROW)


# ─── tracer: math / string / datetime / option / variant / collections ──────


# ─── array sugar ─────────────────────────────────────────────────────────────


def test_array_maximum_minimum_find():
    rows = _rows()
    assert rows.maximum(lambda r: r.price) == 150.0
    assert rows.minimum(lambda r: r.price) == 2.5
    assert rows.find_maximum(lambda r: r.price).value == 1
    assert rows.find_minimum(lambda r: r.price).value == 0
    assert rows.filter(lambda r: r.price > 1e9).find_maximum(lambda r: r.price).type == "none"
    from east import EastError

    with pytest.raises(EastError):
        rows.filter(lambda r: r.price > 1e9).maximum(lambda r: r.price)


# ─── set / dict sugar ────────────────────────────────────────────────────────


# ─── East.DateTime namespace sugar ───────────────────────────────────────────


