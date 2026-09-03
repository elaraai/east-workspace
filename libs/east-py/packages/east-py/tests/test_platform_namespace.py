#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""The platform implementation decorators on the ``East`` namespace (#649)
and the naming rule they pin (#651): an implementation is paired with its
declaration by name — the def's, or ``name=`` — and an ``East.function``
has no name of its own."""

from __future__ import annotations

import pytest

from east import East, IntegerType, generic_platform_function, platform_function, platform_functions
from east.ir.analyze import IRAnalysisError


def test_the_platform_decorators_are_the_same_objects_on_the_namespace():
    assert East.platform_function is platform_function
    assert East.generic_platform_function is generic_platform_function
    assert East.platform_functions is platform_functions


def test_an_implementation_is_paired_with_its_declaration_by_the_defs_name():
    @East.platform_function(inputs=[IntegerType], output=IntegerType)
    def half(x):
        return x // 2

    assert half.east_platform_function["name"] == "half"
    declared = East.platform("half", [IntegerType], IntegerType)
    twice_half = East.function([IntegerType], IntegerType, lambda b, x: declared(x) * 2)
    assert East.compile(twice_half, platform=[half.east_platform_function])(11) == 10


def test_name_overrides_the_def_and_a_mismatch_is_the_compiles_error():
    @East.platform_function(inputs=[IntegerType], output=IntegerType, name="maths.half")
    def half(x):
        return x // 2

    assert half.east_platform_function["name"] == "maths.half"
    declared = East.platform("half", [IntegerType], IntegerType)   # not the implementation's name
    f = East.function([IntegerType], IntegerType, lambda b, x: declared(x))
    with pytest.raises(IRAnalysisError, match=r"Platform function 'half' not found"):
        East.compile(f, platform=[half.east_platform_function])
    paired = East.platform("maths.half", [IntegerType], IntegerType)
    g = East.function([IntegerType], IntegerType, lambda b, x: paired(x))
    assert East.compile(g, platform=[half.east_platform_function])(9) == 4


def test_platform_functions_collects_a_modules_implementations_and_an_east_function_is_anonymous():
    @East.platform_function(inputs=[IntegerType], output=IntegerType)
    def bump(x):
        return x + 1

    collected = East.platform_functions(__name__)
    assert bump.east_platform_function in collected
    # an East.function is a value: its IR carries its parameters' names, never its own
    score = East.function([IntegerType], IntegerType, lambda b, x: x * 3)
    ir = score._east_ir
    assert ir.type == "Function" and "name" not in ir.value
    assert [p.value["name"] for p in ir.value["parameters"]] == ["x"]
