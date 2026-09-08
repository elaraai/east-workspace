#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``prefer-explicit-east-type``: the one-argument ``b.let(x)`` / ``b.const(x)``
infers the East type from the python value, and a bare python list, tuple or
set has none to infer — the build refuses to lift it, empty or not.
``b.let([], ArrayType(IntegerType))`` gives the type;
``East.new_array(IntegerType, [...])`` builds the value. The TypeScript rule of
the same name, where an empty ``[]`` is merely under-determined; here the lift
is refused outright, so the message is the build's.
"""

from __future__ import annotations

import ast

from east.diagnostics.types import Body, Context, body_nodes

#: the zero-argument constructors that build a python container the build cannot lift
_CONTAINER_CTORS = {"list": "list", "set": "set", "tuple": "tuple"}


def message(method: str, kind: str) -> str:
    return (f"cannot lift python value of type {kind} into an East expression — pass the East type "
            f"as b.{method}'s second argument, e.g. b.{method}([], ArrayType(IntegerType)), or build "
            "the value with East.new_array / East.new_set")


class PreferExplicitEastType:
    name = "prefer-explicit-east-type"
    code = 12
    category = "error"
    description = ("b.let / b.const over a bare python list, set or tuple cannot lift it — "
                   "pass the East type: b.let([], ArrayType(IntegerType)).")

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
            kind = _unliftable(node.args[0])
            if kind is not None:
                ctx.report(node.args[0], self, message(node.func.attr, kind))


def _unliftable(value: ast.AST) -> str | None:
    """The python container kind the build refuses to lift, or None."""
    if isinstance(value, (ast.List, ast.ListComp)):
        return "list"
    if isinstance(value, ast.Tuple):
        return "tuple"
    if isinstance(value, (ast.Set, ast.SetComp)):
        return "set"
    if isinstance(value, ast.GeneratorExp):
        return "generator"
    if (isinstance(value, ast.Call) and isinstance(value.func, ast.Name)
            and value.func.id in _CONTAINER_CTORS and not value.args and not value.keywords):
        return _CONTAINER_CTORS[value.func.id]
    return None
