#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-python-string-building``: an East string CONSTANT assembled by an
f-string at module scope — a regex, a replacement template, a key.

``no-python-formatting`` is the sibling case: an f-string over an EXPRESSION
inside a body, which the build refuses outright. This one is quieter and
survives the build: the f-string runs at import, the constant is real, and
only the reader loses. A pattern spelled `f"^{prefix}-\\\\d+$"` cannot be read
as a regex, cannot be grepped, and drifts silently when `prefix` changes
meaning. Spell the constant.
"""

from __future__ import annotations

import ast

from east.diagnostics.types import Body, Context

MESSAGE = ("this East string constant is assembled by an f-string, so what it actually contains "
           "cannot be read here — spell the constant out")


class NoPythonStringBuilding:
    name = "no-python-string-building"
    code = 24
    category = "warning"
    supersedes: tuple[str, ...] = ()
    description = ("No East string constant assembled by a module-scope f-string — spell it out.")

    def check(self, body: Body, ctx: Context) -> None:
        del body, ctx  # an f-string INSIDE a body is no-python-formatting's

    def check_module(self, ctx: Context) -> None:
        for node in ctx.tree.body:
            if not (isinstance(node, ast.Assign) and len(node.targets) == 1
                    and isinstance(node.targets[0], ast.Name)):
                continue
            if not isinstance(node.value, ast.JoinedStr):
                continue
            if not any(isinstance(v, ast.FormattedValue) for v in node.value.values):
                continue
            if _read_in_a_body(node.targets[0].id, ctx):
                ctx.report(node.value, self, MESSAGE)


def _read_in_a_body(name: str, ctx: Context) -> bool:
    return any(
        isinstance(node, ast.Name) and node.id == name and isinstance(node.ctx, ast.Load)
        and ctx.in_body(node)
        for node in ast.walk(ctx.tree)
    )
