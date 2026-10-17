#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""IR node construction for the tracer, plus the small type predicates the
whole package shares.

Two flavours of constructor live here. The ``ir_*`` builders in
``east.ir.builders`` are the canonical ones (scalar children keep object
identity); the ``_k_*`` twins below hold ARRAY children in plain python lists
during tracing, because ``EastArray`` is a C-backed proxy whose every read
materializes a fresh python object — node identity, which the passes in
``east.expression.finalize`` walk by (a subtree the trace shared is rebuilt
once; an embedded function is re-homed and renamed in place), would die at
each array boundary. One finalize pass converts those lists to real
``EastArray``s.
"""

from __future__ import annotations

import itertools
from typing import Any

from east.expression.errors import ExpressionError
from east.expression.location import location_id as _loc_id
from east.ir.builders import ir_value, ir_variable
from east.types.type_of_type import EastTypeType
from east.types.types import EastType, is_subtype, is_type_equal
from east.types.values import EastStruct, EastVariant

# ─── Homoiconic IR construction (#398) ──────────────────────────────────────
#
# Every node is an East value conforming to IRType from the moment it is
# constructed (east/ir/builders.py), so malformed IR is unrepresentable and
# compilation converts the value tree directly (compile_from_value) with no
# serialization round-trip. Every node built inside a build carries the
# loc_id of the python frames that built it (east/expression/location.py,
# #626) — the same authoring-frame source map the TypeScript builders attach
# — so a runtime error names the python file:line of its expression; a node
# built outside any build (an internal helper function) carries 0.


def _type_key(t: EastType) -> str:
    """A stable string key for a type (helper-function memoization)."""
    from east.serialization.json import encode_json_for

    encoded = encode_json_for(EastTypeType)(t)
    return encoded.decode("utf-8") if isinstance(encoded, bytes) else encoded


def _fits(value_t: EastType, slot_t: EastType) -> bool:
    """Whether a value of ``value_t`` may fill a slot of ``slot_t``: the
    type itself (two copies of one recursive type included) or a subtype of
    it, as the TypeScript builder admits an argument."""
    return value_t == slot_t or is_type_equal(value_t, slot_t) or is_subtype(value_t, slot_t)


def _type_words(expected: EastType, got: EastType) -> tuple[str, str]:
    """Words for the East type a slot takes and the one it was given: their
    kinds (``String``, ``Integer``), or, when the kinds agree (a ``Struct``
    and a ``Struct``), each type in East's syntax, so a refusal shows what
    differs."""
    if expected.type != got.type:
        return expected.type, got.type
    from east.serialization.east_printer import print_type

    try:
        return print_type(expected), print_type(got)
    except Exception:  # pragma: no cover - a printer failure must not mask the refusal
        return expected.type, got.type


def _var(name: str, t: EastType):
    return ir_variable(t, name, _loc_id())


def _builtin(name: str, out: EastType, type_params: list[EastType], args: list):
    return _k_builtin(name, out, type_params, args)


def _literal(value: Any, t: EastType):
    """A Value node holding a literal, coerced per the declared East type."""
    tag = t.type
    coerced: Any
    if tag == "Null":
        coerced = None
    elif tag == "Boolean":
        coerced = bool(value)
    elif tag == "Integer":
        coerced = int(value)
    elif tag == "Float":
        coerced = float(value)
    elif tag == "String":
        coerced = str(value)
    elif tag == "DateTime":
        # a python datetime IS the East DateTime value — nothing to cast
        coerced = value
    elif tag == "Blob":
        coerced = bytes(value)
    else:
        raise ExpressionError(f"cannot embed a literal of East type {tag} in an East function body")
    return ir_value(t, coerced, _loc_id())

#: The builtins that MUTATE their first argument — what makes a built function
#: effectful (``function._effectful``), so a call of it thrown away is named
#: as a mutation thrown away is (#565).
_MUTATING_BUILTINS = frozenset({
    "RefUpdate", "RefMerge",
    "ArrayPushLast", "ArrayPopLast", "ArrayPushFirst", "ArrayPopFirst",
    "ArrayUpdate", "ArrayMerge", "ArrayMergeAll", "ArrayAppend", "ArrayPrepend",
    "ArrayClear", "ArraySortInPlace", "ArrayReverseInPlace",
    "SetInsert", "SetTryInsert", "SetDelete", "SetTryDelete", "SetUnionInPlace",
    "SetClear",
    "DictInsert", "DictInsertOrUpdate", "DictGetOrInsert", "DictUpdate",
    "DictSwap", "DictMerge", "DictMergeAll", "DictDelete", "DictTryDelete",
    "DictPop", "DictClear", "DictUnionInPlace",
    "VectorSet", "MatrixSet",
})


def _option_type(inner: EastType) -> EastType:
    from east.types.types import OptionType

    return OptionType(inner)


def _is_option(t: EastType) -> bool:
    if t.type != "Variant" or len(t.value) != 2:
        return False
    return t.value[0]["name"] == "none" and t.value[1]["name"] == "some"


def _option_inner(t: EastType) -> EastType:
    return t.value[1]["type"]


# ─── Nested lambdas + the eager-builtin funnel (#393) ───────────────────────

_fresh_names = itertools.count()


def _fresh_name() -> str:
    """A trace-unique variable name so nested lambdas never shadow outer
    parameters (`split(...).map(lambda v: v + r.id)` must keep `r` visible
    inside the inner function's body)."""
    return f"__n{next(_fresh_names)}"

# ─── Lazy node construction (identity-preserving, #411) ─────────────────────
#
# EastArray is a C-backed proxy: pushing a child converts it and every read
# materializes a FRESH python object — node identity (what the finalize
# passes walk by) dies at every array boundary. During tracing, array-bearing
# nodes therefore hold their children in plain python lists; one finalize
# pass (_arrayify_tree) converts every list to the proper EastArray in one
# rebuild, a shared subtree rebuilt once. Scalar-child nodes use the shared
# builders directly — EastStruct fields keep object identity.


#: ``(builtin_inputs, FN)`` from ``east.runtime.builtin_signatures``, read on
#: the first builtin built (its table imports types this module must not).
_signatures: Any = None

#: Each builtin's slots by its name and type parameters, which hash and
#: compare as the types they are: building one is a table lookup and a type
#: per slot, built for every node a body builds otherwise.
_SLOTS_MAX = 4096
_slots_memo: dict[tuple, list | None] = {}


def _builtin_slots(name: str, type_params: list) -> list | None:
    """The builtin's declared inputs, instanced with its type parameters —
    an East type per slot, ``None`` for a Function-typed slot — or ``None``
    when the table does not know the builtin or its type parameters. The
    list is shared: read it, never change it."""
    key = (name, tuple(type_params))
    hit = _slots_memo.get(key, _slots_memo)
    if hit is not _slots_memo:
        return hit
    global _signatures
    if _signatures is None:
        from east.runtime.builtin_signatures import FN, builtin_inputs

        _signatures = (builtin_inputs, FN)
    inputs_of, fn_slot = _signatures
    try:
        slots = [None if t is fn_slot else t for t in inputs_of(name, list(type_params))]
    except TypeError:
        slots = None
    if len(_slots_memo) >= _SLOTS_MAX:
        _slots_memo.clear()
    _slots_memo[key] = slots
    return slots


def _typed_arguments(name: str, type_params: list, args: list) -> list:
    """``args`` held to the builtin's declared inputs, as the TypeScript
    lowering coerces every builtin argument to its signature: an argument of
    its slot's type, or of a subtype widened to it, and any other refused
    here, naming the builtin (#1316). east-c reads each argument as its
    declared input, so one of another type is a wrong answer, garbage stored
    or a crash. A builtin the table does not know, or a call of another
    arity, is the analyzer's to name."""
    slots = _builtin_slots(name, type_params)
    if slots is None or len(slots) != len(args):
        return list(args)
    typed = list(args)
    for i, (node, want) in enumerate(zip(args, slots, strict=True)):
        if want is None:
            continue
        got = node.value["type"]
        if got == want:
            continue
        if not _fits(got, want):
            w, g = _type_words(want, got)
            raise ExpressionError(f"{name}: argument {i + 1} takes {w}, got {g}")
        from east.expression.expr import Expression
        from east.expression.lift import _coerce

        typed[i] = _coerce(Expression(node, got), want).ir
    return typed


def _k_builtin(name: str, out: EastType, type_params: list, args: list):
    return EastVariant("Builtin", EastStruct({
        "type": out, "loc_id": _loc_id(), "builtin": name,
        "type_parameters": list(type_params),
        "arguments": _typed_arguments(name, type_params, args),
    }))


def _k_function(fn_t: EastType, captures: list, params: list, body):
    return EastVariant("Function", EastStruct({
        "type": fn_t, "loc_id": _loc_id(), "captures": list(captures),
        "parameters": list(params), "body": body,
    }))


def _k_async_function(fn_t: EastType, captures: list, params: list, body):
    return EastVariant("AsyncFunction", EastStruct({
        "type": fn_t, "loc_id": _loc_id(), "captures": list(captures),
        "parameters": list(params), "body": body,
    }))


def _k_platform(name: str, out: EastType, args: list, is_async: bool,
                type_params: list | None = None, optional: bool = False):
    return EastVariant("Platform", EastStruct({
        "type": out, "loc_id": _loc_id(), "name": name,
        "type_parameters": list(type_params or []), "arguments": list(args),
        "async": is_async, "optional": bool(optional),
    }))


def _k_block(t: EastType, statements: list):
    return EastVariant("Block", EastStruct({
        "type": t, "loc_id": _loc_id(), "statements": list(statements),
    }))

def _k_match(t: EastType, subject, cases: list):
    return EastVariant("Match", EastStruct({
        "type": t, "loc_id": _loc_id(), "variant": subject,
        "cases": [EastStruct({"case": c, "variable": v, "body": b}) for c, v, b in cases],
    }))


def _k_new_array(t: EastType, values: list):
    return EastVariant("NewArray", EastStruct({
        "type": t, "loc_id": _loc_id(), "values": list(values),
    }))


def _k_new_vector(t: EastType, values: list):
    return EastVariant("NewVector", EastStruct({
        "type": t, "loc_id": _loc_id(), "values": list(values),
    }))


def _k_new_matrix(t: EastType, rows: int, cols: int, values: list):
    return EastVariant("NewMatrix", EastStruct({
        "type": t, "loc_id": _loc_id(), "values": list(values), "rows": rows, "cols": cols,
    }))


def _k_new_set(t: EastType, values: list):
    return EastVariant("NewSet", EastStruct({
        "type": t, "loc_id": _loc_id(), "values": list(values),
    }))


def _k_new_dict(t: EastType, entries: list):
    return EastVariant("NewDict", EastStruct({
        "type": t, "loc_id": _loc_id(),
        "values": [EastStruct({"key": k, "value": v}) for k, v in entries],
    }))


def _k_struct(t: EastType, fields: list):
    return EastVariant("Struct", EastStruct({
        "type": t, "loc_id": _loc_id(),
        "fields": [EastStruct({"name": n, "value": v}) for n, v in fields],
    }))


def _k_ifelse(t: EastType, ifs: list, else_body):
    return EastVariant("IfElse", EastStruct({
        "type": t, "loc_id": _loc_id(),
        "ifs": [EastStruct({"predicate": p, "body": b}) for p, b in ifs],
        "else_body": else_body,
    }))


def _k_call(t: EastType, function, arguments: list):
    return EastVariant("Call", EastStruct({
        "type": t, "loc_id": _loc_id(), "function": function, "arguments": list(arguments),
    }))


def _k_call_async(t: EastType, function, arguments: list):
    return EastVariant("CallAsync", EastStruct({
        "type": t, "loc_id": _loc_id(), "function": function, "arguments": list(arguments),
    }))
