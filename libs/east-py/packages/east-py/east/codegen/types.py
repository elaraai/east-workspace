#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Printing East types as python builder source (#627).

``type_source(t)`` renders a type value as the python constructor expression
that rebuilds it — ``ArrayType(IntegerType)``, ``StructType([("a",
IntegerType)])``, ``OptionType(T)`` for the exact Option shape,
``recursive_type(lambda self: ...)`` for a recursive wrapper (nested wrappers
name their self-references ``self``, ``self2``, …). Recursive ``ref`` leaves
resolve to the enclosing wrapper's lambda parameter; a free ref (a type
fragment lifted out of its wrapper) is an error.
"""

from __future__ import annotations

from typing import Any

from east.types.types import EastType

__all__ = ["type_source", "type_constructors", "layout", "LINE_WIDTH", "TYPE_IMPORTS"]

#: The width past which a bracketed list breaks, one item per line.
LINE_WIDTH = 80


def layout(open_: str, items: list[str], close: str) -> str:
    """``open_`` + ``items`` + ``close`` on one line when that fits
    :data:`LINE_WIDTH` and no item breaks lines itself; otherwise one item per
    line, indented four spaces relative to the line the bracket opens on, the
    close back at the start — python's relative indentation, which every
    line emitter re-indents along with the line it sits in."""
    inline = f"{open_}{', '.join(items)}{close}"
    if not items or (len(inline) <= LINE_WIDTH and "\n" not in inline):
        return inline
    body = ",\n".join("    " + item.replace("\n", "\n    ") for item in items)
    return f"{open_}\n{body},\n{close}"

#: The names a printed module imports from ``east`` for type source.
TYPE_IMPORTS = (
    "NullType", "NeverType", "BooleanType", "IntegerType", "FloatType", "StringType",
    "DateTimeType", "BlobType", "ArrayType", "SetType", "DictType", "StructType",
    "VariantType", "OptionType", "RefType", "VectorType", "MatrixType", "FunctionType",
    "AsyncFunctionType",
)

_PRIMITIVES = {
    "Null": "NullType", "Never": "NeverType", "Boolean": "BooleanType",
    "Integer": "IntegerType", "Float": "FloatType", "String": "StringType",
    "DateTime": "DateTimeType", "Blob": "BlobType",
}


def _is_option(t: EastType) -> bool:
    if t.type != "Variant" or len(t.value) != 2:
        return False
    return (t.value[0]["name"] == "none" and t.value[0]["type"].type == "Null"
            and t.value[1]["name"] == "some")


def type_source(t: EastType, scope: list[tuple[int, str]] | None = None) -> str:
    """The python source rebuilding ``t``. ``scope`` is the stack of
    enclosing recursive wrappers as ``(id, lambda parameter name)``."""
    scope = scope if scope is not None else []
    kind = t.type
    if kind in _PRIMITIVES:
        return _PRIMITIVES[kind]
    if kind in ("Array", "Set", "Ref", "Vector", "Matrix"):
        return f"{kind}Type({type_source(t.value, scope)})"
    if kind == "Dict":
        return (f"DictType({type_source(t.value['key'], scope)}, "
                f"{type_source(t.value['value'], scope)})")
    if kind == "Struct":
        fields = [f"({f['name']!r}, {type_source(f['type'], scope)})" for f in t.value]
        return layout("StructType([", fields, "])")
    if kind == "Variant":
        if _is_option(t):
            return f"OptionType({type_source(t.value[1]['type'], scope)})"
        cases = [f"({c['name']!r}, {type_source(c['type'], scope)})" for c in t.value]
        return layout("VariantType([", cases, "])")
    if kind in ("Function", "AsyncFunction"):
        inputs = layout("[", [type_source(i, scope) for i in t.value["inputs"]], "]")
        return f"{kind}Type({inputs}, {type_source(t.value['output'], scope)})"
    if kind == "Recursive":
        payload = t.value
        if payload.type == "ref":
            for rid, name in reversed(scope):
                if rid == payload.value:
                    return name
            raise ValueError(f"recursive ref {payload.value} outside its wrapper")
        rec_id = payload.value["id"]
        name = "self" if not scope else f"self{len(scope) + 1}"
        inner = type_source(payload.value["inner"], [*scope, (rec_id, name)])
        return f"recursive_type(lambda {name}: {inner})"
    raise ValueError(f"unknown type kind {kind}")


def type_constructors(t: EastType, into: set[str]) -> None:
    """Adds to ``into`` the constructor names ``type_source(t)`` spells —
    what a printed module must import for the type. A walk over the type,
    case for case with :func:`type_source`."""
    kind = t.type
    if kind in _PRIMITIVES:
        into.add(_PRIMITIVES[kind])
        return
    if kind in ("Array", "Set", "Ref", "Vector", "Matrix"):
        into.add(f"{kind}Type")
        type_constructors(t.value, into)
        return
    if kind == "Dict":
        into.add("DictType")
        type_constructors(t.value["key"], into)
        type_constructors(t.value["value"], into)
        return
    if kind == "Struct":
        into.add("StructType")
        for f in t.value:
            type_constructors(f["type"], into)
        return
    if kind == "Variant":
        if _is_option(t):
            into.add("OptionType")
            type_constructors(t.value[1]["type"], into)
            return
        into.add("VariantType")
        for c in t.value:
            type_constructors(c["type"], into)
        return
    if kind in ("Function", "AsyncFunction"):
        into.add(f"{kind}Type")
        for i in t.value["inputs"]:
            type_constructors(i, into)
        type_constructors(t.value["output"], into)
        return
    if kind == "Recursive":
        payload = t.value
        if payload.type == "wrapper":
            into.add("recursive_type")
            type_constructors(payload.value["inner"], into)
        return
    raise ValueError(f"unknown type kind {kind}")


def type_key(t: Any) -> str:
    """A structural key for deduplicating hoisted type constants."""
    from east.expression.nodes import _type_key

    return _type_key(t)
