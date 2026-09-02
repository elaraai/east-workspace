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

import re

from east.runtime._compiler_eastc import diff_ir

from east import East
from east.codegen import to_python_source
from east.types.construct import none, some
from east.types.types import (
    ArrayType,
    DictType,
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
    src = to_python_source(bound)
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


def test_the_printed_module_rebuilds_the_same_ir_and_prints_to_itself(tmp_path):
    src = to_python_source(bound)
    path = tmp_path / "bound.py"
    path.write_text(src, encoding="utf-8")
    namespace: dict = {}
    exec(compile(src, str(path), "exec"), namespace)
    assert diff_ir(bound._east_ir, namespace["main"]._east_ir) is None
    assert to_python_source(namespace["main"]) == src
    assert namespace["main"](5) == bound(5)
