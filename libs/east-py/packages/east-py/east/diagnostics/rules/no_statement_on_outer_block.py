#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-statement-on-outer-block``: inside a nested body, a statement on an
ENCLOSING body's block (``b.if_(p, lambda _b: b.assign(...))``) — the
statement belongs to the block the nested body received. TypeScript's
``no-cross-block-builder``; the build refuses it with this text.
"""

from __future__ import annotations

import ast

from east.diagnostics.scope import STATEMENT_METHODS
from east.diagnostics.types import Body, Context, body_nodes


def message(op: str) -> str:
    return (f"b.{op}() was called on an OUTER block while a nested body is open — "
            "a statement belongs to the block the body it sits in received (the "
            "first parameter of every branch, loop and handler body)")


class NoStatementOnOuterBlock:
    name = "no-statement-on-outer-block"
    code = 7
    category = "error"
    supersedes: tuple[str, ...] = ()
    description = ("A statement inside a nested body must use that body's own block, not an enclosing "
                   "body's — `lambda b: b.assign(...)`, not `lambda _b: b.assign(...)`.")

    def check(self, body: Body, ctx: Context) -> None:
        outer = body.outer_blocks() - ({body.block} if body.block else set())
        if not outer:
            return
        for node in body_nodes(body):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) \
                    and isinstance(node.func.value, ast.Name) and node.func.value.id in outer \
                    and node.func.attr in STATEMENT_METHODS:
                ctx.report(node, self, message(node.func.attr))
