#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-python-east-data``: East data assembled by python at module scope —
a comprehension, or a list built up by a loop — and then handed to a body.

The rows end up in the program either way, but the declaration is no longer
readable where it is declared: the reader sees the comprehension, not the
data, and nothing checks that what it produces still matches the East type.
Write the rows out. The generated shape belongs at RUNTIME, where an e3 input
or a task can produce it and the engine can see it change.
"""

from __future__ import annotations

import ast

from east.diagnostics.types import Body, Context

MESSAGE = ("this East data is assembled by python at module scope, so the rows are not readable "
           "where they are declared and nothing checks them against the East type — write them "
           "out literally, or produce them at runtime (an e3 input, or a task)")

_COMPREHENSIONS = (ast.ListComp, ast.DictComp, ast.SetComp, ast.GeneratorExp)
#: the methods that grow a container in a module-level loop
_GROWERS = frozenset({"append", "extend", "add", "update", "insert"})


class NoPythonEastData:
    name = "no-python-east-data"
    code = 23
    category = "warning"
    supersedes: tuple[str, ...] = ()
    description = ("No East data assembled by a module-scope comprehension or loop — write the "
                   "rows out, or produce them at runtime.")

    def check(self, body: Body, ctx: Context) -> None:
        del body, ctx  # the assembly is at module scope; the use is what the module pass finds

    def check_module(self, ctx: Context) -> None:
        assembled = _assembled_names(ctx)
        if not assembled:
            return
        for name, node in sorted(assembled.items()):
            if _reaches_east(name, ctx):
                ctx.report(node, self, MESSAGE)


def _assembled_names(ctx: Context) -> dict[str, ast.AST]:
    """Module-level names bound to a comprehension, or to an empty container
    that a module-level loop then grows."""
    out: dict[str, ast.AST] = {}
    for node in ctx.tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            if isinstance(node.value, _COMPREHENSIONS):
                out[node.targets[0].id] = node.value
        elif isinstance(node, ast.For):
            for inner in ast.walk(node):
                if (isinstance(inner, ast.Call) and isinstance(inner.func, ast.Attribute)
                        and inner.func.attr in _GROWERS and isinstance(inner.func.value, ast.Name)):
                    out.setdefault(inner.func.value.id, node)
    return out


def _reaches_east(name: str, ctx: Context) -> bool:
    """Whether ``name`` is read inside an East body, or handed to East at
    module scope (``East.value(rows, T)``, ``coerce_to(rows, T)``)."""
    for node in ast.walk(ctx.tree):
        if isinstance(node, ast.Name) and node.id == name and isinstance(node.ctx, ast.Load) \
                and ctx.in_body(node):
            return True
        if isinstance(node, ast.Call) and not ctx.in_body(node):
            func = node.func
            called = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", "")
            if called in ("value", "coerce_to", "assert_value_of") \
                    and any(isinstance(a, ast.Name) and a.id == name for a in node.args):
                return True
    return False
