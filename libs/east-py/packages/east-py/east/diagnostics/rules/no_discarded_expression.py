#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-discarded-expression``: a bare expression statement in a body is
evaluated at build time and thrown away — a mutation line
(``acc.push_last(x)``) never reaches the compiled body, an ``East.error(...)``
never raises. The build refuses both; the statement is ``b.do(...)``.
"""

from __future__ import annotations

import ast

from east.diagnostics.scope import STATEMENT_METHODS, is_east_ref
from east.diagnostics.types import Body, Context, body_nodes

ERROR_MESSAGE = ("East.error(...) was evaluated and thrown away — return it "
                 "from the body or branch, or use it as an East.if_else arm, "
                 "so the error reaches the compiled program")


def method_message(op: str) -> str:
    return (f".{op}() was evaluated and thrown away — a bare expression "
            "statement does not reach the compiled body and the loop would "
            f"silently do nothing. Append it with b.do(x.{op}(...)) on the "
            f"body's block, or sequence it: East.block(x.{op}(...), result)")


GENERIC_MESSAGE = ("a bare expression statement in a body is evaluated at build time and thrown "
                   "away — it does not reach the compiled body; append it with b.do(...) on the "
                   "body's block, or return it")


class NoDiscardedExpression:
    name = "no-discarded-expression"
    code = 9
    category = "error"
    description = "A bare expression statement in a body does not reach the compiled body — b.do(...) it, or return it."

    def check(self, body: Body, ctx: Context) -> None:
        if isinstance(body.node, ast.Lambda):
            return
        for node in body_nodes(body):
            if not isinstance(node, ast.Expr):
                continue
            value = node.value
            if isinstance(value, ast.Constant):
                continue  # a docstring
            if isinstance(value, ast.Call) and isinstance(value.func, ast.Attribute):
                receiver, attr = value.func.value, value.func.attr
                blocks = body.outer_blocks() | ({body.block} if body.block else set())
                if isinstance(receiver, ast.Name) and receiver.id in blocks and attr in STATEMENT_METHODS:
                    continue  # `b.do(...)`, `b.if_(...)`, … (an OUTER block is no-statement-on-outer-block's)
                if attr in ("else_if", "else_", "catch", "finally_"):
                    continue  # a chained statement builder
                if is_east_ref(receiver, ctx) and attr == "error":
                    ctx.report(node, self, ERROR_MESSAGE)
                elif body.is_expression(receiver):
                    ctx.report(node, self, method_message(attr))
                else:
                    ctx.report(node, self, GENERIC_MESSAGE)
            else:
                ctx.report(node, self, GENERIC_MESSAGE)
