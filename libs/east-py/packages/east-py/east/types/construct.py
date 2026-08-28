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
from typing import TYPE_CHECKING, Any, TypeVar, cast

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

if TYPE_CHECKING:
    from east.expression import Expression

R = TypeVar("R")


def _holds_traced(value: Any) -> bool:
    """Whether ``value`` is — or contains, at any depth — a traced expression.

    The dual-mode constructors decide by this whether they build IR or an
    eager value. A lazy import: the expression package imports this module.
    """
    from east.expression.lift import _holds_traced as _deep

    return _deep(value)


def variant(case: str, value: EastValue, typ: EastType | None = None) -> EastVariant | Expression:
    """Build a tagged variant value.

    If ``typ`` (a VariantType) is given, ``case`` must be one of its cases and
    ``value`` is coerced/validated against that case's type.

    Dual-mode, like ``struct``: a payload holding a traced expression makes
    this the Variant IR the builder emits. With ``typ`` the case and the
    payload's type are checked here; without it the untyped variant is
    returned for the surrounding context to type — the declared output, an
    ``East.if_else`` sibling or a typed struct field (#541) — exactly as on
    plain values.
    """
    if typ is not None and not is_variant_type(typ):
        raise EastTypeError(f"variant() type must be a VariantType, got {typ['type']}", expected=typ)
    if _holds_traced(value):
        if typ is None:
            return EastVariant(case, value)
        from east.expression import _lift

        return _lift(EastVariant(case, value), hint=typ)
    if typ is not None:
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


def match(v: EastVariant, cases: dict[str, Callable[[Any, Any], R]], default: R | None = None) -> R | None:
    """Dispatch on a variant's tag, calling the matching handler — a body,
    ``handler(b, value)`` with an eager block first — with its value.

    Returns ``default`` if no case matches — the one true gap versus the TS API.
    """
    handler = cases.get(v.type)
    if handler is None:
        return default
    from east.expression.statements import EagerBlock

    return handler(EagerBlock(), v.value)


def struct(fields: dict[str, EastValue], typ: EastType | None = None) -> EastStruct | Expression:
    """Build a struct value from a dict.

    If ``typ`` (a StructType) is given, fields are reordered to the type's order
    and each is coerced/validated (so an out-of-order or under-typed dict becomes
    a bridge-ready struct, or raises ``EastTypeError``).

    Dual-mode, like ``East.if_else``: a field holding a traced expression —
    at any depth, a nested dict or ``some(...)`` included — makes this the
    Struct IR a dict literal builds (``typ`` types the fields), so the same
    ``struct({...}, T)`` spelling works inside a captured callback and on
    plain values. Building an eager struct AROUND expression proxies is what
    that replaces — it would lift as a bogus build-time "constant" referencing
    the callback's own parameters.
    """
    if _holds_traced(fields):
        from east.expression import _lift

        ordered = dict(fields)
        if typ is not None:
            # Same contract as the eager path: the declared type fixes the
            # FIELD ORDER (a struct type is ordered), so a dict written in
            # another order must not produce a differently-typed struct just
            # because its values happened to be traced.
            if not is_struct_type(typ):
                raise EastTypeError(
                    f"struct() type must be a StructType, got {typ['type']}", expected=typ)
            names = [f["name"] for f in typ.value]
            missing = [n for n in names if n not in ordered]
            unknown = [k for k in ordered if k not in names]
            if missing or unknown:
                raise EastTypeError(
                    f"struct() fields do not match the declared type — "
                    f"missing {missing}, unknown {unknown}", expected=typ)
            ordered = {n: ordered[n] for n in names}
        return _lift(ordered, hint=typ)
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
