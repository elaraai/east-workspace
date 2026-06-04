#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Ergonomic, validating constructors for East values from plain Python.

These mirror the TypeScript ``variant()``/``some``/``none`` helpers so the
workspace rule "never hand-roll variants" has a Python equivalent, and add
``match``, ``struct``, and ``array`` so the painful ``Array<Struct>`` shape is
built from native Python and validated at construction:

    array(LineItem, [{"name": "a", "price": 1.0}, ...])   # dicts coerced

When a target type is supplied, each constructor validates/coerces against it
(reordering struct fields, picking the right Integer-vs-Float, …) and raises
``EastTypeError`` on a mismatch.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import Any, TypeVar, cast

from east.types.coercion import EastTypeError, coerce_to
from east.types.types import (
    EastType,
    is_struct_type,
    is_variant_type,
)
from east.types.values import (
    EastArray,
    EastStruct,
    EastValue,
    EastVariant,
    east_null,
)

R = TypeVar("R")


def variant(case: str, value: EastValue, typ: EastType | None = None) -> EastVariant:
    """Build a tagged variant value.

    If ``typ`` (a VariantType) is given, ``case`` must be one of its cases and
    ``value`` is coerced/validated against that case's type.
    """
    if typ is not None:
        if not is_variant_type(typ):
            raise EastTypeError(f"variant() type must be a VariantType, got {typ['type']}", expected=typ)
        case_type = next((c["type"] for c in typ.value if c["name"] == case), None)
        if case_type is None:
            names = ", ".join(c["name"] for c in typ.value)
            raise EastTypeError(f"variant case {case!r} not in {{{names}}}", value=value, expected=typ)
        value = coerce_to(value, case_type, path=f"$.{case}")
    return EastVariant(case, value)


def some(value: EastValue) -> EastVariant:
    """Build a ``some`` option variant wrapping ``value``."""
    return EastVariant("some", value)


# ``none`` is a value, not a call (mirrors the TS ``none`` constant).
none: EastVariant = EastVariant("none", east_null)


def match(v: EastVariant, cases: dict[str, Callable[[Any], R]], default: R | None = None) -> R | None:
    """Dispatch on a variant's tag, calling the matching handler with its value.

    Returns ``default`` if no case matches — the one true gap versus the TS API.
    """
    handler = cases.get(v.type)
    return default if handler is None else handler(v.value)


def struct(fields: dict[str, EastValue], typ: EastType | None = None) -> EastStruct:
    """Build a struct value from a dict.

    If ``typ`` (a StructType) is given, fields are reordered to the type's order
    and each is coerced/validated (so an out-of-order or under-typed dict becomes
    a bridge-ready struct, or raises ``EastTypeError``).
    """
    if typ is None:
        return EastStruct(dict(fields))
    if not is_struct_type(typ):
        raise EastTypeError(f"struct() type must be a StructType, got {typ['type']}", expected=typ)
    return cast(EastStruct, coerce_to(fields, typ))


def array(element_type: EastType, items: Iterable[Any], *, validate: bool = True) -> EastArray:
    """Build an array, coercing each item to ``element_type`` (unless ``validate=False``)."""
    if validate:
        coerced = [coerce_to(item, element_type, path=f"$[{i}]") for i, item in enumerate(items)]
    else:
        coerced = list(items)
    return EastArray(element_type, coerced)


__all__ = [
    "variant",
    "some",
    "none",
    "match",
    "struct",
    "array",
]
