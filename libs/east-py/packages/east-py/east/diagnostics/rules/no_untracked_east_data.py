#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-untracked-east-data``: data a body feeds to an East expression must be
bound with ``b.let`` / ``b.const``, not held in a plain python local.

A plain local carries no East type at the binding, and the builder re-inlines
its literal at every use — two uses, two copies in the IR. The block builder
binds it once and gives it a type. The TypeScript rule of the same name, which
reads the contextual type; here the tell is a python literal local reaching an
expression's method.
"""

from __future__ import annotations

import ast

from east.diagnostics.types import Body, Context, body_nodes


def message(name: str) -> str:
    return (f"`{name}` is a plain python local, so it carries no East type and is re-inlined at "
            f"every use — bind it with b.const({name}, Type) (or b.let) and pass the binding")


class NoUntrackedEastData:
    name = "no-untracked-east-data"
    code = 14
    category = "suggestion"
    supersedes: tuple[str, ...] = ()
    description = ("Data reaching an East expression must be bound with b.const / b.let, not held "
                   "in a plain python local.")

    def check(self, body: Body, ctx: Context) -> None:
        untracked = _literal_locals(body)
        if not untracked:
            return
        for node in body_nodes(body):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and body.is_expression(node.func.value)):
                continue
            for arg in [*node.args, *(k.value for k in node.keywords)]:
                if isinstance(arg, ast.Name) and arg.id in untracked:
                    ctx.report(arg, self, message(arg.id))


def _literal_locals(body: Body) -> set[str]:
    """Names the body binds to a bare python list/dict literal — an EMPTY one
    is `prefer-explicit-east-type`'s to talk about, and a name the block
    builder bound is tracked already."""
    names: set[str] = set()
    for node in body_nodes(body):
        if not (isinstance(node, ast.Assign) and len(node.targets) == 1
                and isinstance(node.targets[0], ast.Name)):
            continue
        target = node.targets[0].id
        if target in body.expr_names:
            continue
        value = node.value
        if (isinstance(value, ast.List) and value.elts) or (isinstance(value, ast.Dict) and value.keys):
            names.add(target)
    return names
