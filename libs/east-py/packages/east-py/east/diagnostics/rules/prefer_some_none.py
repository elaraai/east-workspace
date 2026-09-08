#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``prefer-some-none``: ``some(x)`` / ``none`` are the Option
constructors. ``variant("some", x, OptionType(T))`` and ``variant("none",
None, OptionType(T))`` build the same value the long way round, and the long
way is where hand-rolling starts. The TypeScript rule of the same name; a
warning, not a refusal — the build accepts both. A ``VariantType`` of the
author's own whose case happens to be called ``some`` is a different type,
and ``variant("some", x, Count)`` is its only spelling.
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
    """The message for a ``variant("some"/"none", …)`` call building an
    OPTION, else None."""
    if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "variant"):
        return None
    if ctx.from_imports.get("variant", ("", ""))[0].split(".")[0] != "east":
        return None  # someone else's `variant`
    if not (node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str)):
        return None
    tag = node.args[0].value
    if tag not in ("some", "none"):
        return None
    declared = node.args[2] if len(node.args) >= 3 else next(
        (k.value for k in node.keywords if k.arg == "typ"), None)
    if declared is not None and not _is_option_type(declared):
        return None  # the author's own VariantType with a case of that name
    return SOME_MESSAGE if tag == "some" else NONE_MESSAGE


def _is_option_type(node: ast.AST) -> bool:
    if not isinstance(node, ast.Call):
        return False
    func = node.func
    name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", "")
    return name == "OptionType"
