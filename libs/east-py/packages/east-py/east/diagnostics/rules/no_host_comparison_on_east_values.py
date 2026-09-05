#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-host-comparison-on-east-values``: python ``==`` / ``<`` on a decoded
East VARIANT or OPTION compares the wrong thing — two equal variants are
different objects, and ordering compares a representation rather than the
value. ``equal_for(T)`` and ``compare_for(T)`` are the spellings, and
``make_east_key(T)`` for ``sorted``.

Scoped exactly as the TypeScript rule is: only the shapes whose host
comparison is broken. A decoded ``IntegerType`` is a python ``int`` and
``a < b`` on it is correct, so scalars are never flagged. And only OUTSIDE a
body — inside one the same operators build East comparisons, which is right.
"""

from __future__ import annotations

import ast

from east.diagnostics.types import Body, Context

EQUALITY_MESSAGE = ("python equality on a decoded East variant/option compares object identity — "
                    "two equal variants are never `==`. Use equal_for(T)(a, b)")
ORDER_MESSAGE = ("python ordering on a decoded East variant/option compares the wrong "
                 "representation — use compare_for(T) / less_for(T) (and make_east_key(T) for sorted)")

#: the type constructors whose decoded value does not compare in python
BROKEN_TYPES = frozenset({"VariantType", "OptionType"})
#: the value constructors that build one
BROKEN_CTORS = frozenset({"variant", "some"})

_EQUALITY = (ast.Eq, ast.NotEq)
_ORDER = (ast.Lt, ast.LtE, ast.Gt, ast.GtE)


class NoHostComparisonOnEastValues:
    name = "no-host-comparison-on-east-values"
    code = 18
    category = "warning"
    supersedes: tuple[str, ...] = ()
    description = ("No python == / < on a decoded East variant or option outside a body — "
                   "equal_for(T) / compare_for(T).")

    def check(self, body: Body, ctx: Context) -> None:
        # Module scope only: inside a body these operators build East
        # comparisons, which is exactly right.
        del body, ctx

    def check_module(self, ctx: Context) -> None:
        names = _variant_valued_names(ctx)
        for node in ast.walk(ctx.tree):
            if not isinstance(node, ast.Compare) or ctx.in_body(node):
                continue
            operands = [node.left, *node.comparators]
            if not any(_is_broken_value(o, names) for o in operands):
                continue
            if any(_is_none_literal(o) for o in operands):
                continue  # `v == None` is a presence check
            for op in node.ops:
                if isinstance(op, _EQUALITY):
                    ctx.report(node, self, EQUALITY_MESSAGE)
                    break
                if isinstance(op, _ORDER):
                    ctx.report(node, self, ORDER_MESSAGE)
                    break


def _variant_valued_names(ctx: Context) -> set[str]:
    """Names that hold a decoded variant/option: bound from ``variant(...)`` /
    ``some(...)`` / ``none``, or a ``@platform_function`` input declared with a
    ``VariantType`` / ``OptionType`` (directly, or through a module-level type
    alias)."""
    aliases = {
        target.id
        for node in ctx.tree.body
        if isinstance(node, ast.Assign) and _is_broken_type(node.value, set())
        for target in node.targets
        if isinstance(target, ast.Name)
    }
    names: set[str] = set()
    for node in ast.walk(ctx.tree):
        if isinstance(node, ast.Assign) and _builds_broken_value(node.value):
            names.update(t.id for t in node.targets if isinstance(t, ast.Name))
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            names.update(_broken_params(node, aliases))
    return names


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


def _is_broken_value(node: ast.AST, names: set[str]) -> bool:
    if _builds_broken_value(node):
        return True
    return isinstance(node, ast.Name) and node.id in names


def _is_none_literal(node: ast.AST) -> bool:
    return isinstance(node, ast.Constant) and node.value is None
