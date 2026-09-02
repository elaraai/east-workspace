#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Field-mask inference over built function IR (issue #599).

The beast2 compute family decodes a segment BEFORE the eager method traces
its callback — yet the traced IR knows exactly which struct fields the
callback reads. This module runs the trace FIRST (or reads a compiled East
function's retained IR) and derives the set of ``GetField`` paths the IR
reaches from the element parameter, as a mask tree:

- a ``dict`` maps kept field names to sub-masks;
- ``WHOLE_MASK`` marks a subtree that must materialize whole — every use of
  a value that is not a further ``GetField`` (a comparison, a builtin
  argument, a fold over an array, a return) keeps that whole subtree, so
  masked decodes never change what any operation observes;
- the element itself reaching a non-``GetField`` use is the
  "element escapes whole" case: nothing can be skipped.

The mask is conservative by construction: anything the walker does not
positively recognize widens the mask, never narrows it.
"""

from __future__ import annotations

from collections import OrderedDict
from typing import Any

from east.expression.finalize import _node_children
from east.expression.nodes import _type_key
from east.types.types import EastType, StructType

#: A subtree that must decode whole (also the "element escapes" answer).
WHOLE_MASK: Any = "<whole>"

#: Node kinds the walker understands. An unrecognized kind means the tracer
#: grew a construct this walker has not been taught — treat the element as
#: escaping rather than risk a mask that hides a read.
_KNOWN_KINDS = frozenset({
    "Value", "Variable", "Builtin", "GetField", "Struct", "Variant",
    "NewArray", "NewVector", "NewMatrix", "NewSet", "NewDict", "Match",
    "IfElse", "Call", "TryCatch", "Function", "Let", "Block", "Error",
    "NewRef", "While", "ForArray", "ForSet", "ForDict", "Break", "Continue",
})


def merge_masks(a: Any, b: Any) -> Any:
    """The union of two masks — the fields EITHER side reads."""
    if a is WHOLE_MASK or b is WHOLE_MASK:
        return WHOLE_MASK
    out = dict(a)
    for name, sub in b.items():
        out[name] = merge_masks(out[name], sub) if name in out else sub
    return out


def _insert_path(mask: dict, path: tuple) -> None:
    """Mark ``path``'s subtree as needed whole, in place."""
    name = path[0]
    if len(path) == 1:
        mask[name] = WHOLE_MASK
        return
    sub = mask.get(name)
    if sub is WHOLE_MASK:
        return
    if sub is None:
        sub = {}
        mask[name] = sub
    _insert_path(sub, path[1:])


class _Escaped(Exception):
    """Internal control flow: the element reached a non-GetField use."""


def _collect_mask(body: Any, target: str) -> Any:
    """The mask for parameter ``target`` over ``body``, or ``WHOLE_MASK``."""
    mask: dict = {}

    def walk(node: Any) -> None:
        kind = getattr(node, "type", None)
        if kind is None or kind not in _KNOWN_KINDS:
            raise _Escaped
        if kind == "Value":
            return  # literals hold no Variable nodes
        payload = node.value
        if kind == "Variable":
            if payload["name"] == target:
                raise _Escaped
            return
        if kind == "GetField":
            # Ascend the maximal chain: GetField(GetField(target, a), b) is
            # the path (a, b), and its RESULT — however it is used — needs
            # that subtree whole. A chain rooted elsewhere walks its root.
            path: list[str] = []
            cur = node
            while getattr(cur, "type", None) == "GetField":
                path.append(cur.value["field"])
                cur = cur.value["struct"]
            if getattr(cur, "type", None) == "Variable" and cur.value["name"] == target:
                _insert_path(mask, tuple(reversed(path)))
                return
            walk(cur)
            return
        if kind == "Let":
            # The declaration Variable is a binder, not a use. A rebound
            # target name would make later reads ambiguous — escape.
            if payload["variable"].value["name"] == target:
                raise _Escaped
            walk(payload["value"])
            return
        if kind == "Function":
            # Captures/parameters are declarations; the body's USES decide
            # the mask. A parameter shadowing the target hides it — escape
            # conservatively (never happens for the tracer's __k names).
            if any(p.value["name"] == target for p in payload["parameters"]):
                raise _Escaped
            for c in payload["captures"]:
                if c.value["name"] == target:
                    # captured by an inner lambda: its body reads still count
                    break
            walk(payload["body"])
            return
        if kind == "Match" and any(c["variable"].value["name"] == target
                                   for c in payload["cases"]):
            raise _Escaped
        if kind == "TryCatch" and (payload["message"].value["name"] == target
                                   or payload["stack"].value["name"] == target):
            raise _Escaped
        if kind in ("ForArray", "ForSet", "ForDict"):
            names = {payload["key"].value["name"]}
            if kind != "ForSet":
                names.add(payload["value"].value["name"])
            if target in names:
                raise _Escaped
        for child in _node_children(node):
            walk(child)

    try:
        walk(body)
    except _Escaped:
        return WHOLE_MASK
    return mask


def _function_node(ir: Any) -> Any | None:
    """The Function node of a finalized function IR (possibly under a Block of
    hoisted-constant Lets)."""
    kind = getattr(ir, "type", None)
    if kind == "Function":
        return ir
    if kind == "Block":
        for stmt in ir.value["statements"]:
            if getattr(stmt, "type", None) == "Function":
                return stmt
    return None


def narrow_type_for(wire_t: EastType, mask: Any) -> EastType:
    """The subset type ``mask`` keeps of ``wire_t`` (wire field order)."""
    if mask is WHOLE_MASK:
        return wire_t
    if wire_t.type != "Struct":
        # A mask below a non-struct only arises from defensive widening.
        return wire_t
    fields = []
    for f in wire_t.value:
        name = f["name"]
        if name in mask:
            fields.append((name, narrow_type_for(f["type"], mask[name])))
    return StructType(fields)


def _retrace_wrapper(fn: Any, arity: int) -> Any:
    """A capturable wrapper around a compiled East function.

    A compiled function's declared input types name the WIDE element, so on a projected
    (narrow) segment the native pass-through refuses it (#467) and the
    wrapper's re-trace takes over: called with proxies, the function's
    dual-mode callable re-runs its retained source lambda, splicing the same
    expression against the narrow types. The function rides a keyword-only
    default (not a closure cell), which the eligibility check does not
    inspect — and needs not: a ``_east_retrace`` carrier is allowed capture
    anyway.
    """
    # A body takes the block first; a compiled function takes none.
    if arity == 1:
        return lambda _b, a, *, _k=fn: _k(a)
    if arity == 2:
        return lambda _b, a, c, *, _k=fn: _k(a, c)
    if arity == 3:
        return lambda _b, a, c, d, *, _k=fn: _k(a, c, d)
    return None


_MASK_MEMO_MAX = 512
_mask_memo: OrderedDict[tuple, Any] = OrderedDict()


def infer_field_mask(fn: Any, param_types: list[EastType], elem_pos: int) -> tuple:
    """The field mask ``fn`` needs of its ``elem_pos``-th parameter.

    Returns ``(mask, exec_fn, reason)``: on success ``mask`` is a mask tree
    (possibly ``WHOLE_MASK`` — the element is used whole) and ``exec_fn`` is
    the callable the operation should EXECUTE with (the original ``fn``, or
    a re-trace wrapper for a compiled East function, which cannot run its wide
    native form against narrow values). On failure ``mask`` is None and
    ``reason`` is ``"untraceable"`` or ``"function"``.
    """
    handle = getattr(fn, "_eastc_handle", None)
    if handle is not None:
        ir = getattr(fn, "_east_ir", None)
        retrace = getattr(fn, "_east_retrace", None)
        if ir is None or retrace is None:
            # A .bind result or a decoded function value: no retained IR to
            # read, or no source to re-trace against the narrow type.
            return None, None, "function"
        fn_node = _function_node(ir)
        if fn_node is None:
            return None, None, "function"
        params = fn_node.value["parameters"]
        if elem_pos >= len(params):
            return {}, fn, None  # the function never receives the element
        mask = _collect_mask(fn_node.value["body"], params[elem_pos].value["name"])
        wrapper = _retrace_wrapper(fn, len(params))
        if wrapper is None:
            return None, None, "function"
        return mask, wrapper, None

    if not callable(fn):
        return None, None, "untraceable"

    from east.expression.capture import _eligible, _trace_cache_key

    key = _trace_cache_key(fn, ("mask", elem_pos,
                                tuple(_type_key(t) for t in param_types)))
    if key is not None:
        hit = _mask_memo.get(key)
        if hit is not None:
            _mask_memo.move_to_end(key)
            return hit, fn, None
    if not _eligible(fn):
        return None, None, "untraceable"
    try:
        from east.expression.function import trace

        ir, _out, _binds = trace(fn, list(param_types))
    except Exception:
        return None, None, "untraceable"
    fn_node = _function_node(ir)
    if fn_node is None:
        return None, None, "untraceable"
    params = fn_node.value["parameters"]
    if elem_pos >= len(params):
        mask: Any = {}
    else:
        mask = _collect_mask(fn_node.value["body"], params[elem_pos].value["name"])
    if key is not None:
        _mask_memo[key] = mask
        if len(_mask_memo) > _MASK_MEMO_MAX:
            _mask_memo.popitem(last=False)
    return mask, fn, None
