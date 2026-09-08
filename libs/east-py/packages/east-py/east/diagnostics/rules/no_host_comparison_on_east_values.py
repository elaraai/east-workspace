#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-host-comparison-on-east-values``: python ordering — ``<`` ``<=`` ``>``
``>=`` — on a decoded East VARIANT or OPTION raises ``TypeError``:
``EastVariant`` defines no order, and ``sorted`` / ``min`` / ``max`` over them
fail the same way. ``compare_for(T)`` / ``less_for(T)`` order by East's total
order, and ``make_east_key(T)`` is the ``sorted`` key. Equality is fine —
``==`` on a decoded variant is structural (``some(3) == some(3)``) — so it is
never flagged. (The TypeScript rule of the same name flags ``===`` too, because
there it IS reference equality.)

Scoped to the shapes whose host comparison fails, and to python's scopes: a
name is a variant where the binding in force bound it to one — a module-level
``held = some(3)`` says nothing about a parameter called ``held`` in some
function. A decoded ``IntegerType`` is a python ``int`` and orders correctly,
so scalars are never flagged. And only OUTSIDE a body — inside one the same
operators build East comparisons, which is right.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field

from east.diagnostics.types import Body, Context

ORDER_MESSAGE = ("python ordering on a decoded East variant/option raises TypeError — EastVariant "
                 "has no `<`. Use compare_for(T) / less_for(T), and make_east_key(T) for sorted")

#: the type constructors whose decoded value does not order in python
BROKEN_TYPES = frozenset({"VariantType", "OptionType"})
#: the value constructors that build one
BROKEN_CTORS = frozenset({"variant", "some"})

_ORDER = (ast.Lt, ast.LtE, ast.Gt, ast.GtE)
_CALLABLES = (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)


@dataclass
class _Scope:
    """What one python scope binds: every name it binds, and those among
    them bound to a decoded variant/option."""

    bound: set[str] = field(default_factory=set)
    broken: set[str] = field(default_factory=set)


class NoHostComparisonOnEastValues:
    name = "no-host-comparison-on-east-values"
    code = 17
    category = "error"
    description = ("No python < / > on a decoded East variant or option outside a body — it raises; "
                   "compare_for(T) / less_for(T).")

    def check(self, body: Body, ctx: Context) -> None:
        # Module scope only: inside a body these operators build East
        # comparisons, which is exactly right.
        del body, ctx

    def check_module(self, ctx: Context) -> None:
        aliases = {
            target.id
            for node in ctx.tree.body
            if isinstance(node, ast.Assign) and _is_broken_type(node.value, set())
            for target in node.targets
            if isinstance(target, ast.Name)
        }
        module = _scope_of(ctx.tree.body)
        for node in ctx.tree.body:
            self._scan(node, [module], aliases, ctx)

    def _scan(self, node: ast.AST, scopes: list[_Scope], aliases: set[str], ctx: Context) -> None:
        if isinstance(node, _CALLABLES):
            # decorators and defaults evaluate in the ENCLOSING scope
            outer = [*node.decorator_list, *node.args.defaults] if not isinstance(node, ast.Lambda) \
                else list(node.args.defaults)
            for child in outer:
                self._scan(child, scopes, aliases, ctx)
            inner = [*scopes, _function_scope(node, aliases)]
            body = [node.body] if isinstance(node, ast.Lambda) else node.body
            for child in body:
                self._scan(child, inner, aliases, ctx)
            return
        if isinstance(node, ast.Compare) and not ctx.in_body(node):
            operands = [node.left, *node.comparators]
            if (not any(_is_none_literal(o) for o in operands)
                    and any(_is_broken_value(o, scopes) for o in operands)
                    and any(isinstance(op, _ORDER) for op in node.ops)):
                ctx.report(node, self, ORDER_MESSAGE)
        for child in ast.iter_child_nodes(node):
            self._scan(child, scopes, aliases, ctx)


def _scope_of(statements: list[ast.stmt]) -> _Scope:
    """The names ``statements`` bind at THEIR level — not inside a nested
    callable, which is its own scope."""
    scope = _Scope()
    stack: list[ast.AST] = list(statements)
    while stack:
        node = stack.pop()
        if isinstance(node, _CALLABLES):
            if not isinstance(node, ast.Lambda):
                scope.bound.add(node.name)
            continue
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            scope.bound.add(node.id)
        elif isinstance(node, ast.Assign) and _builds_broken_value(node.value):
            scope.broken.update(t.id for t in node.targets if isinstance(t, ast.Name))
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            scope.bound.update((a.asname or a.name).split(".")[0] for a in node.names)
        stack.extend(ast.iter_child_nodes(node))
    return scope


def _function_scope(fn: ast.AST, aliases: set[str]) -> _Scope:
    args = fn.args  # type: ignore[attr-defined]
    params = [a.arg for a in [*args.posonlyargs, *args.args, *args.kwonlyargs]]
    if args.vararg:
        params.append(args.vararg.arg)
    if args.kwarg:
        params.append(args.kwarg.arg)
    body = [fn.body] if isinstance(fn, ast.Lambda) else fn.body  # type: ignore[attr-defined]
    scope = _scope_of(body)
    scope.bound.update(params)
    if not isinstance(fn, ast.Lambda):
        scope.broken.update(_broken_params(fn, aliases))  # type: ignore[arg-type]
    return scope


def _broken_params(fn: ast.FunctionDef | ast.AsyncFunctionDef, aliases: set[str]) -> set[str]:
    """The parameters a ``@platform_function`` declares with a broken type."""
    for decorator in fn.decorator_list:
        if not isinstance(decorator, ast.Call):
            continue
        target = decorator.func
        name = target.attr if isinstance(target, ast.Attribute) else getattr(target, "id", "")
        if name not in ("platform_function", "generic_platform_function"):
            continue
        inputs = next((k.value for k in decorator.keywords if k.arg == "inputs"), None)
        if not isinstance(inputs, (ast.List, ast.Tuple)):
            continue
        params = [a.arg for a in [*fn.args.posonlyargs, *fn.args.args]]
        return {
            param for param, declared in zip(params, inputs.elts, strict=False)
            if _is_broken_type(declared, aliases)
        }
    return set()


def _is_broken_type(node: ast.AST, aliases: set[str]) -> bool:
    """``VariantType(...)`` / ``OptionType(...)``, or a name aliasing one."""
    if isinstance(node, ast.Name):
        return node.id in aliases
    return (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
            and node.func.id in BROKEN_TYPES)


def _builds_broken_value(node: ast.AST) -> bool:
    if isinstance(node, ast.Name) and node.id == "none":
        return True
    return (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
            and node.func.id in BROKEN_CTORS)


def _is_broken_value(node: ast.AST, scopes: list[_Scope]) -> bool:
    if _builds_broken_value(node):
        return True
    if not isinstance(node, ast.Name):
        return False
    # python's rule: the innermost scope that binds the name owns it
    for scope in reversed(scopes):
        if node.id in scope.bound:
            return node.id in scope.broken
    return False


def _is_none_literal(node: ast.AST) -> bool:
    return isinstance(node, ast.Constant) and node.value is None
