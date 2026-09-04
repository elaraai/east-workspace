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

from east.codegen.doc import Doc, bracket, flat
from east.types.types import EastType

__all__ = ["type_source", "type_doc", "type_constructors", "TYPE_IMPORTS"]

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


def type_doc(t: EastType, scope: list[tuple[int, str]] | None = None) -> Doc:
    """The layout document of the python source rebuilding ``t``: a struct,
    variant or parameter list breaks one entry per line when the line it
    sits on would pass the width (``east.codegen.doc``). ``scope`` is the
    stack of enclosing recursive wrappers as ``(id, lambda parameter
    name)``."""
    scope = scope if scope is not None else []
    kind = t.type
    if kind in _PRIMITIVES:
        return _PRIMITIVES[kind]
    if kind in ("Array", "Set", "Ref", "Vector", "Matrix"):
        return [f"{kind}Type(", type_doc(t.value, scope), ")"]
    if kind == "Dict":
        return ["DictType(", type_doc(t.value["key"], scope), ", ", type_doc(t.value["value"], scope), ")"]
    if kind == "Struct":
        fields = [["(", repr(f["name"]), ", ", type_doc(f["type"], scope), ")"] for f in t.value]
        return ["StructType(", bracket("[", fields, "]"), ")"]
    if kind == "Variant":
        if _is_option(t):
            return ["OptionType(", type_doc(t.value[1]["type"], scope), ")"]
        cases = [["(", repr(c["name"]), ", ", type_doc(c["type"], scope), ")"] for c in t.value]
        return ["VariantType(", bracket("[", cases, "]"), ")"]
    if kind in ("Function", "AsyncFunction"):
        inputs = bracket("[", [type_doc(i, scope) for i in t.value["inputs"]], "]")
        return [f"{kind}Type(", inputs, ", ", type_doc(t.value["output"], scope), ")"]
    if kind == "Recursive":
        payload = t.value
        if payload.type == "ref":
            for rid, name in reversed(scope):
                if rid == payload.value:
                    return name
            raise ValueError(f"recursive ref {payload.value} outside its wrapper")
        rec_id = payload.value["id"]
        name = "self" if not scope else f"self{len(scope) + 1}"
        inner = type_doc(payload.value["inner"], [*scope, (rec_id, name)])
        return [f"recursive_type(lambda {name}: ", inner, ")"]
    raise ValueError(f"unknown type kind {kind}")


def type_source(t: EastType, scope: list[tuple[int, str]] | None = None) -> str:
    """The python source rebuilding ``t``, on one line. ``scope`` is the
    stack of enclosing recursive wrappers as ``(id, lambda parameter name)``."""
    return flat(type_doc(t, scope))


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
    """A structural key of a type: for deduplicating hoisted type constants
    and for matching a provider's declared type against a node's. Recursive
    scope ids are alpha-renamed, so a wrapper minted in this process keys
    equal to the same structure decoded from the wire under a foreign id."""
    from east.types.types import _alpha_key

    return repr(_alpha_key(t))
