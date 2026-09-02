#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-python-work``: an EAGER callback reaching for python.

The capture refuses a callback BEFORE its body runs, by name: every global
the body loads must be liftable — a scalar, an East type or value, the
``East`` namespace, an ``East.function`` artifact, ``if_else`` / ``some`` /
``none`` / ``variant``, a handful of builtins (``bool``, ``isinstance``,
``abs``), or a python function that passes the same check (a build-time
macro). A module object (``np``, ``math``), any other python builtin
(``sum``, ``len``, ``int``, ``sorted``…), a mutable East collection, or a
``def`` whose own body reaches for any of those has no East form, and the
capture raises ``_capture_error(name)`` naming the first such binding
(#625). This rule says the same at edit time, for the same names: the
allowed builtins are read off the capture's own check
(``_allowed_global``), not listed here.

Only the eager capture refuses by name; an ``East.function`` body that
calls a helper ``def`` runs it as a macro, and a python builtin over an
expression there fails through the proxy's protocols — the boolean,
formatting and round rules' texts.
"""

from __future__ import annotations

import ast
import builtins
import sys
from functools import cache

from east.diagnostics.scope import mutable_collections
from east.diagnostics.types import Body, Context, body_nodes
from east.expression.capture import _allowed_global, _capture_error

#: How deep a macro's own references are followed — the capture's own bound.
MACRO_DEPTH = 4


@cache
def refused_builtins() -> frozenset[str]:
    """The python builtins the capture refuses when a callback loads them:
    every callable builtin ``_allowed_global`` does not admit."""
    return frozenset(
        name for name in dir(builtins)
        if not name.startswith("_") and callable(getattr(builtins, name))
        and not _allowed_global(getattr(builtins, name), 0)
    )


def _message(name: str) -> str:
    return _capture_error(name).args[0]


class NoPythonWork:
    name = "no-python-work"
    code = 6
    category = "error"
    description = ("No python work inside an eager callback — no module objects, python builtins "
                   "or helpers doing python work; capture side-tables with East.function / .bind.")

    def check(self, body: Body, ctx: Context) -> None:
        if _root(body).kind != "eager":
            return  # the capture refusal is the eager callback's alone
        bound = body.expr_names | _enclosing_names(body) | ({body.block} if body.block else set())
        refused = _Refused(ctx)
        reported: set[str] = set()
        for node in body_nodes(body):
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) and node.id not in bound \
                    and node.id not in reported and refused.name(node.id):
                reported.add(node.id)
                ctx.report(node, self, _message(node.id))


class _Refused:
    """Which module-level names the capture refuses, resolved as the capture
    resolves them: the module's own bindings first, then the builtins."""

    def __init__(self, ctx: Context) -> None:
        self.ctx = ctx
        self.defs = {n.name: n for n in ctx.tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
        self.mutable = mutable_collections(ctx)
        self.macros: dict[str, bool] = {}

    def name(self, name: str, depth: int = MACRO_DEPTH) -> bool:
        ctx = self.ctx
        if name in ctx.east_names or name in ctx.east_artifacts:
            return False
        module = ctx.imports.get(name)
        if module is not None:
            if module == "east" or module.startswith("east."):
                return False
            # a module object is never liftable; a name imported from the
            # standard library is python's; what a user package exports may
            # be an East artifact, which the build alone can tell
            top = module.split(".")[0]
            return name == module or "." not in module or top in sys.stdlib_module_names
        if name in self.mutable:
            return True
        if name in self.defs:
            return not self.macro(name, depth)
        return name in refused_builtins()

    def macro(self, name: str, depth: int) -> bool:
        """Whether the module-level ``def`` is a build-time macro: every
        global it loads passes the same check (to the capture's depth)."""
        hit = self.macros.get(name)
        if hit is not None:
            return hit
        if depth <= 0:
            return False
        self.macros[name] = True  # a recursive helper is its own evidence
        node = self.defs[name]
        local = {a.arg for a in [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]}
        if node.args.vararg:
            local.add(node.args.vararg.arg)
        if node.args.kwarg:
            local.add(node.args.kwarg.arg)
        for n in ast.walk(node):
            if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store):
                local.add(n.id)
        ok = not any(
            isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load) and n.id not in local and self.name(n.id, depth - 1)
            for n in ast.walk(node)
        )
        self.macros[name] = ok
        return ok


def _root(body: Body) -> Body:
    while body.parent is not None:
        body = body.parent
    return body


def _enclosing_names(body: Body) -> set[str]:
    names: set[str] = set()
    parent = body.parent
    while parent is not None:
        names.update(parent.expr_names)
        if parent.block is not None:
            names.add(parent.block)
        parent = parent.parent
    return names
