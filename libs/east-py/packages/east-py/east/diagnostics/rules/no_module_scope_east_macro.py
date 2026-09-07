#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-module-scope-east-macro``: a module-scope python ``def`` whose every
return builds East IR, expanded into a body at each call, is an
authoring-time macro. It cannot be serialized and cannot recurse — everything
a real ``East.function`` can do. The other shape is a helper a body calls to
assemble a composite string key from an f-string (``f"{org}|{line}"``), which
is the signature of a string-keyed data model where typed or nested East data
belongs. Both arms need the helper to be CALLED FROM A BODY: ``some(x)`` /
``variant(...)`` build a plain East VALUE outside one, and an f-string helper
that only ever serves python is python's own business. The TypeScript rule of
the same name; ``no-python-work`` covers the different concern of a helper
doing python WORK inside an eager callback.
"""

from __future__ import annotations

import ast

from east.diagnostics.scope import is_east_ref
from east.diagnostics.types import Body, Context

IR_MESSAGE = ("this module-scope helper builds East IR — an authoring-time macro that expands "
              "inline at each call and cannot be serialized or recursed. Make it a real "
              "East.function, taking what varies as a parameter")
KEY_MESSAGE = ("this helper builds a composite string key from an f-string — the signature of a "
               "string-keyed data model. Model it with typed keys or nested East data, so the "
               "structure survives serialization")

#: the value constructors whose call is East IR by itself
_VALUE_CTORS = frozenset({"variant", "some"})


class NoModuleScopeEastMacro:
    name = "no-module-scope-east-macro"
    code = 18
    category = "warning"
    description = ("No module-scope python helper that a body calls to build East IR or a composite "
                   "string key — make it an East.function, or model typed / nested East data.")

    def check(self, body: Body, ctx: Context) -> None:
        # A macro is a module-scope def; the body walk never sees one.
        del body, ctx

    def check_module(self, ctx: Context) -> None:
        for node in ctx.tree.body:
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if node.name in ctx.east_artifacts or node.decorator_list:
                continue  # an East artifact, or something a decorator already governs
            returns = _returns(node)
            if not returns or not _called_from_a_body(node.name, ctx):
                continue
            if all(_builds_ir(r, ctx) for r in returns):
                ctx.report(node, self, IR_MESSAGE)
            elif all(_composite_key(r) for r in returns):
                ctx.report(node, self, KEY_MESSAGE)


def _called_from_a_body(name: str, ctx: Context) -> bool:
    """Whether ``name`` is called from inside an East body — the tell that
    separates a macro from an eager value builder or a python helper."""

    def calls(body: Body) -> bool:
        for node in ast.walk(body.node):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == name:
                return True
        return any(calls(child) for child in body.children)

    return any(calls(body) for body in ctx.bodies)


def _returns(fn: ast.FunctionDef | ast.AsyncFunctionDef) -> list[ast.expr]:
    """The returned expressions of ``fn`` itself — not those of a nested def."""
    out: list[ast.expr] = []
    stack: list[ast.AST] = list(fn.body)
    while stack:
        node = stack.pop()
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            continue
        if isinstance(node, ast.Return) and node.value is not None:
            out.append(node.value)
        stack.extend(ast.iter_child_nodes(node))
    return out


def _builds_ir(node: ast.AST, ctx: Context) -> bool:
    """``variant(...)`` / ``some(...)`` / ``none`` / an ``East.*`` call."""
    if isinstance(node, ast.Name) and node.id == "none":
        return True
    if not isinstance(node, ast.Call):
        return False
    func = node.func
    if isinstance(func, ast.Name):
        return func.id in _VALUE_CTORS and func.id in ctx.from_imports
    return isinstance(func, ast.Attribute) and is_east_ref(func.value, ctx)


#: the separators a composite key joins its parts with
_KEY_SEPARATORS = frozenset({"|", ":", "-", "/", "_", ".", "#"})


def _composite_key(node: ast.AST) -> bool:
    """An f-string that joins two or more values with nothing but separators —
    ``f"{org}|{line}"``.

    The literal chunks are the tell: a KEY glues its parts with a punctuation
    separator, while prose (a diagnostic message, a log line, a docstring)
    carries words and spaces between them, and ``f"{a}{b}"`` glues nothing.
    """
    if not isinstance(node, ast.JoinedStr):
        return False
    if sum(isinstance(v, ast.FormattedValue) for v in node.values) < 2:
        return False
    chunks = [v.value for v in node.values if isinstance(v, ast.Constant) and isinstance(v.value, str)]
    return bool(chunks) and all(chunk in _KEY_SEPARATORS for chunk in chunks)
