#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""In-place mutation of a local collection or reference cell (#578).

The rest of the traced surface is pure by design, and stays that way: these
are for the accumulator a loop builds. Threading a whole collection through a
loop's STATE rebuilds it every iteration — ``order.concat(…)`` copies, so a
loop that appends n times is O(n²) — where east-c collections are reference
values a loop can extend in place in O(1).

Each method mirrors its EAGER twin exactly: same name, same arguments, and the
same return value (``Null`` for the inserts and deletes, ``Boolean`` for the
``try_`` forms). None of them returns the receiver, because the eager twins do
not either — sequence them with ``East.block(…)``, which is the one spelling
that works on the traced and the python paths alike::

    East.for_(rows, {"seen": East.new_set(StringType), "n": 0},
              lambda s, r: East.block(s.seen.try_insert(r.sku),
                                      {**s, "n": s.n + 1}))
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.kernel.errors import KernelTraceError
from east.kernel.lift import (
    _hoisted_const_names,
    _lift,
    _note_effect,
    _trace_inner_fn,
    _with_key_arg,
)
from east.kernel.nodes import _builtin, _root_var_name
from east.kernel.ops import _ExprBase
from east.types.types import BooleanType, NullType

if TYPE_CHECKING:
    from east.kernel.expr import KernelExpr

#: "argument not supplied" — None is a legitimate East value (the Null literal).
_MISSING = object()


class _MutationOps(_ExprBase):
    """Traced in-place mutation — the loop accumulator's surface."""

    __slots__ = ()

    # ── a mutation has to reach the body, and own its receiver ──────────

    def _mutable(self, op: str, *kinds: str):
        """Check the receiver can legitimately be mutated; return its type.

        A CAPTURED East collection is a build-time SNAPSHOT hoisted to a
        ``Let`` that the compiled function closes over, so ONE value is shared
        by every call to the kernel — mutating it would leak state between
        calls, silently and only at scale. Refusing it here turns that into a
        trace-time error naming the two spellings that do work.
        """
        tag = self.east_type.type
        if tag not in kinds:
            raise KernelTraceError(
                f".{op}() on {tag} — needs {' or '.join(kinds)}")
        root = _root_var_name(self.ir)
        if root is not None and root in _hoisted_const_names():
            raise KernelTraceError(
                f".{op}() would mutate a captured constant. A captured East "
                "collection is a build-time snapshot shared by every call to "
                "the compiled kernel, so the mutation would leak between "
                "calls. Build the collection inside the kernel with "
                "East.new_array/new_set/new_dict, or pass it as a trailing "
                "parameter and bind it by reference (kernel(...).bind(table))."
            )
        return self.east_type

    def _effect(self, op: str, node: Any, out_t: Any) -> KernelExpr:
        """The traced mutation, registered so a DISCARDED one is caught.

        A traced callback is ONE expression, so a mutation written as a
        statement — ``acc.append(x)`` on its own line — is evaluated at trace
        time and thrown away, leaving a compiled loop that silently does
        nothing. Recording it lets the trace check that back.
        """
        _note_effect(node, op)
        return self._expr(node, out_t)

    # ── Array ───────────────────────────────────────────────────────────

    def append(self, value: Any) -> KernelExpr:
        """Traced ArrayPushLast: add ``value`` to the end (yields Null)."""
        elem_t = self._mutable("append", "Array").value
        v = _lift(value, hint=elem_t)
        if v.east_type != elem_t:
            raise KernelTraceError(
                f".append() takes {elem_t.type}, got {v.east_type.type}")
        return self._effect(
            "append",
            _builtin("ArrayPushLast", NullType, [elem_t], [self.ir, v.ir]),
            NullType,
        )

    def extend(self, other: Any) -> KernelExpr:
        """Traced ArrayAppend: add every element of ``other`` (yields Null)."""
        arr_t = self._mutable("extend", "Array")
        o = _lift(other, hint=arr_t)
        if o.east_type != arr_t:
            raise KernelTraceError(
                f".extend() takes an {arr_t.type} of the same element type, "
                f"got {o.east_type.type}")
        return self._effect(
            "extend",
            _builtin("ArrayAppend", NullType, [arr_t.value], [self.ir, o.ir]),
            NullType,
        )

    # ── Set and Dict share these spellings, as they do eagerly ──────────

    def insert(self, key: Any, value: Any = _MISSING) -> KernelExpr:
        """Traced insert — ``insert(element)`` on a Set, ``insert(key, value)``
        on a Dict. An element/key that is already present is an East runtime
        ERROR, like the eager twins; :meth:`try_insert` is the tolerant Set
        form and :meth:`insert_or_update` the tolerant Dict one."""
        if self.east_type.type == "Set":
            if value is not _MISSING:
                raise KernelTraceError(".insert() on a Set takes one element")
            elem_t = self._mutable("insert", "Set").value
            k = _lift(key, hint=elem_t)
            return self._effect(
                "insert",
                _builtin("SetInsert", NullType, [elem_t], [self.ir, k.ir]),
                NullType,
            )
        kv = self._mutable("insert", "Set", "Dict").value
        if value is _MISSING:
            raise KernelTraceError(".insert() on a Dict takes (key, value)")
        k = _lift(key, hint=kv["key"])
        v = _lift(value, hint=kv["value"])
        return self._effect(
            "insert",
            _builtin("DictInsert", NullType, [kv["key"], kv["value"]],
                     [self.ir, k.ir, v.ir]),
            NullType,
        )

    def try_insert(self, value: Any) -> KernelExpr:
        """Traced SetTryInsert: add ``value``, yielding whether it was new."""
        elem_t = self._mutable("try_insert", "Set").value
        v = _lift(value, hint=elem_t)
        return self._effect(
            "try_insert",
            _builtin("SetTryInsert", BooleanType, [elem_t], [self.ir, v.ir]),
            BooleanType,
        )

    def insert_or_update(self, key: Any, value: Any, combine: Any) -> KernelExpr:
        """Traced DictInsertOrUpdate: insert ``value`` at ``key``, or resolve a
        collision as ``combine(existing, incoming)`` (a third parameter
        receives the key). The counter idiom::

            counts.insert_or_update(sku, 1, lambda old, new: old + new)
        """
        kv = self._mutable("insert_or_update", "Dict").value
        k_t, v_t = kv["key"], kv["value"]
        k = _lift(key, hint=k_t)
        v = _lift(value, hint=v_t)
        node, c_out = _trace_inner_fn(
            _with_key_arg(combine), [v_t, v_t, k_t], declared=3, out_hint=v_t)
        if c_out != v_t:
            raise KernelTraceError(
                f".insert_or_update() combine returns {c_out.type}, "
                f"values are {v_t.type}")
        return self._effect(
            "insert_or_update",
            _builtin("DictInsertOrUpdate", NullType, [k_t, v_t],
                     [self.ir, k.ir, v.ir, node]),
            NullType,
        )

    def delete(self, key: Any) -> KernelExpr:
        """Traced delete — an element from a Set, an entry from a Dict. An
        absent key is an East runtime error, like the eager twins; the
        tolerant form is :meth:`try_delete`."""
        if self.east_type.type == "Set":
            elem_t = self._mutable("delete", "Set").value
            k = _lift(key, hint=elem_t)
            return self._effect(
                "delete",
                _builtin("SetDelete", NullType, [elem_t], [self.ir, k.ir]),
                NullType,
            )
        kv = self._mutable("delete", "Set", "Dict").value
        k = _lift(key, hint=kv["key"])
        return self._effect(
            "delete",
            _builtin("DictDelete", NullType, [kv["key"], kv["value"]], [self.ir, k.ir]),
            NullType,
        )

    def try_delete(self, key: Any) -> KernelExpr:
        """Traced tolerant delete, yielding whether anything was removed."""
        if self.east_type.type == "Set":
            elem_t = self._mutable("try_delete", "Set").value
            k = _lift(key, hint=elem_t)
            return self._effect(
                "try_delete",
                _builtin("SetTryDelete", BooleanType, [elem_t], [self.ir, k.ir]),
                BooleanType,
            )
        kv = self._mutable("try_delete", "Set", "Dict").value
        k = _lift(key, hint=kv["key"])
        return self._effect(
            "try_delete",
            _builtin("DictTryDelete", BooleanType, [kv["key"], kv["value"]],
                     [self.ir, k.ir]),
            BooleanType,
        )

    def clear(self) -> KernelExpr:
        """Traced clear: drop every element/entry (yields Null)."""
        t = self._mutable("clear", "Array", "Set", "Dict")
        if t.type == "Dict":
            kv = t.value
            return self._effect(
                "clear",
                _builtin("DictClear", NullType, [kv["key"], kv["value"]], [self.ir]),
                NullType,
            )
        builtin = "ArrayClear" if t.type == "Array" else "SetClear"
        return self._effect(
            "clear", _builtin(builtin, NullType, [t.value], [self.ir]), NullType)

    # ── Ref ─────────────────────────────────────────────────────────────

    def set(self, value: Any) -> KernelExpr:
        """Traced RefUpdate: replace the cell's contents (yields Null)."""
        inner_t = self._mutable("set", "Ref").value
        v = _lift(value, hint=inner_t)
        if v.east_type != inner_t:
            raise KernelTraceError(
                f".set() takes {inner_t.type}, got {v.east_type.type}")
        return self._effect(
            "set",
            _builtin("RefUpdate", NullType, [inner_t], [self.ir, v.ir]),
            NullType,
        )

    def update(self, fn: Any) -> KernelExpr:
        """Traced read-modify-write of a Ref: ``fn(current)`` becomes the new
        contents (yields Null), mirroring the eager ``EastRef.update``."""
        inner_t = self._mutable("update", "Ref").value
        current = self._expr(
            _builtin("RefGet", inner_t, [inner_t], [self.ir]), inner_t)
        nxt = _lift(fn(current), hint=inner_t)
        if nxt.east_type != inner_t:
            raise KernelTraceError(
                f".update() returns {nxt.east_type.type}, the cell holds {inner_t.type}")
        return self._effect(
            "update",
            _builtin("RefUpdate", NullType, [inner_t], [self.ir, nxt.ir]),
            NullType,
        )
