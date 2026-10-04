#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""A query prints as the ``East.jq`` that built it (#927, #1041): a call of
the ``Query`` builtin, read from its query — the program as written, its input
(a dict of the named inputs, each the call's argument in its place) and its
translation's result type — and the printed module rebuilds the same IR. A
``Query`` builtin that is not such a call prints raw, through
``East.builtin``. Every corpus case's call prints and rebuilds so (#1041 B2).
The TypeScript twins are pinned in ``libs/east/src/codegen/codegen.spec.ts``
("a query prints as the East.jq it was") and ``libs/east/test/query.spec.ts``
(B2)."""

from __future__ import annotations

import math
import re
from typing import Any

import pytest
from east.runtime._compiler_eastc import diff_ir

from east import East
from east.codegen import to_python_source
from east.ir.analyze import IRAnalysisError, analyze_ir
from east.ir.builders import ir_block, ir_builtin, ir_call, ir_function, ir_let, ir_variable
from east.query import QueryCallType
from east.types.types import (
    ArrayType,
    DateTimeType,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    StringType,
    StructType,
)
from tests.test_query_corpus import CALLED

Order = StructType([("id", IntegerType), ("total", FloatType)])
Numbers = ArrayType(IntegerType)


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
    assert "east_jq" not in src and "Query" not in src, src
    assert diff_ir(big._east_ir, main._east_ir) is None
    assert to_python_source(main, width=math.inf) == src


def test_named_inputs_print_as_a_dict_every_input_among_them(tmp_path):
    # Every named input is an argument of the call, one the query does not read too.
    @East.function([ArrayType(Order), IntegerType, StringType], FloatType)
    def total(b, orders, least, note):
        t = b.const(East.jq({"orders": orders, "least": least, "note": note},
                            ".least as $m | [.orders[] | select(.id >= $m) | .total] | add", FloatType))
        return t + 1.0

    src, main = _rebuilt(total, tmp_path, "total")
    assert re.search(r"t = b\.const\(East\.jq\(\{'orders': orders, 'least': least, 'note': note\}, '[^']*', "
                     r"result_type=FloatType\)\)", src), src
    assert diff_ir(total._east_ir, main._east_ir) is None


def test_a_querys_program_prints_as_written(tmp_path):
    # An ISO date compared with a DateTime stays the text it was: the DateTime
    # it writes is the translation's, not the query's (#1138).
    dated = StructType([("id", IntegerType), ("at", DateTimeType)])
    fn = East.function([ArrayType(dated)], ArrayType(IntegerType),
                       lambda b, orders: East.jq(orders, '[.[] | select(.at >= "2026-01-01") | .id]',
                                                 ArrayType(IntegerType)))
    src, main = _rebuilt(fn, tmp_path, "dated")
    assert """East.jq(orders, '[.[] | select(.at >= "2026-01-01") | .id]', result_type=ArrayType(IntegerType))""" \
        in src, src
    assert diff_ir(fn._east_ir, main._east_ir) is None


def test_a_query_in_a_callback_prints_as_east_jq_there(tmp_path):
    sums = East.function([ArrayType(ArrayType(IntegerType))], ArrayType(IntegerType),
                         lambda b, rows: rows.map(lambda b, row: East.jq(row, "map(. * 2) | add", IntegerType)))
    src, main = _rebuilt(sums, tmp_path, "sums")
    assert "East.jq(row, 'map(. * 2) | add', result_type=IntegerType)" in src, src
    assert diff_ir(sums._east_ir, main._east_ir) is None
    assert list(main([[1, 2], [3]])) == [6, 6]


def _query_builtin() -> Any:
    """The ``Query`` builtin ``East.jq`` makes of ``map(. * 2)`` over a Numbers input: its constant query and
    its translation."""
    doubled = East.function([Numbers], Numbers, lambda b, xs: East.jq(xs, "map(. * 2)", Numbers))
    call = doubled._east_ir.value["body"]
    assert call.type == "Call"
    return call.value["function"]


def test_a_query_builtin_standing_elsewhere_prints_raw_and_rebuilds(tmp_path):
    # Bound, then called: not the call East.jq makes, so the builtin prints as it stands.
    builtin = _query_builtin()
    fn_t = builtin.value["type"]
    xs = ir_variable(Numbers, "xs")
    query = ir_variable(fn_t, "query")
    body = ir_block(Numbers, [ir_let(NullType, query, builtin), ir_call(Numbers, query, [xs])])
    ir = ir_function(FunctionType([Numbers], Numbers), [], [xs], body)
    analyze_ir(ir)
    src, main = _rebuilt(ir, tmp_path, "standing")
    assert "East.builtin('Query'" in src and "East.jq(" not in src, src
    assert diff_ir(ir, main._east_ir) is None
    assert list(main([1, 2])) == [2, 4]


def test_a_query_call_whose_query_is_not_a_constant_prints_raw(tmp_path):
    # A query read from a parameter is not what East.jq makes: the call prints
    # raw, and rebuilding it is refused by the IR analysis that refuses the IR
    # itself (python analyzes every build; TypeScript at compile).
    fn_t = FunctionType([Numbers], Numbers)
    query = ir_variable(QueryCallType, "query")
    xs = ir_variable(Numbers, "xs")
    ys = ir_variable(Numbers, "ys")
    translation = ir_function(fn_t, [], [ys], ys)
    call = ir_call(Numbers, ir_builtin(fn_t, "Query", [fn_t], [query, translation]), [xs])
    ir = ir_function(FunctionType([QueryCallType, Numbers], Numbers), [], [query, xs], call)
    constant = r"Builtin function 'Query' takes its query as a constant"
    with pytest.raises(IRAnalysisError, match=constant):
        analyze_ir(ir)
    src = to_python_source(ir, width=math.inf)
    assert "East.builtin('Query'" in src and "East.jq(" not in src, src
    with pytest.raises(IRAnalysisError, match=constant):
        exec(compile(src, str(tmp_path / "unconstant.py"), "exec"), {})


@pytest.mark.parametrize("entry", CALLED, ids=[e["case"]["name"] for e in CALLED])
def test_every_corpus_query_call_prints_as_the_east_jq_that_made_it_and_rebuilds(entry: Any, tmp_path: Any) -> None:
    # #1041 B2: TypeScript's call of the Query builtin for each corpus case
    # prints as East.jq, and python rebuilds it equal under the normaliser.
    ir = entry["called"].value
    src, main = _rebuilt(ir, tmp_path, "called")
    assert "East.jq(" in src, src
    assert "'Query'" not in src and "east_jq" not in src, src
    difference = diff_ir(ir, main._east_ir)
    assert difference is None, f"{difference}\n{src}"
