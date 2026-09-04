#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``@East.platform_function`` is dual-mode (#667): the decorated python
runs on values and, called inside an East body, emits the ``Platform`` node
with its own declared signature — so a body calls the implementation
directly and nothing restates the decorator's signature. The same for an
async implementation inside ``East.asyncFunction``, a generic factory called
with a type argument, and a memoized function."""

from __future__ import annotations

import asyncio

import pytest
from east.runtime._compiler_eastc import _eastc_call

from east import (
    ArrayType,
    DictType,
    East,
    IntegerType,
    StringType,
    memoize,
)
from east.expression.errors import ExpressionError


@East.platform_function(inputs=[IntegerType], output=IntegerType)
def half(x):
    return x // 2


@East.platform_function(inputs=[IntegerType], output=IntegerType)
async def slow_double(x):
    return x * 2


@East.generic_platform_function(type_parameters=["T"], inputs=["T"], output="T", name="test.ident")
def ident(_platform, T):  # noqa: N803 — the type argument, as the factory convention names it
    return lambda v: v


@East.generic_platform_function(type_parameters=["T"], name="test.undeclared")
def undeclared(_platform, T):  # noqa: N803
    return lambda v: v


@memoize
@East.platform_function(inputs=[IntegerType], output=IntegerType)
def bump(x):
    return x + 1


@East.generic_platform_function(type_parameters=["T"], inputs=[ArrayType("T")], output=IntegerType,
                                name="test.count", type_erased=True)
def count_rows(rows):
    return len(rows)


def test_a_body_calls_the_implementation_directly_and_python_calls_run_it():
    twice_half = East.function([IntegerType], IntegerType, lambda b, x: half(x) * 2)
    assert [d["name"] for d in East.platform_dependencies(twice_half)] == ["half"]
    assert East.compile(twice_half, platform=[half.east_platform_function])(11) == 10
    assert half(11) == 5  # the python, validated as before
    assert half.east_platform_declaration.name == "half"


def test_the_body_call_is_the_platform_node_a_declaration_would_emit():
    declared = East.platform("half", [IntegerType], IntegerType)
    via_impl = East.function([IntegerType], IntegerType, lambda b, x: half(x))
    via_decl = East.function([IntegerType], IntegerType, lambda b, x: declared(x))
    from east.runtime._compiler_eastc import diff_ir

    assert diff_ir(via_impl._east_ir, via_decl._east_ir) is None


def test_a_wrong_typed_argument_fails_at_build_time_naming_the_function():
    with pytest.raises(ExpressionError, match="'half' argument 0 has East type String"):
        East.function([StringType], IntegerType, lambda b, s: half(s))


def test_an_async_implementation_inside_an_async_body_and_refused_in_a_sync_one():
    af = East.asyncFunction([IntegerType], IntegerType, lambda b, x: slow_double(x) + 1)
    deps = list(East.platform_dependencies(af))
    assert deps[0]["name"] == "slow_double" and deps[0]["async"] is True
    compiled = East.compileAsync(af, platform=[slow_double.east_platform_function])
    handle = compiled._eastc_handle
    # An async implementation runs under the bridge's own loop (the corpus
    # drives these through _eastc_call; an outer asyncio.run would nest it).
    assert _eastc_call(handle._compiled, handle._input_types, handle._output_type, (3,)) == 7
    assert asyncio.run(slow_double(2)) == 4  # the python coroutine, as before
    with pytest.raises(ExpressionError, match="East.asyncFunction"):
        East.function([IntegerType], IntegerType, lambda b, x: slow_double(x))


def test_a_generic_factory_called_with_a_type_argument_emits_the_generic_node():
    both = East.function([IntegerType], IntegerType,
                         lambda b, x: ident(IntegerType, x) + ident([IntegerType], x))
    dep = East.platform_dependencies(both)[0]
    assert dep["name"] == "test.ident" and list(dep["type_parameters"]) == [IntegerType]
    assert East.compile(both, platform=[ident.east_platform_function])(20) == 40
    assert ident(None, IntegerType)(5) == 5  # the factory, from python
    with pytest.raises(ExpressionError, match="test.undeclared.*inputs= and output="):
        East.function([IntegerType], IntegerType, lambda b, x: undeclared(IntegerType, x))


def test_a_type_erased_generic_is_the_implementation_and_the_body_call():
    """The implementation ignores the type argument (it reads the values), so
    it IS the decorated function: python calls it directly, a body calls it
    with the type argument first."""
    assert count_rows([1, 2, 3]) == 3  # the python, unchanged by the decoration
    f = East.function([ArrayType(IntegerType)], IntegerType, lambda b, xs: count_rows(IntegerType, xs))
    dep = East.platform_dependencies(f)[0]
    assert dep["name"] == "test.count" and list(dep["type_parameters"]) == [IntegerType]
    # the runtime binds a factory, and gets the same implementation for any T
    record = count_rows.east_platform_function
    assert record["fn"](None, IntegerType)([1, 2]) == 2
    assert East.compile(f, platform=[record])([4, 5, 6]) == 3


def test_a_package_may_export_a_declaration_where_it_has_no_python_to_run():
    """``simulation_run`` is the C event loop: the package exports the
    declaration, which a body calls exactly as it calls an implementation."""
    from east_py_datascience import simulation_run

    assert simulation_run.east_platform_declaration is simulation_run
    with pytest.raises(ExpressionError, match="expression-level"):
        simulation_run(IntegerType, IntegerType, 1)


def test_a_generic_declaration_takes_its_type_arguments_spread_or_as_a_list():
    """The two spellings are one node: a package exporting a declaration and
    one exporting an implementation are called the same way."""
    from east.runtime._compiler_eastc import diff_ir

    declared = East.genericPlatform("test.ident", ["T"], ["T"], "T")
    spread = East.function([IntegerType], IntegerType, lambda b, x: declared(IntegerType, x))
    listed = East.function([IntegerType], IntegerType, lambda b, x: declared([IntegerType], x))
    assert diff_ir(spread._east_ir, listed._east_ir) is None
    with pytest.raises(ExpressionError, match="type arguments first"):
        East.function([IntegerType], IntegerType, lambda b, x: declared(IntegerType))


def test_a_memoized_implementation_keeps_the_dual_mode():
    f = East.function([IntegerType], IntegerType, lambda b, x: bump(x))
    assert East.compile(f, platform=[bump.east_platform_function])(1) == 2
    assert bump(1) == 2


def test_a_std_implementation_is_callable_from_a_body_with_no_declaration(tmp_path):
    from east_py_std import fs_open_beast, fs_read_file_bytes, platform

    size = East.function([StringType], IntegerType, lambda b, p: fs_read_file_bytes(p).size())
    deps = East.platform_dependencies(size, {"fs_read_file_bytes": "east-py-std"})
    assert deps[0]["name"] == "fs_read_file_bytes" and deps[0]["provider"].value == "east-py-std"
    readable = tmp_path / "bytes.txt"
    readable.write_text("east", encoding="utf-8")
    assert East.compile(size, platform=platform)(str(readable)) == 4
    manifest = East.export_functions("t", "1.0.0", {"size": size}, providers={"fs_read_file_bytes": "east-py-std"})
    assert manifest["functions"][0]["platforms"][0]["provider"].value == "east-py-std"
    # the generic std factory reads as FileSystem.openBeast does in TypeScript
    Table = DictType(IntegerType, StringType)
    first = East.function([StringType], IntegerType,
                          lambda b, p: fs_open_beast(Table, p).size())
    dep = East.platform_dependencies(first)[0]
    assert dep["name"] == "fs_open_beast" and list(dep["type_parameters"]) == [Table]
    assert list(dep["inputs"]) == [StringType] and dep["output"] == Table


def test_a_declared_asyncness_may_differ_from_the_def_but_never_understate_it():
    """``test`` and ``describe`` are async on every runtime while their python
    is a plain ``def`` — ``is_async=True`` declares that. The other way round
    would leave a coroutine unawaited, so it is refused."""
    from east_py_std import describe

    assert describe.east_platform_function["type"] == "async"
    assert describe.east_platform_declaration.is_async
    with pytest.raises(ExpressionError, match="East.asyncFunction"):
        East.function([StringType], IntegerType, lambda b, s: describe(s, s))
    with pytest.raises(TypeError, match="is declared async"):
        @East.platform_function(inputs=[IntegerType], output=IntegerType, is_async=False)
        async def understated(x):
            return x


@pytest.mark.parametrize("package", ["east_py_std", "east_py_io", "east_py_datascience"])
def test_every_stock_platform_function_is_callable_from_a_body(package):
    """#667's compliance line: a body may call any stock function with no
    declaration of its own — which means the package exports, under some
    public name, the dual-mode implementation or (where the implementation is
    in C) the declaration. The printer's provider map is that same lookup."""
    import importlib

    from east.codegen.providers import Providers

    module = importlib.import_module(package)
    providers = Providers()
    providers.add_module(package)
    missing = sorted({r["name"] for r in module.platform} - set(providers.functions))
    assert not missing, f"{package} does not export: {missing}"
