#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""A bound of a key range (#1616): a leading part of a Dict's key or a Set's
element — the twin of TypeScript's ``key_bound.ts`` and ``expr/key_range.ts``.

A key's fields, in the key type's order and through nested structs, are its
leaves. A bound gives the first leaves and stops: ``{"press": "P1"}``,
``{"press": "P1", "day": day}``, or the whole key. Its type is the key's type
cut short — for a struct key, a struct of its first fields in order, each of
the key's own type but the last, which may be cut short the same way; for any
other key, the key's type.

The rule itself is east-c's, which the range builtins run by: a bound's type
is refused here in east-c's own words, so python, C and TypeScript refuse one
bound alike. One copy for python: the expression methods and the eager values'
both read it here.
"""

from __future__ import annotations

from typing import Any

from east.types.types import EastType, StructType, is_subtype, is_type_equal


def _widened_bound_type(key_type: EastType, written: EastType) -> EastType:
    """An expression bound's type as the key reads it: the key's own where the
    expression's is a subtype of it — a variant written as one case is a
    variant of that case alone — and, for a struct of a struct key's first
    fields, each field's widened the same way, so the bound is widened as a
    key a keyed read is given is. Any other type is the expression's own,
    which the bound's check refuses or takes. TypeScript's
    ``widenedBoundType``.

    Args:
        key_type: The key's type, or a key field's.
        written: The expression's type.

    Returns:
        The type the bound is read at.
    """
    if is_subtype(written, key_type):
        return key_type
    if key_type.type != "Struct" or written.type != "Struct":
        return written
    key_fields = {field["name"]: field["type"] for field in key_type.value}
    # In the expression's own order: a field the key does not hold keeps its
    # type, for the check to refuse.
    return StructType([
        (field["name"],
         _widened_bound_type(key_fields[field["name"]], field["type"])
         if field["name"] in key_fields else field["type"])
        for field in written.value
    ])


def written_bound_type(key_type: EastType, bound: Any) -> EastType | None:
    """The type of a bound as it is written.

    Args:
        key_type: The Dict's key type, or the Set's element type.
        bound: The bound: an expression, a struct written as a python dict or
            an East struct value, or any other value of the key's type.

    Returns:
        An expression's own type, widened to the key's where it is a subtype
        of it; for a struct written over a struct key, the key's type cut
        short to the fields it gives, in the key's order however they are
        written; for anything else, the key's type. ``None`` for a struct
        whose fields are not the key's first fields — one the key's first
        fields leave out, or one they do not hold.
    """
    from east.expression.expr import Expression
    from east.types.values import is_east_struct

    if isinstance(bound, Expression):
        return _widened_bound_type(key_type, bound.east_type)
    if key_type.type != "Struct":
        return key_type
    if isinstance(bound, dict):
        given = dict(bound)
    elif is_east_struct(bound):
        given = {name: bound[name] for name in bound}
    else:
        return key_type
    leading = key_type.value[: len(given)]
    # The names given are the key's first fields, every one of them: none left
    # out, and none the key's first fields do not hold.
    if not given or set(given) != {field["name"] for field in leading}:
        return None
    fields: list[tuple[str, EastType]] = []
    for index, field in enumerate(leading):
        cut = written_bound_type(field["type"], given[field["name"]])
        if cut is None:
            return None
        # Only the last field a bound gives may be cut short: each before it is written whole.
        if index < len(leading) - 1 and not is_type_equal(cut, field["type"]):
            return None
        fields.append((field["name"], cut))
    return StructType(fields)


def key_bound_refusal(name: str, key_type: EastType, bound_type: EastType | None) -> str | None:
    """Why a bound is refused, in the words every runtime says.

    Args:
        name: Which bound: ``"from"`` or ``"to"`` of a range, or ``"prefix"``.
        key_type: The Dict's key type, or the Set's element type.
        bound_type: The bound's type; ``None`` for one whose fields are not
            the key's first.

    Returns:
        The refusal, or ``None`` for a bound that is a leading part of the
        key. A prefix is the first fields of a struct key, so on any other key
        it is refused whatever its type.
    """
    from east._eastc_bridge import key_bound_refusal as refusal

    return refusal(name, key_type, bound_type)
