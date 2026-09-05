#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-let-const-in-expression``: ``b.let`` / ``b.const`` declare a binding
in the block and hand back its handle. The only readable position for that is
a statement of its own. Buried in an expression — a call argument, a struct
field's value, an element, the target of a chain — it hides a declaration
inside something that reads as a value, and it type-checks fine. The
TypeScript rule of the same name.
"""

from __future__ import annotations

import ast

from east.diagnostics.types import Body, Context, body_nodes


def message(method: str) -> str:
    return (f"b.{method}(...) declares a binding — give it its own statement "
            f"(`x = b.{method}(value, Type)`) and use `x`, rather than burying the "
            "declaration inside an expression")


class NoLetConstInExpression:
    name = "no-let-const-in-expression"
    code = 13
    category = "warning"
    supersedes: tuple[str, ...] = ()
    description = "b.let / b.const belongs on its own statement, never buried inside an expression."

    def check(self, body: Body, ctx: Context) -> None:
        if body.block is None:
            return
        parents = _parents(body)
        for node in body_nodes(body):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr in ("let", "const")
                    and isinstance(node.func.value, ast.Name) and node.func.value.id == body.block):
                continue
            parent = parents.get(id(node))
            if parent is None or _is_binding_position(parent, node):
                continue
            ctx.report(node, self, message(node.func.attr))


def _is_binding_position(parent: ast.AST, node: ast.AST) -> bool:
    """The positions where a declaration reads as a declaration: the value of
    an assignment, a bare statement, a ``return``, or a lambda's whole body."""
    if isinstance(parent, (ast.Assign, ast.AnnAssign, ast.AugAssign)) and parent.value is node:
        return True
    if isinstance(parent, ast.Expr) and parent.value is node:
        return True
    if isinstance(parent, ast.Return) and parent.value is node:
        return True
    return isinstance(parent, ast.Lambda) and parent.body is node


def _parents(body: Body) -> dict[int, ast.AST]:
    parents: dict[int, ast.AST] = {}
    for node in body_nodes(body):
        for child in ast.iter_child_nodes(node):
            parents[id(child)] = node
    return parents
