#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#

"""``no-redundant-east-cast``: ``b.let(East.value(x, T), T)`` states the East
type twice, and the two can drift. The block builder's second argument already
governs the binding's type — pass the value straight to it. The TypeScript
rule of the same name (whose other arms, a ``as`` cast and ``new Map<K, V>()``
generics, have no python spelling).
"""

from __future__ import annotations

import ast

from east.diagnostics.scope import is_east_ref
from east.diagnostics.types import Body, Context, body_nodes


def message(method: str) -> str:
    return (f"East.value(...) inside b.{method}(...) states the East type twice — pass the value "
            f"and its type to b.{method} directly")


class NoRedundantEastCast:
    name = "no-redundant-east-cast"
    code = 16
    category = "warning"
    # Disjoint by construction, so nothing to supersede: this rule fires only
    # on `b.let(East.value(...), T)`, where the assignment's value is the
    # `b.let` call rather than the `East.value` one that
    # `prefer-let-const-over-east-value` looks for. The edge that used to be
    # declared here could never fire.
    supersedes: tuple[str, ...] = ()
    description = "No East.value(...) wrapper inside b.let / b.const — the block builder carries the type."

    def check(self, body: Body, ctx: Context) -> None:
        if body.block is None:
            return
        for node in body_nodes(body):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr in ("let", "const")
                    and isinstance(node.func.value, ast.Name) and node.func.value.id == body.block):
                continue
            if not node.args:
                continue
            first = node.args[0]
            if (isinstance(first, ast.Call) and isinstance(first.func, ast.Attribute)
                    and first.func.attr == "value" and is_east_ref(first.func.value, ctx)):
                ctx.report(first, self, message(node.func.attr))
