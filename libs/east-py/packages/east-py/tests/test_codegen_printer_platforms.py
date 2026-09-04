#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""A platform call prints under the platform function's own name — the
hoisted declaration is ``tar_create = East.asyncPlatform('tar_create', …)``
and the call ``tar_create(entries)``, never an anonymous ``_p0`` — with a
``_2`` suffix for a second signature under one name, and a body variable
of that name renamed so it never shadows the declaration. The TypeScript
twin is pinned in ``libs/east/src/codegen/codegen.spec.ts`` ("a hoisted
declaration is named after the platform function")."""

from __future__ import annotations

import math
import re

from east.runtime._compiler_eastc import diff_ir

from east import East
from east.codegen import to_python_source
from east.types.construct import variant
from east.types.types import (
    BlobType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
)

log = East.platform("my.log", [StringType], NullType)
log_count = East.platform("my.log", [IntegerType], NullType)     # the same name, another signature
tar_create = East.asyncPlatform("tar_create", [StringType], BlobType)


@East.function([StringType], IntegerType)
def logged(b, s):
    my_log = b.const(1)                 # the platform's identifier: the variable is renamed, not the declaration
    b.do(log(s))
    b.do(log_count(my_log))
    return my_log


@East.asyncFunction([StringType], IntegerType)
def archived(b, s):
    blob = b.const(tar_create(s))
    return blob.size()


def test_a_hoisted_declaration_is_named_after_the_platform_function(tmp_path):
    src = to_python_source(logged, width=math.inf)
    assert re.search(r"^my_log = East\.platform\('my\.log', \[StringType\], NullType\)$", src, re.M), src
    assert re.search(r"^my_log_2 = East\.platform\('my\.log', \[IntegerType\], NullType\)$", src, re.M), src
    assert "_p0" not in src, src
    # the body's `my_log` would shadow the declaration: it prints as v_N, and the calls keep their targets
    assert re.search(r"v_0 = b\.const\(1\)", src), src
    assert "b.do(my_log(s))" in src and "b.do(my_log_2(v_0))" in src, src
    path = tmp_path / "logged.py"
    path.write_text(src, encoding="utf-8")
    namespace: dict = {}
    exec(compile(src, str(path), "exec"), namespace)
    assert diff_ir(logged._east_ir, namespace["main"]._east_ir) is None
    assert to_python_source(namespace["main"], width=math.inf) == src


def test_an_async_declaration_keeps_its_name_and_the_module_rebuilds(tmp_path):
    src = to_python_source(archived, width=math.inf)
    assert re.search(r"^tar_create = East\.asyncPlatform\('tar_create', \[StringType\], BlobType\)$", src, re.M), src
    assert "blob = b.const(tar_create(s))" in src, src
    path = tmp_path / "archived.py"
    path.write_text(src, encoding="utf-8")
    namespace: dict = {}
    exec(compile(src, str(path), "exec"), namespace)
    assert diff_ir(archived._east_ir, namespace["main"]._east_ir) is None


Narrow = StructType([("level", VariantType([("some", IntegerType)]))])
gz = East.asyncPlatform("gz", [StructType([("level", OptionType(IntegerType))])], IntegerType)


@East.asyncFunction([], IntegerType)
def widened(b):
    options = b.let({"level": variant("some", 6, VariantType([("some", IntegerType)]))}, Narrow)
    return gz(options)        # the declaration widens the narrow struct to the Option itself


def test_the_widening_a_declaration_inserts_at_its_argument_prints_as_the_expression(tmp_path):
    src = to_python_source(widened, width=math.inf)
    assert "return gz(options)" in src, src
    assert "East.as_(options" not in src, src
    path = tmp_path / "widened.py"
    path.write_text(src, encoding="utf-8")
    namespace: dict = {}
    exec(compile(src, str(path), "exec"), namespace)
    assert diff_ir(widened._east_ir, namespace["main"]._east_ir) is None
    assert to_python_source(namespace["main"], width=math.inf) == src


# ── providers (#667): the implementing package's own names ──────────────────


def test_a_provided_platform_call_prints_as_the_implementation_and_rebuilds(tmp_path):
    from east_py_std import fs_read_file_bytes

    from east.codegen import providers_for

    size = East.function([StringType], IntegerType, lambda b, p: fs_read_file_bytes(p).size())
    src = to_python_source(size, providers=providers_for(["east_py_std"]), width=math.inf)
    assert "from east_py_std import fs_read_file_bytes" in src, src
    assert "East.platform(" not in src, src
    assert "return fs_read_file_bytes(p).size()" in src, src
    path = tmp_path / "size.py"
    path.write_text(src, encoding="utf-8")
    namespace: dict = {}
    exec(compile(src, str(path), "exec"), namespace)
    assert diff_ir(size._east_ir, namespace["main"]._east_ir) is None
    # without providers the same IR still prints as a declaration
    assert "fs_read_file_bytes = East.platform('fs_read_file_bytes'" in to_python_source(size, width=math.inf)


def test_a_named_type_and_an_implementation_of_another_package_print_by_name(tmp_path):
    from east_py_io import GzipOptionsType, gzip_compress

    from east import BooleanType, some
    from east.codegen import providers_for
    from east.types.construct import (
        variant as _variant,  # noqa: F401 — keep the import surface honest
    )

    @East.asyncFunction([], BooleanType)
    def gz(b):
        data = b.let(East.String.encode_utf8(East.String.repeat(East.value("Hello, World! ", StringType), 100)))
        options = b.let({"level": some(6)}, GzipOptionsType)
        compressed = b.let(gzip_compress(data, options))
        return compressed.size() < data.size()

    src = to_python_source(gz, providers=providers_for(["east_py_std", "east_py_io"]), width=math.inf)
    assert "from east_py_io import GzipOptionsType, gzip_compress" in src, src
    assert "GzipOptionsType)" in src and "gzip_compress(" in src, src
    assert "asyncPlatform" not in src and "StructType([('level'" not in src, src
    path = tmp_path / "gz.py"
    path.write_text(src, encoding="utf-8")
    namespace: dict = {}
    exec(compile(src, str(path), "exec"), namespace)
    assert diff_ir(gz._east_ir, namespace["main"]._east_ir) is None


def test_a_provider_whose_signature_differs_keeps_the_hoisted_declaration():
    from east_py_std import fs_read_file_bytes  # noqa: F401 — the provider under another signature

    from east.codegen import providers_for

    other = East.platform("fs_read_file_bytes", [StringType], IntegerType)   # not the std signature
    f = East.function([StringType], IntegerType, lambda b, p: other(p))
    src = to_python_source(f, providers=providers_for(["east_py_std"]), width=math.inf)
    assert "fs_read_file_bytes = East.platform('fs_read_file_bytes', [StringType], IntegerType)" in src, src
    assert "from east_py_std" not in src, src


def test_a_generic_provider_prints_the_type_argument_first(tmp_path):
    from east_py_std import fs_open_beast

    from east.codegen import providers_for
    from east.types.types import DictType

    Table = DictType(IntegerType, StringType)
    first = East.function([StringType], IntegerType, lambda b, p: fs_open_beast(Table, p).size())
    src = to_python_source(first, providers=providers_for(["east_py_std"]), width=math.inf)
    assert "from east_py_std import fs_open_beast" in src, src
    assert "fs_open_beast(DictType(IntegerType, StringType), p).size()" in src, src
    assert "genericPlatform" not in src, src
    path = tmp_path / "first.py"
    path.write_text(src, encoding="utf-8")
    namespace: dict = {}
    exec(compile(src, str(path), "exec"), namespace)
    assert diff_ir(first._east_ir, namespace["main"]._east_ir) is None


def test_a_package_declaration_and_a_type_erased_generic_print_as_the_package_spells_them(tmp_path):
    """A provider need not be a python implementation: a function implemented
    in C exports its declaration (``optimization_iterative``,
    ``simulation_run``), and a generic whose implementation ignores the type
    argument exports the implementation itself (``causal_experiment``)."""
    from east_py_datascience import causal_experiment
    from east_py_datascience.causal import CausalExperimentConfigType, CausalExperimentResultType

    from east.codegen import providers_for
    from east.types.types import ArrayType, FloatType, StructType

    Row = StructType([("treated", FloatType), ("outcome", FloatType)])
    verdict = East.function(
        [ArrayType(Row), CausalExperimentConfigType], CausalExperimentResultType,
        lambda b, rows, config: causal_experiment(Row, rows, config))
    src = to_python_source(verdict, providers=providers_for(["east_py_datascience"]), width=math.inf)
    assert "from east_py_datascience import" in src and "causal_experiment(" in src, src
    assert "genericPlatform" not in src, src
    path = tmp_path / "verdict.py"
    path.write_text(src, encoding="utf-8")
    namespace: dict = {}
    exec(compile(src, str(path), "exec"), namespace)
    assert diff_ir(verdict._east_ir, namespace["main"]._east_ir) is None
