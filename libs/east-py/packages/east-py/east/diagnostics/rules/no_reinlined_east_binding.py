#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#

"""``no-reinlined-east-binding``: an East expression is a value tree, not a
slot. Held in a plain python local and used twice inside a body, the tree is
copied at each use — evaluated twice, and for a mutable value with a fresh
identity each time. ``b.let`` / ``b.const`` introduce ONE binding, evaluated
once and referred to by name. A single use is a harmless alias; two is the
hazard. The TypeScript rule of the same name.
"""

from __future__ import annotations

import ast

from east.diagnostics.types import Body, Context, body_nodes


def message(name: str, uses: int) -> str:
    return (f"`{name}` holds an East expression in a plain python local and is used {uses} times in "
            "this body, so its tree is re-inlined — and re-evaluated — at every use. Bind it once "
            f"with b.const({name}, Type) (or b.let) and use the binding")


class NoReinlinedEastBinding:
    name = "no-reinlined-east-binding"
    code = 15
    category = "error"
    supersedes: tuple[str, ...] = ()
    description = ("An East expression held in a python local and used more than once in a body is "
                   "re-inlined per use — bind it with b.let / b.const.")

    def check(self, body: Body, ctx: Context) -> None:
        loads = _load_counts(body)
        for node in body_nodes(body):
            if not (isinstance(node, ast.Assign) and len(node.targets) == 1
                    and isinstance(node.targets[0], ast.Name)):
                continue
            value = node.value
            if _is_block_binding(value, body):
                continue  # `x = b.let(...)` — the correct form
            if isinstance(value, ast.Name):
                continue  # a plain alias re-inlines nothing
            if not body.is_expression(value):
                continue
            target = node.targets[0].id
            uses = loads.get(target, 0)
            if uses >= 2:
                ctx.report(node.targets[0], self, message(target, uses))


def _is_block_binding(value: ast.AST, body: Body) -> bool:
    return (body.block is not None and isinstance(value, ast.Call)
            and isinstance(value.func, ast.Attribute) and value.func.attr in ("let", "const")
            and isinstance(value.func.value, ast.Name) and value.func.value.id == body.block)


def _load_counts(body: Body) -> dict[str, int]:
    """How often each name is READ in this body — nested bodies included, since
    a callback reading the local re-inlines it there too."""
    counts: dict[str, int] = {}
    stack: list[ast.AST] = [body.node]
    while stack:
        node = stack.pop()
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
            counts[node.id] = counts.get(node.id, 0) + 1
        stack.extend(ast.iter_child_nodes(node))
    return counts
