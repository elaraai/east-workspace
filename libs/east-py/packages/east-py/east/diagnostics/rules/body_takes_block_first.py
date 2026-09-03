#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``body-takes-block-first``: every body takes the block first (#638).

The build refuses a body with no parameters, a function body whose
parameter count is not the declared count plus the block, and any use of
the block as a value (``lambda x: x.price`` reads ``x.price`` off the
block). The same three messages, at edit time. Handing the block on to a
python helper (``helper(b, x)``) is how bodies compose and is not a use
as a value.
"""

from __future__ import annotations

import ast

from east.diagnostics.scope import STATEMENT_METHODS
from east.diagnostics.types import Body, Context, body_nodes
from east.expression.statements import _BLOCK_FIRST

_DUNDER = {
    ast.Add: "__add__", ast.Sub: "__sub__", ast.Mult: "__mul__", ast.Div: "__truediv__",
    ast.FloorDiv: "__floordiv__", ast.Mod: "__mod__", ast.Pow: "__pow__",
    ast.BitAnd: "__and__", ast.BitOr: "__or__", ast.BitXor: "__xor__",
    ast.Eq: "__eq__", ast.NotEq: "__ne__", ast.Lt: "__lt__", ast.LtE: "__le__",
    ast.Gt: "__gt__", ast.GtE: "__ge__", ast.Not: "__bool__", ast.USub: "__neg__", ast.Invert: "__invert__",
}


class BodyTakesBlockFirst:
    name = "body-takes-block-first"
    code = 1
    category = "error"
    description = ("An East body must take the block first and use it only for statements: "
                   "`lambda b, x: …` / `def f(b, x)`, never `lambda x: …` or `b.price`.")

    def check(self, body: Body, ctx: Context) -> None:
        if body.block is None and not (body.kind == "function" and body.declared_arity is not None):
            ctx.report(body.node, self, f"a body with no parameters cannot receive the block — {_BLOCK_FIRST}")
            return
        if body.kind == "function" and body.declared_arity is not None \
                and len(body.all_params) != body.declared_arity + 1:
            ctx.report(body.node, self,
                       f"East.function body declares {len(body.all_params)} parameter(s) for a "
                       f"{body.declared_arity}-parameter function — {_BLOCK_FIRST}")
            if body.block is None:
                return
        parents = _parents(body)
        for node in body_nodes(body):
            if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) \
                    and node.value.id == body.block and node.attr not in STATEMENT_METHODS:
                ctx.report(node, self,
                           f"the first parameter of a body is the block, which has no attribute "
                           f"{node.attr!r} — {_BLOCK_FIRST}")
            elif isinstance(node, ast.Name) and node.id == body.block:
                parent = parents.get(id(node))
                if isinstance(parent, ast.Attribute) and parent.value is node:
                    continue  # `b.let(...)` — the block used as the block
                if isinstance(parent, ast.Call) and any(a is node for a in parent.args) \
                        and not body.is_expression(parent.func):
                    continue  # `helper(b, x)` — the block handed to a builder helper
                ctx.report(node, self,
                           f"the first parameter of a body is the block, which cannot be used as a "
                           f"value ({_op(parent, node)}) — {_BLOCK_FIRST}")


def _parents(body: Body) -> dict[int, ast.AST]:
    parents: dict[int, ast.AST] = {}
    for node in body_nodes(body):
        for child in ast.iter_child_nodes(node):
            parents[id(child)] = node
    return parents


def _op(parent: ast.AST | None, node: ast.AST) -> str:
    if isinstance(parent, ast.Call) and parent.func is node:
        return "__call__"
    if isinstance(parent, ast.BinOp):
        return _DUNDER.get(type(parent.op), "__op__")
    if isinstance(parent, ast.Compare) and parent.ops:
        return _DUNDER.get(type(parent.ops[0]), "__eq__")
    if isinstance(parent, ast.UnaryOp):
        return _DUNDER.get(type(parent.op), "__op__")
    if isinstance(parent, ast.Subscript):
        return "__getitem__"
    return "as a value"
