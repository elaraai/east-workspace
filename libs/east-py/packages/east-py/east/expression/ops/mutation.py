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
              lambda b, s, r: East.block(s.seen.try_insert(r.sku),
                                         {**s, "n": s.n + 1}))
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from east.expression.errors import ExpressionError
from east.expression.lift import (
    _hoisted_const_names,
    _lift,
    _note_effect,
    _trace_inner_fn,
    _with_key_arg,
)
from east.expression.nodes import _builtin, _root_var_name
from east.expression.ops import _ExprBase
from east.types.types import BooleanType, NullType

if TYPE_CHECKING:
    from east.expression.expr import Expression
else:  # the class is needed at call time by the methods added below

    Expression = None  # bound lazily; see _extend_mutation_ops

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
            raise ExpressionError(
                f".{op}() on {tag} — needs {' or '.join(kinds)}")
        root = _root_var_name(self.ir)
        if root is not None and root in _hoisted_const_names():
            raise ExpressionError(
                f".{op}() would mutate a captured constant. A captured East "
                "collection is a build-time snapshot shared by every call to "
                "the compiled kernel, so the mutation would leak between "
                "calls. Build the collection inside the kernel with "
                "East.new_array/new_set/new_dict, or pass it as a trailing "
                "parameter and bind it by reference (East.function(...).bind(table))."
            )
        return self.east_type

    def _effect(self, op: str, node: Any, out_t: Any) -> Expression:
        """The traced mutation, registered so a DISCARDED one is caught.

        A traced callback is ONE expression, so a mutation written as a
        statement — ``acc.append(x)`` on its own line — is evaluated at trace
        time and thrown away, leaving a compiled loop that silently does
        nothing. Recording it lets the trace check that back.
        """
        _note_effect(node, op)
        return self._expr(node, out_t)

    # ── Array ───────────────────────────────────────────────────────────

    def append(self, value: Any) -> Expression:
        """Traced ArrayPushLast: add ``value`` to the end (yields Null)."""
        elem_t = self._mutable("append", "Array").value
        v = _lift(value, hint=elem_t)
        if v.east_type != elem_t:
            raise ExpressionError(
                f".append() takes {elem_t.type}, got {v.east_type.type}")
        return self._effect(
            "append",
            _builtin("ArrayPushLast", NullType, [elem_t], [self.ir, v.ir]),
            NullType,
        )

    def extend(self, other: Any) -> Expression:
        """Traced ArrayAppend: add every element of ``other`` (yields Null)."""
        arr_t = self._mutable("extend", "Array")
        o = _lift(other, hint=arr_t)
        if o.east_type != arr_t:
            raise ExpressionError(
                f".extend() takes an {arr_t.type} of the same element type, "
                f"got {o.east_type.type}")
        return self._effect(
            "extend",
            _builtin("ArrayAppend", NullType, [arr_t.value], [self.ir, o.ir]),
            NullType,
        )

    # ── Set and Dict share these spellings, as they do eagerly ──────────

    def insert(self, key: Any, value: Any = _MISSING) -> Expression:
        """Traced insert — ``insert(element)`` on a Set, ``insert(key, value)``
        on a Dict. An element/key that is already present is an East runtime
        ERROR, like the eager twins; :meth:`try_insert` is the tolerant Set
        form and :meth:`insert_or_update` the tolerant Dict one."""
        if self.east_type.type == "Set":
            if value is not _MISSING:
                raise ExpressionError(".insert() on a Set takes one element")
            elem_t = self._mutable("insert", "Set").value
            k = _lift(key, hint=elem_t)
            return self._effect(
                "insert",
                _builtin("SetInsert", NullType, [elem_t], [self.ir, k.ir]),
                NullType,
            )
        kv = self._mutable("insert", "Set", "Dict").value
        if value is _MISSING:
            raise ExpressionError(".insert() on a Dict takes (key, value)")
        k = _lift(key, hint=kv["key"])
        v = _lift(value, hint=kv["value"])
        return self._effect(
            "insert",
            _builtin("DictInsert", NullType, [kv["key"], kv["value"]],
                     [self.ir, k.ir, v.ir]),
            NullType,
        )

    def try_insert(self, value: Any) -> Expression:
        """Traced SetTryInsert: add ``value``, yielding whether it was new."""
        elem_t = self._mutable("try_insert", "Set").value
        v = _lift(value, hint=elem_t)
        return self._effect(
            "try_insert",
            _builtin("SetTryInsert", BooleanType, [elem_t], [self.ir, v.ir]),
            BooleanType,
        )

    def insert_or_update(self, key: Any, value: Any, combine: Any) -> Expression:
        """Traced DictInsertOrUpdate: insert ``value`` at ``key``, or resolve a
        collision as ``combine(b, existing, incoming)`` (a fourth parameter
        receives the key). The counter idiom::

            counts.insert_or_update(sku, 1, lambda b, old, new: old + new)
        """
        kv = self._mutable("insert_or_update", "Dict").value
        k_t, v_t = kv["key"], kv["value"]
        k = _lift(key, hint=k_t)
        v = _lift(value, hint=v_t)
        node, c_out = _trace_inner_fn(
            _with_key_arg(combine), [v_t, v_t, k_t], declared=3, out_hint=v_t)
        if c_out != v_t:
            raise ExpressionError(
                f".insert_or_update() combine returns {c_out.type}, "
                f"values are {v_t.type}")
        return self._effect(
            "insert_or_update",
            _builtin("DictInsertOrUpdate", NullType, [k_t, v_t],
                     [self.ir, k.ir, v.ir, node]),
            NullType,
        )

    def delete(self, key: Any) -> Expression:
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

    def try_delete(self, key: Any) -> Expression:
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

    def clear(self) -> Expression:
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

    def set(self, value: Any) -> Expression:
        """Traced RefUpdate: replace the cell's contents (yields Null)."""
        inner_t = self._mutable("set", "Ref").value
        v = _lift(value, hint=inner_t)
        if v.east_type != inner_t:
            raise ExpressionError(
                f".set() takes {inner_t.type}, got {v.east_type.type}")
        return self._effect(
            "set",
            _builtin("RefUpdate", NullType, [inner_t], [self.ir, v.ir]),
            NullType,
        )

    def update(self, fn: Any) -> Expression:
        """Traced read-modify-write of a Ref: ``fn(b, current)`` becomes the
        new contents (yields Null), mirroring the eager ``EastRef.update``."""
        from east.expression.statements import _frames, _run_block

        inner_t = self._mutable("update", "Ref").value
        current = self._expr(
            _builtin("RefGet", inner_t, [inner_t], [self.ir]), inner_t)
        ret_t = _frames[-1].return_type if _frames else None
        nxt = _run_block(fn, (current,), return_type=ret_t, mode="block_expr", out=inner_t)
        if nxt.east_type != inner_t:
            raise ExpressionError(
                f".update() returns {nxt.east_type.type}, the cell holds {inner_t.type}")
        return self._effect(
            "update",
            _builtin("RefUpdate", NullType, [inner_t], [self.ir, nxt.ir]),
            NullType,
        )


# ─── the rest of the in-place surface (#627) ─────────────────────────────────
# One traced spelling per mutating builtin, so every IR node the TypeScript
# builder emits prints back through a python method (east.codegen). Each is
# the builtin, argument for argument, with the callback signatures the
# builtin declares (libs/east/src/builtins.ts).


def _extend_mutation_ops() -> None:
    from east.expression.lift import _trace_inner_fn
    from east.types.types import IntegerType

    def _is_expr(x: Any) -> bool:
        from east.expression.expr import Expression as _Expr

        return isinstance(x, _Expr)

    def _typed(op: str, value: Any, t: Any) -> Any:
        v = _lift(value, hint=t)
        if v.east_type != t:
            raise ExpressionError(f".{op}() takes {t.type}, got {v.east_type.type}")
        return v

    def _callback(fn: Any, param_types: list, out_t: Any = None, *, order=None) -> Any:
        """A callback Function node against the builtin's declared signature
        (``order`` permutes the python-facing parameters into it)."""
        if order is not None and not _is_expr(fn):
            user = fn

            def fn(b, *args):  # type: ignore[no-redef]
                return user(b, *[args[i] for i in order])
        node, got = _trace_inner_fn(fn, list(param_types), out_hint=out_t)
        if out_t is not None and got != out_t and got.type != "Never":
            raise ExpressionError(
                f"callback returns {got.type}, the builtin expects {out_t.type}")
        return node, got

    # ── Array ────────────────────────────────────────────────────────────

    def prepend(self, value: Any) -> Expression:
        """Traced ArrayPushFirst: add ``value`` at the front (yields Null)."""
        elem_t = self._mutable("prepend", "Array").value
        v = _typed("prepend", value, elem_t)
        return self._effect("prepend",
                            _builtin("ArrayPushFirst", NullType, [elem_t], [self.ir, v.ir]),
                            NullType)

    def pop(self, key: Any = _MISSING) -> Expression:
        """Traced ArrayPopLast on an Array (the last element, removed);
        traced DictPop on a Dict (``pop(key)`` — the value, removed)."""
        if self.east_type.type == "Dict":
            kv = self._mutable("pop", "Dict").value
            k = _typed("pop", key, kv["key"])
            return self._effect("pop",
                                _builtin("DictPop", kv["value"], [kv["key"], kv["value"]],
                                         [self.ir, k.ir]),
                                kv["value"])
        if key is not _MISSING:
            raise ExpressionError(".pop() on an Array takes no argument (use .pop_first())")
        elem_t = self._mutable("pop", "Array").value
        return self._effect("pop", _builtin("ArrayPopLast", elem_t, [elem_t], [self.ir]), elem_t)

    def pop_first(self) -> Expression:
        """Traced ArrayPopFirst: the first element, removed."""
        elem_t = self._mutable("pop_first", "Array").value
        return self._effect("pop_first",
                            _builtin("ArrayPopFirst", elem_t, [elem_t], [self.ir]), elem_t)

    def set_at(self, index: Any, value: Any) -> Expression:
        """Traced ArrayUpdate: replace the element at ``index`` (yields Null)."""
        elem_t = self._mutable("set_at", "Array").value
        i = _typed("set_at", index, IntegerType)
        v = _typed("set_at", value, elem_t)
        return self._effect("set_at",
                            _builtin("ArrayUpdate", NullType, [elem_t], [self.ir, i.ir, v.ir]),
                            NullType)

    def reverse_in_place(self) -> Expression:
        """Traced ArrayReverseInPlace (yields Null)."""
        elem_t = self._mutable("reverse_in_place", "Array").value
        return self._effect("reverse_in_place",
                            _builtin("ArrayReverseInPlace", NullType, [elem_t], [self.ir]),
                            NullType)

    def sort_in_place(self, key: Any) -> Expression:
        """Traced ArraySortInPlace: sort by ``key(element)`` (yields Null)."""
        elem_t = self._mutable("sort_in_place", "Array").value
        node, key_t = _callback(key, [elem_t])
        return self._effect("sort_in_place",
                            _builtin("ArraySortInPlace", NullType, [elem_t, key_t], [self.ir, node]),
                            NullType)

    def for_each(self, fn: Any) -> Expression:
        """Traced ArrayForEach / SetForEach / DictForEach: run ``fn`` per
        element for its effect (yields Null). Array ``fn(value, index)``,
        Set ``fn(element)``, Dict ``fn(key, value)``."""
        tag = self.east_type.type
        if tag == "Array":
            elem_t = self.east_type.value
            node, out_t = _callback(fn, [elem_t, IntegerType])
            return self._effect("for_each",
                                _builtin("ArrayForEach", NullType, [elem_t, out_t], [self.ir, node]),
                                NullType)
        if tag == "Set":
            elem_t = self.east_type.value
            node, out_t = _callback(fn, [elem_t])
            return self._effect("for_each",
                                _builtin("SetForEach", NullType, [elem_t, out_t], [self.ir, node]),
                                NullType)
        if tag == "Dict":
            kv = self.east_type.value
            node, out_t = _callback(fn, [kv["value"], kv["key"]], order=[1, 0])
            return self._effect("for_each",
                                _builtin("DictForEach", NullType, [kv["key"], kv["value"], out_t],
                                         [self.ir, node]),
                                NullType)
        raise ExpressionError(f".for_each() on {tag} — needs an Array, Set or Dict")

    # ── Set ──────────────────────────────────────────────────────────────

    def union_in_place(self, other: Any, combine: Any = _MISSING) -> Expression:
        """Traced SetUnionInPlace (``union_in_place(other)``) or
        DictUnionInPlace (``union_in_place(other, combine)`` with
        ``combine(existing, incoming, key)``); yields Null."""
        if self.east_type.type == "Set":
            t = self._mutable("union_in_place", "Set")
            o = _typed("union_in_place", other, t)
            return self._effect("union_in_place",
                                _builtin("SetUnionInPlace", NullType, [t.value], [self.ir, o.ir]),
                                NullType)
        t = self._mutable("union_in_place", "Dict")
        kv = t.value
        o = _typed("union_in_place", other, t)
        if combine is _MISSING:
            raise ExpressionError(".union_in_place() on a Dict takes a combine(existing, incoming, key)")
        node, _out = _callback(combine, [kv["value"], kv["value"], kv["key"]], kv["value"])
        return self._effect("union_in_place",
                            _builtin("DictUnionInPlace", NullType, [kv["key"], kv["value"]],
                                     [self.ir, o.ir, node]),
                            NullType)

    # ── Dict ─────────────────────────────────────────────────────────────

    def update_at(self, key: Any, value: Any) -> Expression:
        """Traced DictUpdate: set the value at an EXISTING key (yields Null)."""
        kv = self._mutable("update_at", "Dict").value
        k = _typed("update_at", key, kv["key"])
        v = _typed("update_at", value, kv["value"])
        return self._effect("update_at",
                            _builtin("DictUpdate", NullType, [kv["key"], kv["value"]],
                                     [self.ir, k.ir, v.ir]),
                            NullType)

    def swap(self, key: Any, value: Any) -> Expression:
        """Traced DictSwap: set the value at an existing key, yielding the old one."""
        kv = self._mutable("swap", "Dict").value
        k = _typed("swap", key, kv["key"])
        v = _typed("swap", value, kv["value"])
        return self._effect("swap",
                            _builtin("DictSwap", kv["value"], [kv["key"], kv["value"]],
                                     [self.ir, k.ir, v.ir]),
                            kv["value"])

    def get_or_insert(self, key: Any, producer: Any) -> Expression:
        """Traced DictGetOrInsert: the value at ``key``, inserting
        ``producer(key)`` first when absent."""
        kv = self._mutable("get_or_insert", "Dict").value
        k = _typed("get_or_insert", key, kv["key"])
        node, _out = _callback(producer, [kv["key"]], kv["value"])
        return self._effect("get_or_insert",
                            _builtin("DictGetOrInsert", kv["value"], [kv["key"], kv["value"]],
                                     [self.ir, k.ir, node]),
                            kv["value"])

    def merge_key(self, key: Any, value: Any, update: Any, init: Any) -> Expression:
        """Traced DictMerge: fold ``value`` into ``key`` — ``update(existing,
        value, key)`` when present, else insert ``init(key)`` (yields Null)."""
        kv = self._mutable("merge_key", "Dict").value
        k = _typed("merge_key", key, kv["key"])
        v = _lift(value)
        upd, _o = _callback(update, [kv["value"], v.east_type, kv["key"]], kv["value"])
        ini, _o2 = _callback(init, [kv["key"]], kv["value"])
        return self._effect("merge_key",
                            _builtin("DictMerge", NullType, [kv["key"], kv["value"], v.east_type],
                                     [self.ir, k.ir, v.ir, upd, ini]),
                            NullType)

    def merge_all(self, other: Any, update: Any, init: Any) -> Expression:
        """Traced DictMergeAll: fold every entry of ``other`` in (yields Null)."""
        kv = self._mutable("merge_all", "Dict").value
        o = _lift(other)
        if o.east_type.type != "Dict" or o.east_type.value["key"] != kv["key"]:
            raise ExpressionError(".merge_all() takes a Dict with the same key type")
        v2 = o.east_type.value["value"]
        upd, _o = _callback(update, [kv["value"], v2, kv["key"]], kv["value"])
        ini, _o2 = _callback(init, [kv["key"]], kv["value"])
        return self._effect("merge_all",
                            _builtin("DictMergeAll", NullType, [kv["key"], kv["value"], v2],
                                     [self.ir, o.ir, upd, ini]),
                            NullType)

    # ── Ref ──────────────────────────────────────────────────────────────

    def merge(self, value: Any, fn: Any) -> Expression:
        """Traced RefMerge: the cell takes ``fn(current, value)`` (yields Null)."""
        inner_t = self._mutable("merge", "Ref").value
        v = _lift(value)
        node, _o = _callback(fn, [inner_t, v.east_type], inner_t)
        return self._effect("merge",
                            _builtin("RefMerge", NullType, [inner_t, v.east_type],
                                     [self.ir, v.ir, node]),
                            NullType)

    for name, fn_ in list(locals().items()):
        if name.startswith("_") or name in ("_typed", "_callback"):
            continue
        if callable(fn_) and fn_.__name__ == name:
            setattr(_MutationOps, name, fn_)


_extend_mutation_ops()
