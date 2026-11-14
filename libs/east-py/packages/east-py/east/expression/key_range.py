#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""A bound of a key range, as an expression writes it (#1616) — the twin of
TypeScript's ``expr/key_range.ts``: the arguments of ``range`` and ``prefix``
on a Dict and on a Set.

A bound is written as the whole key or, for a struct key, as its first fields:
``{"press": "P1"}``, ``{"press": "P1", "day": day}``. Its type is the key's
type cut short to the fields written, in the key's own order however the dict
lists them, and it is passed to the builtin as a type parameter. What is
written is checked here, where the function is built, by the rule every
runtime checks an IR by, and refused in its words.

One copy, which ``DictExpression`` and ``SetExpression`` both use.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.expression.errors import ExpressionError
from east.expression.lift import _coerce, _lift
from east.expression.location import location_id as _loc_id
from east.expression.nodes import _fits, _literal, _option_type, _type_words
from east.ir.builders import ir_variant
from east.key_bound import key_bound_refusal, written_bound_type
from east.types.types import EastType, NullType

if TYPE_CHECKING:
    from east.expression.expr import Expression


def key_bound(name: str, key_type: EastType, bound: Any) -> Expression:
    """A bound as it is written, as an expression of the key's type cut short.

    Args:
        name: Which bound: ``"from"`` or ``"to"`` of a range, or ``"prefix"``.
        key_type: The Dict's key type, or the Set's element type.
        bound: The bound as written.

    Returns:
        The bound's expression; its type is a type parameter of the builtin.

    Raises:
        ExpressionError: When the bound is no leading part of the key, or a
            prefix is written on a key that is not a struct, in the words
            every runtime refuses it in.
    """
    bound_type = written_bound_type(key_type, bound)
    refusal = key_bound_refusal(name, key_type, bound_type)
    if refusal is not None:
        raise ExpressionError(refusal)
    assert bound_type is not None  # a bound of no type is refused above
    lifted = _lift(bound, hint=bound_type)
    if lifted.east_type == bound_type:
        return lifted
    if not _fits(lifted.east_type, bound_type):
        want, got = _type_words(bound_type, lifted.east_type)
        spelling = "prefix" if name == "prefix" else "range"
        raise ExpressionError(f".{spelling}() takes {want}, got {got}")
    return _coerce(lifted, bound_type)


def key_range_end(name: str, key_type: EastType, bound: Any) -> tuple[EastType, Any]:
    """One end of a range as the range builtins take it.

    Args:
        name: Which end: ``"from"`` or ``"to"``.
        key_type: The Dict's key type, or the Set's element type.
        bound: The bound as written, or ``None`` for an end left out.

    Returns:
        The bound's type — the key's own for an end left out — and the
        Variant node of the option: ``some(bound)``, or ``none``.

    Raises:
        ExpressionError: When the bound is no leading part of the key.
    """
    if bound is None:
        return key_type, ir_variant(
            _option_type(key_type), "none", _literal(None, NullType), _loc_id())
    value = key_bound(name, key_type, bound)
    return value.east_type, ir_variant(
        _option_type(value.east_type), "some", value.ir, _loc_id())
