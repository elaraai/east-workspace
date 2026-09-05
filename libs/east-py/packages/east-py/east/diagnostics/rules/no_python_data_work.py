#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-python-data-work``: a python helper doing the DATA work — parsing,
stripping, null-checking, coercing — for a body that calls it.

The ``_f(v)`` shape left behind by a migration: the East function is real, but
the cleaning still happens in python, so it runs at build time over expression
proxies rather than at runtime over the data. What survives into the IR is
whatever the proxy happened to produce. Express it in East, where it runs on
every row.

``no-python-work`` is the sibling for an EAGER callback, where the capture
refuses the helper by name before the body runs; it supersedes this rule where
both see the same helper.
"""

from __future__ import annotations

import ast

from east.diagnostics.types import Body, Context

MESSAGE = ("this helper does the data work — parsing, stripping, null-checking, coercing — in "
           "python for a body that calls it, so it runs once at build time over an expression "
           "proxy rather than over each row. Express it in East")

#: the string/number munging a migrated helper is made of
_DATA_METHODS = frozenset({
    "strip", "lstrip", "rstrip", "split", "rsplit", "replace", "lower", "upper", "title",
    "startswith", "endswith", "removeprefix", "removesuffix", "zfill", "ljust", "rjust",
})
#: the coercions
_DATA_BUILTINS = frozenset({"float", "int", "str", "bool", "round", "abs", "len"})


class NoPythonDataWork:
    name = "no-python-data-work"
    code = 26
    category = "warning"
    supersedes: tuple[str, ...] = ()
    description = ("No python helper doing parse / strip / null-check / coerce work for a body — "
                   "express it in East.")

    def check(self, body: Body, ctx: Context) -> None:
        del body, ctx  # the helper is a module-scope def; the module pass finds it

    def check_module(self, ctx: Context) -> None:
        for node in ctx.tree.body:
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if node.name in ctx.east_artifacts or node.decorator_list:
                continue
            params = {a.arg for a in [*node.args.posonlyargs, *node.args.args]}
            if not params:
                continue
            if _does_data_work(node, params) and _called_from_a_function_body(node.name, ctx):
                ctx.report(node, self, MESSAGE)


def _does_data_work(fn: ast.FunctionDef | ast.AsyncFunctionDef, params: set[str]) -> bool:
    """Whether ``fn`` munges one of its own parameters."""
    for node in ast.walk(fn):
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Attribute) and func.attr in _DATA_METHODS \
                    and _mentions(func.value, params):
                return True
            if isinstance(func, ast.Name) and func.id in _DATA_BUILTINS \
                    and any(_mentions(a, params) for a in node.args):
                return True
        elif isinstance(node, ast.Compare) and _mentions(node.left, params) \
                and any(isinstance(c, ast.Constant) and c.value is None for c in node.comparators):
            return True
    return False


def _mentions(node: ast.AST, params: set[str]) -> bool:
    return any(isinstance(n, ast.Name) and n.id in params for n in ast.walk(node))


def _called_from_a_function_body(name: str, ctx: Context) -> bool:
    """Called from a NON-eager body. An eager callback's helper is refused by
    the capture itself and belongs to ``no-python-work``."""

    def calls(body: Body) -> bool:
        if body.kind != "eager" and any(
                isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == name
                for n in ast.walk(body.node)):
            return True
        return any(calls(child) for child in body.children)

    return any(body.kind != "eager" and calls(body) for body in ctx.bodies)
