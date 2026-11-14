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

from east.types.types import EastType, StructType, is_type_equal


def written_bound_type(key_type: EastType, bound: Any) -> EastType | None:
    """The type of a bound as it is written.

    Args:
        key_type: The Dict's key type, or the Set's element type.
        bound: The bound: an expression, a struct written as a python dict or
            an East struct value, or any other value of the key's type.

    Returns:
        An expression's own type; for a struct written over a struct key, the
        key's type cut short to the fields it gives, in the key's order
        however they are written; for anything else, the key's type. ``None``
        for a struct whose fields are not the key's first.
    """
    from east.expression.expr import Expression
    from east.types.values import is_east_struct

    if isinstance(bound, Expression):
        return bound.east_type
    if key_type.type != "Struct":
        return key_type
    if isinstance(bound, dict):
        given = dict(bound)
    elif is_east_struct(bound):
        given = {name: bound[name] for name in bound}
    else:
        return key_type
    leading = key_type.value[: len(given)]
    if not given or any(field["name"] not in given for field in leading):
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
