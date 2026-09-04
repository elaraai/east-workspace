
"""``prefer-let-const-over-east-value``: inside a body, ``East.value(v, T)``
bound to a python local — or returned — erases the East type at the place the
binding is made. ``b.let`` / ``b.const`` carry it. A bare ``East.value(x)``
handed straight to a method (wrapping an external constant) stays valid. The
TypeScript rule of the same name.
"""

from __future__ import annotations

import ast

from east.diagnostics.scope import is_east_ref
from east.diagnostics.types import Body, Context, body_nodes

ASSIGN_MESSAGE = ("East.value(...) bound to a python local erases the East type at the binding — "
                  "declare it with b.const(value, Type) (or b.let) instead")
RETURN_MESSAGE = ("returning East.value(...) erases the East type — bind it with b.const(value, Type) "
                  "(or b.let) and return the binding")


class PreferLetConstOverEastValue:
    name = "prefer-let-const-over-east-value"
    code = 17
    category = "suggestion"
    supersedes: tuple[str, ...] = ()
    description = "Inside a body, declare with b.let / b.const rather than East.value(...)."

    def check(self, body: Body, ctx: Context) -> None:
        for node in body_nodes(body):
            if isinstance(node, ast.Assign) and _is_east_value(node.value, ctx):
                ctx.report(node.value, self, ASSIGN_MESSAGE)
            elif isinstance(node, ast.Return) and node.value is not None and _is_east_value(node.value, ctx):
                ctx.report(node.value, self, RETURN_MESSAGE)


def _is_east_value(node: ast.AST, ctx: Context) -> bool:
    return (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
            and node.func.attr == "value" and is_east_ref(node.func.value, ctx))
