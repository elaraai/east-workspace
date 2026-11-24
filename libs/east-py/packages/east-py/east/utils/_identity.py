#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""East's identity of a container value, and the marks a comparison keeps by it.

``is_for`` asks whether two mutable values are one. ``equal_for`` and
``compare_for`` (``ordering.py``, and its Cython twin ``_ordering_cy.pyx``)
mark each pair of containers they compare where a value of the type can hold
itself — an Array, a Dict or a Ref whose type holds a recursive type — and
count a pair met again equal: it is still being compared further up, a cycle,
or it compared equal, since a pair that differs ends the comparison.

Each asks East's identity of a value, which Python's ``id`` is not for a value
east-c holds. Every read of a C-backed container (``EastArrayProxy``,
``EastSetProxy``, ``EastDictProxy``, ``EastRefProxy``) is a new Python object
over the same C value, freed once the read is done, and CPython hands a freed
object's ``id`` to the next object made. Marked by ``id``, a cycle through
such a value was never met again, so comparing a value that holds itself never
ended; and a pair compared and freed lent its mark to the next pair, so
``equal_for`` called ``[{"k": 0}, {"k": 1}]`` equal to ``[{"k": 0}, {"k": 99}]``.
A mark holds the objects it was keyed by, so neither id nor C value is handed
on while the comparison runs: a live paged collection decodes its parts afresh,
each read a C value of its own. A struct or a variant is never marked: a read
of one from an array is a new object too, and no cycle passes through it alone.
"""

from __future__ import annotations

from typing import Any

from east.types.types import (
    is_array_type,
    is_dict_type,
    is_recursive_type,
    is_ref_type,
    is_set_type,
    is_struct_type,
    is_variant_type,
)

#: The pairs one comparison has met: the identity of each ``x`` → that ``x``,
#: and the identity of each ``y`` it was compared with → that ``y``.
Marks = dict[int, tuple[Any, dict[int, Any]]]


def east_identity(value: Any) -> int:
    """East's identity of a container value.

    Args:
        value: An Array, Set, Dict, Ref, Vector or Matrix value

    Returns:
        The address of the C value east-c holds it in, which every Python
        object read over that value shares; for a value Python holds, its
        ``id``
    """
    ptr = getattr(value, "_c_ptr", None)
    return id(value) if ptr is None else ptr


def same_value(x: Any, y: Any, _ctx: Any = None) -> bool:
    """Whether two mutable values are one value: East's ``is`` on them.

    Args:
        x: An Array, Set, Dict, Ref, Vector or Matrix value
        y: A value of the same type
        _ctx: Unused; the comparers' common signature

    Returns:
        True when the two are one value, however many Python objects read it
    """
    return x is y or east_identity(x) == east_identity(y)


def type_can_cycle(type_val: Any) -> bool:
    """Whether a value of a type can hold itself: whether the type holds a recursive type.

    Args:
        type_val: An East type

    Returns:
        True when a recursive type stands anywhere in it, through its elements,
        keys, values, fields and cases
    """
    if is_recursive_type(type_val):
        return True
    if is_array_type(type_val) or is_set_type(type_val) or is_ref_type(type_val):
        return type_can_cycle(type_val.value)
    if is_dict_type(type_val):
        return type_can_cycle(type_val.value["key"]) or type_can_cycle(type_val.value["value"])
    if is_struct_type(type_val) or is_variant_type(type_val):
        return any(type_can_cycle(part["type"]) for part in type_val.value)
    return False


def pair_met(ctx: Marks, x: Any, y: Any) -> bool:
    """Whether comparing container ``x`` with ``y`` is already answered, marking the pair if not.

    The pair is answered, and counts equal, when the two are one value or
    when this comparison met the pair before.

    Args:
        ctx: The comparison's marks
        x: An Array, Dict or Ref value
        y: A value of the same type

    Returns:
        True when the pair counts equal without being compared; False, the
        pair now marked, when it is to be compared
    """
    kx = east_identity(x)
    ky = east_identity(y)
    if kx == ky:
        return True
    held = ctx.get(kx)
    if held is None:
        ctx[kx] = (x, {ky: y})
        return False
    met = held[1]
    if ky in met:
        return True
    met[ky] = y
    return False
