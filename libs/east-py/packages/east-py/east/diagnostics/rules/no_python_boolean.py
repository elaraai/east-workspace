#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-python-boolean``: python's ``and`` / ``or`` / ``not`` / ``if`` /
``in`` / ``len()`` / iteration / ``int()`` / ``float()`` over an expression
go through a protocol the proxy refuses (``__bool__``, ``__contains__``,
``__len__``, ``__iter__``, ``__int__``, ``__float__``): they would collapse
the expression to a python value. The build's message, at edit time.
"""

from __future__ import annotations

import ast

from east.diagnostics.types import Body, Context, body_nodes, is_name
from east.expression.errors import _trace_bail


def _bail(op: str) -> str:
    return _trace_bail(op).args[0]


class NoPythonBoolean:
    name = "no-python-boolean"
    code = 4
    category = "error"
    description = ("No python `and` / `or` / `not` / `if` / `in` / `len()` / iteration / `int()` / `float()` "
                   "over an East expression — use `&`, `|`, `~`, East.if_else, and the expression's methods.")

    def check(self, body: Body, ctx: Context) -> None:
        for node in body_nodes(body):
            if isinstance(node, ast.BoolOp) and any(body.is_expression(v) for v in node.values):
                ctx.report(node, self, _bail("if/and/or/not"))
            elif isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not) and body.is_expression(node.operand):
                ctx.report(node, self, _bail("if/and/or/not"))
            elif isinstance(node, (ast.If, ast.While, ast.IfExp, ast.Assert)) and _truthy_expression(node.test, body):
                ctx.report(node.test, self, _bail("if/and/or/not"))
            elif isinstance(node, ast.Compare) and any(isinstance(op, (ast.In, ast.NotIn)) for op in node.ops) \
                    and any(body.is_expression(c) for c in node.comparators):
                ctx.report(node, self, _bail("in"))
            elif isinstance(node, (ast.For, ast.comprehension)) and body.is_expression(node.iter):
                ctx.report(node.iter, self, _bail("iteration"))
            elif isinstance(node, ast.Call) and node.args and body.is_expression(node.args[0]):
                for builtin, op in (("len", "len()"), ("int", "int()"), ("float", "float()")):
                    if is_name(node.func, builtin):
                        ctx.report(node, self, _bail(op))


def _truthy_expression(test: ast.AST, body: Body) -> bool:
    """An `if`/`while` test that IS an expression: a name/chain the body holds
    an expression under, or a comparison on one (which builds a Boolean
    expression the `if` would then collapse)."""
    if body.is_expression(test):
        return True
    if isinstance(test, ast.Compare):
        return body.is_expression(test.left) or any(body.is_expression(c) for c in test.comparators)
    if isinstance(test, ast.BinOp):
        return body.is_expression(test.left) or body.is_expression(test.right)
    return False
