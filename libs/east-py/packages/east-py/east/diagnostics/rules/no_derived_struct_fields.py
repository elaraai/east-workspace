#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""``no-derived-struct-fields``: an East TYPE DECLARATION whose fields are
computed from another type — ``Derived = StructType([f for f in Other.value])``
and its relatives.

A type declaration is a wire format. It is read by every other runtime, it is
what a beast2 file means, and it is the thing a reviewer checks a migration
against. Derived from a comprehension it can only be read by running it, the
field ORDER depends on iteration order, and a change to the source type
silently rewrites the wire format of the derived one. Spell the fields.
"""

from __future__ import annotations

import ast

from east.diagnostics.types import Body, Context

MESSAGE = ("this type's fields are computed from another type — a type declaration is a wire "
           "format, and derived this way it cannot be read here, its field order follows "
           "iteration order, and a change upstream silently rewrites it. Spell the fields out")

#: the type constructors whose argument declares a wire format
TYPE_CTORS = frozenset({"StructType", "VariantType", "DictValueTypeDef"})
_COMPREHENSIONS = (ast.ListComp, ast.DictComp, ast.SetComp, ast.GeneratorExp)


class NoDerivedStructFields:
    name = "no-derived-struct-fields"
    code = 25
    category = "warning"
    # Disjoint by construction: this rule reports a type DECLARATION, while
    # `no-python-east-data` reports the comprehension that assembles rows for a
    # body. Declaring the relation here was dead — the ranges never overlap.
    supersedes: tuple[str, ...] = ()
    description = "No East type whose fields are computed from another type — spell them out."

    def check(self, body: Body, ctx: Context) -> None:
        del body, ctx  # a DECLARATION is module scope; see check_module

    def check_module(self, ctx: Context) -> None:
        # Only a named type DECLARATION. A function computing a type from its
        # argument — generic substitution, runtime type inference — is the type
        # system doing its job, not a wire format written unreadably, so the
        # rule looks for the binding rather than the constructor.
        for node in ctx.tree.body:
            if isinstance(node, ast.Assign) or isinstance(node, ast.AnnAssign) and node.value is not None:
                value = node.value
            else:
                continue
            if _derived(value):
                ctx.report(value, self, MESSAGE)


def _derived(node: ast.AST) -> bool:
    """A type constructor whose argument is a comprehension, or a starred
    comprehension inside its argument list."""
    if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
            and node.func.id in TYPE_CTORS):
        return False
    for arg in node.args:
        if isinstance(arg, _COMPREHENSIONS):
            return True
        if isinstance(arg, ast.Starred) and isinstance(arg.value, _COMPREHENSIONS):
            return True
        if isinstance(arg, (ast.List, ast.Tuple)) and any(
                isinstance(e, ast.Starred) and isinstance(e.value, _COMPREHENSIONS) for e in arg.elts):
            return True
    return False
