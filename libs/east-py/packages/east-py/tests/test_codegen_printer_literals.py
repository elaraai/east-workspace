#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The printer spells a bound construction as the python literal with the
type on ``b.let`` / ``b.const`` — ``d = b.let({1: 'a'}, T)``, as the surface
is written — and an Option case as ``some(v)`` / ``none``; a dict keyed by
expressions keeps ``East.new_dict`` (python cannot hash them) and every set
keeps ``East.new_set`` (a set literal would lose the element order). The
TypeScript twin is pinned in ``libs/east/src/codegen/codegen.spec.ts``
("values")."""

from __future__ import annotations

import math
import re

from east.runtime._compiler_eastc import diff_ir

from east import East
from east.codegen import to_python_source
from east.types.construct import none, some
from east.types.types import (
    ArrayType,
    DictType,
    FunctionType,
    IntegerType,
    OptionType,
    SetType,
    StringType,
    StructType,
)

Row = StructType([("x", IntegerType), ("y", StringType)])


@East.function([IntegerType], IntegerType)
def bound(b, n):
    d = b.let({1: "a", 2: "b"}, DictType(IntegerType, StringType))
    a = b.let([n, n + 1], ArrayType(IntegerType))
    s = b.const(East.new_set(IntegerType, [4, 3]))  # a set keeps its constructor: {4, 3} would reorder
    row = b.const({"x": n, "y": "s"}, Row)
    o = b.const(some(n), OptionType(IntegerType))
    nothing = b.const(none, OptionType(IntegerType))
    keyed = b.let(East.new_dict(IntegerType, StringType, [(n, "k")]))  # an expression key: no python literal
    empty = b.let({}, DictType(IntegerType, StringType))
    picked = b.const([some(n), none], ArrayType(OptionType(IntegerType)))
    nested = b.const({"a": East.new_set(IntegerType, [2, 1]), "b": East.new_set(IntegerType, [n])},
                     DictType(StringType, SetType(IntegerType)))
    rows = b.const([{"x": n, "y": "s"}, {"x": 0, "y": ""}], ArrayType(Row))
    deep = b.const(some({"x": n, "y": "s"}), OptionType(Row))
    return (d.size() + a.size() + s.size() + row.x + o.unwrap() + nothing.unwrap_or(0)
            + keyed.size() + empty.size() + picked.size() + nested.size() + rows.size() + deep.unwrap().x)


def test_bound_constructions_print_as_literals_with_the_type():
    # the SHAPES, one construct per line (``width=math.inf``); the layout has its own test
    src = to_python_source(bound, width=math.inf)
    for expected in [
        r"d = b\.let\(\{1: 'a', 2: 'b'\}, DictType\(IntegerType, StringType\)\)",
        r"a = b\.let\(\[n, \(n \+ 1\)\], ArrayType\(IntegerType\)\)",
        r"s = b\.const\(East\.new_set\(IntegerType, \[4, 3\]\)\)",
        r"row = b\.const\(\{'x': n, 'y': 's'\}, StructType\(\[\(.x., IntegerType\), \(.y., StringType\)\]\)\)",
        r"o = b\.const\(some\(n\), OptionType\(IntegerType\)\)",
        r"nothing = b\.const\(none, OptionType\(IntegerType\)\)",
        r"keyed = b\.let\(East\.new_dict\(IntegerType, StringType, \[\(n, 'k'\)\]\)\)",
        r"empty = b\.let\(\{\}, DictType\(IntegerType, StringType\)\)",
        # the binding's type governs the whole literal: a construction nested inside prints bare
        r"picked = b\.const\(\[some\(n\), none\], ArrayType\(OptionType\(IntegerType\)\)\)",
        r"nested = b\.const\(\{'a': East\.new_set\(IntegerType, \[2, 1\]\), 'b': East\.new_set\(IntegerType, \[n\]\)\}, DictType\(StringType, SetType\(IntegerType\)\)\)",
        r"rows = b\.const\(\[\{'x': n, 'y': 's'\}, \{'x': 0, 'y': ''\}\], ArrayType\(StructType\(\[\(.x., IntegerType\), \(.y., StringType\)\]\)\)\)",
        r"deep = b\.const\(some\(\{'x': n, 'y': 's'\}\), OptionType\(StructType\(\[\(.x., IntegerType\), \(.y., StringType\)\]\)\)\)",
    ]:
        assert re.search(expected, src), f"{expected}\n{src}"
    assert "East.value(" not in src, src  # never inside a bound literal, at any depth
    # the module imports exactly what it uses, from the package root
    assert "noqa" not in src and "east.types.types" not in src, src
    assert re.search(r"^from east import East, some, none, IntegerType, StringType, ArrayType, SetType, DictType, StructType, OptionType$", src, re.M), src
    # a type whose source fits on a line is never hoisted
    assert not re.search(r"^_t\d+ = ", src, re.M), src


Ops = StructType([
    ("add", FunctionType([IntegerType, IntegerType], IntegerType)),
    ("multiply", FunctionType([IntegerType, IntegerType], IntegerType)),
])


@East.function([], IntegerType)
def wide(b):
    mathOps = b.const({"add": East.function([IntegerType, IntegerType], IntegerType, lambda b, a, b_: a + b_),
                       "multiply": East.function([IntegerType, IntegerType], IntegerType, lambda b, a, b_: a * b_)}, Ops)
    return mathOps.add(mathOps.multiply(2, 3), 4)


def test_a_wide_literal_its_type_and_an_argument_list_break_one_entry_per_line():
    """As black lays python out: an argument list that does not fit breaks
    one argument per line, a sole literal argument is hugged
    (``StructType([``), and every line keeps to the width."""
    src = to_python_source(wide)
    expected = "\n".join([
        "@East.function([], IntegerType, cse=False)",
        "def main(b):",
        "    mathOps = b.const(",
        "        {",
        "            'add': East.function(",
        "                [IntegerType, IntegerType],",
        "                IntegerType,",
        "                lambda b, a, b_: (a + b_),",
        "            ),",
        "            'multiply': East.function(",
        "                [IntegerType, IntegerType],",
        "                IntegerType,",
        "                lambda b, a, b_: (a * b_),",
        "            ),",
        "        },",
        "        StructType([",
        "            ('add', FunctionType([IntegerType, IntegerType], IntegerType)),",
        "            ('multiply', FunctionType([IntegerType, IntegerType], IntegerType)),",
        "        ]),",
        "    )",
        "    return mathOps.add(mathOps.multiply(2, 3), 4)",
    ])
    assert expected in src, src
    assert not re.search(r"^_t\d+ = ", src, re.M), src  # no type is hoisted for its width
    assert all(len(ln) <= 100 for ln in src.splitlines() if not ln.startswith("from ")), src
    assert wide() == 10


@East.function([ArrayType(IntegerType), IntegerType], IntegerType)
def chained(b, xs, n):
    total = b.let(0)
    b.for_(xs, lambda b, x, i: b.assign(total, total + x * i))
    return (xs.filter(lambda b, x: x > n).map(lambda b, x: x * 2).reduce(lambda b, acc, x: acc + x, 0)
            + total + (n * n + n * n) - (n - n) + xs.size() * 2 + (n - (n - n)) + (-n))


def test_a_long_chain_breaks_one_call_per_line_and_an_operator_run_before_each_operator():
    """Three or more calls that do not fit print one call per line — in
    parentheses when returned; a run of operands at one precedence level
    is one group breaking before each operator, with the parentheses
    precedence allows dropped (``((a + b) + c)`` is ``a + b + c``; ``n - (n
    - n)`` and ``a + (b + c)`` keep their own)."""
    src = to_python_source(chained)
    expected = "\n".join([
        "    return (",
        "        xs",
        "        .filter(lambda b, x, v_0: (x > n))",
        "        .map(lambda b, x, v_1: (x * 2))",
        "        .reduce(lambda b, acc, x, v_2: (acc + x), 0)",
        "        + total",
        "        + (n * n + n * n)",  # a right operand at the same level keeps its parentheses
        "        - (n - n)",
        "        + xs.size() * 2",
        "        + (n - (n - n))",
        "        + -n",
        "    )",
    ])
    assert expected in src, src
    assert "b.for_(xs, lambda b, x, i, label: b.assign(total, (total + x * i)))" in src, src
    assert all(len(ln) <= 100 for ln in src.splitlines() if not ln.startswith("from ")), src
    assert chained([1, 2, 3], 1) == (2 + 3) * 2 + (0 + 2 + 6) + 2 + 0 + 6 + 1 - 1


def test_the_printed_module_rebuilds_the_same_ir_and_prints_to_itself(tmp_path):
    src = to_python_source(bound)
    path = tmp_path / "bound.py"
    path.write_text(src, encoding="utf-8")
    namespace: dict = {}
    exec(compile(src, str(path), "exec"), namespace)
    assert diff_ir(bound._east_ir, namespace["main"]._east_ir) is None
    assert to_python_source(namespace["main"]) == src
    assert namespace["main"](5) == bound(5)
