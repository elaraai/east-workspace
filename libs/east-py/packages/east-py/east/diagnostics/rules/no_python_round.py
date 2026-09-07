#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-python-round``: ``round(x)`` on a Float expression rounds ties to
even in python; East's rounding is explicit (``East.Float.round_half`` and
the floor / ceil / trunc forms). The build refuses ``__round__``; in an
EAGER callback ``round`` is refused by name first (``no-python-work``).
"""

from __future__ import annotations

import ast

from east.diagnostics.types import Body, Context, body_nodes, is_name

ROUND_MESSAGE = ("python round() rounds ties to even; East.Float.round_half(x) rounds "
                 "half away from zero — call it explicitly (or East.Float.round_floor/"
                 "round_ceil/round_trunc)")


class NoPythonRound:
    name = "no-python-round"
    code = 5
    category = "error"
    description = "No python round() on an East expression — East.Float.round_half / round_floor / round_ceil / round_trunc."

    def check(self, body: Body, ctx: Context) -> None:
        if _root(body).kind == "eager":
            return
        for node in body_nodes(body):
            if isinstance(node, ast.Call) and is_name(node.func, "round") and node.args \
                    and body.is_expression(node.args[0]):
                ctx.report(node, self, ROUND_MESSAGE)


def _root(body: Body) -> Body:
    while body.parent is not None:
        body = body.parent
    return body
