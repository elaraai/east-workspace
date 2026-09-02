#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-python-work``: a body reaching for python — a module object
(``np``, ``random``, ``datetime``), a python builtin over an expression
(``sum``, ``sorted``, ``list``…), or a module-level python ``def`` — has no
East form. The build refuses the capture naming the binding (#625); here
the same text names it at edit time.
"""

from __future__ import annotations

import ast

from east.diagnostics.types import Body, Context, body_nodes
from east.expression.capture import _capture_error

#: python builtins that do the loop's work in python when handed an expression
BUILTIN_WORK = frozenset({
    "sum", "sorted", "list", "dict", "set", "tuple", "min", "max", "abs", "range", "enumerate",
    "zip", "map", "filter", "any", "all", "reversed", "print", "isinstance", "type", "getattr",
    "hasattr", "iter", "next",
})


def _message(name: str) -> str:
    return _capture_error(name).args[0]


class NoPythonWork:
    name = "no-python-work"
    code = 6
    category = "error"
    description = ("No python work inside an East body — no module objects, no python builtins over "
                   "expressions, no python helper calls; capture side-tables with East.function / .bind.")

    def check(self, body: Body, ctx: Context) -> None:
        reported: set[int] = set()
        for node in body_nodes(body):
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
                name = node.id
                if name in body.expr_names or name == body.block or name in _enclosing_names(body):
                    continue
                if name in ctx.east_names or name in ctx.east_artifacts:
                    continue
                module = ctx.imports.get(name)
                if module is not None and not (module == "east" or module.startswith("east.")):
                    if id(node) not in reported:
                        reported.add(id(node))
                        ctx.report(node, self, _message(name))
            elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                fn = node.func.id
                if fn in ctx.python_defs and fn not in ctx.east_artifacts:
                    ctx.report(node, self, _message(fn))
                elif fn in BUILTIN_WORK and fn not in ctx.imports and fn not in ctx.python_defs \
                        and any(body.is_expression(a) for a in [*node.args, *(k.value for k in node.keywords)]):
                    ctx.report(node, self, _message(fn))


def _enclosing_names(body: Body) -> set[str]:
    names: set[str] = set()
    parent = body.parent
    while parent is not None:
        names.update(parent.expr_names)
        if parent.block is not None:
            names.add(parent.block)
        parent = parent.parent
    return names
