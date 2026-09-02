#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Authoring names in the IR (#639): a body's parameter names and the
``b.let`` / ``b.const`` binding names reach the IR's variables, unique per
build, and come back out of ``to_python_source`` — the python twin of
``libs/east/src/naming.spec.ts``."""

from __future__ import annotations

import json
import math
import re
from typing import Any

from east import East
from east.codegen import to_python_source
from east.expression.naming import authored_name, hint_at, parameter_names, reset_names
from east.serialization.json import encode_json_for
from east.types.type_of_type import IRType
from east.types.types import ArrayType, FloatType, IntegerType, StringType, VariantType

Shape = VariantType([("circle", FloatType), ("square", FloatType)])


def variable_names(fn) -> list[str]:
    """Every distinct ``Variable`` name in the IR, in first-seen order."""
    encoded = encode_json_for(IRType)(fn._east_ir)
    names: list[str] = []

    def walk(node) -> None:
        if isinstance(node, list):
            for child in node:
                walk(child)
        elif isinstance(node, dict):
            if node.get("type") == "Variable" and isinstance(node.get("value"), dict):
                name = node["value"].get("name")
                if isinstance(name, str) and name not in names:
                    names.append(name)
            for child in node.values():
                walk(child)

    walk(json.loads(encoded.decode("utf-8") if isinstance(encoded, bytes) else encoded))
    return names


@East.function([ArrayType(IntegerType), Shape], StringType)
def demo(b, items, shape):
    total = b.let(0)

    def step(b, item, index):
        b.assign(total, total + item * index)

    b.for_(items, step)
    area = b.const(shape.match({
        "circle": lambda b, radius: radius * radius,
        "square": lambda b, side: side * side,
    }))
    doubled = b.const(items.map(lambda b, x: x * 2).reduce(lambda b, acc, x: acc + x, 0))
    b.try_(lambda b: b.assign(total, items.get(99))).catch(lambda b, message, stack: b.assign(total, stack.size()))
    return (East.String.print(IntegerType, total) + " " + East.String.print(FloatType, area)
            + " " + East.String.print(IntegerType, doubled))


class TestParameterNames:
    def test_reads_lambdas_defs_defaults_and_stops_at_varargs(self):
        assert parameter_names(lambda b, items, threshold: 0) == ["b", "items", "threshold"]

        def body(b, a=1):
            return a

        assert parameter_names(body) == ["b", "a"]
        assert parameter_names(lambda b, *rest: 0) == ["b"]
        assert parameter_names(lambda **kw: 0) == []
        assert hint_at(["b", "x"], 1) == "x"
        assert hint_at(["b"], 1) is None
        assert hint_at(None, 0) is None

    def test_gives_up_on_what_has_no_signature(self):
        assert parameter_names(3) is None
        assert parameter_names(None) is None


class TestAuthoredName:
    def test_unique_per_build_and_the_fallbacks(self):
        reset_names()
        fresh = iter(["__n1", "__n2", "__n3", "__n4"])

        def fallback() -> str:
            return next(fresh)

        assert authored_name("x", fallback) == "x"
        assert authored_name("x", fallback) == "x_2"
        assert authored_name("x", fallback) == "x_3"
        assert authored_name(None, fallback) == "__n1"
        assert authored_name("__n9", fallback) == "__n2"  # the builder's own spelling is not a hint
        assert authored_name("class", fallback) == "__n3"
        assert authored_name("not an id", fallback) == "__n4"
        reset_names()
        assert authored_name("x", fallback) == "x"


class TestIRCarriesTheAuthoringNames:
    names = variable_names(demo)

    def test_parameters_bindings_loops_callbacks_arms_and_catch(self):
        for expected in ["items", "shape", "total", "item", "index", "area", "radius", "side",
                         "doubled", "x", "acc", "message", "stack"]:
            assert expected in self.names, f"{expected} in {self.names}"

    def test_sibling_bodies_reuse_a_name_and_unnamed_slots_stay_fresh(self):
        assert "x_2" not in self.names, self.names  # the map's and the reduce's x are siblings
        assert any(re.fullmatch(r"__n\d+", n) for n in self.names), self.names  # the map's unnamed index slot
        assert "b" not in self.names

    def test_the_names_come_back_out_of_the_printer(self):
        source = to_python_source(demo, width=math.inf)  # the names, whatever the layout
        assert "total = b.let(0)" in source
        assert "lambda b, item, index, " in source
        assert "'circle': lambda b, radius: (radius * radius)" in source
        assert "reduce(lambda b, acc, x, " in source
        assert ".catch(lambda b, message, stack: " in source

    def test_names_start_afresh_for_every_build(self):
        @East.function([IntegerType], IntegerType)
        def again(b, x):
            return b.const(x + 1)

        assert [n for n in variable_names(again) if n == "x"] == ["x"]
        assert variable_names(demo) == self.names


@East.function([IntegerType], IntegerType)
def shapes(b, x):
    outer = b.let(b.const(x) + 1)          # the inner const initializes nothing
    chained = b.const(b.let(x) + 1)        # nor does a let with more chained onto it
    first, second = b.let(x), b.let(x + 1)  # a tuple of bindings
    typed: Any = b.let(2)                  # an annotated binding
    return outer + chained + first + second + typed


def test_only_the_call_that_initializes_a_variable_names_it():
    names = variable_names(shapes)
    for expected in ["x", "outer", "chained", "first", "second", "typed"]:
        assert expected in names, f"{expected} in {names}"
    assert sum(1 for n in names if re.fullmatch(r"__n\d+", n)) == 2, names  # the two unnamed inner bindings
    assert shapes(3) == 3 + 1 + 3 + 1 + 3 + 4 + 2


@East.function([ArrayType(IntegerType), IntegerType], IntegerType)
def shadowing(b, xs, x):
    outer = x                                            # an alias to the parameter
    inner = b.const(xs.map(lambda b, x: x + outer).sum())  # the callback shadows `x`
    return inner + xs.map(lambda b, x: x).size()          # a sibling reuses `x`


def test_a_name_still_in_scope_takes_a_suffix_so_an_alias_keeps_its_meaning():
    names = variable_names(shadowing)
    assert [n for n in names if re.fullmatch(r"x(_\d+)?", n)] == ["x", "x_2"], names
    assert shadowing([1, 2], 10) == 25


def test_printed_python_is_a_fixed_point(tmp_path):
    """Build the printed module FROM A FILE (the binding names are read from
    the source line) and print it again: the same text."""
    first = to_python_source(demo)
    path = tmp_path / "demo.py"
    path.write_text(first, encoding="utf-8")
    namespace: dict = {}
    exec(compile(first, str(path), "exec"), namespace)
    assert to_python_source(namespace["main"]) == first
