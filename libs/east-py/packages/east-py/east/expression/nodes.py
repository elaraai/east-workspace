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
materializes a fresh python object — node identity, which the CSE in
``east.expression.finalize`` detects, would die at each array boundary. One
finalize pass converts those lists to real ``EastArray``s.
"""

from __future__ import annotations

import itertools
from typing import Any

from east.expression.errors import ExpressionError
from east.expression.location import location_id as _loc_id
from east.ir.builders import ir_value, ir_variable
from east.types.type_of_type import EastTypeType
from east.types.types import EastType
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

#: The builtins that MUTATE their first argument. Two callers need to know:
#: the finalize pass, which must not hoist a mutation of anything the hoisted
#: node does not itself create, and the traced mutators, which refuse a
#: build-time constant as a receiver.
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


def _root_var_name(node: Any) -> str | None:
    """The variable a node ultimately reads through, or None.

    Follows the accessors that do not change WHICH value is addressed — a
    struct field read, a ref read — so ``s.order`` and ``RefGet(r)`` both
    report the binding they hang off. Anything else (a fresh ``NewArray``, a
    builtin result) has no root variable and is by definition local.
    """
    while True:
        kind = getattr(node, "type", None)
        if kind == "Variable":
            return node.value["name"]
        if kind == "GetField":
            node = node.value["struct"]
            continue
        if kind == "Builtin" and node.value["builtin"] == "RefGet":
            node = node.value["arguments"][0]
            continue
        return None


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
# materializes a FRESH python object — node identity (what CSE detects) dies
# at every array boundary. During tracing, array-bearing nodes therefore hold
# their children in plain python lists; one finalize pass (_finalize_ir) runs
# the identity-based CSE and converts every list to the proper EastArray in
# the same rebuild. Scalar-child nodes use the shared builders directly —
# EastStruct fields keep object identity.


def _k_builtin(name: str, out: EastType, type_params: list, args: list):
    return EastVariant("Builtin", EastStruct({
        "type": out, "loc_id": _loc_id(), "builtin": name,
        "type_parameters": list(type_params), "arguments": list(args),
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
