#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-handrolled-variant``: a ``{"type": …, "value": …}`` dict is not an
East variant. The encoder needs the value ``variant()`` / ``some`` / ``none``
build; a dict of the same shape lacks it and drifts silently — ``East.value``
and ``coerce_to`` accept it as a two-field STRUCT, and the failure lands at
encode time, far from the line that wrote it. The TypeScript rule of the same
name reads the contextual type; here the tell is the shape reaching East: a
dict literal inside a body, one handed to an East boundary call (``East.value``,
``coerce_to``, ``array``, …), or one bound to a name a body reads. A dict of
that shape that never meets East — a JSON payload for some other system — is
a dict.
"""

from __future__ import annotations

import ast

from east.diagnostics.scope import EAST_BOUNDARY_CALLS, reaches_east
from east.diagnostics.types import Body, Context, body_nodes

MESSAGE = ('a hand-rolled {"type": …, "value": …} dict is not an East variant — build it with '
           'variant("Tag", value, Type), or some(value) / none for an Option; the encoder needs '
           "what those construct")


class NoHandrolledVariant:
    name = "no-handrolled-variant"
    code = 11
    category = "warning"
    description = 'No hand-rolled {"type": …, "value": …} dicts reaching East — use variant() / some / none.'

    def check(self, body: Body, ctx: Context) -> None:
        for node in body_nodes(body):
            if _handrolled(node):
                ctx.report(node, self, MESSAGE)

    def check_module(self, ctx: Context) -> None:
        reported: set[int] = set()

        def report(dict_node: ast.AST) -> None:
            if id(dict_node) not in reported:
                reported.add(id(dict_node))
                ctx.report(dict_node, self, MESSAGE)

        # handed straight to an East boundary call — a row inside `array(T, [...])` included
        for node in ast.walk(ctx.tree):
            if ctx.in_body(node) or not isinstance(node, ast.Call):
                continue
            func = node.func
            called = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", "")
            if called not in EAST_BOUNDARY_CALLS:
                continue
            for arg in node.args:
                for inner in ast.walk(arg):
                    if _handrolled(inner):
                        report(inner)
        # bound to a module-level name that a body reads or a boundary call takes
        for node in ctx.tree.body:
            if not (isinstance(node, ast.Assign) and len(node.targets) == 1
                    and isinstance(node.targets[0], ast.Name)):
                continue
            if not reaches_east(node.targets[0].id, ctx):
                continue
            for inner in ast.walk(node.value):
                if _handrolled(inner):
                    report(inner)


def _handrolled(node: ast.AST) -> bool:
    """A dict literal whose keys are exactly ``type`` and ``value``."""
    if not isinstance(node, ast.Dict):
        return False
    keys = [k.value for k in node.keys if isinstance(k, ast.Constant) and isinstance(k.value, str)]
    return len(keys) == len(node.keys) == 2 and set(keys) == {"type", "value"}
