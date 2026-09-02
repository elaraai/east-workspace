#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-operator-fork``: the #624 operators python and East disagree on.

``//``, ``%`` and ``**`` on an expression build the wrong builtin (python
floors, East truncates; python's remainder takes the divisor's sign; a
negative Integer exponent promotes in python), and ``a[-1]`` is python's
from-the-end indexing, which East has no twin for. The build refuses all
four with the texts below; here they come at edit time.
"""

from __future__ import annotations

import ast

from east.diagnostics.types import Body, Context, body_nodes
from east.expression.expr.integer import _FLOORDIV_FORK, _MOD_FORK, _POW_FORK

NEGATIVE_INDEX = ("python's from-the-end indexing (a[-1]) has no East twin — "
                  "spell the element you mean, e.g. a.get(a.size() - 1) for "
                  "the last element")

_FORKS = {ast.FloorDiv: _FLOORDIV_FORK, ast.Mod: _MOD_FORK, ast.Pow: _POW_FORK}


class NoOperatorFork:
    name = "no-operator-fork"
    code = 2
    category = "error"
    description = ("`//`, `%`, `**` and `a[-1]` on an East expression diverge from East's builtins — "
                   "call East.Integer.divide / remainder / pow, and spell the element you mean.")

    def check(self, body: Body, ctx: Context) -> None:
        for node in body_nodes(body):
            if isinstance(node, ast.BinOp) and type(node.op) in _FORKS:
                if isinstance(node.op, ast.Mod) and isinstance(node.left, ast.Constant) and isinstance(node.left.value, str):
                    continue  # `"%s" % x` is formatting (no-python-formatting)
                if body.is_expression(node.left) or body.is_expression(node.right):
                    ctx.report(node, self, _FORKS[type(node.op)])
            elif isinstance(node, ast.Subscript) and body.is_expression(node.value):
                index = node.slice
                if isinstance(index, ast.UnaryOp) and isinstance(index.op, ast.USub) \
                        and isinstance(index.operand, ast.Constant) and isinstance(index.operand.value, int):
                    ctx.report(node, self, NEGATIVE_INDEX)
