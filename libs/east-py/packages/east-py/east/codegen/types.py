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

__all__ = ["type_source", "TYPE_IMPORTS"]

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
        fields = ", ".join(f"({f['name']!r}, {type_source(f['type'], scope)})" for f in t.value)
        return f"StructType([{fields}])"
    if kind == "Variant":
        if _is_option(t):
            return f"OptionType({type_source(t.value[1]['type'], scope)})"
        cases = ", ".join(f"({c['name']!r}, {type_source(c['type'], scope)})" for c in t.value)
        return f"VariantType([{cases}])"
    if kind in ("Function", "AsyncFunction"):
        inputs = ", ".join(type_source(i, scope) for i in t.value["inputs"])
        return f"{kind}Type([{inputs}], {type_source(t.value['output'], scope)})"
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


def type_key(t: Any) -> str:
    """A structural key for deduplicating hoisted type constants."""
    from east.expression.nodes import _type_key

    return _type_key(t)
