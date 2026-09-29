#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""A query prints as the ``East.jq`` that built it (#927): its marker's
canonical jq, its input (a dict of the named inputs) and its result type, and
the printed module rebuilds the same IR; a block that looks like a query but
is not what ``East.jq`` builds prints as it stands. The TypeScript twin is
pinned in ``libs/east/src/codegen/codegen.spec.ts`` ("a query prints as the
East.jq it was")."""

from __future__ import annotations

import math
import re
from typing import Any

from east.runtime._compiler_eastc import diff_ir

from east import East
from east.codegen import to_python_source
from east.expression.query import MARKER_TYPE
from east.types.types import ArrayType, FloatType, IntegerType, StructType

Order = StructType([("id", IntegerType), ("total", FloatType)])


def _rebuilt(fn: Any, tmp_path: Any, name: str) -> tuple[str, Any]:
    """The module ``fn`` prints as, and the function it rebuilds."""
    src = to_python_source(fn, width=math.inf)
    path = tmp_path / f"{name}.py"
    path.write_text(src, encoding="utf-8")
    namespace: dict = {}
    exec(compile(src, str(path), "exec"), namespace)
    return src, namespace["main"]


def test_a_query_prints_as_the_east_jq_it_was_and_rebuilds(tmp_path):
    big = East.function([ArrayType(Order)], ArrayType(IntegerType),
                        lambda b, orders: East.jq(orders, "[.[] | select(.total > 1000) | .id]",
                                                  ArrayType(IntegerType)))
    src, main = _rebuilt(big, tmp_path, "big")
    assert "return East.jq(orders, '[.[] | select(.total > 1000) | .id]', result_type=ArrayType(IntegerType))" \
        in src, src
    assert "east_jq" not in src, src
    assert diff_ir(big._east_ir, main._east_ir) is None
    assert to_python_source(main, width=math.inf) == src


def test_named_inputs_print_as_a_dict(tmp_path):
    @East.function([ArrayType(Order), IntegerType], FloatType)
    def total(b, orders, least):
        t = b.const(East.jq({"orders": orders, "least": least},
                            ".least as $m | [.orders[] | select(.id >= $m) | .total] | add", FloatType))
        return t + 1.0

    src, main = _rebuilt(total, tmp_path, "total")
    assert re.search(r"t = b\.const\(East\.jq\(\{'orders': orders, 'least': least\}, '[^']*', "
                     r"result_type=FloatType\)\)", src), src
    assert diff_ir(total._east_ir, main._east_ir) is None


def test_a_query_in_a_callback_prints_as_east_jq_there(tmp_path):
    sums = East.function([ArrayType(ArrayType(IntegerType))], ArrayType(IntegerType),
                         lambda b, rows: rows.map(lambda b, row: East.jq(row, "map(. * 2) | add", IntegerType)))
    src, main = _rebuilt(sums, tmp_path, "sums")
    assert "East.jq(row, 'map(. * 2) | add', result_type=IntegerType)" in src, src
    assert diff_ir(sums._east_ir, main._east_ir) is None
    assert list(main([[1, 2], [3]])) == [6, 6]


def test_a_block_that_looks_like_a_query_but_is_not_what_east_jq_builds_prints_as_it_stands(tmp_path):
    def body(b, x):
        def block(b):
            # the marker, a Let of the input, then not the translation of "." over an Integer
            b.do(East.value({"east_jq": ".", "inputs": []}, MARKER_TYPE))
            given = b.const(x)
            return given + 1
        return East.block(block)

    f = East.function([IntegerType], IntegerType, body)
    src, main = _rebuilt(f, tmp_path, "lookalike")
    assert "East.jq(" not in src, src
    assert "'east_jq': '.'" in src, src
    assert diff_ir(f._east_ir, main._east_ir) is None
    assert main(41) == 42
