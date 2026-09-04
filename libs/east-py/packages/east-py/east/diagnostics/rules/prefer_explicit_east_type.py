#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``prefer-explicit-east-type``: the one-argument ``b.let(x)`` infers the
East type from the python value. Fine when the value determines one; for an
empty list, dict or set it does not, and the inferred element type is a guess
the build will disagree with later. Give the type. The TypeScript rule of the
same name.
"""

from __future__ import annotations

import ast

from east.diagnostics.types import Body, Context, body_nodes

#: the zero-argument constructors that build an empty python container
_EMPTY_CTORS = frozenset({"list", "dict", "set"})


def message(method: str) -> str:
    return (f"b.{method}(...) cannot infer an East type from an empty container — pass it as the "
            f"second argument, e.g. b.{method}([], ArrayType(IntegerType))")


class PreferExplicitEastType:
    name = "prefer-explicit-east-type"
    code = 12
    category = "suggestion"
    supersedes: tuple[str, ...] = ()
    description = ("b.let / b.const over an empty container needs the East type explicitly — "
                   "b.let([], ArrayType(IntegerType)).")

    def check(self, body: Body, ctx: Context) -> None:
        if body.block is None:
            return
        for node in body_nodes(body):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr in ("let", "const")
                    and isinstance(node.func.value, ast.Name) and node.func.value.id == body.block):
                continue
            if len(node.args) != 1 or node.keywords:
                continue
            if _under_determined(node.args[0]):
                ctx.report(node.args[0], self, message(node.func.attr))


def _under_determined(value: ast.AST) -> bool:
    """An empty container: ``[]``, ``{}``, ``list()``, ``dict()``, ``set()``."""
    if isinstance(value, ast.List) and not value.elts:
        return True
    if isinstance(value, ast.Dict) and not value.keys:
        return True
    return (isinstance(value, ast.Call) and isinstance(value.func, ast.Name)
            and value.func.id in _EMPTY_CTORS and not value.args and not value.keywords)
