#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Hand-built helper kernels used by the eager collection methods.

These tiny compiled functions replace the internal python lambdas the eager
methods previously used for identity keys, default combines and group-append —
with them the whole method runs natively. Each is memoized by its types' JSON
form (types are structural, so the string is a stable key).
"""

from __future__ import annotations

from typing import Any

from east.expression.expr import Expression
from east.expression.finalize import _function_ir
from east.expression.nodes import (
    _builtin,
    _k_block,
    _k_new_array,
    _k_new_dict,
    _k_new_set,
    _literal,
    _option_type,
    _type_key,
    _var,
)
from east.ir.builders import ir_error, ir_get_field, ir_variant
from east.types.types import ArrayType, BooleanType, EastType, NullType, StringType

# ─── Hand-built helper kernels (internal — used by eager methods) ───────────
#
# These tiny kernels replace the internal python lambdas that eager methods
# previously used for identity keys, default combines and group-append —
# with them the whole method goes native. Memoized by the type's JSON form
# (types are structural, so the string is a stable key).

_helper_memo: dict[str, Any] = {}


def _identity_kernel(t: EastType) -> Any:
    """Compiled (x: t) -> x."""
    from east.runtime.compiler import compile_from_value

    key = "identity:" + _type_key(t)
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    body = Expression(_var("__k0", t), t)
    k = compile_from_value(_function_ir([t], [_var("__k0", t)], body))
    _helper_memo[key] = k
    return k


def _second_kernel(t: EastType) -> Any:
    """Compiled (a: t, b: t) -> b (default combine: later value wins)."""
    from east.runtime.compiler import compile_from_value

    key = "second:" + _type_key(t)
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    params = [_var("__k0", t), _var("__k1", t)]
    body = Expression(_var("__k1", t), t)
    k = compile_from_value(_function_ir([t, t], params, body))
    _helper_memo[key] = k
    return k


def _empty_array_kernel(key_t: EastType, element_t: EastType) -> Any:
    """Compiled (k: key_t) -> [] of element_t (group init)."""
    from east.runtime.compiler import compile_from_value

    key = "init:" + _type_key(key_t) + "|" + _type_key(element_t)
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    bucket_t = ArrayType(element_t)
    body = Expression(_k_new_array(bucket_t, []), bucket_t)
    k = compile_from_value(_function_ir([key_t], [_var("__k0", key_t)], body))
    _helper_memo[key] = k
    return k


def _none_init_kernel(key_t: EastType, inner_t: EastType) -> Any:
    """Compiled (k: key_t) -> none : Option<inner_t> (group max/min init)."""
    from east.runtime.compiler import compile_from_value

    key = "noneinit:" + _type_key(key_t) + "|" + _type_key(inner_t)
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    opt_t = _option_type(inner_t)
    body = Expression(
        ir_variant(opt_t, "none", _literal(None, NullType)),
        opt_t,
    )
    k = compile_from_value(_function_ir([key_t], [_var("__k0", key_t)], body))
    _helper_memo[key] = k
    return k


def _pair_field(pair_t: EastType, var: Any, name: str) -> tuple:
    f_t = next(f["type"] for f in pair_t.value if f["name"] == name)
    return ir_get_field(f_t, name, var), f_t


def _append_field_kernel(pair_t: EastType, value_field: str) -> Any:
    """Compiled (acc: [V], p: pair_t, i) -> acc with p.<value_field> pushed."""
    from east.runtime.compiler import compile_from_value

    key = "appendfield:" + _type_key(pair_t) + "|" + value_field
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    el = _var("__k1", pair_t)
    field_ir, v_t = _pair_field(pair_t, el, value_field)
    bucket_t = ArrayType(v_t)
    acc = _var("__k0", bucket_t)
    push = _builtin("ArrayPushLast", NullType, [v_t], [acc, field_ir])
    block = _k_block(bucket_t, [push, acc])
    k = compile_from_value(_function_ir([bucket_t, pair_t], [acc, el], Expression(block, bucket_t)))
    _helper_memo[key] = k
    return k


def _empty_set_kernel(key_t: EastType, element_t: EastType) -> Any:
    """Compiled (k: key_t) -> {} : Set<element_t> (group init)."""
    from east.runtime.compiler import compile_from_value
    from east.types.types import SetType as _SetType

    key = "setinit:" + _type_key(key_t) + "|" + _type_key(element_t)
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    set_t = _SetType(element_t)
    body = Expression(_k_new_set(set_t, []), set_t)
    k = compile_from_value(_function_ir([key_t], [_var("__k0", key_t)], body))
    _helper_memo[key] = k
    return k


def _set_insert_field_kernel(pair_t: EastType, value_field: str) -> Any:
    """Compiled (acc: Set<V>, p: pair_t, i) -> acc with p.<value_field> inserted.

    ``SetTryInsert``, not ``SetInsert``: this backs ``group_to_sets``, whose
    entire purpose is that duplicates within a group COLLAPSE. ``SetInsert``
    errors on an existing element, so every one of ``EastArray``/``EastSet``/
    ``EastDict``.``group_to_sets`` raised ``Set already contains key …`` the
    moment two members of a group shared a value — the normal case, not an edge
    one. TypeScript's ``groupToSets`` uses ``tryInsert`` for exactly this
    reason; east-py simply used the erroring spelling (#525).
    """
    from east.runtime.compiler import compile_from_value
    from east.types.types import SetType as _SetType

    key = "setinsfield:" + _type_key(pair_t) + "|" + value_field
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    el = _var("__k1", pair_t)
    field_ir, v_t = _pair_field(pair_t, el, value_field)
    set_t = _SetType(v_t)
    acc = _var("__k0", set_t)
    # SetTryInsert yields a Boolean "was it new"; the block discards it and
    # returns the accumulator, exactly as the SetInsert form did with Null.
    ins = _builtin("SetTryInsert", BooleanType, [v_t], [acc, field_ir])
    block = _k_block(set_t, [ins, acc])
    k = compile_from_value(_function_ir([set_t, pair_t], [acc, el], Expression(block, set_t)))
    _helper_memo[key] = k
    return k


def _empty_dict_kernel(key_t: EastType, k2_t: EastType, v_t: EastType) -> Any:
    """Compiled (k: key_t) -> {} : Dict<k2_t, v_t> (group init)."""
    from east.runtime.compiler import compile_from_value
    from east.types.types import DictType as _DictType

    key = "dictinit:" + _type_key(key_t) + "|" + _type_key(k2_t) + "|" + _type_key(v_t)
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    dict_t = _DictType(k2_t, v_t)
    body = Expression(_k_new_dict(dict_t, []), dict_t)
    k = compile_from_value(_function_ir([key_t], [_var("__k0", key_t)], body))
    _helper_memo[key] = k
    return k


def _dict_insert_fields_kernel(pair_t: EastType, key_field: str, value_field: str) -> Any:
    """Compiled (acc: Dict<K2,V>, p, i) -> acc with (p.<key>, p.<value>) inserted.

    Uses DictInsert, so a duplicate inner key errors — mirroring the TS
    groupToDicts default (resolve collisions with a combine instead).
    """
    from east.runtime.compiler import compile_from_value
    from east.types.types import DictType as _DictType

    key = "dictinsfields:" + _type_key(pair_t) + "|" + key_field + "|" + value_field
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    el = _var("__k1", pair_t)
    k_ir, k2_t = _pair_field(pair_t, el, key_field)
    v_ir, v_t = _pair_field(pair_t, el, value_field)
    dict_t = _DictType(k2_t, v_t)
    acc = _var("__k0", dict_t)
    ins = _builtin("DictInsert", NullType, [k2_t, v_t], [acc, k_ir, v_ir])
    block = _k_block(dict_t, [ins, acc])
    k = compile_from_value(_function_ir([dict_t, pair_t], [acc, el], Expression(block, dict_t)))
    _helper_memo[key] = k
    return k


def _key_error_message(k2: EastType, key_var: Any, prefix: str, suffix: str):
    """``prefix + key + suffix`` as String IR — a String key prints BARE
    (``Print`` would JSON-quote it), matching the eager path and TypeScript."""
    printed = key_var if k2.type == "String" \
        else _builtin("Print", StringType, [k2], [key_var])
    return _builtin(
        "StringConcat", StringType, [],
        [_builtin("StringConcat", StringType, [],
                  [_literal(prefix, StringType), printed]),
         _literal(suffix, StringType)],
    )


def _error_combine_kernel(t2: EastType, k2: EastType, prefix: str, suffix: str) -> Any:
    """Compiled ``(v1, v2, k) -> Error(prefix + key + suffix)`` — the default
    collision handler (duplicate-key / exists-in-both), native so the strict
    surface needs no python error callback (#625). The traced twin is
    ``_TransformOps._key_error_node``; the messages must stay identical."""
    from east.runtime.compiler import compile_from_value

    key = "errcombine:" + _type_key(t2) + "|" + _type_key(k2) + "|" + prefix + "|" + suffix
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    v1, v2, ck = _var("__k0", t2), _var("__k1", t2), _var("__k2", k2)
    body = Expression(ir_error(t2, _key_error_message(k2, ck, prefix, suffix)), t2)
    k = compile_from_value(_function_ir([t2, t2, k2], [v1, v2, ck], body))
    _helper_memo[key] = k
    return k


def _error_init_kernel(out_t: EastType, k2: EastType, prefix: str, suffix: str) -> Any:
    """Compiled ``(k) -> Error(prefix + key + suffix)`` — ``merge_key``'s
    missing-key default, native (#625)."""
    from east.runtime.compiler import compile_from_value

    key = "errinit:" + _type_key(out_t) + "|" + _type_key(k2) + "|" + prefix + "|" + suffix
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    ck = _var("__k0", k2)
    body = Expression(ir_error(out_t, _key_error_message(k2, ck, prefix, suffix)), out_t)
    k = compile_from_value(_function_ir([k2], [ck], body))
    _helper_memo[key] = k
    return k


def _array_get_kernel(element_t: EastType) -> Any:
    """Compiled (i: Integer, a: [t]) -> a[i] — ``get_keys``' element getter.

    The array parameter binds BY REFERENCE at the call site
    (``_array_get_kernel(t).bind(arr)``), so the gather never snapshots the
    source — the python ``lambda idx: self[idx]`` closure it replaces has no
    strict capture (#625).
    """
    from east.runtime.compiler import compile_from_value
    from east.types.types import IntegerType as _IntegerType

    key = "arrayget:" + _type_key(element_t)
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    arr_t = ArrayType(element_t)
    i = _var("__k0", _IntegerType)
    a = _var("__k1", arr_t)
    body = Expression(_builtin("ArrayGet", element_t, [element_t], [a, i]), element_t)
    k = compile_from_value(_function_ir([_IntegerType, arr_t], [i, a], body))
    _helper_memo[key] = k
    return k


def _append_kernel(element_t: EastType) -> Any:
    """Compiled (acc: [t], el: t) -> acc with el pushed (group fold)."""
    from east.runtime.compiler import compile_from_value

    key = "append:" + _type_key(element_t)
    cached = _helper_memo.get(key)
    if cached is not None:
        return cached
    bucket_t = ArrayType(element_t)
    acc = _var("__k0", bucket_t)
    el = _var("__k1", element_t)
    push = _builtin("ArrayPushLast", NullType, [element_t], [acc, el])
    block = _k_block(bucket_t, [push, acc])
    body = Expression(block, bucket_t)
    k = compile_from_value(_function_ir([bucket_t, element_t], [acc, el], body))
    _helper_memo[key] = k
    return k
