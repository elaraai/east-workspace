#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-python-boolean``: python's ``and`` / ``or`` / ``not`` / ``if`` /
``in`` / ``len()`` / iteration / ``int()`` / ``float()`` / ``bool()`` — and
the builtins that iterate (``sum``, ``sorted``, ``list``, ``any``…) or
compare (``max``, ``min``) — over an expression go through a protocol the
proxy refuses (``__bool__``, ``__contains__``, ``__len__``, ``__iter__``,
``__int__``, ``__float__``): they would collapse the expression to a python
value. The build's message, at edit time. In an EAGER callback the capture
refuses those builtins by name before the body runs (``no-python-work``),
so the call forms are the function body's alone there.
"""

from __future__ import annotations

import ast

from east.diagnostics.types import Body, Context, body_nodes
from east.expression.errors import _trace_bail

#: builtins whose call iterates its expression argument (``__iter__``)
ITERATING = frozenset({
    "sum", "sorted", "list", "set", "tuple", "frozenset", "reversed", "enumerate", "zip", "map",
    "filter", "iter", "next", "any", "all",
})
#: builtins whose call is one protocol on its expression argument
PROTOCOL = {"len": "len()", "int": "int()", "float": "float()", "bool": "if/and/or/not"}


def _bail(op: str) -> str:
    return _trace_bail(op).args[0]


class NoPythonBoolean:
    name = "no-python-boolean"
    code = 4
    category = "error"
    description = ("No python `and` / `or` / `not` / `if` / `in` / `len()` / iteration / `int()` / `float()` "
                   "over an East expression — use `&`, `|`, `~`, East.if_else, and the expression's methods.")

    def check(self, body: Body, ctx: Context) -> None:
        eager = _root(body).kind == "eager"
        for node in body_nodes(body):
            if (isinstance(node, ast.BoolOp) and any(_truthy_expression(v, body) for v in node.values)) or (
                    isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not)
                    and _truthy_expression(node.operand, body)):
                ctx.report(node, self, _bail("if/and/or/not"))
            elif isinstance(node, (ast.If, ast.While, ast.IfExp, ast.Assert)) and _truthy_expression(node.test, body):
                ctx.report(node.test, self, _bail("if/and/or/not"))
            elif isinstance(node, ast.Compare) and any(isinstance(op, (ast.In, ast.NotIn)) for op in node.ops) \
                    and any(body.is_expression(c) for c in node.comparators):
                ctx.report(node, self, _bail("in"))
            elif isinstance(node, (ast.For, ast.comprehension)) and body.is_expression(node.iter):
                ctx.report(node.iter, self, _bail("iteration"))
            elif not eager and isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                    and any(body.is_expression(a) for a in node.args):
                op = _builtin_protocol(node.func.id, len(node.args))
                if op is not None and node.func.id not in ctx.imports and node.func.id not in ctx.python_defs:
                    ctx.report(node, self, _bail(op))


def _builtin_protocol(name: str, arity: int) -> str | None:
    """The protocol a builtin call collapses an expression argument through,
    as the build names it: ``max(x)`` iterates, ``max(x, 1)`` compares."""
    if name in PROTOCOL:
        return PROTOCOL[name]
    if name in ("min", "max"):
        return "iteration" if arity == 1 else "if/and/or/not"
    return "iteration" if name in ITERATING else None


def _root(body: Body) -> Body:
    while body.parent is not None:
        body = body.parent
    return body


def _truthy_expression(test: ast.AST, body: Body) -> bool:
    """An `if`/`while` test or an `and`/`or`/`not` operand that IS an
    expression: a name/chain the body holds an expression under, or a
    comparison / arithmetic on one (which builds an expression the python
    boolean would then collapse)."""
    if body.is_expression(test):
        return True
    if isinstance(test, ast.Compare):
        return body.is_expression(test.left) or any(body.is_expression(c) for c in test.comparators)
    if isinstance(test, ast.BinOp):
        return body.is_expression(test.left) or body.is_expression(test.right)
    return False
