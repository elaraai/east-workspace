#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-deprecated-alias``: a python-idiom spelling the surface keeps as a
warning-and-delegate alias (``.fold()`` for ``.reduce()``, ``.is_subset()``
for ``.is_subset_of()``, ``East.Boolean.and_`` for ``bit_and``…). The
canonical name is the TypeScript one.

The alias → canonical map is read off the surface itself: every deprecated
method — on an expression class, an eager value class, or an ``East.<Type>``
namespace — documents itself as ``Deprecated alias of :meth:`target```, so
this rule carries no table. A name that is canonical on any class (Array's
``flat_map``, an alias only on Set/Dict) is never flagged: the receiver's
type is the build's to know.
"""

from __future__ import annotations

import ast
import inspect
import re
from functools import cache

from east.diagnostics.scope import is_east_ref
from east.diagnostics.types import Body, Context, body_nodes

_DOC = re.compile(r"Deprecated alias of (?::meth:)?`+([\w.]+)(?:\([^)]*\))?`+")


def _target(member: object) -> str | None:
    doc = inspect.getdoc(getattr(member, "__func__", member)) or ""
    m = _DOC.match(doc)
    return m.group(1) if m else None


@cache
def method_aliases() -> dict[str, str]:
    """``{alias: canonical}`` for method names deprecated on every class that
    defines them, over the expression and eager value classes."""
    import sys

    found: dict[str, str] = {}
    canonical: set[str] = set()
    modules = [m for n, m in list(sys.modules.items())
               if n.startswith("east.expression.expr") or n.startswith("east.types.values")]
    for module in modules:
        for cls in list(vars(module).values()):
            if not inspect.isclass(cls) or cls.__module__ != module.__name__:
                continue
            for name, member in vars(cls).items():
                if name.startswith("_") or not callable(getattr(member, "__func__", member)):
                    continue
                target = _target(member)
                if target is None:
                    canonical.add(name)
                else:
                    found.setdefault(name, target)
    return {alias: target for alias, target in found.items() if alias not in canonical}


@cache
def namespace_aliases() -> dict[tuple[str, str], str]:
    """``{(namespace, alias): canonical}`` over the ``East.<Type>`` namespaces."""
    from east.namespace import East

    found: dict[tuple[str, str], str] = {}
    for ns_name, ns in vars(type(East)).items():
        if ns_name.startswith("_") or not hasattr(ns, "__class__") or inspect.isroutine(ns):
            continue
        cls = ns if inspect.isclass(ns) else type(ns)
        if cls.__module__ != "east.namespace":
            continue
        for name, member in vars(cls).items():
            if name.startswith("_"):
                continue
            target = _target(member)
            if target is not None:
                found[(ns_name, name)] = target
    return found


def _spell(target: str, receiver: str) -> str:
    return f"{target}()" if "." in target else f"{receiver}{target}()"


class NoDeprecatedAlias:
    name = "no-deprecated-alias"
    code = 8
    category = "warning"
    description = "A deprecated python-idiom alias — the spelling is the TypeScript name."

    def check(self, body: Body, ctx: Context) -> None:
        methods = method_aliases()
        namespaces = namespace_aliases()
        for node in body_nodes(body):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
                continue
            attr, receiver = node.func.attr, node.func.value
            if attr in methods and body.is_expression(receiver):
                ctx.report(node.func, self,
                           f".{attr}() is deprecated: the spelling is {_spell(methods[attr], '.')} (the TypeScript name)")
            elif isinstance(receiver, ast.Attribute) and is_east_ref(receiver.value, ctx) \
                    and (receiver.attr, attr) in namespaces:
                target = namespaces[(receiver.attr, attr)]
                ctx.report(node.func, self,
                           f"East.{receiver.attr}.{attr}() is deprecated: the spelling is "
                           f"{_spell(target, f'East.{receiver.attr}.')} (the TypeScript name)")
