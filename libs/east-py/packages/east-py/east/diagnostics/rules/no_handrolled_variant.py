#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-handrolled-variant``: a ``{"type": …, "value": …}`` dict is not an
East variant. The encoder needs the value ``variant()`` / ``some`` / ``none``
build; a dict of the same shape lacks it and drifts silently — the failure
lands at encode time, far from the line that wrote it. The TypeScript rule of
the same name reads the contextual type; here the shape is the tell, in a
file that imports east.
"""

from __future__ import annotations

import ast

from east.diagnostics.types import Body, Context, body_nodes

MESSAGE = ('a hand-rolled {"type": …, "value": …} dict is not an East variant — build it with '
           'variant("Tag", value, Type), or some(value) / none for an Option; the encoder needs '
           "what those construct")


class NoHandrolledVariant:
    name = "no-handrolled-variant"
    code = 11
    category = "warning"
    supersedes: tuple[str, ...] = ()
    description = 'No hand-rolled {"type": …, "value": …} dicts — use variant() / some / none.'

    def check(self, body: Body, ctx: Context) -> None:
        for node in body_nodes(body):
            if _handrolled(node):
                ctx.report(node, self, MESSAGE)

    def check_module(self, ctx: Context) -> None:
        for node in ast.walk(ctx.tree):
            if _handrolled(node) and not ctx.in_body(node):
                ctx.report(node, self, MESSAGE)


def _handrolled(node: ast.AST) -> bool:
    """A dict literal whose keys are exactly ``type`` and ``value``."""
    if not isinstance(node, ast.Dict):
        return False
    keys = [k.value for k in node.keys if isinstance(k, ast.Constant) and isinstance(k.value, str)]
    return len(keys) == len(node.keys) == 2 and set(keys) == {"type", "value"}
