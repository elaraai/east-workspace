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
from east.types.types import BlobType, IntegerType, NullType, StringType

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
