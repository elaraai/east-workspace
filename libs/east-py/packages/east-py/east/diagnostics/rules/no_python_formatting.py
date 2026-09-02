#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-python-formatting``: an f-string, ``str()``, ``format()`` or
``%``-formatting over an expression would constant-fold the proxy's
repr into the result; the build refuses it (``__str__`` / ``__format__``).
"""

from __future__ import annotations

import ast

from east.diagnostics.types import Body, Context, body_nodes, is_name

STR_MESSAGE = ("f-strings / str() cannot be traced into an East function body — the "
               "expression proxy would constant-fold into the result. Build "
               "strings with `+` concatenation, or East.String.print(T, value) "
               "for a value's text")
FORMAT_MESSAGE = ("f-strings / format() cannot be traced into an East function body — the "
                  "expression proxy would constant-fold into the result. Build "
                  "strings with `+` concatenation, or East.String.print(T, value) "
                  "for a value's text")


class NoPythonFormatting:
    name = "no-python-formatting"
    code = 3
    category = "error"
    description = ("No f-string / str() / format() / `%` formatting over an East expression — "
                   "build strings with `+` or East.String.print(T, value).")

    def check(self, body: Body, ctx: Context) -> None:
        for node in body_nodes(body):
            if isinstance(node, ast.JoinedStr):
                if any(isinstance(v, ast.FormattedValue) and body.is_expression(v.value) for v in node.values):
                    ctx.report(node, self, FORMAT_MESSAGE)
            elif isinstance(node, ast.Call):
                if is_name(node.func, "str") and node.args and body.is_expression(node.args[0]):
                    ctx.report(node, self, STR_MESSAGE)
                elif is_name(node.func, "format") and node.args and body.is_expression(node.args[0]):
                    ctx.report(node, self, FORMAT_MESSAGE)
                elif isinstance(node.func, ast.Attribute) and node.func.attr == "format" \
                        and isinstance(node.func.value, ast.Constant) and isinstance(node.func.value.value, str) \
                        and any(body.is_expression(a) for a in node.args):
                    ctx.report(node, self, FORMAT_MESSAGE)
            elif isinstance(node, ast.BinOp) and isinstance(node.op, ast.Mod) \
                    and isinstance(node.left, ast.Constant) and isinstance(node.left.value, str):
                right = node.right.elts if isinstance(node.right, ast.Tuple) else [node.right]
                if any(body.is_expression(r) for r in right):
                    ctx.report(node, self, STR_MESSAGE)
