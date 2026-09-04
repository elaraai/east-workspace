#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-compile-time-data-injection``: reading data while the module is
IMPORTED bakes that data into the program. The file read at build time is the
file as it was on the build machine; the environment variable read at build
time is the builder's, not the deployment's. Both belong at runtime — an e3
input, a dataset, or a platform function, which is precisely what a platform
function is for, so a read inside a ``def`` is never flagged.

The TypeScript rule of the same name, whose fs/`process.env` set becomes
python's ``open`` / ``Path.read_text`` / ``json.load`` / ``os.environ`` and
the dataframe readers.
"""

from __future__ import annotations

import ast

from east.diagnostics.types import Body, Context

MESSAGE = ("reading data at module import bakes the build machine's copy into the program — load "
           "it at runtime instead (an e3 input, a dataset, or a platform function)")
ENV_MESSAGE = ("reading the environment at module import captures the BUILDER's environment, not "
               'the deployment\'s — read it at runtime with East.Env.get("YOUR_VAR")')

#: read calls whose receiver is a path-like or a module we can name
_READ_CALLS = frozenset({
    "read_text", "read_bytes", "open", "load", "loads_file",
    "read_csv", "read_parquet", "read_json", "read_excel", "read_table",
})
#: the bare builtins that read
_READ_BUILTINS = frozenset({"open"})
#: ``os.environ`` / ``os.getenv`` / ``environ.get``
_ENV_ATTRS = frozenset({"getenv", "environ"})


class NoCompileTimeDataInjection:
    name = "no-compile-time-data-injection"
    code = 22
    category = "warning"
    supersedes: tuple[str, ...] = ()
    description = ("No file or environment read at module import in East source — load data at "
                   "runtime.")

    def check(self, body: Body, ctx: Context) -> None:
        # Inside a callable the read happens at runtime, which is correct.
        del body, ctx

    def check_module(self, ctx: Context) -> None:
        stack: list[ast.AST] = list(ctx.tree.body)
        while stack:
            node = stack.pop()
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                continue
            if _is_env_read(node):
                ctx.report(node, self, ENV_MESSAGE)
            elif isinstance(node, ast.Call) and _is_data_read(node):
                ctx.report(node, self, MESSAGE)
            stack.extend(ast.iter_child_nodes(node))


def _is_data_read(node: ast.Call) -> bool:
    func = node.func
    if isinstance(func, ast.Name):
        return func.id in _READ_BUILTINS
    return isinstance(func, ast.Attribute) and func.attr in _READ_CALLS


def _is_env_read(node: ast.AST) -> bool:
    """``os.getenv(...)``, ``os.environ[...]`` or ``os.environ.get(...)``."""
    if isinstance(node, ast.Subscript):
        return _names_environ(node.value)
    if isinstance(node, ast.Call):
        func = node.func
        if isinstance(func, ast.Attribute) and func.attr == "getenv":
            return isinstance(func.value, ast.Name) and func.value.id == "os"
        if isinstance(func, ast.Attribute) and func.attr == "get":
            return _names_environ(func.value)
    return False


def _names_environ(node: ast.AST) -> bool:
    if isinstance(node, ast.Attribute):
        return node.attr == "environ"
    return isinstance(node, ast.Name) and node.id == "environ"
