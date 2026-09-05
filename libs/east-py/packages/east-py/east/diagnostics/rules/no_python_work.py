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
(``sum``, ``len``, ``int``, ``sorted``…), a name imported from the
standard library or an installed package that has no East form (``from
math import floor``; ``from math import pi`` is a float and lifts), a
mutable East collection, or a ``def`` whose own body reaches for any of
those, and the capture raises ``_capture_error(name)`` naming the first
such binding (#625). This rule says the same at edit time, for the same
names, with the capture's own check: the allowed builtins are read off
``_allowed_global``, and an imported name is resolved — the module
imported, the attribute fetched — and put to the same check (#648). A
module of the user's own, or one this environment cannot import, is
unknown and left to the build.

Only the eager capture refuses by name; an ``East.function`` body that
calls a helper ``def`` runs it as a macro, and a python builtin over an
expression there fails through the proxy's protocols — the boolean,
formatting and round rules' texts.
"""

from __future__ import annotations

import ast
import builtins
import importlib
import importlib.util
import os
import site
import sys
import sysconfig
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


@cache
def _site_dirs() -> tuple[str, ...]:
    """Where installed distributions live: the site-packages directories."""
    dirs = {*site.getsitepackages(), site.getusersitepackages()}
    dirs.update(p for k, p in sysconfig.get_paths().items() if k in ("purelib", "platlib"))
    return tuple(os.path.realpath(d) for d in dirs if d)


def _installed(top: str) -> bool:
    """Whether the top-level package ``top`` is an installed distribution —
    found under a site-packages directory — as opposed to the user's own
    code (a module on the path, an editable install)."""
    try:
        spec = importlib.util.find_spec(top)
    except (ImportError, ValueError):
        return False
    if spec is None:
        return False
    locations = [spec.origin] if spec.origin else list(spec.submodule_search_locations or [])
    return any(os.path.realpath(loc).startswith(d + os.sep) for loc in locations if loc for d in _site_dirs())


@cache
def refused_import(module: str, attr: str) -> bool:
    """Whether ``from module import attr`` binds a name the capture
    refuses: the object itself, put to the capture's own check
    (``_allowed_global``), when ``module`` is python's standard library or
    an installed distribution — the modules a lint may import. A module of
    the user's own, or one that fails to import here, is unknown, and the
    build alone can tell: not refused."""
    top = module.split(".")[0]
    if not (top in sys.stdlib_module_names or _installed(top)):
        return False
    try:
        value = getattr(importlib.import_module(module), attr)
    except Exception:
        return False
    return not _allowed_global(value, MACRO_DEPTH)


def _message(name: str) -> str:
    return _capture_error(name).args[0]


class NoPythonWork:
    name = "no-python-work"
    code = 6
    category = "error"
    # Nothing to supersede: `no-python-data-work` only fires for a helper called
    # from a NON-eager body, and this rule only fires inside an eager one, so the
    # two are disjoint by construction. The declaration that used to sit here was
    # dead — the rules report at different ranges (a call site vs a module-scope
    # `def`), so `_overlaps` could never have fired it, and no test could tell.
    supersedes: tuple[str, ...] = ()
    description = ("No python work inside an eager callback — no module objects, python builtins, "
                   "imported python functions or helpers doing python work; capture side-tables with "
                   "East.function / .bind.")

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
            imported = ctx.from_imports.get(name)
            if imported is None:
                return True  # a module object is never liftable
            # a name from the standard library or an installed package: the
            # object itself, put to the capture's check; a user module's is
            # the build's to tell
            return refused_import(*imported)
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
