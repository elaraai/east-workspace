#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``prefer-some-none``: ``some(x)`` / ``none`` are the Option
constructors. ``variant("some", x)`` and ``variant("none", None)`` build the
same value the long way round, and the long way is where hand-rolling starts.
The TypeScript rule of the same name; a warning, not a refusal — the build
accepts both.
"""

from __future__ import annotations

import ast

from east.diagnostics.types import Body, Context, body_nodes

SOME_MESSAGE = 'use `some(value)` instead of `variant("some", value)`'
NONE_MESSAGE = 'use `none` instead of `variant("none", None)`'


class PreferSomeNone:
    name = "prefer-some-none"
    code = 10
    category = "warning"
    supersedes: tuple[str, ...] = ()
    description = 'Prefer some(value) / none over variant("some", value) / variant("none", None).'

    def check(self, body: Body, ctx: Context) -> None:
        for node in body_nodes(body):
            message = _option_tag(node, ctx)
            if message is not None:
                ctx.report(node, self, message)

    def check_module(self, ctx: Context) -> None:
        for node in ast.walk(ctx.tree):
            if ctx.in_body(node):
                continue
            message = _option_tag(node, ctx)
            if message is not None:
                ctx.report(node, self, message)


def _option_tag(node: ast.AST, ctx: Context) -> str | None:
    """The message for a ``variant("some"/"none", …)`` call, else None."""
    if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "variant"):
        return None
    if ctx.from_imports.get("variant", ("", ""))[0].split(".")[0] != "east":
        return None  # someone else's `variant`
    if not (node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str)):
        return None
    tag = node.args[0].value
    if tag == "some":
        return SOME_MESSAGE
    return NONE_MESSAGE if tag == "none" else None

